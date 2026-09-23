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

// Summarizer workers are never uploaded, so they are invisible to everything that reads a session.
const UPLOADED = `substr(coalesce(s.title, ''), 1, ${WORKER_PREFIX.length}) <> '${WORKER_PREFIX}'`

const POSITIONS = `SELECT s.id AS sessionId, s.directory,
    coalesce((SELECT seq FROM event_sequence WHERE aggregate_id = s.id), 0) AS revision,
    max(s.time_updated, coalesce((SELECT max(time_created) FROM session_message WHERE session_id = s.id), 0))
      AS lastActivity
  FROM session_v2 s WHERE ${UPLOADED}`

/** The session's current position, or `null` if the database does not hold it or it is never uploaded. */
export function readPosition(db: Database, sessionId: string): Position | null {
  const row = db.query(`${POSITIONS} AND s.id = ?`).get(sessionId) as PositionRow | null
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
    if (!position || !session) return null
    const contentHash = createHash("sha256").update(JSON.stringify(session)).digest("hex")
    return { session, ...position, contentHash, extractorVersion: EXTRACTOR_VERSION }
  })()
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
  const row = db
    .query(
      `SELECT id, slug, title, directory, parent_id, time_created, time_updated FROM session_v2 s
       WHERE ${UPLOADED} AND id = ?`,
    )
    .get(sessionId) as SessionRow | null
  if (!row) return null

  const rows = db
    .query("SELECT id, type, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq")
    .all(sessionId) as MessageRow[]

  const messages = rows.flatMap((m): Message[] => {
    const type = m.type
    if (!isMessageType(type)) return []
    return [{ id: m.id, type, timeCreated: m.time_created, parts: extractParts(type, JSON.parse(m.data)) }]
  })

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

/** Read `db`, which the caller owns and closes. */
export const fromDatabase = (db: Database) =>
  Layer.succeed(
    Service,
    Service.of({
      position: (sessionId) => Effect.sync(() => Option.fromNullishOr(readPosition(db, sessionId))),
      positions: () => Effect.sync(() => readPositions(db)),
      snapshot: (sessionId) => Effect.sync(() => Option.fromNullishOr(readSnapshot(db, sessionId))),
      compactionBoundary: (sessionId) => Effect.sync(() => compactionBoundary(db, sessionId)),
    }),
  )

/** Open the database at `path` read-only for the layer's lifetime. */
export const layer = (path: string) =>
  Layer.unwrap(
    Effect.acquireRelease(
      Effect.sync(() => new Database(path, { readonly: true })),
      (db) => Effect.sync(() => db.close()),
    ).pipe(Effect.map(fromDatabase)),
  )

export * as Source from "./source.ts"
