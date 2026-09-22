/**
 * The part extraction rules (§3.3), carried over from the single-machine recall plugin's
 * `lib/source.ts` and `lib/text.ts` so the searchable text of every part stays byte-identical.
 * Pure: no database, no filesystem.
 */
import type { Message, Part } from "@opencode-recall/protocol"

/** Session titles with this prefix are the old plugin's hidden summarizer workers. */
export const WORKER_PREFIX = "recall-summarizer worker: "

/** A tool part's rendered text is capped here; the rest is dropped. */
const TOOL_TEXT_CHARS = 16_000

/** Searching must never match earlier search output. */
const UNSEARCHABLE_TOOLS: ReadonlySet<string> = new Set([
  "recall_search",
  "recall_expand",
  "recall_inspect",
  "recall_status",
  "recall_summarize",
])

const ANSI_RE =
  /[\u001b\u009b](?:\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\[[0-9;?]*[0-9A-ORZcf-nqry=><]|[()#][0-9A-Za-z])/g

const stripAnsi = (text: string) => text.replace(ANSI_RE, "")

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null

const nonBlank = (text: unknown): text is string => typeof text === "string" && text.trim() !== ""

/** A compact, deterministic one-liner for the call: the tool's own title, else its string inputs. */
function toolTitle(input: unknown, metadata: unknown): string {
  if (isObject(metadata) && typeof metadata.title === "string") return metadata.title
  if (!isObject(input)) return ""
  return Object.values(input)
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .slice(0, 200)
}

/** The text items of a tool's content; file items are attachments and are dropped. */
function toolOutput(content: unknown): string {
  if (!Array.isArray(content)) return ""
  return content
    .filter((c): c is { type: "text"; text: string } => isObject(c) && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
}

/**
 * A completed call renders `<tool> <title>\n<output>` and a failed one puts its error text where
 * the output would be. In-flight calls have no text yet but are kept so transcripts show them.
 */
function toolPart(tool: string, title: string, status: string, output: string, error?: string): Part {
  const body = status === "completed" ? output : error
  const text = body === undefined ? "" : `${tool} ${title}\n${stripAnsi(body)}`.slice(0, TOOL_TEXT_CHARS)
  return {
    kind: "tool",
    tool,
    title,
    status,
    ...(error !== undefined && { error }),
    text,
    searchable: !UNSEARCHABLE_TOOLS.has(tool) && text.trim() !== "",
  }
}

function assistantItem(item: unknown): Part[] {
  if (!isObject(item)) return []
  if ((item.type === "text" || item.type === "reasoning") && nonBlank(item.text))
    return [{ kind: item.type, text: item.text }]
  if (item.type !== "tool" || typeof item.name !== "string") return []
  const state = isObject(item.state) ? item.state : {}
  const status = typeof state.status === "string" ? state.status : "unknown"
  const error = status === "error" && isObject(state.error) ? state.error.message : undefined
  return [
    toolPart(
      item.name,
      toolTitle(state.input, state.metadata),
      status,
      status === "completed" ? toolOutput(state.content) : "",
      typeof error === "string" ? error : undefined,
    ),
  ]
}

/** The parts one `session_message` row contributes, given its type and parsed `data`. */
export function extractParts(type: Message["type"], data: Json): Part[] {
  switch (type) {
    case "user":
    case "synthetic":
      return nonBlank(data.text) ? [{ kind: "text", text: data.text }] : []
    case "compaction":
      // `recent` replays messages that are already their own rows, so only the summary is kept.
      return data.status === "completed" && nonBlank(data.summary) ? [{ kind: "text", text: data.summary }] : []
    case "shell": {
      const output = isObject(data.output) ? data.output.output : undefined
      const command = typeof data.command === "string" ? data.command : ""
      return [toolPart("shell", command, "completed", typeof output === "string" ? output : "")]
    }
    case "skill":
      return [
        toolPart(
          "skill",
          typeof data.name === "string" ? data.name : "",
          "completed",
          typeof data.text === "string" ? data.text : "",
        ),
      ]
    case "assistant":
      return Array.isArray(data.content) ? data.content.flatMap(assistantItem) : []
  }
}
