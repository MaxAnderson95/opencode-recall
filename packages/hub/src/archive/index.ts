/**
 * The Archive module: the only code that knows the hub's SQL schema.
 *
 * Every statement lives behind this interface. Callers hand it validated
 * protocol values and get plain results back.
 */
import { Database } from "bun:sqlite"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { Session } from "@opencode-recall/protocol"
import { migrations } from "./migrations.ts"

export const SCHEMA_VERSION = migrations.length

const TOKEN_PREFIX = "opencode-recall_"

/** One host. Outlives any single token, so rotating tokens never changes attribution. */
export type Source = { id: number; name: string }

export type TokenInfo = { id: number; source: string; timeCreated: number }

export type Archive = {
  /** Schema versions before and after the migrations applied by this open. */
  readonly migration: { from: number; to: number }
  /** Replace the session and its whole transcript in one transaction, attributing it to `sourceId`. */
  putSnapshot(session: Session, sourceId: number): void
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
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, source_id, slug, title, directory, parent_id, time_created, time_updated)
     VALUES ($id, $sourceId, $slug, $title, $directory, $parentId, $timeCreated, $timeUpdated)`,
  )
  const insertMessage = db.prepare(
    `INSERT INTO messages (id, session_id, ordinal, type, time_created)
     VALUES ($id, $sessionId, $ordinal, $type, $timeCreated)`,
  )
  const insertPart = db.prepare(
    `INSERT INTO parts (message_id, ordinal, kind, text) VALUES ($messageId, $ordinal, $kind, $text)`,
  )
  const countSessions = db.prepare("SELECT count(*) AS n FROM sessions")
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

  const putSnapshot = db.transaction((session: Session, sourceId: number) => {
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
  })

  return {
    migration,
    putSnapshot: (session, sourceId) => putSnapshot(session, sourceId),
    issueToken: (source) => issueToken(source),
    listTokens: () => selectTokens.all() as TokenInfo[],
    revokeToken: (id) => deleteToken.run(id).changes > 0,
    authenticate,
    status: () => ({ sessions: (countSessions.get() as { n: number }).n }),
    close: () => db.close(),
  }
}

const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest()
