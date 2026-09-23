/**
 * The `recall_inspect` tool: one archived session searched from within, or outlined by its user
 * turns, rendered in the single-machine recall plugin's format.
 */
import type { Info, ToolContext } from "@opencode/plugin/promise/tool"
import { Inspect, type Responses } from "@opencode-recall/protocol"
import { Effect, Result, Schema } from "effect"
import { PluginConfig } from "./config.ts"
import { Source } from "./source.ts"
import { Tools } from "./tools.ts"

// The runtime forwards the JSON Schema below to the model without validating against it.
const Args = Schema.Struct({
  session_id: Schema.String,
  query: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Inspect.fields.scope.schema),
  mode: Schema.optionalKey(Inspect.fields.mode.schema),
  include_tools: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(Schema.Number),
})

const INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["session_id"],
  properties: {
    session_id: { type: "string", description: "Session id (ses_...) or slug from recall_search" },
    query: { type: "string", description: "Search within the session (omit for a user-turn outline)" },
    scope: {
      type: "string",
      enum: ["all", "user-messages"],
      description:
        "Search scope in query mode: all (default), or top-level user messages without known synthetic context or child assignments.",
    },
    mode: {
      type: "string",
      enum: ["hybrid", "lexical", "semantic"],
      description: "hybrid (default) fuses both; lexical = exact terms only; semantic = meaning only",
    },
    include_tools: {
      type: "boolean",
      description: "Include tool outputs (bash/file contents) in lexical matching (default true)",
    },
    limit: { type: "number", description: "Max hits in query mode (default 12, max 30)" },
  },
} as const

const DESCRIPTION =
  "Look inside ONE past session, from any host sharing this recall hub: the cheap, instant first stop after recall_search finds it, before reaching for recall_summarize. With a query: hybrid-search within that session, returning message-level hits in chronological order with message_ids ready for recall_expand. Without a query: an outline of the session's user turns (its intent skeleton). No worker model, no wait."

type Outline = Extract<Responses["inspect"], { kind: "outline" }>

function outline(answer: Outline, ref: string): string {
  const line = (t: Outline["turns"][number], i: number) => `${i + 1}. ${Tools.fmtDateTime(t.time)} (${t.messageId}) ${t.text}`
  const { turns } = answer
  const toc =
    turns.length > 60
      ? [
          ...turns.slice(0, 30).map(line),
          `[... ${turns.length - 60} turns omitted — search them with query=... ]`,
          ...turns.slice(-30).map((t, i) => line(t, turns.length - 30 + i)),
        ]
      : turns.map(line)
  return [
    Tools.header(answer, ref, "inspecting"),
    `${answer.messages} messages · ${turns.length} user turns`,
    "",
    "USER TURNS:",
    ...toc,
    "",
    "Search within: query=...; read around a turn: recall_expand(session_id, message_id); whole-session story: recall_summarize.",
  ].join("\n")
}

export const make = Effect.fnUntraced(function* () {
  const source = yield* Source.Service

  const execute = Effect.fn("recall_inspect")(function* (input: unknown, ctx: Pick<ToolContext, "sessionID">) {
    const args = Schema.decodeUnknownResult(Args)(input)
    if (Result.isFailure(args)) return { content: `Invalid recall_inspect arguments: ${args.failure.message}` }
    const { session_id: ref, query } = args.success
    const title = (t: string) => ({ title: `recall inspect: ${t}` })

    if (!query?.trim()) {
      if (args.success.scope === "user-messages")
        return { content: "scope=user-messages requires a query; omit scope for the standard user-turn outline." }
      const answer = yield* Tools.withHub((hub) => hub.inspect({ session: ref, limit: 12 }))
      if (answer.kind !== "outline") return { content: Tools.notFound(ref) }
      return { content: outline(answer, ref), metadata: title(answer.session.title) }
    }

    const mode = args.success.mode ?? "hybrid"
    const scope = args.success.scope ?? "all"
    const request: Inspect = {
      session: ref,
      query,
      mode,
      scope,
      includeTools: args.success.include_tools,
      limit: Tools.clampInt(args.success.limit, 1, 30, 12),
      // Computed here: the hub's copy of this session trails its newest turn.
      exclude: { sessionId: ctx.sessionID, before: yield* source.compactionBoundary(ctx.sessionID) },
    }
    const answer = yield* Tools.withHub((hub) => hub.inspect(request))
    if (answer.kind !== "matches") return { content: Tools.notFound(ref) }
    const { semanticUnavailable } = answer
    if (semanticUnavailable !== undefined && mode === "semantic")
      return {
        content: `recall could not look: semantic search is unavailable (${semanticUnavailable}). Retry with mode=lexical or hybrid. This is not an empty result.`,
      }
    const note = semanticUnavailable === undefined ? "" : `semantic search is unavailable (${semanticUnavailable}); these results are lexical only.\n`
    const head = note + Tools.header(answer, ref, "inspecting")
    if (!answer.hits.length)
      return {
        content: `${head}\n\nNo matches for "${query}" (${mode}, scope=${scope}) in this session. Likely not discussed in this session, or only in a turn not archived yet. Try different keywords, mode=semantic (unfiltered ranking), or omit query for a user-turn outline. User-message scope excludes child sessions.`,
      }
    const lines = [
      head,
      `${answer.hits.length} of ${answer.total} matches for "${query}" (${mode}) — chronological:`,
      "",
      ...answer.hits.flatMap((h, i) => [
        `${i + 1}. ${Tools.fmtDateTime(h.time)} (${h.messageId})`,
        `   [${Tools.via(h, answer.session.parentId, scope)}] ${h.snippet}`,
      ]),
      "",
      "Read around a hit: recall_expand(session_id, message_id). Escalate to recall_summarize only if this doesn't answer it.",
    ]
    return { content: lines.join("\n"), metadata: title(answer.session.title) }
  }, Effect.catchTag("Tools.CouldNotLook", (e) => Effect.succeed({ content: e.message })))

  const context = yield* Effect.context<PluginConfig.Service | Source.Service>()
  const info: Info<typeof INPUT> = {
    name: "recall_inspect",
    description: DESCRIPTION,
    input: INPUT,
    options: { codemode: false },
    execute: (input, ctx) => Effect.runPromiseWith(context)(execute(input, ctx)),
  }
  return info
})

export * as InspectTool from "./inspect.ts"
