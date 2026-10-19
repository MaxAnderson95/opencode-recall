import { expect, test } from "bun:test"
import { Deferred, Effect, Layer, Option, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { Archive } from "./archive/index.ts"
import type { Embedder } from "./embedder.ts"
import { fakeEmbedder, fakeLayer, type FakeEmbedder } from "./fake-embedder.ts"
import { Log } from "./log.ts"
import { Memory } from "./memory.ts"

type Line = { msg: string; point?: string; matrix?: Record<string, number> } & Record<string, unknown>

type Env = { archive: Archive.Interface; embedder: FakeEmbedder; ready: Deferred.Deferred<void>; signalled: Deferred.Deferred<void> }

/** Runs `body` with an in-memory archive, a fake embedder, a test clock, and the `memory` lines it logs. */
async function run(body: (env: Env) => Effect.Effect<void, unknown, Archive.Service | Embedder.Service | Scope.Scope>) {
  const lines: Line[] = []
  const embedder = fakeEmbedder()
  const ready = Effect.runSync(Deferred.make<void>())
  const signalled = Effect.runSync(Deferred.make<void>())
  const log = Log.layer("info", (text) => {
    const line: Line = JSON.parse(text)
    if (line.msg !== "memory") return
    lines.push(line)
    Effect.runSync(Deferred.succeed(line.point === "ready" ? ready : signalled, undefined))
  })
  await Effect.runPromise(
    Effect.flatMap(Archive.Service, (archive) => body({ archive, embedder, ready, signalled })).pipe(
      Effect.scoped,
      Effect.provide(Archive.layer(":memory:").pipe(Layer.provideMerge(fakeLayer(embedder)))),
      Effect.provide(Layer.mergeAll(log, TestClock.layer())),
    ),
  )
  return lines
}

test("watch reports memory with the matrix's rows once the model loads, and again on SIGUSR2", async () => {
  const lines = await run(({ archive, ready, signalled }) =>
    Effect.gen(function* () {
      const { id } = Option.getOrThrow(yield* archive.authenticate(yield* archive.issueToken("laptop")))
      yield* archive.putSnapshot(
        {
          session: {
            id: "ses_1",
            slug: "s",
            title: "t",
            directory: "/w",
            parentId: null,
            timeCreated: 1,
            timeUpdated: 2,
            messages: [{ id: "msg_1", type: "user", timeCreated: 10, parts: [{ kind: "text", text: "how is the deployment going" }] }],
          },
          revision: 1,
          lastActivity: 10,
          contentHash: "h1",
          extractorVersion: 1,
        },
        id,
      )
      while (yield* archive.embedPending(8));
      yield* archive.loadVectors()

      yield* Memory.watch
      yield* Deferred.await(ready)
      process.kill(process.pid, "SIGUSR2")
      yield* Deferred.await(signalled)
    }),
  )

  expect(lines.map((l) => l.point)).toEqual(["ready", "signal"])
  expect(lines[0]!.rssMB).toBeGreaterThan(0)
  expect(lines[0]!.heapMB).toBeGreaterThan(0)
  expect(lines[0]!.matrix).toEqual({ capacity: 1024, live: 2, removed: 0, allocatedMB: 0, writtenMB: 0 })
})

test("watch still reports ready when the model loads only after a failed load", async () => {
  const lines = await run(({ embedder, ready }) =>
    Effect.gen(function* () {
      embedder.down = true
      yield* Memory.watch
      yield* TestClock.adjust("5 seconds")
      expect(yield* Deferred.isDone(ready)).toBe(false)

      embedder.down = false
      yield* embedder.load
      yield* TestClock.adjust("1 second")
      yield* Deferred.await(ready)
    }),
  )

  expect(lines.map((l) => l.point)).toEqual(["ready"])
  expect(lines[0]!.matrix).toBeUndefined()
})
