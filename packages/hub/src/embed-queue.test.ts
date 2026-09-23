import { expect, test } from "bun:test"
import type { Snapshot } from "@opencode-recall/protocol"
import { Context, Effect, Layer, Option, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { Archive } from "./archive/index.ts"
import { EmbedQueue } from "./embed-queue.ts"
import { fakeEmbedder, fakeLayer } from "./fake-embedder.ts"
import { Log } from "./log.ts"

type Line = { msg: string; retryInMs?: number; chunks?: number }

/** Runs `body` with an in-memory archive, a fake embedder, a captured debug log, and a test clock. */
const run = <A, E>(body: (env: Env) => Effect.Effect<A, E, Archive.Service | Scope.Scope>) => {
  const lines: Line[] = []
  const embedder = fakeEmbedder()
  return Effect.runPromise(
    Effect.gen(function* () {
      const archive = yield* Archive.Service
      const source = Option.getOrThrow(yield* archive.authenticate(yield* archive.issueToken("laptop"))).id
      return yield* body({ archive, embedder, source, lines })
    }).pipe(
      Effect.provide(Archive.layer(":memory:").pipe(Layer.provide(fakeLayer(embedder)))),
      Effect.provide(Layer.mergeAll(Log.layer("debug", (line) => lines.push(JSON.parse(line))), TestClock.layer())),
      Effect.scoped,
    ),
  )
}

type Env = { archive: Archive.Interface; embedder: ReturnType<typeof fakeEmbedder>; source: number; lines: Line[] }

const start = (retry?: EmbedQueue.RetryDelays) =>
  Layer.build(EmbedQueue.layer(retry)).pipe(Effect.map(Context.get(EmbedQueue.Service)))

/** Let background fibers run until `done` holds. */
const settle = Effect.fnUntraced(function* (done: () => boolean) {
  for (let i = 0; i < 10_000 && !done(); i++) yield* Effect.yieldNow
  expect(done()).toBe(true)
})

const snapshot = (id: string, text: string): Snapshot => ({
  session: {
    id,
    slug: "s",
    title: "t",
    directory: "/w",
    parentId: null,
    timeCreated: 1,
    timeUpdated: 1,
    messages: [{ id: `${id}_m`, type: "user", timeCreated: 1, parts: [{ kind: "text", text }] }],
  },
  revision: 1,
  lastActivity: 1,
  contentHash: text,
  extractorVersion: 1,
})

test("a kick drains the whole queue, including chunks queued while it runs", () =>
  run(({ archive, source, lines }) =>
    Effect.gen(function* () {
      for (let i = 0; i < 20; i++) yield* archive.putSnapshot(snapshot(`ses_${i}`, `text ${i}`), source)
      const queue = yield* start()
      yield* archive.putSnapshot(snapshot("ses_late", "late"), source)
      yield* queue.kick
      let embedded = 0
      yield* settle(() => {
        embedded = lines.filter((l) => l.msg === "chunks embedded").reduce((n, l) => n + l.chunks!, 0)
        return embedded === 42
      })
      expect((yield* archive.status()).embeddedChunks).toBe(42)
    }),
  ))

test("a failing embedder is retried on a doubling timer, ignoring kicks meanwhile, until it recovers", () =>
  run(({ archive, embedder, source, lines }) =>
    Effect.gen(function* () {
      const failures = () => lines.filter((l) => l.msg === "embedding failed")
      embedder.down = true
      yield* archive.putSnapshot(snapshot("ses_a", "needle"), source)
      const queue = yield* start({ firstMs: 20, maxMs: 40 })
      yield* settle(() => failures().length === 1)
      yield* TestClock.adjust(20)
      yield* settle(() => failures().length === 2)
      yield* TestClock.adjust(40)
      yield* settle(() => failures().length === 3)
      expect(failures().map((l) => l.retryInMs)).toEqual([20, 40, 40])

      const calls = embedder.calls.length
      yield* queue.kick
      for (let i = 0; i < 100; i++) yield* Effect.yieldNow
      expect(embedder.calls.length).toBe(calls)

      embedder.down = false
      yield* TestClock.adjust(40)
      yield* settle(() => lines.some((l) => l.msg === "chunks embedded"))
      expect((yield* archive.status()).embeddedChunks).toBe(2)
    }),
  ))
