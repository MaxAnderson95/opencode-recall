import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "./index.ts"
import { sourceDb, startHub, type SourceDb } from "./fixture.ts"
import type { Storage } from "./storage.ts"

type Context = Parameters<typeof plugin.setup>[0]
type Json = Parameters<Storage.Domain["set"]>[1]

let dir: string
let source: SourceDb
const saved = { ...process.env }

// Effect's default ConfigProvider snapshots the environment when first read, so every test in
// this file shares the one setting. The hub is configured through the config file instead, which
// the plugin reads again whenever it changes.
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "recall-plugin-setup-"))
  source = sourceDb(join(dir, "opencode.db"))
  process.env.OPENCODE_RECALL_SOURCE_DB = join(dir, "opencode.db")
  process.env.XDG_CONFIG_HOME = dir
  delete process.env.OPENCODE_RECALL_HUB_URL
  delete process.env.OPENCODE_RECALL_TOKEN
})

afterAll(() => {
  source.close()
  process.env = { ...saved }
  rmSync(dir, { recursive: true, force: true })
})

const configFile = () => join(dir, "opencode", "recall.json")
afterEach(() => rmSync(configFile(), { force: true }))

type Hooked = { system: { type: "text"; text: string }[] }

/** OpenCode's event bus as plugin instances see it: every subscription receives every event. */
function bus() {
  const readers = new Set<(event: object) => void>()
  return { readers, emit: (event: object) => readers.forEach((read) => read(event)) }
}

/** Every instance in one process addresses the same `ctx.storage` namespace. */
const namespace = () => new Map<string, Json>()

/**
 * A host whose event stream records whether the plugin subscribed and later let go of it, and
 * which keeps the plugin's session hooks, its registered tool names, and the storage calls made
 * through this instance.
 */
function host({
  transform = async () => {},
  events: shared = bus(),
  entries = namespace(),
}: {
  transform?: (edit: (editor: { add: (tool: { name: string }) => void }) => void) => Promise<unknown>
  events?: ReturnType<typeof bus>
  entries?: Map<string, Json>
} = {}) {
  const events = {
    subscribed: false,
    released: false,
    get active() {
      return this.subscribed && !this.released
    },
  }
  const hooks = new Map<string, (event: Hooked) => void>()
  const storageCalls: string[] = []
  const storage: Storage.Domain = {
    get: async (key) => (storageCalls.push(`get ${key}`), entries.get(key)),
    set: async (key, value) => void (storageCalls.push(`set ${key}`), entries.set(key, value)),
    remove: async (key) => void (storageCalls.push(`remove ${key}`), entries.delete(key)),
    scan: async ({ prefix }) => (
      storageCalls.push(`scan ${prefix}`),
      { entries: [...entries].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })) }
    ),
  }
  const ctx = {
    session: {
      hook: async (name: string, callback: (event: Hooked) => void) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
    },
    storage,
    tool: { transform },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => {
        events.subscribed = true
        const queue: object[] = []
        let wake = () => {}
        const read = (event: object) => {
          queue.push(event)
          wake()
        }
        const release = () => {
          events.released = true
          shared.readers.delete(read)
          wake()
        }
        shared.readers.add(read)
        signal.addEventListener("abort", release)
        return {
          [Symbol.asyncIterator]: () => ({
            next: async (): Promise<IteratorResult<object>> => {
              while (queue.length === 0 && !events.released) await new Promise<void>((resolve) => (wake = resolve))
              const event = queue.shift()
              return event === undefined || events.released ? { done: true, value: undefined } : { done: false, value: event }
            },
            return: async () => {
              release()
              return { done: true as const, value: undefined }
            },
          }),
        }
      },
    },
  } as unknown as Context
  return { ctx, events, hooks, storageCalls, entries }
}

/**
 * A hub on a free port behind a proxy that records the path of every request, and the session,
 * revision, and outcome of every snapshot, configured in the plugin's config file.
 */
