/** Labels, ranking them through the Archive, and session-level metrics. */
import type { Search } from "../../../packages/protocol/src/index.ts"
import type { Archive } from "../../../packages/hub/src/archive/index.ts"

export type Label = {
  query: string
  filters: { directory?: string; since?: string; until?: string; mode?: string; scope?: string }
  /** Sessions the human opened after this search. */
  relevant: string[]
  from_session: string
  time: number
}

export type Mode = NonNullable<Search["mode"]>

/** The search `recall_search` would have sent for this label, run as `mode`. */
function searchFor(l: Label, mode: Mode): Search {
  const { since, until, directory, scope } = l.filters
  return {
    query: l.query,
    mode,
    scope: scope === "user-messages" ? "user-messages" : "all",
    ...(since && { since: Date.parse(since) }),
    // A date-only `until` includes that whole day.
    ...(until && { until: Date.parse(until) + 86_400_000 }),
    ...(directory && { directory }),
    // Every metric stops at rank 10.
    limit: 10,
    // The calling session is dropped whole, as it is for an uncompacted session.
    exclude: { sessionId: l.from_session, before: 0 },
  }
}

/** Zero-based rank of the first relevant session for each label, or -1 when none is in the top 10. */
export async function rankAll(archive: Archive, labels: Label[], mode: Mode): Promise<number[]> {
  const ranks: number[] = []
  for (const l of labels) {
    const { sessions, semanticUnavailable } = await archive.search(searchFor(l, mode), 0)
    if (semanticUnavailable !== undefined) throw new Error(`semantic branch unavailable: ${semanticUnavailable}`)
    const relevant = new Set(l.relevant)
    ranks.push(sessions.findIndex((s) => relevant.has(s.sessionId)))
  }
  return ranks
}

/**
 * `hitK` is the share of labels with any relevant session in the top K. It is a hit rate, not
 * recall: a label may have several relevant sessions and one is enough.
 */
export type Metrics = { mrr: number; hit1: number; hit5: number; hit10: number; n: number }

export function metrics(ranks: number[]): Metrics {
  const n = ranks.length
  const hit = (k: number) => ranks.filter((r) => r >= 0 && r < k).length / n
  const mrr = ranks.reduce((s, r) => s + (r >= 0 ? 1 / (r + 1) : 0), 0) / n
  return { mrr, hit1: hit(1), hit5: hit(5), hit10: hit(10), n }
}

export function formatMetrics(name: string, m: Metrics): string {
  return `${name.padEnd(34)} MRR@10=${m.mrr.toFixed(4)}  Hit@1=${m.hit1.toFixed(4)}  Hit@5=${m.hit5.toFixed(4)}  Hit@10=${m.hit10.toFixed(4)}  n=${m.n}`
}
