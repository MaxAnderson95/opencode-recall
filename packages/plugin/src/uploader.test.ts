import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PROTOCOL_VERSION, type Client, type ErrorBody, type Session } from "@opencode-recall/protocol"
import { openArchive } from "../../hub/src/archive/index.ts"
import { createLog } from "../../hub/src/log.ts"
import { serve } from "../../hub/src/serve.ts"
import { loadHubConfig } from "./config.ts"
import { createUploader, type Uploader } from "./uploader.ts"

let dir: string
let configFile: string
let hub: ReturnType<typeof serve>
let uploader: Uploader | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recall-uploader-"))
  configFile = join(dir, "recall.json")
  hub = serve({ dataDir: join(dir, "hub"), listen: "127.0.0.1:0", logLevel: "error" }, createLog("error", () => {}))
})

afterEach(async () => {
  uploader?.stop()
  await hub.stop()
  rmSync(dir, { recursive: true, force: true })
})

const writeConfig = (hubConfig: { url?: string; token?: string }) =>
  writeFileSync(configFile, JSON.stringify({ index: { excludeDirectories: [] }, hub: hubConfig }))

function issueToken(): string {
  const admin = openArchive(join(dir, "hub", "archive.db"))
  const token = admin.issueToken("laptop")
  admin.close()
  return token
}

function archivedCount(): number {
  const admin = openArchive(join(dir, "hub", "archive.db"))
  const { sessions } = admin.status()
  admin.close()
  return sessions
}

const session = (id: string): Session => ({
  id,
  slug: "slug",
  title: "title",
  directory: "/work",
  parentId: null,
  timeCreated: 1,
  timeUpdated: 2,
  messages: [],
})

function start() {
  const uploads: string[] = []
  uploader = createUploader({
    upload: async (client: Client, sessionId) => {
      uploads.push(sessionId)
      await client.snapshot(session(sessionId))
    },
    loadConfig: () => loadHubConfig({}, configFile),
    probeIntervalMs: 5,
    log: () => {},
  })
  return { uploader, uploads }
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 400 && !condition(); i++) await Bun.sleep(5)
  expect(condition()).toBe(true)
}

test("invalid_token pauses the queue without losing work, and a fixed config file resumes it", async () => {
  writeConfig({ url: hub.url.href, token: "opencode-recall_revoked" })
  const { uploader, uploads } = start()

  uploader.enqueue("ses_a")
  await until(() => uploader.pausedBy !== null)
  expect(uploader.pausedBy).toStartWith("invalid_token")
  uploader.enqueue("ses_b")
  await Bun.sleep(30)
  expect(uploads).toEqual(["ses_a"])
  expect(archivedCount()).toBe(0)

  writeConfig({ url: hub.url.href, token: issueToken() })
  await until(() => archivedCount() === 2)
  expect(uploader.pausedBy).toBeNull()
})

test("a missing token pauses the queue until the config provides one", async () => {
  writeConfig({ url: hub.url.href })
  const { uploader, uploads } = start()

  uploader.enqueue("ses_a")
  await until(() => uploader.pausedBy !== null)
  expect(uploads).toEqual([])

  writeConfig({ url: hub.url.href, token: issueToken() })
  await until(() => archivedCount() === 1)
})

test("protocol_version pauses the queue and it resumes once the hub accepts the client", async () => {
  let hubVersion = PROTOCOL_VERSION + 1
  const stub = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      if (hubVersion !== PROTOCOL_VERSION) {
        const error = { code: "protocol_version", message: `this hub serves version ${hubVersion}` } as const
        return Response.json({ error } satisfies ErrorBody, { status: 400 })
      }
      return Response.json(new URL(req.url).pathname.endsWith("/status") ? { sessions: 0 } : { outcome: "archived" })
    },
  })
  try {
    writeConfig({ url: stub.url.href, token: "opencode-recall_any" })
    const { uploader, uploads } = start()

    uploader.enqueue("ses_a")
    await until(() => uploader.pausedBy !== null)
    expect(uploader.pausedBy).toStartWith("protocol_version")

    hubVersion = PROTOCOL_VERSION
    await until(() => uploader.pausedBy === null && uploads.length === 2)
    expect(uploads).toEqual(["ses_a", "ses_a"])
  } finally {
    await stub.stop()
  }
})

test("the environment overrides the config file's hub URL and token", async () => {
  writeConfig({ url: "http://file", token: "from-file" })
  expect(await loadHubConfig({ OPENCODE_RECALL_TOKEN: "from-env" }, configFile)).toEqual({
    url: "http://file",
    token: "from-env",
  })
  expect(await loadHubConfig({}, join(dir, "absent.json"))).toBeNull()
})
