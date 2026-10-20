/**
 * Everything that knows the shape of OpenCode's own database. It is opened
 * read-only and never written.
 */
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { MessageType, type Message, type Session, type Snapshot } from "@opencode-recall/protocol"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { WORKER_PREFIX, extractParts } from "./extract.ts"

/** Bump whenever extraction output changes for unchanged input, so the hub accepts re-extracted history. */
export const EXTRACTOR_VERSION = 2

/** Where a session stands in the §5 order: last activity first, then revision. */
export const Position = Schema.Struct({ lastActivity: Schema.Int, revision: Schema.Int })
export interface Position extends Schema.Schema.Type<typeof Position> {}

type SessionRow = {
  id: string
  slug: string
  title: string | null
  directory: string
  parent_id: string | null
  time_created: number
  time_updated: number
}

type MessageRow = { id: string; type: string; time_created: number; data: string }

const isMessageType = Schema.is(MessageType)

/** The message a kept row contributes, or `null` for a bookkeeping row, which is never parsed. */
function toMessage(m: MessageRow): Message | null {
  const type = m.type
  if (!isMessageType(type)) return null
  return { id: m.id, type, timeCreated: m.time_created, parts: extractParts(type, JSON.parse(m.data)) }
}

// Summarizer workers are never uploaded, so they are invisible to everything that reads a session.
const UPLOADED = `substr(coalesce(s.title, ''), 1, ${WORKER_PREFIX.length}) <> '${WORKER_PREFIX}'`

// OpenCode's v1 migration records a session with no events at -1, which is no revision yet: the
// session has nothing to upload until its first event makes it 0.
const POSITIONS = `SELECT * FROM (SELECT s.id AS sessionId, s.directory,
    coalesce((SELECT seq FROM event_sequence WHERE aggregate_id = s.id), 0) AS revision,
    max(s.time_updated, coalesce((SELECT max(time_created) FROM session_message WHERE session_id = s.id), 0))
      AS lastActivity
  FROM session_v2 s WHERE ${UPLOADED}) WHERE revision >= 0`

/** The session's current position, or `null` if the database does not hold it or it is never uploaded. */
export function readPosition(db: Database, sessionId: string): Position | null {
  const row = db.query(`${POSITIONS} AND sessionId = ?`).get(sessionId) as PositionRow | null
  return row && { revision: row.revision, lastActivity: row.lastActivity }
}

type PositionRow = { sessionId: string; directory: string } & Position

/** A session the database holds: where it stands, and the working directory it belongs to. */
export interface Local {
  readonly position: Position
  readonly directory: string
}

/** Every session the database holds. */
export function readPositions(db: Database): Map<string, Local> {
  const rows = db.query(POSITIONS).all() as PositionRow[]
  return new Map(
    rows.map(({ sessionId, directory, revision, lastActivity }) => [sessionId, { position: { revision, lastActivity }, directory }]),
  )
}

/**
 * Read one session with its position and content hash, all inside one read transaction so the
 * revision cannot describe a different transcript than the one sent. `null` if the session is absent.
 */
export function readSnapshot(db: Database, sessionId: string): Snapshot | null {
  return db.transaction(() => {
    const position = readPosition(db, sessionId)
    const session = readSession(db, sessionId)
    return position && session && toSnapshot(position, session)
  })()
}

function toSnapshot(position: Position, session: Session): Snapshot {
  const contentHash = createHash("sha256").update(JSON.stringify(session)).digest("hex")
  return { session, ...position, contentHash, extractorVersion: EXTRACTOR_VERSION }
}

/** How much `cachedSnapshots` holds: sessions, and bytes counted as extracted message JSON length times 2. */
export interface CacheLimits {
  readonly sessions: number
  readonly bytes: number
}

export const CACHE_LIMITS: CacheLimits = { sessions: 16, bytes: 64 * 1024 * 1024 }

type MessageMeta = { id: string; type: string; time_created: number; time_updated: number }

interface Extracted {
  readonly message: Message
  readonly timeUpdated: number
  readonly bytes: number
}

interface Entry {
  readonly messages: ReadonlyMap<string, Extracted>
  readonly bytes: number
}

/**
 * `readSnapshot`, remembering the extracted messages of the most recently snapshotted sessions so
 * the next snapshot of one parses `data` only for rows that are new or whose `time_updated`
 * changed. OpenCode sets `session_message.time_updated` on every insert and update. Its output is
 * identical to `readSnapshot`'s.
 */
