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

/** A host whose event stream records whether the plugin subscribed and later let go of it. */
function host(transform: () => Promise<unknown>) {
  const events = { subscribed: false, released: false }
  const ctx = {
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
  return { ctx, events }
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
