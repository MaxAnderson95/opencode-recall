/**
 * The Archive module: the only code that knows the hub's SQL schema.
 *
 * Every statement lives behind this interface. Callers hand it validated
 * protocol values and get plain results back.
 */
import { Database } from "bun:sqlite"
import type { Session } from "@opencode-recall/protocol"
import { migrations } from "./migrations.ts"

export const SCHEMA_VERSION = migrations.length

export type Archive = {
  /** Schema versions before and after the migrations applied by this open. */
  readonly migration: { from: number; to: number }
  /** Replace the session and its whole transcript in one transaction. */
  putSnapshot(session: Session): void
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
    `INSERT INTO sessions (id, slug, title, directory, parent_id, time_created, time_updated)
     VALUES ($id, $slug, $title, $directory, $parentId, $timeCreated, $timeUpdated)`,
  )
  const insertMessage = db.prepare(
    `INSERT INTO messages (id, session_id, ordinal, type, time_created)
     VALUES ($id, $sessionId, $ordinal, $type, $timeCreated)`,
  )
  const insertPart = db.prepare(
    `INSERT INTO parts (message_id, ordinal, kind, text) VALUES ($messageId, $ordinal, $kind, $text)`,
  )
  const countSessions = db.prepare("SELECT count(*) AS n FROM sessions")

  const putSnapshot = db.transaction((session: Session) => {
    // Cascades to messages and parts, so a shrunken transcript leaves nothing behind.
    deleteSession.run(session.id)
    insertSession.run({
      id: session.id,
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
    putSnapshot: (session) => putSnapshot(session),
    status: () => ({ sessions: (countSessions.get() as { n: number }).n }),
    close: () => db.close(),
  }
}
