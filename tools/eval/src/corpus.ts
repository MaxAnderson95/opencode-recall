/** The indexed corpus, and the query embedder that must match how it was built. */
import { indexDb, settings } from "./retrieval.ts"

export type Corpus = {
  n: number
  dims: number
  /** Vectors in chunk-id order, matching the production matrix layout. */
  mat: Float32Array
  ids: Float64Array
  times: Float64Array
  sessions: string[]
  messages: string[]
  scopes: string[]
  texts: string[]
}

export function loadCorpus(): Corpus {
  const dims = settings.embed.dims
  const count = (indexDb.query("select count(*) c from chunks").get() as { c: number }).c
  const out: Corpus = {
    n: 0,
    dims,
    mat: new Float32Array(count * dims),
    ids: new Float64Array(count),
    times: new Float64Array(count),
    sessions: new Array(count),
    messages: new Array(count),
    scopes: new Array(count),
    texts: new Array(count),
  }
  const page = indexDb.prepare(
    "select id, session_id, message_id, time, scope, text, emb from chunks where id > ? order by id limit 4000",
  )
  let i = 0
  let last = 0
  for (;;) {
    const rows = page.all(last) as {
      id: number
      session_id: string
      message_id: string
      time: number
      scope: string
      text: string
      emb: Uint8Array
    }[]
    if (!rows.length) break
    for (const r of rows) {
      last = r.id
      out.ids[i] = r.id
      out.times[i] = r.time
      out.sessions[i] = r.session_id
      out.messages[i] = r.message_id
      out.scopes[i] = r.scope
      out.texts[i] = r.text
      const v =
        r.emb.byteOffset % 4 === 0 && r.emb.byteLength === dims * 4
          ? new Float32Array(r.emb.buffer, r.emb.byteOffset, dims)
          : new Float32Array(r.emb.slice().buffer, 0, dims)
      out.mat.set(v, i * dims)
      i++
    }
  }
  out.n = i
  return out
}

/**
 * Query vectors built the way production builds them. The prefix matters:
 * bge-family models are trained with it and omitting it measurably lowers
 * retrieval, which is easy to get wrong and hard to notice.
 */
export async function embedQueries(texts: string[]): Promise<Float32Array[]> {
  const { pipeline, env } = await import("@huggingface/transformers")
  env.cacheDir = `${process.env.HOME}/.local/share/opencode-recall/models`
  const pipe = (await pipeline("feature-extraction", settings.embed.model, { dtype: "q8" })) as any
  const dims = settings.embed.dims
  const out: Float32Array[] = []
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16).map((t) => settings.embed.queryPrefix + t)
    const tensor = await pipe(batch, { pooling: "mean", normalize: true })
    const d = tensor.data as Float32Array
    for (let j = 0; j < batch.length; j++) out.push(d.slice(j * dims, (j + 1) * dims))
    tensor.dispose?.()
  }
  return out
}

export function normalize(v: Float32Array): Float32Array {
  let s = 0
  for (const x of v) s += x * x
  const inv = 1 / (Math.sqrt(s) || 1)
  for (let i = 0; i < v.length; i++) v[i] *= inv
  return v
}
