import { Context, Duration, Effect, Layer, Queue, Schedule } from "effect"
import { Archive } from "./archive/index.ts"
import { Embedder } from "./embedder.ts"

/**
 * Chunks embedded per archive call. Query embeddings queue behind an in-flight batch, so this is
 * one inference batch: a search waits for at most eight chunks.
 */
const BATCH = 8

export type RetryDelays = { firstMs: number; maxMs: number }
const DEFAULT_RETRY: RetryDelays = { firstMs: 30_000, maxMs: 10 * 60_000 }

export interface Interface {
  /** Ask for the queue to be drained; kicks while a drain runs coalesce into one more pass. */
  readonly kick: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-recall/hub/EmbedQueue") {}

/**
 * Loads the model and drains the archive's embedding queue on a background fiber whenever kicked.
 * When a pass fails, it is retried on a timer that doubles with each further failure up to
 * `maxMs`, and kicks are ignored until then so a burst of uploads does not hammer a broken model.
 * The queue itself is in the archive, so the layer kicks once to resume whatever a previous run
 * left and to load the model. Releasing the layer stops retrying and waits for an in-flight batch,
 * so the archive can be closed after it.
 */
export const layer = (retry: RetryDelays = DEFAULT_RETRY) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const archive = yield* Archive.Service
      const embedder = yield* Embedder.Service
      const kicks = yield* Queue.dropping<void>(1)

      const backoff = Schedule.exponential(Duration.millis(retry.firstMs)).pipe(
        Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.millis(retry.maxMs)))),
        Schedule.setInputType<{ readonly message: string }>(),
        Schedule.tap(({ input, duration }) =>
          Effect.logWarning("embedding failed").pipe(
            Effect.annotateLogs({ error: input.message, retryInMs: Duration.toMillis(duration) }),
          ),
        ),
      )

      const pass = Effect.gen(function* () {
        // Every kick so far, and any that arrived during a backoff, is covered by this pass.
        yield* Queue.clear(kicks)
        let embedded = 0
        yield* Effect.gen(function* () {
          // Loading first means the pass the layer kicks at startup loads the model even when
          // nothing is queued, so readiness reflects it, and a model that cannot load is retried.
          yield* embedder.load
          for (let n; (n = yield* archive.embedPending(BATCH).pipe(Effect.uninterruptible)); ) embedded += n
        }).pipe(
          // An unexpected failure is retried like a failing model rather than ending the worker.
          Effect.catchDefect((defect) => Effect.fail({ message: defect instanceof Error ? defect.message : String(defect) })),
          Effect.ensuring(
            Effect.suspend(() =>
              embedded ? Effect.logInfo("chunks embedded").pipe(Effect.annotateLogs({ chunks: embedded })) : Effect.void,
            ),
          ),
        )
      })

      yield* Queue.take(kicks).pipe(Effect.andThen(pass.pipe(Effect.retry(backoff))), Effect.forever, Effect.forkScoped)

      const kick = Queue.offer(kicks, undefined).pipe(Effect.asVoid)
      yield* kick
      return Service.of({ kick })
    }),
  )

export * as EmbedQueue from "./embed-queue.ts"
