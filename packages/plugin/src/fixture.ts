import { Database } from "bun:sqlite"

/**
 * An in-memory stand-in for OpenCode 2.0.14's database, holding only the columns the plugin reads.
 * Every write advances the session's `event_sequence` row, as a durable OpenCode event does.
 */
export function sourceDb() {
  const db = new Database(":memory:")
  db.run(`CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, slug TEXT NOT NULL, directory TEXT NOT NULL,
    title TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)`)
  db.run(`CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
    seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.run("CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, owner_id TEXT)")

  const advance = (sessionId: string): number =>
    (
      db
        .query(
          `INSERT INTO event_sequence (aggregate_id, seq) VALUES (?, 1)
           ON CONFLICT (aggregate_id) DO UPDATE SET seq = seq + 1 RETURNING seq`,
        )
        .get(sessionId) as { seq: number }
    ).seq

  return {
    db,
    addSession(id: string, { title = "Demo", time = 100 }: { title?: string; time?: number } = {}) {
      db.run("INSERT INTO session_v2 VALUES (?, NULL, 'brave-otter', '/work/demo', ?, ?, ?)", [id, title, time, time])
      advance(id)
    },
    addMessage(sessionId: string, type: string, data: object, time: number) {
      const seq = advance(sessionId)
      db.run("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)", [
        `msg_${sessionId}_${seq}`,
        sessionId,
        type,
        seq,
        time,
        time,
        JSON.stringify(data),
      ])
    },
    rename(sessionId: string, title: string, time: number) {
      db.run("UPDATE session_v2 SET title = ?, time_updated = ? WHERE id = ?", [title, time, sessionId])
      advance(sessionId)
    },
    close: () => db.close(),
  }
}

export type SourceDb = ReturnType<typeof sourceDb>
