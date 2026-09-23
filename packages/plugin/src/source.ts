/**
 * Everything that knows the shape of OpenCode's own database. It is opened
 * read-only and never written.
 */
import type { Database } from "bun:sqlite"
import { Message, type Part, type Session } from "@opencode-recall/protocol"

type SessionRow = {
  id: string
  slug: string
  title: string | null
  directory: string
  parent_id: string | null
  time_created: number
  time_updated: number
}

type MessageRow = { id: string; type: string; time_created: number; data: string }

type TextItem = { type: "text"; text: string }

const isTextItem = (item: unknown): item is TextItem =>
  typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string"

/** Plain text only; reasoning, tool output, and the full type mapping are not extracted yet. */
function extractParts(type: Message["type"], data: Record<string, unknown>): Part[] {
  const texts =
    type === "user" || type === "synthetic"
      ? [data.text]
      : type === "assistant" && Array.isArray(data.content)
        ? data.content.filter(isTextItem).map((item) => item.text)
        : []
  return texts.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((text) => ({ kind: "text", text }))
}

/** Read one v2 session as a snapshot, or `null` if the database does not hold it. */
export function readSession(db: Database, sessionId: string): Session | null {
  const row = db
    .query(
      "SELECT id, slug, title, directory, parent_id, time_created, time_updated FROM session_v2 WHERE id = ?",
    )
    .get(sessionId) as SessionRow | null
  if (!row) return null

  const rows = db
    .query("SELECT id, type, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq")
    .all(sessionId) as MessageRow[]

  const messages = rows.flatMap((m): Message[] => {
    const type = Message.shape.type.safeParse(m.type)
    if (!type.success) return []
    return [{ id: m.id, type: type.data, timeCreated: m.time_created, parts: extractParts(type.data, JSON.parse(m.data)) }]
  })

  return {
    id: row.id,
    slug: row.slug,
    title: row.title ?? "",
    directory: row.directory,
    parentId: row.parent_id,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    messages,
  }
}
