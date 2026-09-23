import { mkdirSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"

import { config, paths } from "./config.ts"
import type { Label } from "./score.ts"

const db = new Database(config.opencodeDb, { readonly: true })

type Row = { session_id: string; seq: number; time_created: number; data: string }

const rows = db
  .query<Row, []>(
    `select session_id, seq, time_created, data from session_message
     where data like '%"recall_search"%' or data like '%"recall_expand"%' or data like '%"recall_inspect"%'
     order by session_id, seq`,
  )
  .all()

console.log(`messages mentioning a recall tool: ${rows.length}`)

type Call = { session_id: string; seq: number; time: number; tool: string; input: any; output?: string }
const calls: Call[] = []

for (const r of rows) {
  let parsed: any
  try {
    parsed = JSON.parse(r.data)
  } catch {
    continue
  }
  for (const part of parsed.content ?? []) {
    if (part?.type !== "tool") continue
    if (!part.name?.startsWith("recall_")) continue
    if (part.state?.status !== "completed") continue
    calls.push({
      session_id: r.session_id,
      seq: r.seq,
      time: r.time_created,
      tool: part.name,
      input: part.state.input ?? {},
      output: typeof part.state.output === "string" ? part.state.output : JSON.stringify(part.state.output ?? ""),
    })
  }
}

const byTool = calls.reduce<Record<string, number>>((a, c) => ((a[c.tool] = (a[c.tool] ?? 0) + 1), a), {})
console.log("calls by tool:", byTool)

// A search followed, in the same conversation and before the next search, by an expand/inspect
// targeting a session id is an implicit relevance judgment on that search.
const grouped = new Map<string, Call[]>()
for (const c of calls) {
  const arr = grouped.get(c.session_id) ?? []
  arr.push(c)
  grouped.set(c.session_id, arr)
}

const labels: Label[] = []

for (const [, seqCalls] of grouped) {
  seqCalls.sort((a, b) => a.seq - b.seq)
  for (const [i, c] of seqCalls.entries()) {
    if (c.tool !== "recall_search") continue
    const query = typeof c.input.query === "string" ? c.input.query.trim() : ""
    if (!query) continue
    const relevant = new Set<string>()
    for (const n of seqCalls.slice(i + 1)) {
      if (n.tool === "recall_search") break
      const sid = n.input.session_id
      if (typeof sid === "string" && sid.startsWith("ses_")) relevant.add(sid)
    }
    if (relevant.size === 0) continue
    labels.push({
      query,
      filters: {
        directory: c.input.directory,
        since: c.input.since,
        until: c.input.until,
        mode: c.input.mode,
        scope: c.input.scope,
      },
      relevant: [...relevant],
      from_session: c.session_id,
      time: c.time,
    })
  }
}

console.log(`labeled queries (search followed by an expand/inspect): ${labels.length}`)
const multi = labels.filter((l) => l.relevant.length > 1).length
console.log(`  with >1 clicked session: ${multi}`)
const filtered = labels.filter((l) => l.filters.directory || l.filters.since || l.filters.until).length
console.log(`  carrying a directory/date filter: ${filtered}`)

// Only keep labels whose clicked sessions a frozen corpus can hold (v2 sessions), or the label is unscoreable.
const known = new Set(db.query<{ id: string }, []>("select id from session_v2").all().map((r) => r.id))
const scoreable = labels
  .map((l) => ({ ...l, relevant: l.relevant.filter((s) => known.has(s)) }))
  .filter((l) => l.relevant.length > 0)
console.log(`scoreable against OpenCode's v2 sessions: ${scoreable.length}`)

mkdirSync(path.dirname(paths.labels), { recursive: true })
await Bun.write(paths.labels, JSON.stringify(scoreable, null, 1))
console.log("\nsample queries:")
for (const l of scoreable.slice(0, 12)) console.log(`  [${l.relevant.length}] ${l.query.slice(0, 95)}`)
