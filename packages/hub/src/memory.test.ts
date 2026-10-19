import { expect, test } from "bun:test"
import { Deferred, Effect, Layer, Option } from "effect"
import { Archive } from "./archive/index.ts"
import { fakeLayer } from "./fake-embedder.ts"
import { Log } from "./log.ts"
import { Memory } from "./memory.ts"

type Line = { msg: string; point?: string; matrix?: Record<string, number> } & Record<string, unknown>

test("watch reports memory with the matrix's rows once the model loads, and again on SIGUSR2", async () => {
  const lines: Line[] = []
  const ready = Effect.runSync(Deferred.make<void>())
  const signalled = Effect.runSync(Deferred.make<void>())
  const log = Log.layer("info", (text) => {
    const line: Line = JSON.parse(text)
    if (line.msg !== "memory") return
    lines.push(line)
    Effect.runSync(Deferred.succeed(line.point === "ready" ? ready : signalled, undefined))
  })

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const archive = yield* Archive.Service
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
    ).pipe(Effect.provide(Archive.layer(":memory:").pipe(Layer.provideMerge(fakeLayer()), Layer.provideMerge(log)))),
  )

  expect(lines.map((l) => l.point)).toEqual(["ready", "signal"])
  expect(lines[0]!.rssMB).toBeGreaterThan(0)
  expect(lines[0]!.heapMB).toBeGreaterThan(0)
  expect(lines[0]!.matrix).toEqual({ capacity: 1024, live: 2, removed: 0, allocatedMB: 0, writtenMB: 0 })
})
