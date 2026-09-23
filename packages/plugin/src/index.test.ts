import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "./index.ts"
import { sourceDb } from "./fixture.ts"

type Context = Parameters<typeof plugin.setup>[0]

let dir: string
const saved = { ...process.env }

// Effect's default ConfigProvider snapshots the environment when first read, so every test in
// this file shares the one setting.
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "recall-plugin-setup-"))
  const source = sourceDb()
  source.db.run("VACUUM INTO ?", [join(dir, "opencode.db")])
  source.close()
  process.env.OPENCODE_RECALL_SOURCE_DB = join(dir, "opencode.db")
  process.env.XDG_CONFIG_HOME = dir
  delete process.env.OPENCODE_RECALL_HUB_URL
  delete process.env.OPENCODE_RECALL_TOKEN
})

afterAll(() => {
  process.env = { ...saved }
  rmSync(dir, { recursive: true, force: true })
})

type Hooked = { system: { type: "text"; text: string }[] }

/**
 * A host whose event stream records whether the plugin subscribed and later let go of it, and
 * which keeps the plugin's session hooks and registered tool names.
 */
function host(transform: (edit: (editor: { add: (tool: { name: string }) => void }) => void) => Promise<unknown>) {
  const events = { subscribed: false, released: false }
  const hooks = new Map<string, (event: Hooked) => void>()
  const ctx = {
    session: {
      hook: async (name: string, callback: (event: Hooked) => void) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
    },
    storage: {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
      scan: async () => ({ entries: [] }),
    },
    tool: { transform },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => {
        events.subscribed = true
        signal.addEventListener("abort", () => (events.released = true))
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<never>>(() => {}),
            return: async () => {
              events.released = true
              return { done: true as const, value: undefined }
            },
          }),
        }
      },
    },
  } as unknown as Context
  return { ctx, events, hooks }
}

test("a setup whose tool registration fails releases the uploader and the event subscription", async () => {
  const { ctx, events } = host(async () => {
    throw new Error("registration refused")
  })
  await expect(plugin.setup(ctx)).rejects.toThrow("registration refused")
  expect(events.subscribed).toBe(true)
  expect(events.released).toBe(true)
})

test("a successful setup keeps the subscription until its cleanup runs", async () => {
  const { ctx, events } = host(async () => {})
  const cleanup = await plugin.setup(ctx)
  expect(events.subscribed).toBe(true)
  expect(events.released).toBe(false)
  await cleanup!()
  expect(events.released).toBe(true)
})

test("setup registers all five tools and adds the recall instructions to every agent request's system prompt", async () => {
  const names: string[] = []
  const { ctx, hooks } = host(async (edit) => edit({ add: (tool) => names.push(tool.name) }))
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
