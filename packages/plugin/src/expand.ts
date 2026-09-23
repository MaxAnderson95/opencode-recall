/**
 * The `recall_expand` tool: a window of an archived session's transcript, rendered in the
 * single-machine recall plugin's format.
 */
import type { Info } from "@opencode/plugin/promise/tool"
import type { WindowMessage } from "@opencode-recall/protocol"
import { Effect, Result, Schema } from "effect"
import { PluginConfig } from "./config.ts"
import { Tools } from "./tools.ts"

// The runtime forwards the JSON Schema below to the model without validating against it.
const Args = Schema.Struct({
  session_id: Schema.String,
  message_id: Schema.optionalKey(Schema.String),
  window: Schema.optionalKey(Schema.Number),
  max_chars: Schema.optionalKey(Schema.Number),
})

const INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["session_id"],
  properties: {
    session_id: { type: "string", description: "Session id (ses_...) or slug from recall_search" },
    message_id: {
      type: "string",
      description: "Center the window on this message (msg_...); defaults to the end of the session",
    },
    window: { type: "number", description: "Number of messages to include (default 12, max 60)" },
    max_chars: { type: "number", description: "Max characters per message (default 800, max 4000)" },
  },
} as const

const DESCRIPTION =
  "Read a transcript excerpt from a past OpenCode conversation found via recall_search, from any host sharing this recall hub. Given a session_id (or slug) and optionally a message_id to center on, returns the surrounding user/assistant turns with timestamps and one-line tool-call summaries."

/** Characters of transcript one answer holds at most; later messages in the window are left out. */
const BUDGET = 20_000

function toolLine({ tool, title, status, error }: WindowMessage["tools"][number]): string {
  const line = `[tool ${tool}] ${title}`.trimEnd()
  if (status === "completed") return line
  return status === "error" ? `${line} (failed: ${error || "no error message"})` : `${line} (${status})`
}

/** One block per message: tool one-liners, repeats collapsed, then its text. `null` when it has neither. */
function block(m: WindowMessage): string | null {
  const tools: string[] = []
  let last = ""
  let count = 0
  const flush = () => {
    if (count) tools.push(count > 1 ? `${last} (×${count})` : last)
  }
  for (const line of m.tools.map(toolLine)) {
    if (line === last) count++
    else {
      flush()
      last = line
      count = 1
    }
  }
  flush()
  const body = [...tools, m.text].filter(Boolean).join("\n")
  return body ? `── ${m.type} @ ${Tools.fmtDateTime(m.time)} (${m.messageId})\n${body}` : null
}

export const make = Effect.fnUntraced(function* () {
  const execute = Effect.fn("recall_expand")(function* (input: unknown) {
    const args = Schema.decodeUnknownResult(Args)(input)
    if (Result.isFailure(args)) return { content: `Invalid recall_expand arguments: ${args.failure.message}` }
    const { session_id: ref, message_id: messageId } = args.success
    const window = Tools.clampInt(args.success.window, 2, 60, 12)
    const answer = yield* Tools.withHub((hub) =>
      hub.expand({
        session: ref,
        messageId,
        window,
        maxChars: Tools.clampInt(args.success.max_chars, 100, 4000, 800),
      }),
    )
    if (answer.kind !== "window") return { content: Tools.notFound(ref) }
    if (!answer.total) return { content: `Session ${answer.session.sessionId} has no archived messages.` }

    const lines = [
      Tools.header(answer, ref, "showing"),
      `messages ${answer.start + 1}-${answer.start + answer.messages.length} of ${answer.total}`,
      "",
    ]
    let budget = BUDGET
    for (const m of answer.messages) {
      const rendered = block(m)
      if (!rendered) continue
      const text = `${rendered}\n`
      if (text.length > budget) break
      budget -= text.length
      lines.push(text)
    }
    lines.push(`(widen with window=${Math.min(window * 2, 60)} or center on another message_id)`)
    return { content: lines.join("\n"), metadata: { title: `recall: ${answer.session.title}` } }
  }, Effect.catchTag("Tools.CouldNotLook", (e) => Effect.succeed({ content: e.message })))

  const context = yield* Effect.context<PluginConfig.Service>()
  const info: Info<typeof INPUT> = {
    name: "recall_expand",
    description: DESCRIPTION,
    input: INPUT,
    options: { codemode: false },
    execute: (input) => Effect.runPromiseWith(context)(execute(input)),
  }
  return info
})

export * as ExpandTool from "./expand.ts"