async function configuredHub() {
  const dataDir = mkdtempSync(join(dir, "hub-"))
  const hub = await startHub(dataDir)
  const paths: string[] = []
  const snapshots: string[] = []
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname
      paths.push(path)
      const body = new Uint8Array(await req.arrayBuffer())
      const res = await fetch(new URL(path, hub.url), { method: req.method, headers: req.headers, body })
      if (path === "/v1/snapshot") {
        const sent = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(body))) as { session: { id: string }; revision: number }
        const { outcome } = (await res.clone().json()) as { outcome?: string }
        snapshots.push(`${sent.session.id}@${sent.revision} ${outcome ?? "rejected"}`)
      }
      return res
    },
  })
  mkdirSync(join(dir, "opencode"), { recursive: true })
  writeFileSync(configFile(), JSON.stringify({ hub: { url: proxy.url.href, token: hub.issueToken("mac") } }))
  return {
    paths,
    snapshots,
    stop: async () => {
      await proxy.stop(true)
      await hub.stop()
    },
  }
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not reached")
    await Bun.sleep(20)
  }
}

const queued = (entries: Map<string, Json>) => [...entries.keys()].filter((key) => key.startsWith("dirty/"))

const succeeded = (sessionID: string) => ({ type: "session.execution.succeeded", data: { sessionID } })

test("a setup whose tool registration fails releases the uploader and the event subscription", async () => {
  const { ctx, events } = host({
    transform: async () => {
      throw new Error("registration refused")
    },
  })
  await expect(plugin.setup(ctx)).rejects.toThrow("registration refused")
  expect(events.subscribed).toBe(true)
  expect(events.released).toBe(true)
})

test("a successful setup keeps the subscription until its cleanup runs", async () => {
  const { ctx, events } = host()
  const cleanup = await plugin.setup(ctx)
  expect(events.subscribed).toBe(true)
  expect(events.released).toBe(false)
  await cleanup!()
  expect(events.released).toBe(true)
})

test("setup registers all five tools and adds the recall instructions to every agent request's system prompt", async () => {
  const names: string[] = []
  const { ctx, hooks } = host({ transform: async (edit) => edit({ add: (tool) => names.push(tool.name) }) })
  const cleanup = await plugin.setup(ctx)
  expect(names.sort()).toEqual(["recall_expand", "recall_inspect", "recall_search", "recall_status", "recall_summarize"])

  const request: Hooked = { system: [{ type: "text", text: "agent prompt" }] }
  hooks.get("context")!(request)
  expect(request.system[0]).toEqual({ type: "text", text: "agent prompt" })
  const text = request.system[1]!.text
  // Today's ladder, then the shared hub's additions: origin and revision, the source filter, and could-not-look.
  expect(text).toContain("**Climb the ladder, cheapest rung first.**")
  expect(text).toContain("**Summarize is the escalation, not the default.**")
  expect(text).toContain("names the host its session was archived from")
  expect(text).toContain("and the archived revision")
  expect(text).toContain("`source` is a `recall_search` filter")
  expect(text).toContain('**"Could not look" is not "nothing found".**')
  await cleanup!()
})

test("instances in one process share one event subscription, read through the oldest", async () => {
  const events = bus()
  const entries = namespace()
  const names: string[][] = [[], [], []]
  const hosts = names.map((registered) =>
    host({ events, entries, transform: async (edit) => edit({ add: (tool) => registered.push(tool.name) }) }),
  )
  const cleanups = await Promise.all(hosts.map((h) => plugin.setup(h.ctx)))
  expect(hosts.map((h) => h.events.active)).toEqual([true, false, false])
  expect(events.readers.size).toBe(1)
  // Each instance still registers its own tools.
  expect(names.map((n) => n.length)).toEqual([5, 5, 5])
  for (const cleanup of cleanups) await cleanup!()
  expect(events.readers.size).toBe(0)
})

