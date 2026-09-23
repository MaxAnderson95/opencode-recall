import { afterEach, beforeEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PROTOCOL_VERSION, makeClient, type ErrorBody, type ErrorCode } from "@opencode-recall/protocol"
import { ConfigProvider, Effect, Layer, Logger, ManagedRuntime, Option } from "effect"
import { Archive } from "../../hub/src/archive/index.ts"
import type { Embedder } from "../../hub/src/embedder.ts"
import { fakeLayer } from "../../hub/src/fake-embedder.ts"
import { Log } from "../../hub/src/log.ts"
import { DEFAULT_LIMITS, makeHandler, type Limits } from "../../hub/src/server.ts"
import { PluginConfig } from "./config.ts"
import { sourceDb, type SourceDb } from "./fixture.ts"
import { EXTRACTOR_VERSION, Source, readPosition, readSnapshot } from "./source.ts"
import { Storage } from "./storage.ts"
import { Uploader } from "./uploader.ts"

type Json = Parameters<Storage.Domain["set"]>[1]

/** `ctx.storage` as OpenCode implements it: prefix scan over keys with the namespace stripped. */
function memoryStorage() {
  const entries = new Map<string, Json>()
  const storage: Storage.Domain = {
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

const sync = Effect.runSync
/** The typed failure of `effect`, which must fail. */
const failure = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect))

let dir: string
let configFile: string
let hubRuntime: ManagedRuntime.ManagedRuntime<Archive.Service | Embedder.Service, Archive.NewerSchema>
let archive: Archive.Interface
let hub: ReturnType<typeof Bun.serve>
let source: SourceDb
let intercept: Intercept
/** The outcome or error code of every snapshot request that reached the hub. */
let outcomes: string[]
/** The verb of every request that reached the hub. */
let verbs: string[]
const uploaders: { stop: () => Promise<void> }[] = []

async function startHub(limits: Limits = DEFAULT_LIMITS) {
  const handler = await hubRuntime.runPromise(makeHandler({ limits }))
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

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "recall-uploader-"))
  configFile = join(dir, "recall.json")
  hubRuntime = ManagedRuntime.make(
    Archive.layer(join(dir, "archive.db")).pipe(Layer.provideMerge(fakeLayer()), Layer.provideMerge(Log.layer("error", () => {}))),
  )
  archive = await hubRuntime.runPromise(Archive.Service)
  intercept = (req, forward) => forward(req)
  laptopToken = undefined
  outcomes = []
  verbs = []
  await startHub()
  source = sourceDb()
  source.addSession("ses_a")
  source.addMessage("ses_a", "user", { text: "first" }, 101)
})

afterEach(async () => {
  for (const u of uploaders.splice(0)) await u.stop()
  await hub.stop(true)
  await hubRuntime.dispose()
  source.close()
  rmSync(dir, { recursive: true, force: true })
})

const writeConfig = (hubConfig: { url?: string; token?: string }, excludeDirectories: unknown = []) =>
  writeFileSync(configFile, JSON.stringify({ index: { excludeDirectories }, hub: hubConfig }))

/** Point the config at the hub as "laptop", excluding `excludeDirectories`; later calls keep the same token. */
let laptopToken: string | undefined
const configure = (excludeDirectories: unknown = []) =>
  writeConfig({ url: hub.url.href, token: (laptopToken ??= sync(archive.issueToken("laptop"))) }, excludeDirectories)

/** The config file alone decides the hub, whatever this process's environment holds. */
const noEnvironment = ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))

