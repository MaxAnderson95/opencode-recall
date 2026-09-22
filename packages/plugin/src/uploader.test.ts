import { afterEach, beforeEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PROTOCOL_VERSION, type ErrorBody, type ErrorCode } from "@opencode-recall/protocol"
import { openArchive, type Archive } from "../../hub/src/archive/index.ts"
import { DEFAULT_LIMITS, createHandler, type Limits } from "../../hub/src/server.ts"
import { loadHubConfig } from "./config.ts"
import { sourceDb, type SourceDb } from "./fixture.ts"
import { readPosition, readSnapshot } from "./source.ts"
import { createUploader, type Storage, type Uploader } from "./uploader.ts"

type Json = Parameters<Storage["set"]>[1]

/** `ctx.storage` as OpenCode implements it: prefix scan over keys with the namespace stripped. */
function memoryStorage() {
  const entries = new Map<string, Json>()
  const storage: Storage = {
    get: async (key) => entries.get(key),
    set: async (key, value) => void entries.set(key, value),
    remove: async (key) => void entries.delete(key),
    scan: async ({ prefix }) => ({
      entries: [...entries].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    }),
  }
  return { storage, entries }
}

type Intercept = (req: Request, forward: (req: Request) => Promise<Response>) => Promise<Response>

let dir: string
let configFile: string
let archive: Archive
let hub: ReturnType<typeof Bun.serve>
let source: SourceDb
let intercept: Intercept
/** The outcome or error code of every snapshot request that reached the hub. */
let outcomes: string[]
const uploaders: Uploader[] = []

function startHub(limits: Limits = DEFAULT_LIMITS) {
  const handler = createHandler({ archive, log: () => {}, limits })
  const forward = async (req: Request) => {
    const res = await handler(req)
    if (new URL(req.url).pathname === "/v1/snapshot") {
      const body = (await res.clone().json()) as { outcome?: string } & Partial<ErrorBody>
      outcomes.push(body.outcome ?? body.error!.code)
    }
    return res
  }
  hub = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => intercept(req, forward) })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recall-uploader-"))
  configFile = join(dir, "recall.json")
  archive = openArchive(join(dir, "archive.db"))
  intercept = (req, forward) => forward(req)
  outcomes = []
  startHub()
  source = sourceDb()
  source.addSession("ses_a")
  source.addMessage("ses_a", "user", { text: "first" }, 101)
})

afterEach(async () => {
  for (const u of uploaders.splice(0)) u.stop()
  await hub.stop(true)
  archive.close()
  source.close()
  rmSync(dir, { recursive: true, force: true })
})

const writeConfig = (hubConfig: { url?: string; token?: string }) =>
  writeFileSync(configFile, JSON.stringify({ index: { excludeDirectories: [] }, hub: hubConfig }))

const configure = () => writeConfig({ url: hub.url.href, token: archive.issueToken("laptop") })

function start(storage: Storage = memoryStorage().storage, timing: { quietMs?: number; retryMs?: number } = {}) {
  const uploader = createUploader({
    source: { position: (id) => readPosition(source.db, id), snapshot: (id) => readSnapshot(source.db, id) },
    storage,
    loadConfig: () => loadHubConfig({}, configFile),
    quietMs: 5,
    retryMs: 10,
    probeIntervalMs: 5,
    log: () => {},
    ...timing,
  })
  uploaders.push(uploader)
  return uploader
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 400 && !condition(); i++) await Bun.sleep(5)
  expect(condition()).toBe(true)
}

function archivedTexts(): string[] {
  const db = new Database(join(dir, "archive.db"), { readonly: true })
  const rows = db
    .query("SELECT parts.text FROM parts JOIN messages ON messages.id = message_id ORDER BY messages.ordinal")
    .all() as { text: string }[]
  db.close()
  return rows.map((row) => row.text)
}

