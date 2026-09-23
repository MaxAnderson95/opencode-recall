import { expect, test } from "bun:test"
import { chunkText, renderChunks, type ChunkSource } from "./chunks.ts"

const params = { chunkChars: 1200, chunkOverlap: 200, turnChars: 60_000 }

type Msg = ChunkSource["messages"][number]
const msg = (id: string, type: Msg["type"], ...texts: string[]): Msg => ({
  id,
  type,
  timeCreated: Number(id.slice(1)),
  parts: texts.map((text) => ({ kind: "text", text })),
})

test("a turn is its user message and every reply after it, non-assistant replies labelled and blank or non-text parts left out", () => {
  const chunks = renderChunks(
    {
      parentId: null,
      messages: [
        msg("m1", "user", "fix the build", "  "),
        { ...msg("m2", "assistant", "looking"), parts: [{ kind: "reasoning", text: "hidden" }, { kind: "text", text: "looking" }, { kind: "tool", text: "bash ls\nout" }] },
        msg("m3", "synthetic", "injected context"),
        msg("m4", "assistant", "done", "really"),
        msg("m5", "user"),
        msg("m6", "compaction", "summary"),
      ],
    },
    params,
  )
  expect(chunks).toEqual([
    {
      messageId: "m1",
      window: 0,
      scope: "all",
      time: 1,
      text: "USER: fix the build\nASSISTANT: looking\n[synthetic] injected context\ndone\nreally",
    },
    { messageId: "m5", window: 0, scope: "all", time: 5, text: "ASSISTANT: [compaction] summary" },
    { messageId: "m1", window: 0, scope: "user-messages", time: 1, text: "fix the build" },
  ])
})

test("replies before any user message form their own turn, and child sessions get no user-messages chunks", () => {
  const chunks = renderChunks({ parentId: "ses_parent", messages: [msg("m1", "assistant", "hello"), msg("m2", "user", "hi")] }, params)
  expect(chunks.map((c) => [c.messageId, c.scope, c.text])).toEqual([
    ["m1", "all", "ASSISTANT: hello"],
    ["m2", "all", "USER: hi"],
  ])
})

test("long turns are windowed with overlap, and later windows are re-anchored to the user's intent", () => {
  const user = `please   \u001b[31mexplain\u001b[0m ${"why ".repeat(60)}`
  const answer = "a".repeat(2000)
  const chunks = renderChunks({ parentId: null, messages: [msg("m1", "user", user), msg("m2", "assistant", answer)] }, params)
  const body = `USER: ${user.trim()}\nASSISTANT: ${answer}`
  const anchor = `(re: please explain ${"why ".repeat(60).trim().slice(0, 160 - "please explain ".length)}…)\n`
  expect(chunks.filter((c) => c.scope === "all").map((c) => c.text)).toEqual([
    body.slice(0, 1200),
    anchor + body.slice(1000, 2200),
    anchor + body.slice(2000),
  ])
})

test("text past the per-turn cap keeps its head and tail", () => {
  const text = `${"h".repeat(40)}${"m".repeat(100)}${"t".repeat(40)}`
  expect(chunkText(text, 1200, 200, 80)).toEqual([`${"h".repeat(40)}\n…\n${"t".repeat(40)}`])
  expect(chunkText("   ", 1200, 200, 80)).toEqual([])
})