/** An uploader instance, as one OpenCode process runs it; `stop` releases it as plugin shutdown does. */
async function start(
  storage: Storage.Domain = memoryStorage().storage,
  timing: Uploader.Timing = {},
  db: SourceDb = source,
) {
  const runtime = ManagedRuntime.make(
    Uploader.layer({ quietMs: 5, retryMs: 10, probeIntervalMs: 5, uploadIntervalMs: 0, ...timing }).pipe(
      Layer.provide(Layer.mergeAll(Source.fromDatabase(db.db), Storage.fromDomain(storage), PluginConfig.layer(configFile))),
      Layer.provideMerge(Layer.mergeAll(Logger.layer([]), noEnvironment)),
    ),
  )
  const run = <A>(f: (uploader: Uploader.Interface) => Effect.Effect<A>) =>
    runtime.runPromise(Effect.flatMap(Uploader.Service, f))
  const uploader = {
    enqueue: (sessionId: string) => run((u) => u.enqueue(sessionId)),
    delete: (sessionId: string, deletion: Uploader.Deletion) => run((u) => u.delete(sessionId, deletion)),
    reconcile: () => run((u) => u.reconcile),
    pausedBy: () => run((u) => u.state.pipe(Effect.map((s) => Option.getOrNull(s.pausedBy)), Effect.orDie)),
    state: () => run((u) => Effect.orDie(u.state)),
    stop: () => runtime.dispose(),
  }
  uploaders.push(uploader)
  // Built at once, as the plugin is at setup, so work left by an earlier run resumes.
  await runtime.runPromise(Effect.void)
  return uploader
}

async function until(condition: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 400 && !(await condition()); i++) await Bun.sleep(5)
  expect(await condition()).toBe(true)
}

function archivedTexts(): string[] {
  const db = new Database(join(dir, "archive.db"), { readonly: true })
  const rows = db
    .query("SELECT parts.text FROM parts JOIN messages ON messages.id = message_id ORDER BY messages.ordinal")
    .all() as { text: string }[]
  db.close()
  return rows.map((row) => row.text)
}

const status = () => sync(archive.status())

const loadHubConfig = (env: Record<string, string>, path: string) =>
  Effect.runPromise(
    PluginConfig.load(path).pipe(
      Effect.map(Option.getOrNull),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
  )
const manifest = () => sync(archive.manifest(0))

test("updating a session uploads a newer revision that replaces the archived copy", async () => {
  configure()
  const { storage, entries, pending } = memoryStorage()
  const uploader = await start(storage)
  await uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)

  source.addMessage("ses_a", "user", { text: "second" }, 102)
  await uploader.enqueue("ses_a")
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
  await (await start(storage)).enqueue("ses_a")

  await until(() => outcomes.length === 2)
  expect(outcomes).toEqual(["archived", "unchanged"])
  await until(() => pending() === 0)
  expect(status()).toMatchObject({ sessions: 1 })
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
  const uploader = await start(storage)
  await uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)

  source.addMessage("ses_a", "user", { text: "mid-flight" }, 102)
  await uploader.enqueue("ses_a")
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
  const instances = [await start(storage), await start(storage)]
  for (const text of ["two", "three", "four"]) {
    source.addMessage("ses_a", "user", { text }, 100 + text.length)
    for (const instance of instances) await instance.enqueue("ses_a")
    await Bun.sleep(15)
  }

  await until(() => pending() === 0)
  await Bun.sleep(30)
  expect(archivedTexts()).toEqual(["first", "two", "three", "four"])
  expect(outcomes.every((o) => o === "archived" || o === "unchanged")).toBe(true)
  expect(status()).toMatchObject({ sessions: 1 })
})

test("an old acknowledgement never removes another instance's newer work", async () => {
  configure()
  const { storage, entries, pending } = memoryStorage()
  // Instance A's acknowledgement stops after it has read the work list and before it removes anything.
  let reachedRemove!: () => void
  const removing = new Promise<void>((resolve) => (reachedRemove = resolve))
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  const held: Storage.Domain = {
    ...storage,
    remove: async (key) => {
      reachedRemove()
      await released
      return storage.remove(key)
    },
  }
  // B is already running with an empty work list; it only sees the second change.
  const b = await start(storage, { quietMs: 100 })
  const a = await start(held)
  await a.enqueue("ses_a")
  await removing

  // A shuts down with its acknowledgement in flight while B records a newer change.
  await a.stop()
  source.addMessage("ses_a", "user", { text: "second" }, 102)
  await b.enqueue("ses_a")
  await until(() => [...entries.values()].some((entry) => (entry as { revision: number }).revision === 3))
  release()

  await until(() => outcomes.length === 2)
  expect(archivedTexts()).toEqual(["first", "second"])
  await until(() => pending() === 0)
})

