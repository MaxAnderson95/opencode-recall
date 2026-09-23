import { afterEach, beforeEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PROTOCOL_VERSION, createClient, type ErrorBody, type ErrorCode } from "@opencode-recall/protocol"
import { openArchive, type Archive } from "../../hub/src/archive/index.ts"
import { fakeEmbedder } from "../../hub/src/fake-embedder.ts"
import { DEFAULT_LIMITS, createHandler, type Limits } from "../../hub/src/server.ts"
import { loadHubConfig } from "./config.ts"
import { sourceDb, type SourceDb } from "./fixture.ts"
import { EXTRACTOR_VERSION, readPosition, readPositions, readSnapshot } from "./source.ts"
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
  /** Queued work, leaving out the acknowledged positions kept for the sweep. */
  const pending = () => [...entries.keys()].filter((key) => !key.startsWith("acked/")).length
  return { storage, entries, pending }
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
/** The verb of every request that reached the hub. */
let verbs: string[]
const uploaders: Uploader[] = []

function startHub(limits: Limits = DEFAULT_LIMITS) {
  const handler = createHandler({ archive, log: () => {}, limits })
  const forward = async (req: Request) => {
    const res = await handler(req)
    verbs.push(new URL(req.url).pathname.slice("/v1/".length))
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
  archive = openArchive(join(dir, "archive.db"), fakeEmbedder())
  intercept = (req, forward) => forward(req)
  outcomes = []
  verbs = []
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

function start(
  storage: Storage = memoryStorage().storage,
  timing: { quietMs?: number; retryMs?: number; sweepIntervalMs?: number } = {},
  db: SourceDb = source,
) {
  const uploader = createUploader({
    source: {
      position: (id) => readPosition(db.db, id),
      positions: () => readPositions(db.db),
      snapshot: (id) => readSnapshot(db.db, id),
    },
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
  const { storage, entries, pending } = memoryStorage()
  const uploader = start(storage)
  uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)

  source.addMessage("ses_a", "user", { text: "second" }, 102)
  uploader.enqueue("ses_a")
  await until(() => outcomes.length === 2)
  expect(outcomes).toEqual(["archived", "archived"])
  expect(archivedTexts()).toEqual(["first", "second"])
  await until(() => pending() === 0)
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
  const { storage, entries, pending } = memoryStorage()
  start(storage).enqueue("ses_a")

  await until(() => outcomes.length === 2)
  expect(outcomes).toEqual(["archived", "unchanged"])
  await until(() => pending() === 0)
  expect(archive.status()).toMatchObject({ sessions: 1 })
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
  const { storage, entries, pending } = memoryStorage()
  const uploader = start(storage)
  uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)

  source.addMessage("ses_a", "user", { text: "mid-flight" }, 102)
  uploader.enqueue("ses_a")
  await Bun.sleep(20)
  release()

  await until(() => outcomes.length === 2)
  expect(archivedTexts()).toEqual(["first", "mid-flight"])
  await until(() => pending() === 0)
})

test("two plugin instances uploading the same session converge on one correct copy", async () => {
  configure()
  const { storage, entries, pending } = memoryStorage()
  // Every instance receives every event, so both see each change.
  const instances = [start(storage), start(storage)]
  for (const text of ["two", "three", "four"]) {
    source.addMessage("ses_a", "user", { text }, 100 + text.length)
    for (const instance of instances) instance.enqueue("ses_a")
    await Bun.sleep(15)
  }

  await until(() => pending() === 0)
  await Bun.sleep(30)
  expect(archivedTexts()).toEqual(["first", "two", "three", "four"])
  expect(outcomes.every((o) => o === "archived" || o === "unchanged")).toBe(true)
  expect(archive.status()).toMatchObject({ sessions: 1 })
})

test("an old acknowledgement never removes another instance's newer work", async () => {
  configure()
  const { storage, entries, pending } = memoryStorage()
  // Instance A's acknowledgement stops after it has read the work list and before it removes anything.
  let reachedRemove!: () => void
  const removing = new Promise<void>((resolve) => (reachedRemove = resolve))
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  const held: Storage = {
    ...storage,
    remove: async (key) => {
      reachedRemove()
      await released
      return storage.remove(key)
    },
  }
  // B is already running with an empty work list; it only sees the second change.
  const b = start(storage, { quietMs: 100 })
  const a = start(held)
  a.enqueue("ses_a")
  await removing

  // A shuts down with its acknowledgement in flight while B records a newer change.
  a.stop()
  source.addMessage("ses_a", "user", { text: "second" }, 102)
  b.enqueue("ses_a")
  await until(() => [...entries.values()].some((entry) => (entry as { revision: number }).revision === 3))
  release()

  await until(() => outcomes.length === 2)
  expect(archivedTexts()).toEqual(["first", "second"])
  await until(() => pending() === 0)
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
  const { storage, entries, pending } = memoryStorage()
  await storage.set("dirty/ses_a/101-2", readPosition(source.db, "ses_a")!)
  start(storage)
  await until(() => outcomes.length === 1 && pending() === 0)
  expect(archivedTexts()).toEqual(["first"])
})

test("an oversize snapshot is rejected as payload_too_large and not retried", async () => {
  await hub.stop(true)
  startHub({ ...DEFAULT_LIMITS, decompressedBytes: 2_000 })
  configure()
  source.addMessage("ses_a", "user", { text: "x".repeat(5_000) }, 102)
  const { storage, entries, pending } = memoryStorage()
  start(storage).enqueue("ses_a")

  await until(() => pending() === 0)
  await Bun.sleep(50)
  expect(outcomes).toEqual(["payload_too_large"])
  expect(archive.status()).toMatchObject({ sessions: 0 })
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
  const { storage, entries, pending } = memoryStorage()
  start(storage).enqueue("ses_a")

  await until(() => pending() === 0)
  await Bun.sleep(50)
  expect(requests).toBe(expected === "retried" ? 2 : 1)
  expect(archive.status()).toMatchObject({ sessions: expected === "retried" ? 1 : 0 })
})

test("invalid_token pauses the queue without losing work, and a fixed config file resumes it", async () => {
  writeConfig({ url: hub.url.href, token: "opencode-recall_revoked" })
  source.addSession("ses_b")
  const { storage, entries, pending } = memoryStorage()
  const uploader = start(storage)

  uploader.enqueue("ses_a")
  await until(() => uploader.pausedBy !== null)
  expect(uploader.pausedBy).toStartWith("invalid_token")
  uploader.enqueue("ses_b")
  await Bun.sleep(30)
  expect(archive.status()).toMatchObject({ sessions: 0 })
  expect([...entries.keys()].map((key) => key.split("/")[1]).sort()).toEqual(["ses_a", "ses_b"])

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

const clientFor = (name: string) => createClient({ url: hub.url.href, token: archive.issueToken(name) })

test("deleting a session tombstones it, and a later upload from before the deletion is rejected", async () => {
  configure()
  const { storage, entries, pending } = memoryStorage()
  const uploader = start(storage)
  uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)
  const stale = readSnapshot(source.db, "ses_a")!

  source.remove("ses_a")
  uploader.delete("ses_a", { revision: 3, timeDeleted: 200 })
  await until(() => archive.status().sessions === 0 && pending() === 0)
  expect(archive.manifest().tombstones).toEqual([{ sessionId: "ses_a", timeDeleted: 200 }])

  const error = await clientFor("desktop").snapshot(stale).catch((e: unknown) => e)
  expect(error).toMatchObject({ code: "tombstoned", status: 409 })
  expect(archive.status()).toMatchObject({ sessions: 0 })
})

test("a session deleted before its queued upload sends a tombstone instead of the upload", async () => {
  configure()
  const { storage, entries, pending } = memoryStorage()
  const uploader = start(storage)
  uploader.enqueue("ses_a")
  source.remove("ses_a")
  uploader.delete("ses_a", { revision: 3, timeDeleted: 200 })

  await until(() => archive.manifest().tombstones.length === 1 && pending() === 0)
  expect(verbs).toEqual(["tombstone"])
})

test("acknowledging a deletion never removes a newer deletion recorded meanwhile", async () => {
  configure()
  const { storage, pending } = memoryStorage()
  // The first deletion's acknowledgement stops before it removes anything.
  let reachedRemove!: () => void
  const removing = new Promise<void>((resolve) => (reachedRemove = resolve))
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  let held = false
  const blocking: Storage = {
    ...storage,
    remove: async (key) => {
      if (!held && key.startsWith("deleted/")) {
        held = true
        reachedRemove()
        await released
      }
      return storage.remove(key)
    },
  }
  const uploader = start(blocking)
  source.remove("ses_a")
  uploader.delete("ses_a", { revision: 3, timeDeleted: 200 })
  await removing

  uploader.delete("ses_a", { revision: 5, timeDeleted: 400 })
  await Bun.sleep(20)
  release()

  await until(() => archive.manifest().tombstones[0]?.timeDeleted === 400 && pending() === 0)
  expect(verbs).toEqual(["tombstone", "tombstone"])
})

test("a re-import after the deletion is uploaded and clears the tombstone", async () => {
  configure()
  const uploader = start()
  uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)
  source.remove("ses_a")
  uploader.delete("ses_a", { revision: 3, timeDeleted: 200 })
  await until(() => archive.manifest().tombstones.length === 1)

  // Importing sets `time_updated` to the import time and restarts the counter.
  source.addSession("ses_a", { time: 300 })
  source.addMessage("ses_a", "user", { text: "first" }, 101)
  uploader.enqueue("ses_a")
  await until(() => archive.status().sessions === 1)
  expect(archive.manifest().tombstones).toEqual([])
  expect(archivedTexts()).toEqual(["first"])
})

test("a session changed while the plugin was not running is uploaded on the next startup", async () => {
  configure()
  const { storage } = memoryStorage()
  const first = start(storage)
  first.enqueue("ses_a")
  await until(() => outcomes.length === 1)
  first.stop()

  source.addMessage("ses_a", "user", { text: "while down" }, 102)
  source.addSession("ses_b", { time: 150 })
  await start(storage).reconcile()
  await until(() => outcomes.length === 3)
  expect(archivedTexts()).toEqual(["first", "while down"])
  expect(archive.status()).toMatchObject({ sessions: 2 })
})

test("a dropped event is caught by the periodic sweep without asking the hub", async () => {
  configure()
  const uploader = start(memoryStorage().storage, { sweepIntervalMs: 20 })
  await uploader.reconcile()
  await until(() => outcomes.length === 1)

  // No enqueue: the change event was lost.
  source.addMessage("ses_a", "user", { text: "lost event" }, 102)
  await until(() => outcomes.length === 2)
  expect(archivedTexts()).toEqual(["first", "lost event"])
  await Bun.sleep(60)
  expect(verbs.filter((v) => v === "manifest")).toHaveLength(1)
  expect(outcomes).toHaveLength(2)
})

test("a rebuilt host with a new token uploads nothing for sessions the hub holds with matching hashes", async () => {
  configure()
  source.addSession("ses_b", { time: 150 })
  const original = start()
  original.enqueue("ses_a")
  original.enqueue("ses_b")
  await until(() => outcomes.length === 2)
  original.stop()

  // Fresh plugin storage and token; the counter was re-derived higher without changing content.
  writeConfig({ url: hub.url.href, token: archive.issueToken("laptop-rebuilt") })
  source.db.run("UPDATE event_sequence SET seq = seq + 5 WHERE aggregate_id = 'ses_b'")
  const rebuilt = start(memoryStorage().storage, { sweepIntervalMs: 10 })
  await rebuilt.reconcile()
  await Bun.sleep(60)
  expect(outcomes).toHaveLength(2)
})

test("a session tombstoned on the hub but still present locally is not re-uploaded on every sweep", async () => {
  configure()
  await clientFor("desktop").tombstone({ sessionId: "ses_a", revision: 9, timeDeleted: 200 })
  const uploader = start(memoryStorage().storage, { sweepIntervalMs: 10 })
  await uploader.reconcile()
  await uploader.reconcile()
  await Bun.sleep(60)
  expect(outcomes).toEqual([])
  expect(archive.manifest().tombstones).toHaveLength(1)
})

test("a session archived by an older extractor is re-uploaded at the same position and accepted", async () => {
  configure()
  const current = readSnapshot(source.db, "ses_a")!
  // What the previous extractor produced for this unchanged session: other content, same position.
  await clientFor("laptop").snapshot({ ...current, contentHash: "older", extractorVersion: EXTRACTOR_VERSION - 1 })

  await start().reconcile()
  await until(() => outcomes.length === 2)
  expect(outcomes).toEqual(["archived", "archived"])
  expect(archive.manifest().sessions).toEqual([
    {
      sessionId: "ses_a",
      revision: current.revision,
      lastActivity: current.lastActivity,
      contentHash: current.contentHash,
      extractorVersion: EXTRACTOR_VERSION,
    },
  ])
})

test("summarizer worker sessions are never uploaded", async () => {
  configure()
  source.addSession("ses_w", { title: "recall-summarizer worker: anthropic/claude", time: 150 })
  source.addMessage("ses_w", "user", { text: "summarize" }, 151)
  const uploader = start(memoryStorage().storage, { sweepIntervalMs: 10 })
  uploader.enqueue("ses_w")
  await uploader.reconcile()
  await until(() => outcomes.length === 1)
  await Bun.sleep(60)
  expect(archive.manifest().sessions.map((s) => s.sessionId)).toEqual(["ses_a"])
  expect(outcomes).toHaveLength(1)
})

test("sessions the hub holds that this host no longer reports stay in the archive", async () => {
  configure()
  source.addSession("ses_b", { time: 150 })
  const uploader = start(memoryStorage().storage, { sweepIntervalMs: 10 })
  uploader.enqueue("ses_a")
  uploader.enqueue("ses_b")
  await until(() => outcomes.length === 2)

  // Removed without an observed deletion, even with an upload still queued for it.
  source.addMessage("ses_b", "user", { text: "queued" }, 160)
  uploader.enqueue("ses_b")
  source.remove("ses_b")
  await uploader.reconcile()
  await Bun.sleep(60)
  expect(archive.status()).toMatchObject({ sessions: 2 })
  expect(archive.manifest().tombstones).toEqual([])
  expect(verbs).not.toContain("tombstone")
})
