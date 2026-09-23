import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Effect, Predicate, Schema } from "effect"

/** Another `serve` or a `reindex` holds the data directory. */
export class Held extends Schema.TaggedError<Held>()("HubLock.Held", { message: Schema.String }) {}

/**
 * Hold `dataDir` for this process until the scope closes, failing with {@link Held} at once if
 * another process holds it. `serve` and `reindex` both take it, so neither runs beside the other
 * or a second copy of itself; `token` and `status` do not, since they may run beside `serve`.
 *
 * The hold is an exclusive SQLite lock on `hub.lock`, a file lock the operating system releases
 * when the process exits however it exits, so a killed holder never leaves a stale lock behind.
 */
export const hold = Effect.fn("HubLock.hold")(function* (dataDir: string) {
  mkdirSync(dataDir, { recursive: true })
  const path = join(dataDir, "hub.lock")
  const take = Effect.try({
    try: () => {
      const db = new Database(path, { create: true })
      try {
        db.run("PRAGMA locking_mode = EXCLUSIVE")
        // The first write under exclusive locking mode takes the lock and keeps it until close.
        db.run("BEGIN EXCLUSIVE")
        db.run("COMMIT")
        return db
      } catch (cause) {
        db.close()
        throw cause
      }
    },
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((cause) =>
      Predicate.hasProperty(cause, "code") && cause.code === "SQLITE_BUSY"
        ? Effect.fail(
            new Held({ message: `${dataDir} is held by another opencode-recall-hub process (serve or reindex); stop it first` }),
          )
        : Effect.die(cause),
    ),
  )
  yield* Effect.acquireRelease(take, (db) => Effect.sync(() => db.close()))
})

export * as HubLock from "./lock.ts"
