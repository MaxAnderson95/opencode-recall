/**
 * Compares a candidate embedding model against the incumbent, end to end.
 *
 * The candidate is any OpenAI-compatible `/embeddings` endpoint. Vectors are
 * cached under the data directory, so re-scoring is free after the first run.
 *
 *   bun run compare --model voyageai/voyage-4-lite --dims 512 --input-type
 */
import { mkdirSync } from "node:fs"
import { paths, config } from "./config.ts"
import { embedQueries, loadCorpus, normalize, type Corpus } from "./corpus.ts"
import { fuseToSessions, lexical } from "./retrieval.ts"
import { comparePaired, filtersFor, formatMetrics, reciprocalRanks, score, semantic, type Label } from "./score.ts"

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1]
  return fallback
}
const model = arg("model")
if (!model) throw new Error("usage: compare --model <slug> [--dims N] [--input-type] [--endpoint URL]")
const dims = Number(arg("dims", "1024"))
const endpoint = arg("endpoint", "https://openrouter.ai/api/v1/embeddings")!
const useInputType = process.argv.includes("--input-type")
const tag = `${model.replace(/[^a-z0-9]/gi, "_")}_${dims}`

const apiKey = process.env.EVAL_EMBED_API_KEY
if (!apiKey) throw new Error("set EVAL_EMBED_API_KEY")

const labels: Label[] = await Bun.file(paths.labels).json()
const corpus = loadCorpus()

async function embedBatch(input: string[], type: "document" | "query"): Promise<number[][]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const body: Record<string, unknown> = { model, input, dimensions: dims }
    if (useInputType) body.input_type = type
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const j = (await res.json()) as { data: { index: number; embedding: number[] }[] }
      const v = j.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
      if (v[0].length !== dims) throw new Error(`asked for ${dims} dims, got ${v[0].length}`)
      return v
    }
    if (res.status === 400) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
    await Bun.sleep(1500 * (attempt + 1))
  }
  throw new Error("retries exhausted")
}

async function embedAll(texts: string[], type: "document" | "query", file: string): Promise<Float32Array> {
  const cached = Bun.file(file)
  if (await cached.exists()) return new Float32Array(await cached.arrayBuffer())
  mkdirSync(config.dataDir, { recursive: true })
  const all = new Float32Array(texts.length * dims)
  const starts: number[] = []
  for (let i = 0; i < texts.length; i += 96) starts.push(i)
  let done = 0
  for (let k = 0; k < starts.length; k += 6) {
    await Promise.all(
      starts.slice(k, k + 6).map(async (s) => {
        const slice = texts.slice(s, s + 96)
        const vecs = await embedBatch(slice, type)
        vecs.forEach((v, j) => all.set(v, (s + j) * dims))
        done += slice.length
      }),
    )
    process.stdout.write(`\r  embedding ${type}s ${done}/${texts.length}   `)
  }
  process.stdout.write("\n")
  await Bun.write(file, all.buffer as ArrayBuffer)
  return all
}

const docVecs = await embedAll(corpus.texts.slice(0, corpus.n), "document", paths.corpusVectors(tag))
const qFlat = await embedAll(labels.map((l) => l.query), "query", paths.queryVectors(tag))
for (let i = 0; i < corpus.n; i++) normalize(docVecs.subarray(i * dims, (i + 1) * dims))
const candQ = labels.map((_, i) => normalize(qFlat.slice(i * dims, (i + 1) * dims)))

const baseQ = await embedQueries(labels.map((l) => l.query))
const lex = labels.map((l) => lexical(l.query, filtersFor(l)))

const candidate: Corpus = { ...corpus, mat: docVecs, dims }
const rankBase = (l: Label, i: number) => fuseToSessions(lex[i], semantic(baseQ[i], corpus, filtersFor(l)))
const rankCand = (l: Label, i: number) => fuseToSessions(lex[i], semantic(candQ[i], candidate, filtersFor(l), docVecs, dims))

console.log()
console.log(formatMetrics("incumbent hybrid", score(labels, rankBase)))
console.log(formatMetrics(`${model} @${dims} hybrid`, score(labels, rankCand)))

const stats = comparePaired(reciprocalRanks(labels, rankBase), reciprocalRanks(labels, rankCand))
console.log(
  `\ndelta=${stats.delta >= 0 ? "+" : ""}${stats.delta.toFixed(4)}  95% CI [${stats.lo.toFixed(4)}, ${stats.hi.toFixed(4)}]  p=${stats.p.toFixed(3)}  wins/losses=${stats.wins}/${stats.losses}`,
)
console.log(
  stats.lo <= 0 && stats.hi >= 0
    ? "The interval spans zero: this candidate is not distinguishable from the incumbent."
    : "The interval excludes zero.",
)
