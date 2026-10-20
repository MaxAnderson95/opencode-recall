import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeClient } from "@opencode-recall/protocol"
import { Effect } from "effect"
import { sourceDb, startHub, type SourceDb } from "./fixture.ts"
import { CACHE_LIMITS, EXTRACTOR_VERSION, cachedSnapshots, readPosition, readPositions, readSession, readSnapshot } from "./source.ts"

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
let hub: Awaited<ReturnType<typeof startHub>>
let source: SourceDb

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "recall-plugin-"))
  hub = await startHub(dataDir)
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

test("a session OpenCode migrated from v1 with no events is invisible until its first event", () => {
  // The v1 migration records an empty session's event counter as -1, which is no revision at all.
  source.addSession("ses_e")
  source.db.run("INSERT OR REPLACE INTO event_sequence (aggregate_id, seq) VALUES ('ses_e', -1)")
  expect(readPosition(source.db, "ses_e")).toBeNull()
  expect([...readPositions(source.db).keys()]).toEqual(["ses_a"])
  expect(readSnapshot(source.db, "ses_e")).toBeNull()

  source.db.run("UPDATE event_sequence SET seq = 0 WHERE aggregate_id = 'ses_e'")
  expect(readPosition(source.db, "ses_e")).toMatchObject({ revision: 0 })
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

/** The `data` strings `read` parsed. */
function parsedBy<A>(read: () => A): { result: A; parsed: unknown[] } {
  const parse = spyOn(JSON, "parse")
  try {
    const result = read()
    return { result, parsed: parse.mock.calls.map(([text]) => text) }
  } finally {
    parse.mockRestore()
  }
}

const dataOf = (id: string) => (source.db.query("SELECT data FROM session_message WHERE id = ?").get(id) as { data: string }).data

test("a cached snapshot parses data only for new and changed rows and matches an uncached one", () => {
  const snapshot = cachedSnapshots(source.db)
  // Bookkeeping rows are never parsed, cached or not.
  expect(parsedBy(() => snapshot("ses_a"))).toEqual({
    result: readSnapshot(source.db, "ses_a"),
    parsed: [dataOf("msg_ses_a_2"), dataOf("msg_ses_a_4")],
  })
  expect(parsedBy(() => snapshot("ses_a"))).toEqual({ result: readSnapshot(source.db, "ses_a"), parsed: [] })

  source.updateMessage("ses_a", "msg_ses_a_2", { text: "how do I list hidden files?" }, 200)
  expect(parsedBy(() => snapshot("ses_a"))).toEqual({ result: readSnapshot(source.db, "ses_a"), parsed: [dataOf("msg_ses_a_2")] })

  source.addMessage("ses_a", "user", { text: "and sizes?" }, 201)
  expect(parsedBy(() => snapshot("ses_a"))).toEqual({ result: readSnapshot(source.db, "ses_a"), parsed: [dataOf("msg_ses_a_7")] })
  expect(parsedBy(() => snapshot("ses_a"))).toEqual({ result: readSnapshot(source.db, "ses_a"), parsed: [] })
  expect(snapshot("ses_missing")).toBeNull()
})

test("a cached snapshot drops deleted rows and re-reads a row written in the millisecond of the last read", () => {
  const snapshot = cachedSnapshots(source.db)
  snapshot("ses_a")
  source.db.run("DELETE FROM session_message WHERE id = 'msg_ses_a_4'")
  expect(snapshot("ses_a")!.session.messages.map((m) => m.id)).toEqual(["msg_ses_a_2"])
  expect(snapshot("ses_a")).toEqual(readSnapshot(source.db, "ses_a"))

  try {
    setSystemTime(new Date(1_000))
    source.addMessage("ses_a", "user", { text: "draft" }, 1_000)
    expect(snapshot("ses_a")!.session.messages.at(-1)!.parts).toEqual([{ kind: "text", text: "draft" }])
    source.updateMessage("ses_a", "msg_ses_a_6", { text: "final" }, 1_000)
    setSystemTime(new Date(2_000))
    expect(parsedBy(() => snapshot("ses_a"))).toEqual({ result: readSnapshot(source.db, "ses_a"), parsed: [dataOf("msg_ses_a_6")] })
    expect(parsedBy(() => snapshot("ses_a")).parsed).toEqual([])
  } finally {
    setSystemTime()
  }
})

test("the snapshot cache evicts the least recently read session past its session and byte limits", () => {
  for (const id of ["ses_b", "ses_c"]) {
    source.addSession(id)
    source.addMessage(id, "user", { text: "x".repeat(1_000) }, 101)
  }
  const parses = (snapshot: (id: string) => unknown, id: string) => parsedBy(() => snapshot(id)).parsed.length

  const byCount = cachedSnapshots(source.db, { sessions: 2, bytes: CACHE_LIMITS.bytes })
  for (const id of ["ses_a", "ses_b", "ses_c"]) byCount(id)
  expect([parses(byCount, "ses_c"), parses(byCount, "ses_b"), parses(byCount, "ses_a")]).toEqual([0, 0, 2])
  expect(parses(byCount, "ses_c")).toBe(1)

  // One 1,000-character message is a little over 2,000 bytes, so one session fits and two do not.
  const byBytes = cachedSnapshots(source.db, { sessions: 16, bytes: 3_000 })
  byBytes("ses_b")
  byBytes("ses_c")
  expect([parses(byBytes, "ses_c"), parses(byBytes, "ses_b"), parses(byBytes, "ses_c")]).toEqual([0, 1, 1])

  const tooSmall = cachedSnapshots(source.db, { sessions: 16, bytes: 1_000 })
  expect([parses(tooSmall, "ses_b"), parses(tooSmall, "ses_b")]).toEqual([1, 1])
})

test("an uploaded session is stored by the hub as sessions, messages, and parts rows", async () => {
  const client = makeClient({ url: hub.url.href, token: hub.issueToken("laptop") })
  expect(await Effect.runPromise(client.snapshot(readSnapshot(source.db, "ses_a")!))).toEqual({ outcome: "archived" })
  expect(await Effect.runPromise(client.status())).toMatchObject({ sessions: 1 })

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
  const [first, second] = [hub.issueToken("laptop"), hub.issueToken("laptop")]
  await Effect.runPromise(makeClient({ url: hub.url.href, token: first }).snapshot(readSnapshot(source.db, "ses_a")!))
  source.addSession("ses_b", { title: "Other", time: 300 })
  await Effect.runPromise(makeClient({ url: hub.url.href, token: second }).snapshot(readSnapshot(source.db, "ses_b")!))

  const archive = new Database(join(dataDir, "archive.db"), { readonly: true })
  expect(
    archive.query("SELECT sessions.id, sources.name FROM sessions JOIN sources ON sources.id = source_id ORDER BY sessions.id").all(),
  ).toEqual([
    { id: "ses_a", name: "laptop" },
    { id: "ses_b", name: "laptop" },
  ])
  archive.close()
})
