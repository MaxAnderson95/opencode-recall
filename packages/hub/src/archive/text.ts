/**
 * Pure retrieval helpers carried over from the single-machine recall plugin's `lib/text.ts` and
 * `lib/search.ts`: FTS query construction, segmentation, snippet rendering, and RRF fusion.
 * Changing any of them changes results, so they stay as measured. No database, no filesystem.
 */

const ANSI_RE =
  /[\u001b\u009b](?:\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\[[0-9;?]*[0-9A-ORZcf-nqry=><]|[()#][0-9A-Za-z])/g

export const stripAnsi = (text: string) => text.replace(ANSI_RE, "")

const TOKEN_RE = /[\p{L}\p{N}_./@-]+/gu

export function queryTokens(query: string): string[] {
  return query.match(TOKEN_RE) ?? []
}

/** FTS5 MATCH treats many characters as operators; quote every token. */
export function ftsQuery(query: string, op: "AND" | "OR"): string | undefined {
  const tokens = queryTokens(query)
  if (!tokens.length) return undefined
  return tokens.map((t) => `"${t.replaceAll('"', "")}"`).join(` ${op} `)
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff

/**
 * Split text into non-overlapping segments for FTS indexing.
 *
 * Long parts are split rather than truncated: nothing becomes unsearchable, and BM25 length
 * normalisation stops being skewed by the occasional 400 KB message. Breaks prefer a newline, then
 * whitespace, near the end of each segment. A hard cut never splits a surrogate pair, since each half
 * alone would encode to UTF-8 as a replacement character.
 */
function segmentText(text: string, size: number): { start: number; text: string }[] {
  if (size <= 0 || text.length <= size) return text.trim() ? [{ start: 0, text }] : []
  const out: { start: number; text: string }[] = []
  let pos = 0
  while (pos < text.length) {
    let end = Math.min(pos + size, text.length)
    if (end < text.length) {
      const window = text.slice(pos + Math.floor(size * 0.6), end)
      const nl = window.lastIndexOf("\n")
      const sp = window.lastIndexOf(" ")
      const rel = nl >= 0 ? nl : sp
      if (rel >= 0) end = pos + Math.floor(size * 0.6) + rel + 1
      else if (isHighSurrogate(text.charCodeAt(end - 1))) end--
    }
    const slice = text.slice(pos, end)
    if (slice.trim()) out.push({ start: pos, text: slice })
    pos = end
  }
  return out
}

/**
 * The segments of a part's text, as positions in its UTF-8 encoding: `start` is a zero-based byte
 * offset and `length` a byte count, not the UTF-16 code units JavaScript string offsets use.
 */
export function segments(text: string, size: number): { start: number; length: number }[] {
  let unit = 0
  let byte = 0
  return segmentText(text, size).map((seg) => {
    byte += Buffer.byteLength(text.slice(unit, seg.start))
    unit = seg.start
    return { start: byte, length: Buffer.byteLength(seg.text) }
  })
}

/** Render a highlighted excerpt around the densest cluster of query terms. */
export function makeSnippet(text: string, tokens: string[], width = 220, open = "«", close = "»"): string {
  const flat = stripAnsi(text).replace(/\s+/g, " ").trim()
  if (!flat) return ""
  const lower = flat.toLowerCase()
  const wanted = [...new Set(tokens.map((t) => t.toLowerCase()).filter(Boolean))]

  type Occ = { start: number; end: number; token: string }
  const occs: Occ[] = []
  for (const tok of wanted) {
    let from = 0
    for (let n = 0; n < 200; n++) {
      const i = lower.indexOf(tok, from)
      if (i < 0) break
      occs.push({ start: i, end: i + tok.length, token: tok })
      from = i + tok.length
    }
  }
  if (!occs.length) return flat.length > width ? flat.slice(0, width) + "…" : flat
  occs.sort((a, b) => a.start - b.start)

  // Pick the window covering the most distinct query terms.
  let best = { start: occs[0]!.start, distinct: 0 }
  for (let i = 0; i < occs.length; i++) {
    const from = occs[i]!.start
    const seen = new Set<string>()
    for (let j = i; j < occs.length && occs[j]!.start < from + width; j++) seen.add(occs[j]!.token)
    if (seen.size > best.distinct) best = { start: from, distinct: seen.size }
  }

  const pad = Math.floor(width / 4)
  let start = Math.max(0, best.start - pad)
  let end = Math.min(flat.length, start + width)
  start = Math.max(0, Math.min(start, flat.length - width))
  if (start > 0) {
    const sp = flat.indexOf(" ", start)
    if (sp >= 0 && sp < start + 20) start = sp + 1
  }
  end = Math.min(flat.length, start + width)

  let out = ""
  let cursor = start
  for (const o of occs) {
    if (o.start < cursor) continue
    if (o.start >= end) break
    out += flat.slice(cursor, o.start) + open + flat.slice(o.start, o.end) + close
    cursor = o.end
  }
  out += flat.slice(cursor, end)
  return (start > 0 ? "…" : "") + out.trim() + (end < flat.length ? "…" : "")
}

export type FusedGroup<K, H> = { key: K; score: number; hits: H[]; nLex: number; nSem: number }

/**
 * Reciprocal Rank Fusion.
 *
 * `keyOf` decides the unit being ranked (a session for corpus search, a message for within-session
 * search). `perBranchCap` limits how many hits from one branch may contribute to a key's score, so
 * a flood of weak matches cannot outrank a single strong one.
 */
export function fuse<K, H extends { messageId: string }>(
  branches: { hits: H[]; which: "lex" | "sem" }[],
  keyOf: (h: H) => K,
  opts: { rrfK: number; perBranchCap?: number; hitsPerKey?: number },
): FusedGroup<K, H>[] {
  const groups = new Map<K, FusedGroup<K, H>>()
  const cap = opts.perBranchCap ?? Infinity
  const hitsPerKey = opts.hitsPerKey ?? 1
  for (const { hits, which } of branches) {
    hits.forEach((h, rank) => {
      const key = keyOf(h)
      let g = groups.get(key)
      if (!g) {
        g = { key, score: 0, hits: [], nLex: 0, nSem: 0 }
        groups.set(key, g)
      }
      const seenInBranch = which === "lex" ? g.nLex : g.nSem
      if (seenInBranch < cap) g.score += 1 / (opts.rrfK + rank)
      if (g.hits.length < hitsPerKey && !g.hits.some((x) => x.messageId === h.messageId)) g.hits.push(h)
      if (which === "lex") g.nLex++
      else g.nSem++
    })
  }
  return [...groups.values()].sort((a, b) => b.score - a.score)
}