test("a burst of child-turn events produces one upload after the quiet period", async () => {
  configure()
  const uploader = await start(memoryStorage().storage, { quietMs: 50 })
  for (let turn = 0; turn < 20; turn++) {
    source.addMessage("ses_a", "assistant", { content: [{ type: "text", text: `child ${turn}` }] }, 200 + turn)
    await uploader.enqueue("ses_a")
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
  await start(storage)
  await until(() => outcomes.length === 1 && pending() === 0)
  expect(archivedTexts()).toEqual(["first"])
})

test("an oversize snapshot is rejected as payload_too_large and not retried", async () => {
  await hub.stop(true)
  await startHub({ ...DEFAULT_LIMITS, decompressedBytes: 2_000 })
  configure()
  source.addMessage("ses_a", "user", { text: "x".repeat(5_000) }, 102)
  const { storage, entries, pending } = memoryStorage()
  await (await start(storage)).enqueue("ses_a")

  await until(() => pending() === 0)
  await Bun.sleep(50)
  expect(outcomes).toEqual(["payload_too_large"])
  expect(status()).toMatchObject({ sessions: 0 })
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
  await (await start(storage)).enqueue("ses_a")

  await until(() => pending() === 0)
  await Bun.sleep(50)
  expect(requests).toBe(expected === "retried" ? 2 : 1)
  expect(status()).toMatchObject({ sessions: expected === "retried" ? 1 : 0 })
})

test("invalid_token pauses the queue without losing work, and a fixed config file resumes it", async () => {
  writeConfig({ url: hub.url.href, token: "opencode-recall_revoked" })
  source.addSession("ses_b")
  const { storage, entries, pending } = memoryStorage()
  const uploader = await start(storage)

  await uploader.enqueue("ses_a")
  await until(async () => (await uploader.pausedBy()) !== null)
  expect(await uploader.pausedBy()).toStartWith("invalid_token")
  await uploader.enqueue("ses_b")
  await Bun.sleep(30)
  expect(status()).toMatchObject({ sessions: 0 })
  expect([...entries.keys()].map((key) => key.split("/")[1]).sort()).toEqual(["ses_a", "ses_b"])
  expect(await uploader.state()).toMatchObject({ queued: 2, local: 2, answered: 0 })
  expect(Option.getOrThrow((await uploader.state()).lastError).message).toStartWith("uploads paused until configuration is fixed: invalid_token")

  configure()
  await until(() => status().sessions === 2)
  expect(await uploader.pausedBy()).toBeNull()
  await until(async () => (await uploader.state()).answered === 2)
  expect(await uploader.state()).toMatchObject({ queued: 0, local: 2 })
})

test("a missing token pauses the queue until the config provides one", async () => {
  writeConfig({ url: hub.url.href })
  const uploader = await start()

  await uploader.enqueue("ses_a")
  await until(async () => (await uploader.pausedBy()) !== null)
  expect(outcomes).toEqual([])

  configure()
  await until(() => status().sessions === 1)
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
  const uploader = await start()

  await uploader.enqueue("ses_a")
  await until(async () => (await uploader.pausedBy()) !== null)
  expect(await uploader.pausedBy()).toStartWith("protocol_version")

  hubVersion = PROTOCOL_VERSION
  await until(async () => (await uploader.pausedBy()) === null && status().sessions === 1)
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

const clientFor = (name: string) => makeClient({ url: hub.url.href, token: sync(archive.issueToken(name)) })

test("deleting a session tombstones it, and a later upload from before the deletion is rejected", async () => {
  configure()
  const { storage, entries, pending } = memoryStorage()
  const uploader = await start(storage)
  await uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)
  const stale = readSnapshot(source.db, "ses_a")!

  source.remove("ses_a")
  await uploader.delete("ses_a", { revision: 3, timeDeleted: 200 })
  await until(() => status().sessions === 0 && pending() === 0)
  expect(manifest().tombstones).toEqual([{ sessionId: "ses_a", timeDeleted: 200, excludedByCaller: false }])

  const error = await failure(clientFor("desktop").snapshot(stale))
  expect(error).toMatchObject({ code: "tombstoned", status: 409 })
  expect(status()).toMatchObject({ sessions: 0 })
})

test("a session deleted before its queued upload sends a tombstone instead of the upload", async () => {
  configure()
  const { storage, entries, pending } = memoryStorage()
  const uploader = await start(storage)
  await uploader.enqueue("ses_a")
  source.remove("ses_a")
  await uploader.delete("ses_a", { revision: 3, timeDeleted: 200 })

  await until(() => manifest().tombstones.length === 1 && pending() === 0)
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
  const blocking: Storage.Domain = {
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
  const uploader = await start(blocking)
  source.remove("ses_a")
  await uploader.delete("ses_a", { revision: 3, timeDeleted: 200 })
  await removing

  await uploader.delete("ses_a", { revision: 5, timeDeleted: 400 })
  await Bun.sleep(20)
  release()

  await until(() => manifest().tombstones[0]?.timeDeleted === 400 && pending() === 0)
  expect(verbs).toEqual(["tombstone", "tombstone"])
})

test("a re-import after the deletion is uploaded and clears the tombstone", async () => {
  configure()
  const uploader = await start()
  await uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)
  source.remove("ses_a")
  await uploader.delete("ses_a", { revision: 3, timeDeleted: 200 })
  await until(() => manifest().tombstones.length === 1)

  // Importing sets `time_updated` to the import time and restarts the counter.
  source.addSession("ses_a", { time: 300 })
  source.addMessage("ses_a", "user", { text: "first" }, 101)
  await uploader.enqueue("ses_a")
  await until(() => status().sessions === 1)
  expect(manifest().tombstones).toEqual([])
  expect(archivedTexts()).toEqual(["first"])
})

test("a session changed while the plugin was not running is uploaded on the next startup", async () => {
  configure()
  const { storage } = memoryStorage()
  const first = await start(storage)
  await first.enqueue("ses_a")
  await until(() => outcomes.length === 1)
  await first.stop()

  source.addMessage("ses_a", "user", { text: "while down" }, 102)
  source.addSession("ses_b", { time: 150 })
  await (await start(storage)).reconcile()
  await until(() => outcomes.length === 3)
  expect(archivedTexts()).toEqual(["first", "while down"])
  expect(status()).toMatchObject({ sessions: 2 })
})

test("a dropped event is caught by the periodic sweep without asking the hub", async () => {
  configure()
  const uploader = await start(memoryStorage().storage, { sweepIntervalMs: 20 })
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
  const original = await start()
  await original.enqueue("ses_a")
  await original.enqueue("ses_b")
  await until(() => outcomes.length === 2)
  await original.stop()

  // Fresh plugin storage and token; the counter was re-derived higher without changing content.
  writeConfig({ url: hub.url.href, token: sync(archive.issueToken("laptop-rebuilt")) })
  source.db.run("UPDATE event_sequence SET seq = seq + 5 WHERE aggregate_id = 'ses_b'")
  const rebuilt = await start(memoryStorage().storage, { sweepIntervalMs: 10 })
  expect(Option.isNone((await rebuilt.state()).lastReconciled)).toBe(true)
  await rebuilt.reconcile()
  await Bun.sleep(60)
  expect(outcomes).toHaveLength(2)
  // Backfill needs nothing: the manifest already answers every local session.
  expect(await rebuilt.state()).toMatchObject({ queued: 0, local: 2, answered: 2, reconciling: false })
  expect(Option.isSome((await rebuilt.state()).lastReconciled)).toBe(true)
})

/** The session id of a snapshot request, read from its gzip-encoded body. */
const uploadedSession = async (req: Request) =>
  (JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await req.clone().arrayBuffer())))) as { session: { id: string } })
    .session.id