test("updating a session uploads a newer revision that replaces the archived copy", async () => {
  configure()
  const { storage, entries } = memoryStorage()
  const uploader = start(storage)
  uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)

  source.addMessage("ses_a", "user", { text: "second" }, 102)
  uploader.enqueue("ses_a")
  await until(() => outcomes.length === 2)
  expect(outcomes).toEqual(["archived", "archived"])
  expect(archivedTexts()).toEqual(["first", "second"])
  await until(() => entries.size === 0)
})

test("a lost acknowledgement is retried and the retry is a no-op", async () => {
  configure()
  let dropped = false
  intercept = async (req, forward) => {
    const res = await forward(req)
    if (dropped || new URL(req.url).pathname !== "/v1/snapshot") return res
    dropped = true
    return new Response("upstream reset", { status: 502 })
  }
  const { storage, entries } = memoryStorage()
  start(storage).enqueue("ses_a")

  await until(() => outcomes.length === 2)
  expect(outcomes).toEqual(["archived", "unchanged"])
  await until(() => entries.size === 0)
  expect(archive.status()).toEqual({ sessions: 1 })
})

test("a change made while an upload is in flight is still uploaded afterwards", async () => {
  configure()
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let first = true
  intercept = async (req, forward) => {
    const res = await forward(req)
    if (first && new URL(req.url).pathname === "/v1/snapshot") {
      first = false
      await held
    }
    return res
  }
  const { storage, entries } = memoryStorage()
  const uploader = start(storage)
  uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)

  source.addMessage("ses_a", "user", { text: "mid-flight" }, 102)
  uploader.enqueue("ses_a")
  await Bun.sleep(20)
  release()

  await until(() => outcomes.length === 2)
  expect(archivedTexts()).toEqual(["first", "mid-flight"])
  await until(() => entries.size === 0)
})

test("two plugin instances uploading the same session converge on one correct copy", async () => {
  configure()
  const { storage, entries } = memoryStorage()
  // Every instance receives every event, so both see each change.
  const instances = [start(storage), start(storage)]
  for (const text of ["two", "three", "four"]) {
    source.addMessage("ses_a", "user", { text }, 100 + text.length)
    for (const instance of instances) instance.enqueue("ses_a")
    await Bun.sleep(15)
  }

  await until(() => entries.size === 0)
  await Bun.sleep(30)
  expect(archivedTexts()).toEqual(["first", "two", "three", "four"])
  expect(outcomes.every((o) => o === "archived" || o === "unchanged")).toBe(true)
  expect(archive.status()).toEqual({ sessions: 1 })
})

test("a burst of child-turn events produces one upload after the quiet period", async () => {
  configure()
  const uploader = start(memoryStorage().storage, { quietMs: 50 })
  for (let turn = 0; turn < 20; turn++) {
    source.addMessage("ses_a", "assistant", { content: [{ type: "text", text: `child ${turn}` }] }, 200 + turn)
    uploader.enqueue("ses_a")
    await Bun.sleep(1)
  }
  await until(() => outcomes.length === 1)
  await Bun.sleep(100)
  expect(outcomes).toEqual(["archived"])
  expect(archivedTexts()).toHaveLength(21)
})

test("an entry left in the work list by an earlier run is uploaded at startup", async () => {
  configure()
  const { storage, entries } = memoryStorage()
  await storage.set("dirty/ses_a", readPosition(source.db, "ses_a")!)
  start(storage)
  await until(() => outcomes.length === 1 && entries.size === 0)
  expect(archivedTexts()).toEqual(["first"])
})

test("an oversize snapshot is rejected as payload_too_large and not retried", async () => {
  await hub.stop(true)
  startHub({ ...DEFAULT_LIMITS, decompressedBytes: 2_000 })
  configure()
  source.addMessage("ses_a", "user", { text: "x".repeat(5_000) }, 102)
  const { storage, entries } = memoryStorage()
  start(storage).enqueue("ses_a")

  await until(() => entries.size === 0)
  await Bun.sleep(50)
  expect(outcomes).toEqual(["payload_too_large"])
  expect(archive.status()).toEqual({ sessions: 0 })
})