export function cachedSnapshots(db: Database, limits: CacheLimits = CACHE_LIMITS): (sessionId: string) => Snapshot | null {
  // Map order is recency: the first entry is the least recently snapshotted.
  const entries = new Map<string, Entry>()
  let held = 0

  const forget = (sessionId: string) => {
    held -= entries.get(sessionId)?.bytes ?? 0
    entries.delete(sessionId)
  }

  return (sessionId) => {
    // A row written later in the millisecond the read started could carry this same
    // `time_updated`, so only rows strictly older than the read are remembered. The clock is read
    // before the transaction's first query, which is where SQLite fixes what the read sees.
    const readAt = Date.now()
    return db.transaction(() => {
      const cached = entries.get(sessionId)?.messages
      forget(sessionId)
      const position = readPosition(db, sessionId)
      const row = readSessionRow(db, sessionId)
      if (!position || !row) return null

      const rows = (
        db
          .query("SELECT id, type, time_created, time_updated FROM session_message WHERE session_id = ? ORDER BY seq")
          .all(sessionId) as MessageMeta[]
      ).filter((m) => isMessageType(m.type))
      const stale = rows.filter((m) => cached?.get(m.id)?.timeUpdated !== m.time_updated).map((m) => m.id)
      const fresh = new Map(
        (
          db
            .query(
              `SELECT id, type, time_created, time_updated, data FROM session_message
               WHERE session_id = ? AND id IN (SELECT value FROM json_each(?))`,
            )
            .all(sessionId, JSON.stringify(stale)) as (MessageRow & MessageMeta)[]
        ).flatMap((m): [string, Extracted][] => {
          const extracted = toMessage(m)
          if (!extracted) return []
          // Extraction slices strings out of ones as large as the row, and a slice keeps its whole
          // source alive; the copy holds only the kept characters, so the byte count is honest.
          const message = structuredClone(extracted)
          return [[m.id, { message, timeUpdated: m.time_updated, bytes: JSON.stringify(message).length * 2 }]]
        }),
      )

      const kept = new Map<string, Extracted>()
      const messages = rows.flatMap((m): Message[] => {
        const extracted = fresh.get(m.id) ?? cached?.get(m.id)
        if (!extracted) return []
        if (extracted.timeUpdated < readAt) kept.set(m.id, extracted)
        return [extracted.message]
      })

      const bytes = [...kept.values()].reduce((sum, m) => sum + m.bytes, 0)
      if (bytes <= limits.bytes) {
        entries.set(sessionId, { messages: kept, bytes })
        held += bytes
        for (const oldest of entries.keys()) {
          if (entries.size <= limits.sessions && held <= limits.bytes) break
          forget(oldest)
        }
      }
      return toSnapshot(position, toSession(row, messages))
    })()
  }
}

/** Time of the session's latest completed compaction, or 0 if it never compacted. */
export function compactionBoundary(db: Database, sessionId: string): number {
  const row = db
    .query(
      `SELECT max(time_created) AS t FROM session_message
       WHERE session_id = ? AND type = 'compaction' AND json_extract(data, '$.status') = 'completed'`,
    )
    .get(sessionId) as { t: number | null }
  return row.t ?? 0
}

/** Read one v2 session's transcript, or `null` if the database does not hold it or it is never uploaded. */
export function readSession(db: Database, sessionId: string): Session | null {
  const row = readSessionRow(db, sessionId)
  if (!row) return null

  const rows = db
    .query("SELECT id, type, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq")
    .all(sessionId) as MessageRow[]

  return toSession(row, rows.flatMap((m) => toMessage(m) ?? []))
}

function readSessionRow(db: Database, sessionId: string): SessionRow | null {
  return db
    .query(
      `SELECT id, slug, title, directory, parent_id, time_created, time_updated FROM session_v2 s
       WHERE ${UPLOADED} AND id = ?`,
    )
    .get(sessionId) as SessionRow | null
}

function toSession(row: SessionRow, messages: Message[]): Session {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title ?? "",
    directory: row.directory,
    parentId: row.parent_id,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    messages,
  }
}

/** The host's OpenCode database, as the uploader and the search tool read it. */
export interface Interface {
  readonly position: (sessionId: string) => Effect.Effect<Option.Option<Position>>
  /** Every session the database holds. */
  readonly positions: () => Effect.Effect<Map<string, Local>>
  readonly snapshot: (sessionId: string) => Effect.Effect<Option.Option<Snapshot>>
  readonly compactionBoundary: (sessionId: string) => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-recall/plugin/Source") {}

/** Read `db`, which the caller owns and closes. Each build holds its own snapshot cache. */
export const fromDatabase = (db: Database) =>
  Layer.sync(Service, () => {
    const snapshot = cachedSnapshots(db)
    return Service.of({
      position: (sessionId) => Effect.sync(() => Option.fromNullishOr(readPosition(db, sessionId))),
      positions: () => Effect.sync(() => readPositions(db)),
      snapshot: (sessionId) => Effect.sync(() => Option.fromNullishOr(snapshot(sessionId))),
      compactionBoundary: (sessionId) => Effect.sync(() => compactionBoundary(db, sessionId)),
    })
  })

/** Open the database at `path` read-only for the layer's lifetime. */
export const layer = (path: string) =>
  Layer.unwrap(
    Effect.acquireRelease(
      Effect.sync(() => new Database(path, { readonly: true })),
      (db) => Effect.sync(() => db.close()),
    ).pipe(Effect.map(fromDatabase)),
  )

export * as Source from "./source.ts"
