/**
 * Adapter over the retrieval implementation under test.
 *
 * The eval is only trustworthy if the lexical branch and the fusion are the
 * production ones rather than a reimplementation that can drift. This module is
 * the single place that knows where they come from, so swapping the plugin for
 * the hub's Archive module is a change here and nowhere else.
 */
import { Database } from "bun:sqlite"
import { config } from "./config.ts"

const search = await import(`${config.retrievalDir}/lib/search.ts`)
const sourceMod = await import(`${config.retrievalDir}/lib/source.ts`)
const configMod = await import(`${config.retrievalDir}/lib/config.ts`)

export type Hit = {
  session_id: string
  message_id: string
  time: number
  via: string
  src: { kind: "part"; part_id: string; seg_start: number; part_kind: string } | { kind: "chunk"; chunk_id: number }
}

export type Filters = {
  scope?: "all" | "user-messages"
  since: number
  until: number
  includeTools: boolean
  directory?: string
  sessionId?: string
  excludeSession?: string
  excludeBefore: number
}

/** Retrieval settings the production code reads, so the eval inherits them. */
export const settings = configMod.loadConfig().config as {
  embed: { model: string; dims: number; queryPrefix: string }
  fts: { toolOutputChars: number; segmentChars: number }
  search: { candidates: number; rrfK: number }
  sourceDb: string
}

export const indexDb = new Database(config.indexDb, { readonly: true })
export const source = new sourceMod.Source(new Database(settings.sourceDb, { readonly: true }))
export const extractPartText = sourceMod.extractPartText as (
  data: unknown,
  opts: { toolOutputChars: number },
) => { text: string } | null

/**
 * Production BM25. Needs an embedder to satisfy the constructor but never calls
 * it, because the eval drives the semantic branch itself to swap vector sets.
 */
const index = new search.SearchIndex(indexDb, source, { embed: async () => [] }, settings, () => {})

export function lexical(query: string, filters: Filters): Hit[] {
  return index.lexical(query, filters)
}

/** Production RRF, grouped by session because that is what recall_search returns. */
export function fuseToSessions(lex: Hit[], sem: Hit[]): string[] {
  return search
    .fuse(
      [
        { hits: lex, which: "lex" },
        { hits: sem, which: "sem" },
      ],
      (h: Hit) => h.session_id,
      { rrfK: settings.search.rrfK, perBranchCap: 3, hitsPerKey: 2 },
    )
    .map((g: { key: string }) => g.key)
}

export function fuseGroups(lex: Hit[], sem: Hit[]): { key: string; hits: Hit[] }[] {
  return search.fuse(
    [
      { hits: lex, which: "lex" },
      { hits: sem, which: "sem" },
    ],
    (h: Hit) => h.session_id,
    { rrfK: settings.search.rrfK, perBranchCap: 3, hitsPerKey: 2 },
  )
}