test.each<[ErrorCode | number, "retried" | "dropped"]>([
  ["rate_limited", "retried"],
  ["request_timeout", "retried"],
  [503, "retried"],
  ["stale_revision", "dropped"],
  ["hash_divergence", "dropped"],
  ["payload_too_large", "dropped"],
  ["invalid_request", "dropped"],
])("a %s answer is %s", async (answer, expected) => {
  configure()
  let requests = 0
  intercept = async (req, forward) => {
    if (new URL(req.url).pathname !== "/v1/snapshot" || requests++ > 0) return forward(req)
    if (typeof answer === "number") return new Response("unavailable", { status: answer })
    const status = { rate_limited: 429, request_timeout: 408, payload_too_large: 413, invalid_request: 400 }[answer as string] ?? 409
    return Response.json({ error: { code: answer, message: "stub" } } satisfies ErrorBody, { status })
  }
  const { storage, entries } = memoryStorage()
  start(storage).enqueue("ses_a")

  await until(() => entries.size === 0)
  await Bun.sleep(50)
  expect(requests).toBe(expected === "retried" ? 2 : 1)
  expect(archive.status()).toEqual({ sessions: expected === "retried" ? 1 : 0 })
})

test("invalid_token pauses the queue without losing work, and a fixed config file resumes it", async () => {
  writeConfig({ url: hub.url.href, token: "opencode-recall_revoked" })
  source.addSession("ses_b")
  const { storage, entries } = memoryStorage()
  const uploader = start(storage)

  uploader.enqueue("ses_a")
  await until(() => uploader.pausedBy !== null)
  expect(uploader.pausedBy).toStartWith("invalid_token")
  uploader.enqueue("ses_b")
  await Bun.sleep(30)
  expect(archive.status()).toEqual({ sessions: 0 })
  expect([...entries.keys()].sort()).toEqual(["dirty/ses_a", "dirty/ses_b"])

  configure()
  await until(() => archive.status().sessions === 2)
  expect(uploader.pausedBy).toBeNull()
})

test("a missing token pauses the queue until the config provides one", async () => {
  writeConfig({ url: hub.url.href })
  const uploader = start()

  uploader.enqueue("ses_a")
  await until(() => uploader.pausedBy !== null)
  expect(outcomes).toEqual([])

  configure()
  await until(() => archive.status().sessions === 1)
})

test("protocol_version pauses the queue and it resumes once the hub accepts the client", async () => {
  let hubVersion = PROTOCOL_VERSION + 1
  let snapshots = 0
  intercept = async (req, forward) => {
    if (new URL(req.url).pathname === "/v1/snapshot") snapshots++
    if (hubVersion === PROTOCOL_VERSION) return forward(req)
    const error = { code: "protocol_version", message: `this hub serves version ${hubVersion}` } as const
    return Response.json({ error } satisfies ErrorBody, { status: 400 })
  }
  configure()
  const uploader = start()

  uploader.enqueue("ses_a")
  await until(() => uploader.pausedBy !== null)
  expect(uploader.pausedBy).toStartWith("protocol_version")

  hubVersion = PROTOCOL_VERSION
  await until(() => uploader.pausedBy === null && archive.status().sessions === 1)
  expect(snapshots).toBe(2)
})

test("the environment overrides the config file's hub URL and token", async () => {
  writeConfig({ url: "http://file", token: "from-file" })
  expect(await loadHubConfig({ OPENCODE_RECALL_TOKEN: "from-env" }, configFile)).toEqual({
    url: "http://file",
    token: "from-env",
  })
  expect(await loadHubConfig({}, join(dir, "absent.json"))).toBeNull()

  writeConfig({ url: "", token: "" })
  const env = { OPENCODE_RECALL_HUB_URL: "http://env", OPENCODE_RECALL_TOKEN: "from-env" }
  expect(await loadHubConfig(env, configFile)).toEqual({ url: "http://env", token: "from-env" })
  expect(await loadHubConfig({}, configFile)).toBeNull()

  writeFileSync(configFile, JSON.stringify({ hub: { url: 7, token: "from-file" } }))
  await expect(loadHubConfig({}, configFile)).rejects.toThrow()
})