/** Local sessions with last activity 300, 250, ... below `ses_a`'s 101, one per id. */
function addHistory(ids: string[]) {
  ids.forEach((id, i) => {
    source.addSession(id, { time: 300 - i * 50 })
    source.addMessage(id, "user", { text: id }, 300 - i * 50)
  })
}

test("a backfill into an empty hub uploads every eligible session, newest first", async () => {
  configure(["/work/private"])
  source.addSession("ses_old", { time: 50 })
  addHistory(["ses_b", "ses_c"])
  source.addSession("ses_private", { time: 400, directory: "/work/private" })
  const order: string[] = []
  intercept = async (req, forward) => {
    if (new URL(req.url).pathname === "/v1/snapshot") order.push(await uploadedSession(req))
    return forward(req)
  }
  const uploader = await start()
  await uploader.reconcile()
  await until(() => outcomes.length === 4)
  expect(order).toEqual(["ses_b", "ses_c", "ses_a", "ses_old"])
  expect(outcomes.every((o) => o === "archived")).toBe(true)
  await until(async () => (await uploader.state()).queued === 0)
  // The excluded session is not eligible, so the backfill is complete without it.
  expect(await uploader.state()).toMatchObject({ local: 4, answered: 4 })
})

test("uploads are spaced by the upload interval", async () => {
  configure()
  addHistory(["ses_b", "ses_c", "ses_d"])
  const started: number[] = []
  intercept = async (req, forward) => {
    if (new URL(req.url).pathname === "/v1/snapshot") started.push(performance.now())
    return forward(req)
  }
  await (await start(memoryStorage().storage, { uploadIntervalMs: 40 })).reconcile()
  await until(() => outcomes.length === 4)
  const gaps = started.slice(1).map((t, i) => t - (started[i] ?? t))
  // Timers may fire a millisecond early.
  expect(gaps.every((gap) => gap >= 39)).toBe(true)
})

