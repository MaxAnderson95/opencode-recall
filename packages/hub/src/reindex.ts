import { Clock, Console, Effect, Layer, Option } from "effect"
import { Archive } from "./archive/index.ts"
import { HubConfig } from "./config.ts"
import { Embedder } from "./embedder.ts"
import { Hub } from "./serve.ts"

export const REINDEX_USAGE = "opencode-recall-hub reindex"

/** Chunks per second measured on an M5 Pro (§3.6); only an estimate anywhere else. */
const MEASURED_RATE = 45
/** Chunks per archive call: each call is one read and one write transaction around the model. */
const BATCH = 64
const PROGRESS_EVERY = 1_000

const seconds = (ms: number) => Math.round(ms / 1000)

/**
 * The `reindex` subcommand: build a vector space of the configured recipe from every held session,
 * then activate it and drop the old one. It logs the chunk count and an estimated duration before
 * embedding, progress while embedding, and returns the process exit code. A failure or a kill
 * leaves the active space as it was; the partial space is reclaimed by the next `serve` or
 * `reindex`.
 */
export const run = Effect.fn("Reindex.run")(
  function* (args: readonly string[]) {
    if (args.length > 0) {
      yield* Console.error(`usage: ${REINDEX_USAGE}`)
      return 2
    }
    const archive = yield* Archive.Service
    const reclaimed = yield* archive.reclaim()
    if (reclaimed) yield* Effect.logWarning("reclaimed an interrupted reindex").pipe(Effect.annotateLogs({ chunks: reclaimed }))

    const rebuild = yield* archive.rebuild()
    if (Option.isNone(rebuild)) {
      yield* Effect.logInfo("the active vector space already has the configured recipe; nothing to reindex")
      return 0
    }
    const { chunks, recipe, embedNext, activate } = rebuild.value
    yield* Effect.logInfo("reindex starting").pipe(
      Effect.annotateLogs({ chunks, estimatedSeconds: Math.ceil(chunks / MEASURED_RATE), estimateRate: MEASURED_RATE, recipe }),
    )

    const started = yield* Clock.currentTimeMillis
    let embedded = 0
    for (let n; (n = yield* embedNext(BATCH)); ) {
      const before = embedded
      embedded += n
      if (Math.floor(embedded / PROGRESS_EVERY) === Math.floor(before / PROGRESS_EVERY)) continue
      const elapsed = (yield* Clock.currentTimeMillis) - started
      yield* Effect.logInfo("reindex progress").pipe(
        Effect.annotateLogs({
          embedded,
          chunks,
          elapsedSeconds: seconds(elapsed),
          remainingSeconds: seconds((elapsed / embedded) * (chunks - embedded)),
        }),
      )
    }
    yield* activate
    yield* Effect.logInfo("reindex complete; the new vector space is active").pipe(
      Effect.annotateLogs({ chunks: embedded, elapsedSeconds: seconds((yield* Clock.currentTimeMillis) - started) }),
    )
    return 0
  },
  Effect.tapError((error) =>
    Effect.logError("reindex failed; the active vector space is unchanged").pipe(Effect.annotateLogs({ error: error.message })),
  ),
)

/** The configured model, which a reindex builds with whatever the active space holds. */
const configuredEmbedder = Layer.unwrap(
  Effect.map(HubConfig.Service, (config) => Embedder.onnx(Hub.modelsDir(config), config.embedding)),
)

/**
 * What `run` needs: the data directory held against `serve` and other reindexes, then the archive
 * in it, embedding with the configured model (or with `embedder`, which then decides the recipe,
 * as in tests). Fails to build with `HubLock.Held` while another process holds the directory.
 */
export const layer = (embedder?: Layer.Layer<Embedder.Service, never, HubConfig.Service>) =>
  Hub.archive(embedder, configuredEmbedder).pipe(Layer.provide(Hub.exclusive))

export * as Reindex from "./reindex.ts"
