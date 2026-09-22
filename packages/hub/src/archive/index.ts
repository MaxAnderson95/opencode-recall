/**
 * The Archive module: the only code that knows the hub's SQL schema.
 *
 * Every statement lives behind this interface. Callers hand it validated
 * protocol values and get plain results back.
 */
import { Database } from "bun:sqlite"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { Manifest, Snapshot, Tombstone } from "@opencode-recall/protocol"
import { migrations } from "./migrations.ts"

export const SCHEMA_VERSION = migrations.length

const TOKEN_PREFIX = "opencode-recall_"

/** One host. Outlives any single token, so rotating tokens never changes attribution. */
export type Source = { id: number; name: string }

export type TokenInfo = { id: number; source: string; timeCreated: number }

/** How `putSnapshot` resolved a snapshot against the copy the archive holds (§5 acceptance). */
export type PutResult = "archived" | "rewound" | "unchanged" | "stale_revision" | "hash_divergence" | "tombstoned"

export type Archive = {
  /** Schema versions before and after the migrations applied by this open. */
  readonly migration: { from: number; to: number }
  /**
   * Resolve the snapshot against the held copy by position `(lastActivity, revision)` and, when it
   * is accepted, replace the session and its whole transcript in one transaction, attributing it to
   * `sourceId`. A matching content hash is `unchanged` at any position and moves nothing.
   *
   * A tombstoned session is `tombstoned` unless the snapshot's last activity is after the deletion
   * time; such a snapshot is archived and clears the tombstone.
   */
  putSnapshot(snapshot: Snapshot, sourceId: number): PutResult
  /**
   * Delete the session and its transcript, and record a tombstone so no snapshot active at or
   * before the deletion time can bring it back. Of two tombstones for one session the later
   * deletion is kept. A held copy active after the deletion time wins and the tombstone is a
   * no-op, so a retried old deletion cannot remove a later re-import. `removed` is whether a copy
   * was deleted.
   */
  putTombstone(tombstone: Tombstone, sourceId: number): { removed: boolean }
  /** Every held session's position and hash, and every tombstone, across all sources. */
  manifest(): Manifest
  /**
   * Mint a token for the named source, creating the source if it is new.
   * The returned value is the only copy; the archive keeps just its hash.
   */
  issueToken(source: string): string
  listTokens(): TokenInfo[]
  /** Delete the token so the next request presenting it fails. False if no such token. */
  revokeToken(id: number): boolean
  /** The source a presented token maps to, or `null`. Compares against every live token in constant time. */
  authenticate(token: string): Source | null
  status(): { sessions: number }
  close(): void
}

/**
 * Open (creating if needed) and migrate the archive at `path`, or `:memory:`.
 * Throws without touching the database when it was migrated by a newer binary.
 */
export function openArchive(path: string): Archive {
  const db = new Database(path, { create: true, strict: true })
  try {
    db.run("PRAGMA foreign_keys = ON")
    // `token` subcommands write while `serve` holds the same file.
    db.run("PRAGMA busy_timeout = 5000")
    if (path !== ":memory:") db.run("PRAGMA journal_mode = WAL")
    const migration = migrate(db)
    return bind(db, migration)
  } catch (e) {
    db.close()
    throw e
  }
}

function migrate(db: Database): { from: number; to: number } {
  return db
    .transaction(() => {
      const { user_version: from } = db.query("PRAGMA user_version").get() as { user_version: number }
      if (from > SCHEMA_VERSION)
        throw new Error(
          `archive schema version ${from} is newer than this binary supports (${SCHEMA_VERSION}); refusing to start`,
        )
      for (const sql of migrations.slice(from)) db.run(sql)
      // PRAGMA takes no bound parameters; SCHEMA_VERSION is a compile-time integer.
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      return { from, to: SCHEMA_VERSION }
    })
    .immediate()
}