test("a session excluded while its upload waits out the upload interval is not sent", async () => {
  configure()
  source.addSession("ses_private", { time: 50, directory: "/work/private" })
  source.addMessage("ses_private", "user", { text: "private" }, 50)
  intercept = async (req, forward) => {
    // The exclusion is saved partway through the interval that follows the first upload.
    if (new URL(req.url).pathname === "/v1/snapshot") setTimeout(() => configure(["/work/private"]), 30)
    return forward(req)
  }
  const { storage, pending } = memoryStorage()
  await (await start(storage, { uploadIntervalMs: 100 })).reconcile()
  await until(() => outcomes.length > 0 && pending() === 0)
  await Bun.sleep(150)
  expect(outcomes).toEqual(["archived"])
  // The hub never held it, so there is nothing to tombstone.
  expect(verbs).not.toContain("tombstone")
})

test("an interrupted backfill resumes without re-uploading the sessions it completed", async () => {
  configure()
  addHistory(["ses_b", "ses_c", "ses_d", "ses_e"])
  const { storage, pending } = memoryStorage()
  const first = await start(storage, { uploadIntervalMs: 50 })
  await first.reconcile()
  // Stopped between two uploads, after two have been acknowledged.
  await until(() => pending() === 3)
  await first.stop()
  expect(outcomes).toHaveLength(2)

  const second = await start(storage)
  await second.reconcile()
  await until(() => status().sessions === 5 && pending() === 0)
  await Bun.sleep(30)
  expect(outcomes).toEqual(Array(5).fill("archived"))
  expect(await second.state()).toMatchObject({ local: 5, answered: 5 })
})

test("a session tombstoned on the hub but still present locally is not re-uploaded on every sweep", async () => {
  configure()
  await Effect.runPromise(clientFor("desktop").tombstone({ sessionId: "ses_a", revision: 9, timeDeleted: 200, reason: "deleted" }))
  const uploader = await start(memoryStorage().storage, { sweepIntervalMs: 10 })
  await uploader.reconcile()
  await uploader.reconcile()
  await Bun.sleep(60)
  expect(outcomes).toEqual([])
  expect(manifest().tombstones).toHaveLength(1)
})

