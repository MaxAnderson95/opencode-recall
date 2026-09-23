import type { SpaceRecipe } from "@opencode-recall/protocol"
import type { FeatureExtractionPipeline } from "@huggingface/transformers"
import { Context, Data, Effect, Layer, Schema, Semaphore } from "effect"
import hub from "../package.json" with { type: "json" }

/** The recipe fields a model decides; the archive adds the chunking fields. */
export type EmbeddingModel = Pick<
  SpaceRecipe,
  "model" | "revision" | "dtype" | "dims" | "runtime" | "pooling" | "normalize" | "queryPrefix"
>

/** The model could not be loaded or run; `message` is its reason. */
export class Failed extends Schema.TaggedError<Failed>()("Embedder.Failed", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Whether the model is in memory: not yet, yes, or its last load failed and why. */
export type ModelState = Data.TaggedEnum<{
  Loading: {}
  Loaded: {}
  Failed: { readonly message: string }
}>
export const ModelState = Data.taggedEnum<ModelState>()

/** Turns text into vectors of the model's dimension. */
export interface Interface {
  readonly model: EmbeddingModel
  readonly embed: (texts: readonly string[]) => Effect.Effect<Float32Array[], Failed>
  /** Load the model now rather than on the first `embed`; nothing once it is loaded. */
  readonly load: Effect.Effect<void, Failed>
  readonly state: Effect.Effect<ModelState>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-recall/hub/Embedder") {}

/** transformers.js weight types with a fixed meaning; `auto` picks one per device, so it names no recipe. */
export const Dtype = Schema.Literals(["fp32", "fp16", "q8", "int8", "uint8", "q4", "bnb4", "q4f16"])

/** The model fields an operator chooses. Runtime, mean pooling, and normalization are this binary's. */
export const ModelChoice = Schema.Struct({
  model: Schema.String.check(Schema.isNonEmpty()),
  /**
   * The full Hugging Face commit the model files are fetched at. A branch or tag is refused: it can
   * move to other weights while the recorded recipe, and so the space's identity, stays the same.
   */
  revision: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/, { message: "expected a full 40-character commit hash" })),
  dtype: Dtype,
  dims: Schema.Int.check(Schema.isGreaterThan(0)),
  queryPrefix: Schema.String,
})
export interface ModelChoice extends Schema.Schema.Type<typeof ModelChoice> {}

export const BGE_SMALL: ModelChoice = {
  model: "Xenova/bge-small-en-v1.5",
  revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
  dtype: "q8",
  dims: 384,
  // bge retrieval queries want this prefix and documents do not; omitting it costs measurable recall.
  queryPrefix: "Represent this sentence for searching relevant passages: ",
}

/** The recipe fields `choice` decides, with this binary's runtime, pooling, and normalization. */
export const modelOf = (choice: ModelChoice) =>
  ({
    ...choice,
    // Tokenization and pooling are the library's, so its pinned version is part of the recipe.
    runtime: `@huggingface/transformers ${hub.dependencies["@huggingface/transformers"]}`,
    pooling: "mean",
    normalize: true,
  }) satisfies EmbeddingModel

/** Texts per inference call, as the single-machine plugin measured. */
const BATCH = 8

const failed = (cause: unknown) => new Failed({ message: cause instanceof Error ? cause.message : String(cause), cause })

/**
 * One vector per text from a pooled `[texts, dims]` tensor. Fails unless the tensor has exactly
 * that shape: a model wider than the configured `dims` would otherwise hand each text a slice of
 * its neighbour's vector, which has the right length and so passes every later check.
 */
export const splitRows = (tensor: { readonly data: unknown; readonly dims: readonly number[] }, texts: number, dims: number) => {
  const { data } = tensor
  if (!(data instanceof Float32Array))
    return Effect.fail(failed(new Error(`embedding model returned ${Object.prototype.toString.call(data)}, not a Float32Array`)))
  const [rows, width, ...rest] = tensor.dims
  if (rows !== texts || width !== dims || rest.length || data.length !== texts * dims)
    return Effect.fail(
      failed(new Error(`embedding model returned a [${tensor.dims.join(", ")}] tensor for ${texts} texts; expected [${texts}, ${dims}]`)),
    )
  return Effect.succeed(Array.from({ length: texts }, (_, j) => data.slice(j * dims, (j + 1) * dims)))
}

/**
 * The chosen model (by default `bge-small-en-v1.5`) on ONNX Runtime, in-process. The model loads
 * on `load` or first use, from `cacheDir` or downloaded into it, and a failed load is retried on
 * the next call. Calls run one at a time.
 */
export const onnx = (cacheDir: string, choice: ModelChoice = BGE_SMALL) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const model = modelOf(choice)
      const serial = yield* Semaphore.make(1)
      let loaded: FeatureExtractionPipeline | undefined
      let state: ModelState = ModelState.Loading()

      const pipeline = Effect.suspend(() =>
        loaded
          ? Effect.succeed(loaded)
          : Effect.tryPromise({
              try: async () => {
                // Imported here so nothing that never embeds loads the native runtime.
                const { pipeline, env } = await import("@huggingface/transformers")
                env.cacheDir = cacheDir
                return pipeline("feature-extraction", model.model, { dtype: model.dtype, revision: model.revision })
              },
              catch: failed,
            }).pipe(
              Effect.tap((pipe) => Effect.sync(() => ((loaded = pipe), (state = ModelState.Loaded())))),
              Effect.tapError((e) => Effect.sync(() => (state = ModelState.Failed({ message: e.message })))),
            ),
      )

      const embed = Effect.fn("Embedder.embed")(function* (texts: readonly string[]) {
        const pipe = yield* pipeline
        const vectors: Float32Array[] = []
        for (let i = 0; i < texts.length; i += BATCH) {
          const batch = texts.slice(i, i + BATCH)
          const tensor = yield* Effect.tryPromise({
            try: () => pipe(batch, { pooling: model.pooling, normalize: model.normalize }),
            catch: failed,
          })
          const split = splitRows(tensor, batch.length, model.dims)
          tensor.dispose()
          vectors.push(...(yield* split))
        }
        return vectors
      }, serial.withPermit)

      return Service.of({
        model,
        embed,
        load: pipeline.pipe(Effect.asVoid, serial.withPermit, Effect.withSpan("Embedder.load")),
        state: Effect.sync(() => state),
      })
    }),
  )

export * as Embedder from "./embedder.ts"
