import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { createClient } from "@opencode-recall/protocol"
import { openArchive } from "../../hub/src/archive/index.ts"
import { createLog } from "../../hub/src/log.ts"
import { serve } from "../../hub/src/serve.ts"
import type { HubConfig } from "./config.ts"
import { sourceDb, type SourceDb } from "./fixture.ts"
import { searchTool } from "./search.ts"
import { compactionBoundary, readSnapshot } from "./source.ts"

let dataDir: string
let hub: ReturnType<typeof serve>
let laptop: SourceDb
let config: HubConfig

function issueToken(name: string): string {
  const admin = openArchive(join(dataDir, "archive.db"))
  const token = admin.issueToken(name)
  admin.close()
  return token
}

async function upload(source: SourceDb, sessionId: string, token: string) {
  await createClient({ url: hub.url.href, token }).snapshot(readSnapshot(source.db, sessionId)!)
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "recall-search-"))
  hub = serve({ dataDir, listen: "127.0.0.1:0", logLevel: "error" }, createLog("error", () => {}))
  config = { url: hub.url.href, token: issueToken("laptop") }

  // The desktop uploads one session and goes offline; the hub's copy is all that remains.
  const desktop = sourceDb()
  desktop.addSession("ses_remote", { title: "Fixing the ingress", time: 100 })
  desktop.addMessage("ses_remote", "user", { text: "the needle broke the ingress" }, 101)
  await upload(desktop, "ses_remote", issueToken("desktop"))
  desktop.close()

  laptop = sourceDb()
  laptop.addSession("ses_self", { title: "Current work", time: 200 })
  laptop.addMessage("ses_self", "user", { text: "needle before compaction" }, 201)
  laptop.addMessage("ses_self", "compaction", { status: "completed", summary: "Summarized.", recent: [] }, 202)
  laptop.addMessage("ses_self", "user", { text: "needle after compaction" }, 203)
  await upload(laptop, "ses_self", config.token)
})

afterEach(async () => {
  laptop.close()
  await hub.stop()
  rmSync(dataDir, { recursive: true, force: true })
})

const context = { sessionID: "ses_self" } as unknown as ToolContext

async function run(input: object, loadConfig: () => Promise<HubConfig | null> = async () => config): Promise<string> {
  const tool = searchTool({ loadConfig, compactionBoundary: (id) => compactionBoundary(laptop.db, id) })
  const { content } = await tool.execute(input, context)
  if (typeof content !== "string") throw new Error("expected text content")
  return content
}

test("finds an offline host's session and the caller's pre-compaction history, naming origin and revision", async () => {
  const output = await run({ query: "needle" })
  expect(output).toContain("Fixing the ingress")
  expect(output).toContain("from desktop, archived revision 2")
  expect(output).toContain("from laptop (this host), archived revision 4 ← THIS session, before its last compaction")
  expect(output).toContain("«needle» before compaction")
  expect(output).not.toContain("after compaction")
})

test("filters reach the hub", async () => {
  const output = await run({ query: "needle", source: "desktop" })
  expect(output).toContain("ses_remote")
  expect(output).not.toContain("ses_self")
  expect(await run({ query: "needle", since: "2999-01-01" })).toStartWith('No matches for "needle"')
})

test("an unconfigured or unreachable hub is reported as not having looked", async () => {
  expect(await run({ query: "needle" }, async () => null)).toStartWith("recall could not look")
  await hub.stop()
  expect(await run({ query: "needle" })).toStartWith("recall could not look: the hub request failed")
})