function bind(db: Database, migration: { from: number; to: number }): Archive {
  const deleteSession = db.prepare("DELETE FROM sessions WHERE id = ?")
  const selectHeld = db.prepare(
    `SELECT revision, last_activity AS lastActivity, extractor_version AS extractorVersion, content_hash AS contentHash
     FROM sessions WHERE id = ?`,
  )
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, source_id, slug, title, directory, parent_id, time_created, time_updated,
       revision, last_activity, extractor_version, content_hash)
     VALUES ($id, $sourceId, $slug, $title, $directory, $parentId, $timeCreated, $timeUpdated,
       $revision, $lastActivity, $extractorVersion, $contentHash)`,
  )
  const insertMessage = db.prepare(
    `INSERT INTO messages (id, session_id, ordinal, type, time_created)
     VALUES ($id, $sessionId, $ordinal, $type, $timeCreated)`,
  )
  const insertPart = db.prepare(
    `INSERT INTO parts (message_id, ordinal, kind, text) VALUES ($messageId, $ordinal, $kind, $text)`,
  )
  const countSessions = db.prepare("SELECT count(*) AS n FROM sessions")
  const selectTombstone = db.prepare("SELECT time_deleted AS timeDeleted FROM tombstones WHERE session_id = ?")
  const deleteTombstone = db.prepare("DELETE FROM tombstones WHERE session_id = ?")
  const upsertTombstone = db.prepare(
    `INSERT INTO tombstones (session_id, source_id, revision, time_deleted, reason)
     VALUES ($sessionId, $sourceId, $revision, $timeDeleted, 'deleted')
     ON CONFLICT (session_id) DO UPDATE SET source_id = excluded.source_id, revision = excluded.revision,
       time_deleted = excluded.time_deleted, reason = excluded.reason
     WHERE excluded.time_deleted > tombstones.time_deleted`,
  )
  const selectManifestSessions = db.prepare(
    `SELECT id AS sessionId, revision, last_activity AS lastActivity, content_hash AS contentHash,
       extractor_version AS extractorVersion
     FROM sessions ORDER BY id`,
  )
  const selectManifestTombstones = db.prepare(
    "SELECT session_id AS sessionId, time_deleted AS timeDeleted FROM tombstones ORDER BY session_id",
  )
  const upsertSource = db.prepare(
    `INSERT INTO sources (name, time_created) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`,
  )
  const insertToken = db.prepare("INSERT INTO tokens (source_id, hash, time_created) VALUES (?, ?, ?)")
  const selectTokens = db.prepare(
    `SELECT tokens.id, sources.name AS source, tokens.time_created AS timeCreated
     FROM tokens JOIN sources ON sources.id = tokens.source_id ORDER BY sources.name, tokens.id`,
  )
  const deleteToken = db.prepare("DELETE FROM tokens WHERE id = ?")
  const selectTokenHashes = db.prepare(
    "SELECT tokens.hash, sources.id, sources.name FROM tokens JOIN sources ON sources.id = tokens.source_id",
  )

  const issueToken = db.transaction((source: string) => {
    const { id } = upsertSource.get(source, Date.now()) as { id: number }
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url")
    insertToken.run(id, hashToken(token), Date.now())
    return token
  })

  function authenticate(token: string): Source | null {
    const presented = hashToken(token)
    const rows = selectTokenHashes.all() as { hash: Uint8Array; id: number; name: string }[]
    let match: Source | null = null
    // No early exit, so response time does not depend on which row matched.
    for (const row of rows) if (timingSafeEqual(row.hash, presented)) match = { id: row.id, name: row.name }
    return match
  }

  const putSnapshot = db.transaction((snapshot: Snapshot, sourceId: number): PutResult => {
    const { session } = snapshot
    const tombstone = selectTombstone.get(session.id) as Pick<Tombstone, "timeDeleted"> | null
    // Revisions are not compared: a delete-then-reimport restarts the counter below the tombstone's.
    if (tombstone && snapshot.lastActivity <= tombstone.timeDeleted) return "tombstoned"
    const held = selectHeld.get(session.id) as Held | null
    const result = held ? resolve(snapshot, held) : "archived"
    if (result !== "archived" && result !== "rewound") return result

    if (tombstone) deleteTombstone.run(session.id)
    // Cascades to messages and parts, so a shrunken transcript leaves nothing behind.
    deleteSession.run(session.id)
    insertSession.run({
      id: session.id,
      sourceId,
      slug: session.slug,
      title: session.title,
      directory: session.directory,
      parentId: session.parentId,
      timeCreated: session.timeCreated,
      timeUpdated: session.timeUpdated,
      revision: snapshot.revision,
      lastActivity: snapshot.lastActivity,
      extractorVersion: snapshot.extractorVersion,
      contentHash: snapshot.contentHash,
    })
    session.messages.forEach((message, ordinal) => {
      insertMessage.run({
        id: message.id,
        sessionId: session.id,
        ordinal,
        type: message.type,
        timeCreated: message.timeCreated,
      })
      message.parts.forEach((part, partOrdinal) =>
        insertPart.run({ messageId: message.id, ordinal: partOrdinal, kind: part.kind, text: part.text }),
      )
    })
    return result
  })

  const putTombstone = db.transaction((tombstone: Tombstone, sourceId: number) => {
    // A copy active after the deletion already superseded it, as it would have cleared the tombstone.
    const held = selectHeld.get(tombstone.sessionId) as Held | null
    if (held && held.lastActivity > tombstone.timeDeleted) return { removed: false }
    upsertTombstone.run({ ...tombstone, sourceId })
    return { removed: deleteSession.run(tombstone.sessionId).changes > 0 }
  })

  return {
    migration,
    // Immediate: the read-then-write must not race a `token` subcommand writing the same file.
    putSnapshot: (snapshot, sourceId) => putSnapshot.immediate(snapshot, sourceId),
    putTombstone: (tombstone, sourceId) => putTombstone.immediate(tombstone, sourceId),
    manifest: db.transaction(() => ({
      sessions: selectManifestSessions.all() as Manifest["sessions"],
      tombstones: selectManifestTombstones.all() as Manifest["tombstones"],
    })),
    issueToken: (source) => issueToken(source),
    listTokens: () => selectTokens.all() as TokenInfo[],
    revokeToken: (id) => deleteToken.run(id).changes > 0,
    authenticate,
    status: () => ({ sessions: (countSessions.get() as { n: number }).n }),
    close: () => db.close(),
  }
}

type Held = Pick<Snapshot, "revision" | "lastActivity" | "extractorVersion" | "contentHash">

/**
 * The §5 acceptance rules. Last activity leads the comparison so that a rewound copy, once
 * accepted, is never displaced by a stale copy still holding the pre-rewind revision.
 */
function resolve(incoming: Snapshot, held: Held): PutResult {
  if (incoming.contentHash === held.contentHash) return "unchanged"
  const order = Math.sign(incoming.lastActivity - held.lastActivity) || Math.sign(incoming.revision - held.revision)
  if (order > 0) return incoming.revision > held.revision ? "archived" : "rewound"
  if (order < 0) return "stale_revision"
  // Equal position, different content: only a newer extractor may re-extract unchanged history.
  return incoming.extractorVersion > held.extractorVersion ? "archived" : "hash_divergence"
}

const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest()