test("cleaning up the instance holding the subscription moves it to the next oldest, whose storage the work list drains through", async () => {
  const hub = await configuredHub()
  const events = bus()
  const entries = namespace()
  const [first, second] = [host({ events, entries }), host({ events, entries })]
  const cleanupFirst = await plugin.setup(first.ctx)
  const cleanupSecond = await plugin.setup(second.ctx)
  await until(() => hub.paths.includes("/v1/manifest"))

  await cleanupFirst!()
  expect(first.events.released).toBe(true)
  expect(second.events.active).toBe(true)
  expect(events.readers.size).toBe(1)

  const callsBefore = { first: first.storageCalls.length, second: second.storageCalls.length }
  source.addSession("ses_moved", { time: 100 })
  source.addMessage("ses_moved", "user", { text: "moved over" }, 101)
  events.emit(succeeded("ses_moved"))
  await until(() => hub.snapshots.some((s) => s.startsWith("ses_moved@")) && queued(entries).length === 0)

  expect(first.storageCalls.length).toBe(callsBefore.first)
  expect(second.storageCalls.length).toBeGreaterThan(callsBefore.second)
  expect(second.storageCalls).toContain("set acked/ses_moved")
  await cleanupSecond!()
  expect(second.events.released).toBe(true)
  await hub.stop()
}, 20_000)

test("cleaning up the last instance releases the subscription and the shared runtime", async () => {
  const events = bus()
  const entries = namespace()
  const [first, second] = [host({ events, entries }), host({ events, entries })]
  const cleanupFirst = await plugin.setup(first.ctx)
  const cleanupSecond = await plugin.setup(second.ctx)

  await cleanupSecond!()
  expect(first.events.active).toBe(true)
  expect(second.events.subscribed).toBe(false)
  await cleanupFirst!()
  expect(first.events.released).toBe(true)
  expect(events.readers.size).toBe(0)

  // The next setup builds a new runtime: its uploader starts by reading the work list left behind.
  const third = host({ events, entries })
  const cleanupThird = await plugin.setup(third.ctx)
  expect(third.storageCalls).toContain("scan dirty/")
  expect(third.events.active).toBe(true)
  await cleanupThird!()
})

test("one session change with several instances in one process reaches the hub as one snapshot request", async () => {
  const hub = await configuredHub()
  const events = bus()
  const entries = namespace()
  const hosts = [host({ events, entries }), host({ events, entries }), host({ events, entries })]
  const cleanups = await Promise.all(hosts.map((h) => plugin.setup(h.ctx)))
  await until(() => hub.paths.includes("/v1/manifest"))

  source.addSession("ses_once", { time: 200 })
  source.addMessage("ses_once", "user", { text: "upload me once" }, 201)
  events.emit(succeeded("ses_once"))
  const once = () => hub.snapshots.filter((s) => s.startsWith("ses_once@"))
  await until(() => once().length > 0 && queued(entries).length === 0)
  // Duplicates arrived within milliseconds of each other; give any late one a full request interval to show.
  await Bun.sleep(1_000)

  expect(once()).toEqual(["ses_once@2 archived"])
  for (const cleanup of cleanups) await cleanup!()
  await hub.stop()
}, 20_000)

test("events of other types never reach the uploader", async () => {
  const events = bus()
  const { ctx, entries, storageCalls } = host({ events })
  const cleanup = await plugin.setup(ctx)
  source.addSession("ses_ignored", { time: 300 })
  source.addSession("ses_barrier", { time: 300 })
  for (const type of ["message.part.delta", "session.updated", "session.status", "session.execution.started"])
    events.emit({ type, data: { sessionID: "ses_ignored" } })
  events.emit({ type: "session.execution.interrupted", data: { sessionID: "ses_ignored", reason: "shutdown" } })
  // Events are handled in order, so once this one is queued every earlier one has been seen.
  events.emit(succeeded("ses_barrier"))
  await until(() => queued(entries).some((key) => key.startsWith("dirty/ses_barrier/")))

  expect(storageCalls.filter((call) => call.includes("ses_ignored"))).toEqual([])
  await cleanup!()
})

test("the installable package bundles its pinned Effect runtime instead of importing OpenCode's", async () => {
  const out = join(dir, "plugin-package")
  const build = Bun.spawnSync([process.execPath, join(import.meta.dir, "../build.ts"), "0.0.0", out])
  expect(build.exitCode).toBe(0)
  const bundle = await Bun.file(join(out, "index.js")).text()
  expect(/^import\s.*from\s*["']effect(?:\/[^"']*)?["']/m.test(bundle)).toBe(false)
  const manifest = await Bun.file(join(out, "package.json")).json()
  expect(manifest.dependencies?.effect).toBeUndefined()
})
