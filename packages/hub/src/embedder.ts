import type { SpaceRecipe } from "@opencode-recall/protocol"
import type { FeatureExtractionPipeline } from "@huggingface/transformers"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
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

/** Turns text into vectors of the model's dimension. */
export interface Interface {
  readonly model: EmbeddingModel
  readonly embed: (texts: readonly string[]) => Effect.Effect<Float32Array[], Failed>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-recall/hub/Embedder") {}

/** transformers.js weight types with a fixed meaning; `auto` picks one per device, so it names no recipe. */
export const Dtype = Schema.Literals(["fp32", "fp16", "q8", "int8", "uint8", "q4", "bnb4", "q4f16"])

/** The model fields an operator chooses. Runtime, mean pooling, and normalization are this binary's. */
export const ModelChoice = Schema.Struct({
  model: Schema.String.check(Schema.isNonEmpty()),
  /** The Hugging Face commit the model files are fetched at, so `main` moving cannot change a space. */
  revision: Schema.String.check(Schema.isNonEmpty()),
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
 * The chosen model (by default `bge-small-en-v1.5`) on ONNX Runtime, in-process. The model loads
 * on first use, from `cacheDir` or downloaded into it, and a failed load is retried on the next
 * call. Calls run one at a time.
 */
export const onnx = (cacheDir: string, choice: ModelChoice = BGE_SMALL) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const model = modelOf(choice)
      const serial = yield* Semaphore.make(1)
      let loaded: FeatureExtractionPipeline | undefined

      const load = Effect.tryPromise({
        try: async () => {
          // Imported here so nothing that never embeds loads the native runtime.
          const { pipeline, env } = await import("@huggingface/transformers")
          env.cacheDir = cacheDir
          return pipeline("feature-extraction", model.model, { dtype: model.dtype, revision: model.revision })
        },
        catch: failed,
      })

      const embed = Effect.fn("Embedder.embed")(function* (texts: readonly string[]) {
        const pipe = (loaded ??= yield* load)
        const vectors: Float32Array[] = []
        for (let i = 0; i < texts.length; i += BATCH) {
          const batch = texts.slice(i, i + BATCH)
          const tensor = yield* Effect.tryPromise({
            try: () => pipe(batch, { pooling: model.pooling, normalize: model.normalize }),
            catch: failed,
          })
          const { data } = tensor
          if (!(data instanceof Float32Array))
            return yield* failed(new Error(`embedding model returned ${data.constructor.name}, not Float32Array`))
          for (let j = 0; j < batch.length; j++) vectors.push(data.slice(j * model.dims, (j + 1) * model.dims))
          tensor.dispose()
        }
        return vectors
      }, serial.withPermit)

      return Service.of({ model, embed })
    }),
  )

export * as Embedder from "./embedder.ts"
