import { afterEach, beforeEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createClient } from "@opencode-recall/protocol"
import { openArchive } from "../../hub/src/archive/index.ts"
import { fakeEmbedder } from "../../hub/src/fake-embedder.ts"
import { createLog } from "../../hub/src/log.ts"
import { serve } from "../../hub/src/serve.ts"
import { sourceDb, type SourceDb } from "./fixture.ts"
import { EXTRACTOR_VERSION, readPosition, readPositions, readSession, readSnapshot } from "./source.ts"

function demo(): SourceDb {
  const source = sourceDb()
  source.addSession("ses_a", { time: 100 })
  source.addMessage("ses_a", "user", { text: "how do I list files?", files: [{ data: "aGVsbG8=", mime: "text/plain" }] }, 101)
  source.addMessage("ses_a", "model-switched", { model: { id: "m", providerID: "p" } }, 102)
  source.addMessage(
    "ses_a",
    "assistant",
    {
      content: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "Use ls." },
        { type: "tool", name: "bash", state: { status: "completed", content: [{ type: "text", text: "a b" }] } },
      ],
    },
    103,
  )
  source.addMessage("ses_a", "idle", { outcome: "succeeded" }, 104)
  return source
}

let dataDir: string
let hub: ReturnType<typeof serve>
let source: SourceDb

/** Issue a token the way `opencode-recall-hub token issue` does, through its own connection. */
function issueToken(name: string): string {
  const admin = openArchive(join(dataDir, "archive.db"), fakeEmbedder())
  const token = admin.issueToken(name)
  admin.close()
  return token
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "recall-plugin-"))
  hub = serve({ dataDir, listen: "127.0.0.1:0", logLevel: "error" }, createLog("error", () => {}), fakeEmbedder())
  source = demo()
})

afterEach(async () => {
  source.close()
  await hub.stop()
  rmSync(dataDir, { recursive: true, force: true })
})

const tool = (name: string, state: object) => ({ type: "tool", id: "call", name, state, time: { created: 1 } })

test("reads a v2 session with every kept message type, dropping bookkeeping messages", () => {
  expect(readSession(source.db, "ses_a")).toEqual({
    id: "ses_a",
    slug: "brave-otter",
    title: "Demo",
    directory: "/work/demo",
    parentId: null,
    timeCreated: 100,
    timeUpdated: 100,
    messages: [
      { id: "msg_ses_a_2", type: "user", timeCreated: 101, parts: [{ kind: "text", text: "how do I list files?" }] },
      {
        id: "msg_ses_a_4",
        type: "assistant",
        timeCreated: 103,
        parts: [
          { kind: "reasoning", text: "thinking" },
          { kind: "text", text: "Use ls." },
          { kind: "tool", tool: "bash", title: "", status: "completed", text: "bash \na b", searchable: true },
        ],
      },
    ],
  })
  expect(readSession(source.db, "ses_missing")).toBeNull()
})

test("tool calls keep their status, failures their error text, and attachments are dropped", () => {
  source.addSession("ses_t")
  source.addMessage("ses_t", "user", { text: "   ", files: [{ uri: "data:;base64,aGVsbG8=", mime: "image/png" }] }, 101)
  source.addMessage(
    "ses_t",
    "assistant",
    {
      content: [
        tool("read", {
          status: "completed",
          input: { filePath: "/a.png" },
          metadata: { title: "a.png" },
          content: [
            { type: "text", text: "\u001b[31mred\u001b[0m" },
            { type: "file", uri: "data:;base64,aGVsbG8=", mime: "image/png" },
          ],
        }),
        tool("bash", {
          status: "error",
          input: { command: "git push", description: "Push" },
          error: { type: "tool.execution", message: "rejected: non-fast-forward" },
        }),
        tool("bash", { status: "running", input: { command: "sleep 9" }, metadata: {} }),
        tool("edit", { status: "streaming", input: "{" }),
        tool("recall_search", { status: "completed", input: { query: "x" }, content: [{ type: "text", text: "hits" }] }),
        tool("glob", { status: "completed", input: {}, content: [{ type: "text", text: "x".repeat(20_000) }] }),
      ],
    },
    102,
  )
  source.addMessage("ses_t", "shell", { command: "ls", status: "completed", output: { output: "a\n" } }, 103)
  source.addMessage("ses_t", "skill", { skill: "tdd", name: "tdd", text: "Red, green." }, 104)
  source.addMessage("ses_t", "compaction", { status: "completed", summary: "Listed files.", recent: [] }, 105)
  source.addMessage("ses_t", "compaction", { status: "running" }, 106)
  source.addMessage("ses_t", "system", { text: "prompt" }, 107)
  source.addMessage("ses_t", "agent-switched", { agent: "plan" }, 108)

  const snapshot = readSnapshot(source.db, "ses_t")!
  expect(JSON.stringify(snapshot)).not.toContain("aGVsbG8=")
  const [user, assistant, ...rest] = snapshot.session.messages
  expect(user!.parts).toEqual([])
  const [read, failed, running, streaming, recall, glob] = assistant!.parts
  expect(read).toEqual({ kind: "tool", tool: "read", title: "a.png", status: "completed", text: "read a.png\nred", searchable: true })
  expect(failed).toEqual({
    kind: "tool",
    tool: "bash",
    title: "git push Push",
    status: "error",
    error: "rejected: non-fast-forward",
    text: "bash git push Push\nrejected: non-fast-forward",
    searchable: true,
  })
  expect(running).toEqual({ kind: "tool", tool: "bash", title: "sleep 9", status: "running", text: "", searchable: false })
  expect(streaming).toEqual({ kind: "tool", tool: "edit", title: "", status: "streaming", text: "", searchable: false })
  expect(recall).toEqual({ kind: "tool", tool: "recall_search", title: "x", status: "completed", text: "recall_search x\nhits", searchable: false })
  expect(glob).toMatchObject({ text: `glob \n${"x".repeat(16_000 - 6)}`, searchable: true })
  expect(rest.map((m) => [m.type, m.parts])).toEqual([
    ["shell", [{ kind: "tool", tool: "shell", title: "ls", status: "completed", text: "shell ls\na\n", searchable: true }]],
    ["skill", [{ kind: "tool", tool: "skill", title: "tdd", status: "completed", text: "skill tdd\nRed, green.", searchable: true }]],
    ["compaction", [{ kind: "text", text: "Listed files." }]],
    ["compaction", []],
  ])
})

