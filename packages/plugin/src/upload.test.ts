import { afterEach, beforeEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createClient } from "@opencode-recall/protocol"
import { openArchive } from "../../hub/src/archive/index.ts"
import { createLog } from "../../hub/src/log.ts"
import { serve } from "../../hub/src/serve.ts"
import { sourceDb, type SourceDb } from "./fixture.ts"
import { EXTRACTOR_VERSION, readSession, readSnapshot } from "./source.ts"

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
  const admin = openArchive(join(dataDir, "archive.db"))
  const token = admin.issueToken(name)
  admin.close()
  return token
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "recall-plugin-"))
  hub = serve({ dataDir, listen: "127.0.0.1:0", logLevel: "error" }, createLog("error", () => {}))
  source = demo()
})

afterEach(async () => {
  source.close()
  await hub.stop()
  rmSync(dataDir, { recursive: true, force: true })
})

test("reads a v2 session as plain text, dropping bookkeeping messages", () => {
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
      { id: "msg_ses_a_4", type: "assistant", timeCreated: 103, parts: [{ kind: "text", text: "Use ls." }] },
    ],
  })
  expect(readSession(source.db, "ses_missing")).toBeNull()
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
  expect(await client.status()).toEqual({ sessions: 1 })

  const archive = new Database(join(dataDir, "archive.db"), { readonly: true })
  expect(archive.query("SELECT id, title, revision, last_activity FROM sessions").all()).toEqual([
    { id: "ses_a", title: "Demo", revision: 5, last_activity: 104 },
  ])
  expect(archive.query("SELECT id, type FROM messages ORDER BY ordinal").all()).toEqual([
    { id: "msg_ses_a_2", type: "user" },
    { id: "msg_ses_a_4", type: "assistant" },
  ])
  expect(archive.query("SELECT message_id, text FROM parts ORDER BY message_id").all()).toEqual([
    { message_id: "msg_ses_a_2", text: "how do I list files?" },
    { message_id: "msg_ses_a_4", text: "Use ls." },
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
