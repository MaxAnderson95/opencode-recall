/**
 * The `recall_search` tool: a corpus search the hub answers from the shared archive, rendered in
 * the single-machine recall plugin's result format.
 */
import { homedir } from "node:os"
import type { Info, ToolContext } from "@opencode/plugin/promise/tool"
import { Search, makeClient, type SearchHit, type SearchResult } from "@opencode-recall/protocol"
import { Effect, Option, Result, Schema } from "effect"
import { PluginConfig } from "./config.ts"
import { Source } from "./source.ts"

// The runtime forwards the JSON Schema below to the model without validating against it.
const Args = Schema.Struct({
  query: Schema.String,
  scope: Schema.optionalKey(Search.fields.scope.schema),
  mode: Schema.optionalKey(Search.fields.mode.schema),
  directory: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String),
  since: Schema.optionalKey(Schema.String),
  until: Schema.optionalKey(Schema.String),
  include_tools: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(Schema.Number),
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
    mode: {
      type: "string",
      enum: ["hybrid", "lexical", "semantic"],
      description: "hybrid (default) fuses both; lexical = exact terms only; semantic = meaning only",
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

function via(hit: SearchHit, session: SearchResult, scope: Search["scope"]): string {
  if (hit.branch === "semantic")
    return `semantic ${hit.score.toFixed(2)} · ${scope === "user-messages" ? "Top-level user message" : "Conversation context (mixed origins)"}`
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
function render(sessions: readonly SearchResult[], scope: Search["scope"], callerSessionId: string): string {
  const lines = sessions.flatMap((s, i) => {
    const origin = `from ${s.source || "an unknown host"}${s.ownSource ? " (this host)" : ""}, archived revision ${s.revision}`
    const self = s.sessionId === callerSessionId ? " ← THIS session, before its last compaction" : ""
    return [
      `${i + 1}. ${s.title || "(untitled)"} — ${fmtDate(s.timeUpdated)} · ${shortDir(s.directory)} · ${origin}${self}`,
      `   session_id=${s.sessionId} message_id=${s.hits[0]?.messageId} matches(lex=${s.lexicalMatches},sem=${s.semanticMatches})`,
      ...s.hits.map((h) => `   [${via(h, s, scope)}] ${h.snippet}`),
    ]
  })
  return lines.join("\n")
}

const DESCRIPTION =
  "Search ALL past OpenCode conversations from every host sharing this recall hub (every project, full history) with hybrid lexical (FTS5/BM25 over messages, reasoning, and tool outputs) + semantic (embedding) search. Use when the user references a previous discussion ('do you remember', 'we discussed', 'in another session'), or when past decisions, fixes, commands, or error messages would help. Also searches THIS session's history from before its last compaction, useful for recovering details lost to context compaction. Results name the host each session came from and its archived revision; the newest turn of a session may not be archived yet."

/**
 * The tool as OpenCode registers it. Each call runs as an Effect with the services it was built
 * with, re-reading the hub config so a fixed config is picked up without a restart.
 */
export const make = Effect.fnUntraced(function* () {
  const config = yield* PluginConfig.Service
  const source = yield* Source.Service

  const execute = Effect.fn("recall_search")(function* (input: unknown, ctx: Pick<ToolContext, "sessionID">) {
    const args = Schema.decodeUnknownResult(Args)(input)
    if (Result.isFailure(args)) return { content: `Invalid recall_search arguments: ${args.failure.message}` }
    const { query } = args.success
    const hub = yield* Effect.orDie(config.hub)
    if (Option.isNone(hub))
      return {
        content:
          "recall could not look: no hub is configured. Set OPENCODE_RECALL_HUB_URL and OPENCODE_RECALL_TOKEN, or hub.url and hub.token in recall.json. This is not an empty result.",
      }

    const mode = args.success.mode ?? "hybrid"
    const search: Search = {
      query,
      mode,
      scope: args.success.scope,
      since: parseWhen(args.success.since),
      until: parseWhen(args.success.until),
      directory: args.success.directory,
      source: args.success.source,
      includeTools: args.success.include_tools,
      limit: clampInt(args.success.limit, 1, 25, 8),
      // Computed here: the hub's copy of this session trails its newest turn.
      exclude: { sessionId: ctx.sessionID, before: yield* source.compactionBoundary(ctx.sessionID) },
    }
    const answer = yield* Effect.result(makeClient(hub.value).search(search))
    if (Result.isFailure(answer)) {
      const e = answer.failure
      const reason = e._tag === "HubError" ? `${e.code}: ${e.message}` : e.message
      return { content: `recall could not look: the hub request failed (${reason}). This is not an empty result.` }
    }
    const { sessions, semanticUnavailable } = answer.success
    if (semanticUnavailable !== undefined && mode === "semantic")
      return {
        content: `recall could not look: semantic search is unavailable (${semanticUnavailable}). Retry with mode=lexical or hybrid. This is not an empty result.`,
      }
    const note = semanticUnavailable === undefined ? "" : `semantic search is unavailable (${semanticUnavailable}); these results are lexical only.\n`
    if (!sessions.length)
      return {
        content: `${note}No matches for "${query}" (${mode}, scope=${search.scope ?? "all"}). Try mode=semantic for fuzzy recall, fewer or different keywords, or drop filters.`,
      }
    return { content: note + render(sessions, search.scope, ctx.sessionID), metadata: { title: `recall: ${query}` } }
  })

  const context = yield* Effect.context<never>()
  const info: Info<typeof INPUT> = {
    name: "recall_search",
    description: DESCRIPTION,
    input: INPUT,
    options: { codemode: false },
    execute: (input, ctx) => Effect.runPromiseWith(context)(execute(input, ctx)),
  }
  return info
})

export * as SearchTool from "./search.ts"
