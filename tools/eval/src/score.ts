/** Filters, the swappable semantic branch, and session-level metrics. */
import type { Corpus } from "./corpus.ts"
import { indexDb, settings, type Filters, type Hit } from "./retrieval.ts"

export type Label = {
  query: string
  filters: { directory?: string; since?: string; until?: string; mode?: string; scope?: string }
  /** Sessions the human opened after this search. */
  relevant: string[]
  from_session: string
  time: number
}

export function filtersFor(l: Label): Filters {
  return {
    scope: (l.filters.scope as Filters["scope"]) ?? "all",
    since: l.filters.since ? Date.parse(l.filters.since) : 0,
    until: l.filters.until ? Date.parse(l.filters.until) + 86_400_000 : Number.MAX_SAFE_INTEGER,
    includeTools: true,
    directory: l.filters.directory,
    // Production drops the calling session; an uncompacted one is dropped whole.
    excludeSession: l.from_session,
    excludeBefore: 0,
  }
}

const dirCache = new Map<string, Set<string>>()
function sessionsInDirectory(directory: string): Set<string> {
  let s = dirCache.get(directory)
  if (!s) {
    const rows = indexDb.query("select id from sessions where directory like ?").all(`%${directory}%`) as {
      id: string
    }[]
    s = new Set(rows.map((r) => r.id))
    dirCache.set(directory, s)
  }
  return s
}

/**
 * The semantic branch, mirroring production but over an arbitrary vector set so
 * a candidate model can be compared against the incumbent on one corpus.
 */
export function semantic(qvec: Float32Array, c: Corpus, f: Filters, vectors = c.mat, dims = c.dims): Hit[] {
  const allow = f.directory ? sessionsInDirectory(f.directory) : null
  const scope = f.scope ?? "all"
  const scored: { score: number; i: number }[] = []
  for (let i = 0; i < c.n; i++) {
    if (c.scopes[i] !== scope) continue
    const t = c.times[i]
    if (t < f.since || t > f.until) continue
    const sid = c.sessions[i]
    if (f.sessionId && sid !== f.sessionId) continue
    if (f.excludeSession === sid && t >= f.excludeBefore) continue
    if (allow && !allow.has(sid)) continue
    let s = 0
    const off = i * dims
    for (let k = 0; k < dims; k++) s += qvec[k] * vectors[off + k]
    scored.push({ score: s, i })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, settings.search.candidates).map((t) => ({
    session_id: c.sessions[t.i],
    message_id: c.messages[t.i],
    time: c.times[t.i],
    via: `semantic ${t.score.toFixed(2)}`,
    src: { kind: "chunk" as const, chunk_id: c.ids[t.i] },
  }))
}

export type Metrics = { mrr: number; r1: number; r5: number; r10: number; found: number; n: number }

/** Reciprocal rank of the first relevant session, per query. */
export function reciprocalRanks(labels: Label[], rank: (l: Label, i: number) => string[]): number[] {
  return labels.map((l, i) => {
    const ranked = rank(l, i)
    const rel = new Set(l.relevant)
    const at = ranked.findIndex((s) => rel.has(s))
    return at >= 0 && at < 10 ? 1 / (at + 1) : 0
  })
}

export function score(labels: Label[], rank: (l: Label, i: number) => string[]): Metrics {
  let mrr = 0
  let r1 = 0
  let r5 = 0
  let r10 = 0
  let found = 0
  labels.forEach((l, i) => {
    const ranked = rank(l, i)
    const rel = new Set(l.relevant)
    const at = ranked.findIndex((s) => rel.has(s))
    if (at < 0) return
    found++
    if (at < 10) mrr += 1 / (at + 1)
    if (at < 1) r1++
    if (at < 5) r5++
    if (at < 10) r10++
  })
  const n = labels.length
  return { mrr: mrr / n, r1: r1 / n, r5: r5 / n, r10: r10 / n, found, n }
}

export function formatMetrics(name: string, m: Metrics): string {
  return `${name.padEnd(34)} MRR@10=${m.mrr.toFixed(4)}  R@1=${m.r1.toFixed(4)}  R@5=${m.r5.toFixed(4)}  R@10=${m.r10.toFixed(4)}  found=${m.found}/${m.n}`
}

/**
 * Paired bootstrap CI and permutation test on the per-query difference. Small
 * MRR gaps on a few hundred queries are usually noise; this says which.
 */
export function comparePaired(a: number[], b: number[], resamples = 10_000) {
  const diffs = b.map((x, i) => x - a[i])
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
  const observed = mean(diffs)
  const boots: number[] = []
  for (let r = 0; r < resamples; r++) {
    let s = 0
    for (let i = 0; i < diffs.length; i++) s += diffs[(Math.random() * diffs.length) | 0]
    boots.push(s / diffs.length)
  }
  boots.sort((x, y) => x - y)
  let atLeastAsExtreme = 0
  for (let r = 0; r < resamples; r++) {
    let s = 0
    for (const d of diffs) s += Math.random() < 0.5 ? d : -d
    if (Math.abs(s / diffs.length) >= Math.abs(observed)) atLeastAsExtreme++
  }
  return {
    delta: observed,
    lo: boots[Math.floor(resamples * 0.025)],
    hi: boots[Math.floor(resamples * 0.975)],
    p: (atLeastAsExtreme + 1) / (resamples + 1),
    wins: diffs.filter((d) => d > 0).length,
    losses: diffs.filter((d) => d < 0).length,
  }
}
