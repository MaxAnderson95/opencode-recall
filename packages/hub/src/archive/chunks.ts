/**
 * Turn-pair chunk rendering (§3.2), carried over from the single-machine recall plugin's
 * `lib/indexer.ts` and `lib/text.ts`. The rendered text is exactly what the model embeds, so any
 * change here changes what a vector means and must bump {@link RENDERING_VERSION}. Pure.
 */
import type { Message, Part, Session, SpaceRecipe } from "@opencode-recall/protocol"
import { stripAnsi } from "./text.ts"

export const RENDERING_VERSION = 1

export type ChunkParams = Pick<SpaceRecipe, "chunkChars" | "chunkOverlap" | "turnChars">

/** The parts of a session chunking reads; only non-blank text parts are embedded. */
export type ChunkSource = Pick<Session, "parentId"> & {
  messages: readonly (Pick<Message, "id" | "type" | "timeCreated"> & { parts: readonly Pick<Part, "kind" | "text">[] })[]
}

export type Chunk = {
  /** The turn's anchor: its user message, or the first message of a turn with none. */
  messageId: string
  /** Position among the windows of one turn (or one user message) in one scope. */
  window: number
  scope: "all" | "user-messages"
  time: number
  text: string
}

function clean(text: string, max: number): string {
  const out = stripAnsi(text).replace(/\s+/g, " ").trim()
  return out.length > max ? out.slice(0, max) + "…" : out
}

/**
 * Sliding windows of `size` characters overlapping by `overlap`. A text longer than `maxChars`
 * keeps its head and tail, which is where a turn's intent and its outcome live.
 */
export function chunkText(text: string, size: number, overlap: number, maxChars: number): string[] {
  const t = text.trim()
  if (!t) return []
  const stride = Math.max(1, size - overlap)
  let body = t
  if (maxChars > 0 && t.length > maxChars) {
    const half = Math.floor(maxChars / 2)
    body = t.slice(0, half) + "\n…\n" + t.slice(t.length - half)
  }
  if (body.length <= size) return [body]
  const out: string[] = []
  for (let pos = 0; pos < body.length; pos += stride) {
    const chunk = body.slice(pos, pos + size)
    if (chunk.trim()) out.push(chunk)
    if (pos + size >= body.length) break
  }
  return out
}

/**
 * Every chunk of a session. Each turn (a user message and every message after it up to the next
 * user message) renders as `USER: …\nASSISTANT: …`, non-assistant replies prefixed `[type] `, and
 * windows past the first are re-anchored with `(re: <the user's text>)`. Top-level sessions also
 * get `user-messages` chunks of each user message's text alone.
 */
export function renderChunks(session: ChunkSource, { chunkChars, chunkOverlap, turnChars }: ChunkParams): Chunk[] {
  const texts = new Map<string, string[]>()
  for (const m of session.messages) {
    const own = m.parts.filter((p) => p.kind === "text" && p.text.trim()).map((p) => p.text)
    if (own.length) texts.set(m.id, own)
  }

  type Turn = { messageId: string; time: number; user: string[]; assistant: string[] }
  const turns: Turn[] = []
  let current: Turn | null = null
  for (const m of session.messages) {
    const own = texts.get(m.id)
    if (m.type === "user") {
      current = { messageId: m.id, time: m.timeCreated, user: own ?? [], assistant: [] }
      turns.push(current)
    } else if (own) {
      if (!current) {
        current = { messageId: m.id, time: m.timeCreated, user: [], assistant: [] }
        turns.push(current)
      }
      current.assistant.push(...(m.type === "assistant" ? own : own.map((text) => `[${m.type}] ${text}`)))
    }
  }

  const chunks: Chunk[] = []
  for (const t of turns) {
    const user = t.user.join("\n").trim()
    const assistant = t.assistant.join("\n").trim()
    if (!user && !assistant) continue
    const body = (user ? `USER: ${user}\n` : "") + (assistant ? `ASSISTANT: ${assistant}` : "")
    // A bare slice of mid-turn prose retrieves poorly on its own, so later windows keep the subject.
    const anchor = user ? `(re: ${clean(user, 160)})\n` : ""
    chunkText(body, chunkChars, chunkOverlap, turnChars).forEach((w, window) => {
      chunks.push({ messageId: t.messageId, window, scope: "all", time: t.time, text: window === 0 ? w : anchor + w })
    })
  }
  if (!session.parentId)
    for (const m of session.messages) {
      const text = m.type === "user" ? texts.get(m.id)?.join("\n") : undefined
      if (!text) continue
      chunkText(text, chunkChars, chunkOverlap, turnChars).forEach((w, window) => {
        chunks.push({ messageId: m.id, window, scope: "user-messages", time: m.timeCreated, text: w })
      })
    }
  return chunks
}
