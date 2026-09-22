/**
 * Everything that knows the shape of OpenCode's own database. It is opened
 * read-only and never written.
 */
import type { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { Message, type Part, type Session, type Snapshot } from "@opencode-recall/protocol"

/** Bump whenever extraction output changes for unchanged input, so the hub accepts re-extracted history. */
export const EXTRACTOR_VERSION = 1

/** Where a session stands in the §5 order: last activity first, then revision. */
export type Position = Pick<Snapshot, "lastActivity" | "revision">

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

const POSITIONS = `SELECT s.id AS sessionId,
    coalesce((SELECT seq FROM event_sequence WHERE aggregate_id = s.id), 0) AS revision,
    max(s.time_updated, coalesce((SELECT max(time_created) FROM session_message WHERE session_id = s.id), 0))
      AS lastActivity
  FROM session_v2 s`

/** The session's current position, or `null` if the database does not hold it. */
export function readPosition(db: Database, sessionId: string): Position | null {
  const row = db.query(`${POSITIONS} WHERE s.id = ?`).get(sessionId) as ({ sessionId: string } & Position) | null
  return row && { revision: row.revision, lastActivity: row.lastActivity }
}

/** The current position of every session the database holds. */
export function readPositions(db: Database): Map<string, Position> {
  const rows = db.query(POSITIONS).all() as ({ sessionId: string } & Position)[]
  return new Map(rows.map(({ sessionId, ...position }) => [sessionId, position]))
}

/**
 * Read one session with its position and content hash, all inside one read transaction so the
 * revision cannot describe a different transcript than the one sent. `null` if the session is absent.
 */
export function readSnapshot(db: Database, sessionId: string): Snapshot | null {
  return db.transaction(() => {
    const position = readPosition(db, sessionId)
    const session = readSession(db, sessionId)
    if (!position || !session) return null
    const contentHash = createHash("sha256").update(JSON.stringify(session)).digest("hex")
    return { session, ...position, contentHash, extractorVersion: EXTRACTOR_VERSION }
  })()
}

/** Read one v2 session's transcript, or `null` if the database does not hold it. */
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