test("a session archived by an older extractor is re-uploaded at the same position and accepted", async () => {
  configure()
  const current = readSnapshot(source.db, "ses_a")!
  // What the previous extractor produced for this unchanged session: other content, same position.
  await Effect.runPromise(clientFor("laptop").snapshot({ ...current, contentHash: "older", extractorVersion: EXTRACTOR_VERSION - 1 }))

  await (await start()).reconcile()
  await until(() => outcomes.length === 2)
  expect(outcomes).toEqual(["archived", "archived"])
  expect(manifest().sessions).toEqual([
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
  const uploader = await start(memoryStorage().storage, { sweepIntervalMs: 10 })
  await uploader.enqueue("ses_w")
  await uploader.reconcile()
  await until(() => outcomes.length === 1)
  await Bun.sleep(60)
  expect(manifest().sessions.map((s) => s.sessionId)).toEqual(["ses_a"])
  expect(outcomes).toHaveLength(1)
})

test("sessions the hub holds that this host no longer reports stay in the archive", async () => {
  configure()
  source.addSession("ses_b", { time: 150 })
  const uploader = await start(memoryStorage().storage, { sweepIntervalMs: 10 })
  await uploader.enqueue("ses_a")
  await uploader.enqueue("ses_b")
  await until(() => outcomes.length === 2)

  // Removed without an observed deletion, even with an upload still queued for it.
  source.addMessage("ses_b", "user", { text: "queued" }, 160)
  await uploader.enqueue("ses_b")
  source.remove("ses_b")
  await uploader.reconcile()
  await Bun.sleep(60)
  expect(status()).toMatchObject({ sessions: 2 })
  expect(manifest().tombstones).toEqual([])
  expect(verbs).not.toContain("tombstone")
})

test("adding a directory to excludeDirectories while running tombstones its sessions and their summaries", async () => {
  configure()
  source.addSession("ses_b", { time: 150, directory: "/work/other" })
  const { storage, pending } = memoryStorage()
  const uploader = await start(storage, { configPollMs: 10 })
  await uploader.enqueue("ses_a")
  await uploader.enqueue("ses_b")
  await until(() => outcomes.length === 2)
  const key = { provider: "p", model: "m", focus: "", recipe: 1 }
  const contentHash = readSnapshot(source.db, "ses_a")!.contentHash
  sync(archive.putSummary({ ...key, sessionId: "ses_a", contentHash, summary: "s", omitted: 0, clipped: 0 }))

  configure(["/work/demo"])
  await until(() => status().sessions === 1 && pending() === 0)
  expect(status().summaries).toBe(0)
  expect(manifest().sessions.map((s) => s.sessionId)).toEqual(["ses_b"])
  expect(manifest().tombstones.map((t) => t.sessionId)).toEqual(["ses_a"])

  // Later turns in the excluded session stay on this host.
  source.addMessage("ses_a", "user", { text: "private" }, 400)
  await uploader.enqueue("ses_a")
  await until(() => pending() === 0)
  await Bun.sleep(50)
  expect(outcomes).toHaveLength(2)
  expect(verbs.filter((v) => v === "tombstone")).toHaveLength(1)
})

test("removing a directory from excludeDirectories uploads its sessions again", async () => {
  configure(["/work/demo"])
  await Effect.runPromise(clientFor("desktop").snapshot(readSnapshot(source.db, "ses_a")!))
  const uploader = await start(memoryStorage().storage, { configPollMs: 10 })
  await uploader.reconcile()
  await until(() => status().sessions === 0 && manifest().tombstones.length === 1)

  configure([])
  await until(() => status().sessions === 1)
  expect(manifest().tombstones).toEqual([])
  expect(archivedTexts()).toEqual(["first"])
})

test("moving a session into an excluded directory tombstones it", async () => {
  configure(["/work/private"])
  const uploader = await start()
  await uploader.enqueue("ses_a")
  await until(() => outcomes.length === 1)

  source.move("ses_a", "/work/private/app", 300)
  await uploader.enqueue("ses_a")
  await until(() => status().sessions === 0 && manifest().tombstones.length === 1)
  expect(outcomes).toHaveLength(1)
})

test("a queued upload of a session excluded before it is sent is dropped", async () => {
  configure()
  const { storage, pending } = memoryStorage()
  const uploader = await start(storage, { quietMs: 100 })
  await uploader.enqueue("ses_a")
  configure(["/work"])

  await until(() => pending() === 0)
  await Bun.sleep(50)
  expect(verbs).not.toContain("snapshot")
  // The hub never held it, so there is nothing to tombstone.
  expect(verbs).not.toContain("tombstone")
})

test("an upload that races a new exclusion is tombstoned once it lands", async () => {
  configure()
  intercept = async (req, forward) => {
    // The exclusion is saved while this upload is in flight.
    if (new URL(req.url).pathname === "/v1/snapshot") configure(["/work/demo"])
    return forward(req)
  }
  await (await start()).enqueue("ses_a")
  await until(() => outcomes.length === 1 && status().sessions === 0 && manifest().tombstones.length === 1)
})

test("two plugin instances on one host enforce the same exclusion list", async () => {
  configure()
  const { storage, pending } = memoryStorage()
  const instances = [await start(storage, { configPollMs: 10 }), await start(storage, { configPollMs: 10 })]
  for (const instance of instances) await instance.enqueue("ses_a")
  await until(() => status().sessions === 1 && pending() === 0)

  configure(["/work/demo"])
  await until(() => status().sessions === 0 && pending() === 0)
  const uploads = outcomes.length
  source.addMessage("ses_a", "user", { text: "private" }, 400)
  for (const instance of instances) await instance.enqueue("ses_a")
  await until(() => pending() === 0)
  await Bun.sleep(50)
  expect(outcomes).toHaveLength(uploads)
  expect(status().sessions).toBe(0)
})

test("excluded sessions are not re-uploaded by reconciliation or the sweep", async () => {
  configure(["/work/demo"])
  // Another host archived it before this host excluded it.
  await Effect.runPromise(clientFor("desktop").snapshot(readSnapshot(source.db, "ses_a")!))
  const uploader = await start(memoryStorage().storage, { sweepIntervalMs: 10 })
  await uploader.reconcile()
  await until(() => status().sessions === 0)
  await uploader.reconcile()
  await uploader.reconcile()
  await Bun.sleep(60)
  expect(outcomes).toEqual(["archived"])
  expect(verbs.filter((v) => v === "tombstone")).toHaveLength(1)
})

test("an exclusion list that cannot be applied holds every upload until it is fixed", async () => {
  configure(["work/relative"])
  const uploader = await start()
  await uploader.enqueue("ses_a")
  await until(async () => (await uploader.pausedBy()) !== null)
  expect(await uploader.pausedBy()).toContain("index.excludeDirectories")
  expect(outcomes).toEqual([])

  configure([])
  await until(() => status().sessions === 1)
})

test("excludeDirectories resolves ~ and matches a directory and its descendants, not a sibling prefix", async () => {
  writeFileSync(configFile, JSON.stringify({ index: { excludeDirectories: ["~/Projects/private/", "/srv/secret", "~"] } }))
  const roots = await Effect.runPromise(PluginConfig.loadExcludeDirectories(configFile, "/Users/test"))
  expect(roots).toEqual(["/Users/test/Projects/private", "/srv/secret", "/Users/test"])
  const [privateRoot] = roots
  expect(PluginConfig.isExcluded([privateRoot!], "/Users/test/Projects/private")).toBe(true)
  expect(PluginConfig.isExcluded([privateRoot!], "/Users/test/Projects/private/subdir")).toBe(true)
  expect(PluginConfig.isExcluded([privateRoot!], "/Users/test/Projects/private-old")).toBe(false)

  expect(await Effect.runPromise(PluginConfig.loadExcludeDirectories(join(dir, "absent.json")))).toEqual([])
  for (const bad of [["Projects/private"], [""], "~/private", [7]]) {
    writeFileSync(configFile, JSON.stringify({ index: { excludeDirectories: bad } }))
    expect(await failure(PluginConfig.loadExcludeDirectories(configFile, "/Users/test"))).toBeInstanceOf(PluginConfig.Invalid)
  }
})

test("a session moved into an excluded directory without its event is tombstoned by the sweep", async () => {
  configure(["/work/private"])
  const uploader = await start(memoryStorage().storage, { sweepIntervalMs: 10 })
  await uploader.reconcile()
  await until(() => status().sessions === 1)

  // No enqueue: the `session.moved` event was lost.
  source.move("ses_a", "/work/private/app", 300)
  await until(() => status().sessions === 0 && manifest().tombstones.length === 1)
  await Bun.sleep(60)
  expect(verbs.filter((v) => v === "tombstone")).toHaveLength(1)
  expect(outcomes).toEqual(["archived"])
})

test("a work-list entry that no longer decodes is dropped instead of retried forever", async () => {
  configure()
  const { storage, entries } = memoryStorage()
  // The shape an earlier build wrote, without a reason.
  await storage.set("deleted/ses_a/200", { revision: 3, timeDeleted: 200 })
  await storage.set("dirty/ses_b/1-1", { revision: "one" })
  const uploader = await start(storage)
  await until(() => entries.size === 0)
  await Bun.sleep(50)
  expect(verbs).toEqual([])
  expect(Option.getOrThrow((await uploader.state()).lastError).message).toStartWith("dropped unreadable work-list entry")
})
