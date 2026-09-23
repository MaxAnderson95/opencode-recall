import type { SpaceRecipe } from "@opencode-recall/protocol"
import type { FeatureExtractionPipeline } from "@huggingface/transformers"
import hub from "../package.json" with { type: "json" }

/** The recipe fields a model decides; the archive adds the chunking fields. */
export type EmbeddingModel = Pick<
  SpaceRecipe,
  "model" | "revision" | "dtype" | "dims" | "runtime" | "pooling" | "normalize" | "queryPrefix"
>

/** Turns text into vectors of the model's dimension. Rejects when the model cannot be loaded or run. */
export type Embedder = {
  readonly model: EmbeddingModel
  embed(texts: string[]): Promise<Float32Array[]>
}

export const BGE_SMALL: EmbeddingModel = {
  model: "Xenova/bge-small-en-v1.5",
  // The Hugging Face commit the model files are fetched at, so `main` moving cannot change a space.
  revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
  dtype: "q8",
  dims: 384,
  // Tokenization and pooling are the library's, so its pinned version is part of the recipe.
  runtime: `@huggingface/transformers ${hub.dependencies["@huggingface/transformers"]}`,
  pooling: "mean",
  normalize: true,
  // bge retrieval queries want this prefix and documents do not; omitting it costs measurable recall.
  queryPrefix: "Represent this sentence for searching relevant passages: ",
}

/** Texts per inference call, as the single-machine plugin measured. */
const BATCH = 8

/**
 * `bge-small-en-v1.5` on ONNX Runtime, in-process. The model loads on first use, from `cacheDir`
 * or downloaded into it, and a failed load is retried on the next call. Calls run one at a time.
 */
export function onnxEmbedder(cacheDir: string): Embedder {
  const model = BGE_SMALL
  let loading: Promise<FeatureExtractionPipeline> | null = null
  let serial: Promise<unknown> = Promise.resolve()

  function load() {
    loading ??= (async () => {
      // Imported here so nothing that never embeds loads the native runtime.
      const { pipeline, env } = await import("@huggingface/transformers")
      env.cacheDir = cacheDir
      return pipeline("feature-extraction", model.model, { dtype: "q8", revision: model.revision })
    })()
    loading.catch(() => {
      loading = null
    })
    return loading
  }

  async function run(texts: string[]): Promise<Float32Array[]> {
    const pipe = await load()
    const vectors: Float32Array[] = []
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH)
      const tensor = await pipe(batch, { pooling: model.pooling, normalize: model.normalize })
      const { data } = tensor
      if (!(data instanceof Float32Array)) throw new Error(`embedding model returned ${data.constructor.name}, not Float32Array`)
      for (let j = 0; j < batch.length; j++) vectors.push(data.slice(j * model.dims, (j + 1) * model.dims))
      tensor.dispose()
    }
    return vectors
  }

  return {
    model,
    embed(texts) {
      const result = serial.then(() => run(texts))
      serial = result.catch(() => {})
      return result
    },
  }
}