test("summarizer worker sessions are invisible to the uploader", () => {
  source.addSession("ses_w", { title: "recall-summarizer worker: anthropic/claude" })
  source.addMessage("ses_w", "user", { text: "summarize" }, 101)
  expect(readPosition(source.db, "ses_w")).toBeNull()
  expect([...readPositions(source.db).keys()]).toEqual(["ses_a"])
  expect(readSnapshot(source.db, "ses_w")).toBeNull()
  expect(readSession(source.db, "ses_w")).toBeNull()
})

test("a snapshot carries the event counter as its revision and the newest activity", () => {
  expect(readSnapshot(source.db, "ses_a")).toMatchObject({
    revision: 5,
    lastActivity: 104,
    extractorVersion: EXTRACTOR_VERSION,
    contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
  })
  // A rename touches no message, so `time_updated` is what moves last activity forward.
  source.rename("ses_a", "Renamed", 500)
  expect(readSnapshot(source.db, "ses_a")).toMatchObject({ revision: 6, lastActivity: 500 })
  expect(readSnapshot(source.db, "ses_missing")).toBeNull()
})

test("the content hash changes with content and not with a re-read", () => {
  const first = readSnapshot(source.db, "ses_a")!
  expect(readSnapshot(source.db, "ses_a")!.contentHash).toBe(first.contentHash)
  source.addMessage("ses_a", "user", { text: "and hidden files?" }, 105)
  expect(readSnapshot(source.db, "ses_a")!.contentHash).not.toBe(first.contentHash)
})

test("an uploaded session is stored by the hub as sessions, messages, and parts rows", async () => {
  const client = createClient({ url: hub.url.href, token: issueToken("laptop") })
  expect(await client.snapshot(readSnapshot(source.db, "ses_a")!)).toEqual({ outcome: "archived" })
  expect(await client.status()).toMatchObject({ sessions: 1 })

  const archive = new Database(join(dataDir, "archive.db"), { readonly: true })
  expect(archive.query("SELECT id, title, revision, last_activity FROM sessions").all()).toEqual([
    { id: "ses_a", title: "Demo", revision: 5, last_activity: 104 },
  ])
  expect(archive.query("SELECT id, type FROM messages ORDER BY ordinal").all()).toEqual([
    { id: "msg_ses_a_2", type: "user" },
    { id: "msg_ses_a_4", type: "assistant" },
  ])
  expect(
    archive
      .query("SELECT message_id, kind, text, tool_name, status, searchable FROM parts ORDER BY message_id, ordinal")
      .all(),
  ).toEqual([
    { message_id: "msg_ses_a_2", kind: "text", text: "how do I list files?", tool_name: null, status: null, searchable: 1 },
    { message_id: "msg_ses_a_4", kind: "reasoning", text: "thinking", tool_name: null, status: null, searchable: 1 },
    { message_id: "msg_ses_a_4", kind: "text", text: "Use ls.", tool_name: null, status: null, searchable: 1 },
    { message_id: "msg_ses_a_4", kind: "tool", text: "bash \na b", tool_name: "bash", status: "completed", searchable: 1 },
  ])
  archive.close()
})

test("uploads under two tokens for one source are attributed to that one source", async () => {
  const [first, second] = [issueToken("laptop"), issueToken("laptop")]
  await createClient({ url: hub.url.href, token: first }).snapshot(readSnapshot(source.db, "ses_a")!)
  source.addSession("ses_b", { title: "Other", time: 300 })
  await createClient({ url: hub.url.href, token: second }).snapshot(readSnapshot(source.db, "ses_b")!)

  const archive = new Database(join(dataDir, "archive.db"), { readonly: true })
  expect(
    archive.query("SELECT sessions.id, sources.name FROM sessions JOIN sources ON sources.id = source_id ORDER BY sessions.id").all(),
  ).toEqual([
    { id: "ses_a", name: "laptop" },
    { id: "ses_b", name: "laptop" },
  ])
  archive.close()
})
