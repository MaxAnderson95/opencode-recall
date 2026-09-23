import { Database } from "bun:sqlite"
import { join } from "node:path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Archive } from "../../hub/src/archive/index.ts"
import { HubConfig } from "../../hub/src/config.ts"
import type { Embedder } from "../../hub/src/embedder.ts"
import { fakeEmbedder, fakeLayer } from "../../hub/src/fake-embedder.ts"
import { Log } from "../../hub/src/log.ts"
import { Hub } from "../../hub/src/serve.ts"

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
    addSession(
      id: string,
      { title = "Demo", time = 100, directory = "/work/demo" }: { title?: string; time?: number; directory?: string } = {},
    ) {
      db.run("INSERT INTO session_v2 VALUES (?, NULL, 'brave-otter', ?, ?, ?, ?)", [id, directory, title, time, time])
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
    move(sessionId: string, directory: string, time: number) {
      db.run("UPDATE session_v2 SET directory = ?, time_updated = ? WHERE id = ?", [directory, time, sessionId])
      advance(sessionId)
    },
    /** Delete a session as OpenCode does, taking its event counter with it. */
    remove(sessionId: string) {
      db.run("DELETE FROM session_message WHERE session_id = ?", [sessionId])
      db.run("DELETE FROM session_v2 WHERE id = ?", [sessionId])
      db.run("DELETE FROM event_sequence WHERE aggregate_id = ?", [sessionId])
    },
    close: () => db.close(),
  }
}

export type SourceDb = ReturnType<typeof sourceDb>

/**
 * A hub serving `dataDir` on a free port with `embedder`, as `serve` runs it. `issueToken` goes
 * through its own connection, as `opencode-recall-hub token issue` does.
 */
export async function startHub(dataDir: string, embedder: Embedder.Interface = fakeEmbedder()) {
  const settings = { dataDir, listen: "127.0.0.1:0", logLevel: "error" } as const
  const runtime = ManagedRuntime.make(
    Hub.layer(fakeLayer(embedder)).pipe(
      Layer.provide(Layer.succeed(HubConfig.Service, settings)),
      Layer.provide(Log.layer("error", () => {})),
    ),
  )
  const { url } = await runtime.runPromise(Hub.Listening)
  const issueToken = (name: string) =>
    Effect.runSync(
      Effect.scoped(Effect.flatMap(Archive.make(join(dataDir, "archive.db")), (admin) => admin.issueToken(name))).pipe(
        Effect.provide(fakeLayer()),
      ),
    )
  return { url, issueToken, stop: () => runtime.dispose() }
}
