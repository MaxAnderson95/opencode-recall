/**
 * The `recall_search` tool: a corpus search the hub answers from the shared archive, rendered in
 * the single-machine recall plugin's result format.
 */
import { homedir } from "node:os"
import type { Info } from "@opencode/plugin/promise/tool"
import { HubError, createClient, type Search, type SearchHit, type SearchResult } from "@opencode-recall/protocol"
import { z } from "zod"
import type { HubConfig } from "./config.ts"

// The runtime forwards the JSON Schema below to the model without validating against it.
const Args = z.object({
  query: z.string(),
  scope: z.enum(["all", "user-messages"]).optional(),
  directory: z.string().optional(),
  source: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  include_tools: z.boolean().optional(),
  limit: z.number().optional(),
})

const INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", description: "Search query: natural language or exact keywords/identifiers" },
    scope: {
      type: "string",
      enum: ["all", "user-messages"],
      description:
        "Default all. Use user-messages to search top-level user text, excluding known synthetic context and child assignments.",
    },
    directory: {
      type: "string",
      description: "Substring filter on the session working directory, e.g. 'infrastructure' or 'Projects_personal'",
    },
    source: { type: "string", description: "Only sessions archived from this host, by the name shown in results" },
    since: { type: "string", description: "Only sessions after this ISO date, e.g. 2026-05-01" },
    until: { type: "string", description: "Only sessions before this ISO date" },
    include_tools: {
      type: "boolean",
      description: "Include tool outputs (bash/file contents) in lexical matching (default true)",
    },
    limit: { type: "number", description: "Max sessions returned (default 8, max 25)" },
  },
} as const

const parseWhen = (s: string | undefined): number | undefined => {
  const ms = s ? Date.parse(s) : NaN
  return Number.isNaN(ms) ? undefined : ms
}

const clampInt = (v: number | undefined, lo: number, hi: number, dflt: number): number =>
  v === undefined || !Number.isFinite(v) ? dflt : Math.max(lo, Math.min(Math.round(v), hi))

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const home = homedir()
const shortDir = (dir: string) => (home && dir.startsWith(home) ? "~" + dir.slice(home.length) : dir)

function via(hit: SearchHit, session: SearchResult): string {
  const origin =
    hit.kind === "tool"
      ? "Tool output"
      : hit.messageType === "user"
        ? session.parentId
          ? "Child user message"
          : "Top-level user message"
        : hit.messageType === "synthetic"
          ? "Synthetic context"
          : `${hit.messageType} text`
  return `lexical/${hit.kind} · ${origin}`
}

/** The ranked sessions as the model reads them. */
function render(sessions: SearchResult[], callerSessionId: string): string {
  const lines = sessions.flatMap((s, i) => {
    const origin = `from ${s.source || "an unknown host"}${s.ownSource ? " (this host)" : ""}, archived revision ${s.revision}`
    const self = s.sessionId === callerSessionId ? " ← THIS session, before its last compaction" : ""
    return [
      `${i + 1}. ${s.title || "(untitled)"} — ${fmtDate(s.timeUpdated)} · ${shortDir(s.directory)} · ${origin}${self}`,
      `   session_id=${s.sessionId} message_id=${s.hits[0]?.messageId} matches(lex=${s.lexicalMatches})`,
      ...s.hits.map((h) => `   [${via(h, s)}] ${h.snippet}`),
    ]
  })
  return lines.join("\n")
}

type Options = {
  /** Re-read on every call, so a fixed config is picked up without a restart. */
  loadConfig: () => Promise<HubConfig | null>
  /** Time of the session's last compaction in the local database, or 0 if it never compacted. */
  compactionBoundary: (sessionId: string) => number
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}

export function searchTool({ loadConfig, compactionBoundary, fetch }: Options): Info<typeof INPUT> {
  return {
    name: "recall_search",
    description:
      "Search ALL past OpenCode conversations from every host sharing this recall hub (every project, full history) with lexical FTS5/BM25 search over messages, reasoning, and tool outputs. Use when the user references a previous discussion ('do you remember', 'we discussed', 'in another session'), or when past decisions, fixes, commands, or error messages would help. Also searches THIS session's history from before its last compaction, useful for recovering details lost to context compaction. Results name the host each session came from and its archived revision; the newest turn of a session may not be archived yet.",
    input: INPUT,
    options: { codemode: false },
    async execute(input, ctx) {
      const args = Args.safeParse(input)
      if (!args.success) return { content: `Invalid recall_search arguments: ${z.prettifyError(args.error)}` }
      const { query } = args.data
      const config = await loadConfig()
      if (!config)
        return {
          content:
            "recall could not look: no hub is configured. Set OPENCODE_RECALL_HUB_URL and OPENCODE_RECALL_TOKEN, or hub.url and hub.token in recall.json. This is not an empty result.",
        }

      const search: Search = {
        query,
        scope: args.data.scope,
        since: parseWhen(args.data.since),
        until: parseWhen(args.data.until),
        directory: args.data.directory,
        source: args.data.source,
        includeTools: args.data.include_tools,
        limit: clampInt(args.data.limit, 1, 25, 8),
        // Computed here: the hub's copy of this session trails its newest turn.
        exclude: { sessionId: ctx.sessionID, before: compactionBoundary(ctx.sessionID) },
      }
      let sessions: SearchResult[]
      try {
        ;({ sessions } = await createClient({ ...config, fetch }).search(search))
      } catch (e) {
        const reason = e instanceof HubError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e)
        return { content: `recall could not look: the hub request failed (${reason}). This is not an empty result.` }
      }
      if (!sessions.length)
        return {
          content: `No matches for "${query}" (lexical, scope=${search.scope ?? "all"}). Try fewer or different keywords, or drop filters.`,
        }
      return { content: render(sessions, ctx.sessionID), metadata: { title: `recall: ${query}` } }
    },
  }
}
