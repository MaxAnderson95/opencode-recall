import type { Embedder, EmbeddingModel } from "./embedder.ts"

const DIMS = 64

const bucket = (word: string) => {
  let h = 2166136261
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619)
  return (h >>> 0) % DIMS
}

/**
 * A deterministic stand-in for the ONNX model, for tests: a normalized bag of hashed four-letter
 * word stems. Texts sharing stems score higher, so "deploying" finds "deployment", which BM25 over
 * unstemmed tokens does not. Set `down` to make every call reject as a failed model would.
 */
export function fakeEmbedder(model: Partial<EmbeddingModel> = {}): Embedder & { down: boolean; calls: string[][] } {
  const fake = {
    down: false,
    calls: [] as string[][],
    model: {
      model: "fake/bag-of-words",
      revision: "1",
      dtype: "fp32",
      dims: DIMS,
      runtime: "fake",
      pooling: "mean" as const,
      normalize: true,
      queryPrefix: "query: ",
      ...model,
    },
    async embed(texts: string[]) {
      fake.calls.push(texts)
      if (fake.down) throw new Error("embedding model unavailable")
      return texts.map((text) => {
        const v = new Float32Array(DIMS)
        for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) v[bucket(word.slice(0, 4))]! += 1
        const norm = Math.hypot(...v) || 1
        return v.map((x) => x / norm)
      })
    },
  }
  return fake
}
