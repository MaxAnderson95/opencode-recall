import { Effect, Layer } from "effect"
import { Embedder, type EmbeddingModel } from "./embedder.ts"

const DIMS = 64

const bucket = (word: string) => {
  let h = 2166136261
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619)
  return (h >>> 0) % DIMS
}

export type FakeEmbedder = Embedder.Interface & { down: boolean; loaded: boolean; calls: string[][] }

const unavailable = () => new Embedder.Failed({ message: "embedding model unavailable", cause: null })

/**
 * A deterministic stand-in for the ONNX model, for tests: a normalized bag of hashed four-letter
 * word stems. Texts sharing stems score higher, so "deploying" finds "deployment", which BM25 over
 * unstemmed tokens does not. Set `down` to make every call fail as a failed model would. It counts
 * as loaded after its first successful `load` or `embed`, as the real one does.
 */
export function fakeEmbedder(model: Partial<EmbeddingModel> = {}): FakeEmbedder {
  const fake: FakeEmbedder = {
    down: false,
    loaded: false,
    calls: [],
    model: {
      model: "fake/bag-of-words",
      revision: "1",
      dtype: "fp32",
      dims: DIMS,
      runtime: "fake",
      pooling: "mean",
      normalize: true,
      queryPrefix: "query: ",
      ...model,
    },
    load: Effect.suspend(() => (fake.down ? Effect.fail(unavailable()) : Effect.sync(() => void (fake.loaded = true)))),
    state: Effect.sync(() =>
      fake.down
        ? Embedder.ModelState.Failed({ message: unavailable().message })
        : fake.loaded
          ? Embedder.ModelState.Loaded()
          : Embedder.ModelState.Loading(),
    ),
    embed: (texts) =>
      Effect.suspend(() => {
        fake.calls.push([...texts])
        if (fake.down) return Effect.fail(unavailable())
        fake.loaded = true
        return Effect.succeed(
          texts.map((text) => {
            const v = new Float32Array(DIMS)
            for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) v[bucket(word.slice(0, 4))]! += 1
            const norm = Math.hypot(...v) || 1
            return v.map((x) => x / norm)
          }),
        )
      }),
  }
  return fake
}

export const fakeLayer = (fake: Embedder.Interface = fakeEmbedder()) => Layer.succeed(Embedder.Service, fake)
