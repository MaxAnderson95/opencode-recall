/**
 * Explains the queries where retrieval never surfaces the session the human
 * opened. Failure causes are more actionable than an aggregate metric: a
 * filter excluding the answer and a chunk ranking 900th are the same number
 * here and completely different problems.
 */
import { paths } from "./config.ts"
import { embedQueries, loadCorpus } from "./corpus.ts"
import { fuseToSessions, indexDb, lexical } from "./retrieval.ts"
import { filtersFor, semantic, type Label } from "./score.ts"

const labels: Label[] = await Bun.file(paths.labels).json()
const corpus = loadCorpus()
const qvecs = await embedQueries(labels.map((l) => l.query))

const sessionRow = indexDb.prepare("select id, directory from sessions where id = ?")
const chunksBySession = new Map<string, number[]>()
for (let i = 0; i < corpus.n; i++) {
  const a = chunksBySession.get(corpus.sessions[i]) ?? []
  a.push(i)
  chunksBySession.set(corpus.sessions[i], a)
}

/** Where the target's best chunk really sits, ignoring the candidate cut. */
function bestRank(qvec: Float32Array, l: Label, target: string) {
  const f = filtersFor(l)
  const scope = f.scope ?? "all"
  const allow = f.directory
    ? new Set(
        (indexDb.query("select id from sessions where directory like ?").all(`%${f.directory}%`) as { id: string }[]).map(
          (r) => r.id,
        ),
      )
    : null
  let best = -Infinity
  let passed = false
  const scores: number[] = []
  for (let i = 0; i < corpus.n; i++) {
    if (corpus.scopes[i] !== scope) continue
    const t = corpus.times[i]
    if (t < f.since || t > f.until) continue
    const sid = corpus.sessions[i]
    if (f.excludeSession === sid && t >= f.excludeBefore) continue
    if (allow && !allow.has(sid)) continue
    let s = 0
    for (let k = 0; k < corpus.dims; k++) s += qvec[k] * corpus.mat[i * corpus.dims + k]
    scores.push(s)
    if (sid === target && s > best) {
      best = s
      passed = true
    }
  }
  if (!passed) return { rank: -1, pool: scores.length }
  return { rank: scores.filter((s) => s > best).length + 1, pool: scores.length }
}

const counts = new Map<string, number>()
const examples: string[] = []

labels.forEach((l, i) => {
  const f = filtersFor(l)
  const ranked = fuseToSessions(lexical(l.query, f), semantic(qvecs[i], corpus, f))
  const rel = new Set(l.relevant)
  if (ranked.some((s) => rel.has(s))) return

  const target = l.relevant[0]
  const row = sessionRow.get(target) as { directory: string } | undefined
  const idxs = chunksBySession.get(target) ?? []

  let cause: string
  if (idxs.length === 0) cause = "target has no chunks"
  else if (l.from_session === target) cause = "target is the calling session (excluded by design)"
  else if (f.directory && !(row?.directory ?? "").includes(f.directory)) cause = "directory filter excluded the target"
  else if (!idxs.some((k) => corpus.times[k] >= f.since && corpus.times[k] <= f.until))
    cause = "date filter excluded the target"
  else {
    const r = bestRank(qvecs[i], l, target)
    if (r.rank < 0) cause = "scope filter excluded the target"
    else if (r.rank <= 500) cause = "ranked below the candidate cut"
    else cause = "ranked far down: not retrievable as chunked"
    if (examples.length < 12) examples.push(`  ${cause} [rank ${r.rank}/${r.pool}]  ${l.query.slice(0, 80)}`)
  }
  counts.set(cause, (counts.get(cause) ?? 0) + 1)
})

const total = [...counts.values()].reduce((a, b) => a + b, 0)
console.log(`\n${total} of ${labels.length} queries never surface the opened session\n`)
for (const [cause, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`${String(n).padStart(3)}  ${cause}`)
console.log("\nexamples:")
for (const e of examples) console.log(e)
