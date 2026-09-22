import { afterEach, beforeEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createClient } from "@opencode-recall/protocol"
import { openArchive } from "../../hub/src/archive/index.ts"
import { createLog } from "../../hub/src/log.ts"
import { serve } from "../../hub/src/serve.ts"
import { uploadSession } from "./index.ts"
import { readSession } from "./source.ts"

/** The columns of OpenCode 2.0.14's `session_v2` and `session_message` that the plugin reads. */
function sourceDb(): Database {
  const db = new Database(":memory:")
  db.run(`CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, slug TEXT NOT NULL, directory TEXT NOT NULL,
    title TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)`)
  db.run(`CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
    seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.run(`INSERT INTO session_v2 VALUES ('ses_a', NULL, 'brave-otter', '/work/demo', 'Demo', 100, 200)`)
  const messages: [string, number, object][] = [
    ["user", 1, { text: "how do I list files?", files: [{ data: "aGVsbG8=", mime: "text/plain" }] }],
    ["model-switched", 2, { model: { id: "m", providerID: "p" } }],
    [
      "assistant",
      3,
      {
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "Use ls." },
          { type: "tool", name: "bash", state: { status: "completed", content: [{ type: "text", text: "a b" }] } },
        ],
      },
    ],
    ["idle", 4, { outcome: "succeeded" }],
  ]
  for (const [type, seq, data] of messages)
    db.run("INSERT INTO session_message VALUES (?, 'ses_a', ?, ?, ?, ?, ?)", [
      `msg_${seq}`,
      type,
      seq,
      100 + seq,
      100 + seq,
      JSON.stringify(data),
    ])
  return db
}

let dataDir: string
let hub: ReturnType<typeof serve>
let db: Database

/** Issue a token the way `opencode-recall-hub token issue` does, through its own connection. */
function issueToken(source: string): string {
  const admin = openArchive(join(dataDir, "archive.db"))
  const token = admin.issueToken(source)
  admin.close()
  return token
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "recall-plugin-"))
  hub = serve({ dataDir, listen: "127.0.0.1:0", logLevel: "error" }, createLog("error", () => {}))
  db = sourceDb()
})

afterEach(async () => {
  db.close()
  await hub.stop()
  rmSync(dataDir, { recursive: true, force: true })
})

test("reads a v2 session as plain text, dropping bookkeeping messages", () => {
  expect(readSession(db, "ses_a")).toEqual({
    id: "ses_a",
    slug: "brave-otter",
    title: "Demo",
    directory: "/work/demo",
    parentId: null,
    timeCreated: 100,
    timeUpdated: 200,
    messages: [
      { id: "msg_1", type: "user", timeCreated: 101, parts: [{ kind: "text", text: "how do I list files?" }] },
      { id: "msg_3", type: "assistant", timeCreated: 103, parts: [{ kind: "text", text: "Use ls." }] },
    ],
  })
  expect(readSession(db, "ses_missing")).toBeNull()
})

test("an uploaded session is stored by the hub as sessions, messages, and parts rows", async () => {
  const client = createClient({ url: hub.url.href, token: issueToken("laptop") })
  expect(await uploadSession(db, client, "ses_a")).toBe(true)
  expect(await client.status()).toEqual({ sessions: 1 })

  const archive = new Database(join(dataDir, "archive.db"), { readonly: true })
  expect(archive.query("SELECT id, title FROM sessions").all()).toEqual([{ id: "ses_a", title: "Demo" }])
  expect(archive.query("SELECT id, type FROM messages ORDER BY ordinal").all()).toEqual([
    { id: "msg_1", type: "user" },
    { id: "msg_3", type: "assistant" },
  ])
  expect(archive.query("SELECT message_id, text FROM parts ORDER BY message_id").all()).toEqual([
    { message_id: "msg_1", text: "how do I list files?" },
    { message_id: "msg_3", text: "Use ls." },
  ])
  archive.close()
})

test("uploads under two tokens for one source are attributed to that one source", async () => {
  const [first, second] = [issueToken("laptop"), issueToken("laptop")]
  await uploadSession(db, createClient({ url: hub.url.href, token: first }), "ses_a")
  db.run("INSERT INTO session_v2 VALUES ('ses_b', NULL, 'calm-heron', '/work/demo', 'Other', 300, 400)")
  await uploadSession(db, createClient({ url: hub.url.href, token: second }), "ses_b")

  const archive = new Database(join(dataDir, "archive.db"), { readonly: true })
  expect(
    archive.query("SELECT sessions.id, sources.name FROM sessions JOIN sources ON sources.id = source_id ORDER BY sessions.id").all(),
  ).toEqual([
    { id: "ses_a", name: "laptop" },
    { id: "ses_b", name: "laptop" },
  ])
  archive.close()
})
