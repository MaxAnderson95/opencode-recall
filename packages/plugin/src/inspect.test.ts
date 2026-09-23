import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { makeClient } from "@opencode-recall/protocol"
import { Effect, Layer, Option } from "effect"
import { PluginConfig } from "./config.ts"
import { ExpandTool } from "./expand.ts"
import { sourceDb, startHub, type SourceDb } from "./fixture.ts"
import { InspectTool } from "./inspect.ts"
import { Source, readSnapshot } from "./source.ts"

let dataDir: string
let hub: Awaited<ReturnType<typeof startHub>>
let laptop: SourceDb
let config: PluginConfig.Hub

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "recall-inspect-"))
  hub = await startHub(dataDir)
  config = { url: hub.url.href, token: hub.issueToken("laptop") }

  // The desktop uploads one session and goes offline; the hub's copy is all that remains.
  const desktop = sourceDb()
  desktop.addSession("ses_remote", { title: "Fixing the ingress", time: 100 })
  desktop.addMessage("ses_remote", "user", { text: "why did the push fail?" }, 101)
  desktop.addMessage(
    "ses_remote",
    "assistant",
    {
      content: [
        { type: "text", text: "Pushing the needle branch." },
        { type: "tool", name: "bash", state: { status: "error", input: { command: "git push" }, error: { message: "rejected: non-fast-forward" } } },
      ],
    },
    102,
  )
  desktop.addMessage("ses_remote", "user", { text: "rebase and retry the needle" }, 103)
  desktop.addMessage("ses_remote", "assistant", { content: [{ type: "text", text: "Done." }] }, 104)
  await Effect.runPromise(makeClient({ url: hub.url.href, token: hub.issueToken("desktop") }).snapshot(readSnapshot(desktop.db, "ses_remote")!))
  desktop.close()

  laptop = sourceDb()
})

afterEach(async () => {
  laptop.close()
  await hub.stop()
  rmSync(dataDir, { recursive: true, force: true })
})

const context = { sessionID: "ses_self" } as unknown as ToolContext

const layer = (hubConfig: Option.Option<PluginConfig.Hub>) =>
  Layer.mergeAll(Layer.succeed(PluginConfig.Service, { hub: Effect.succeed(hubConfig), summaryModel: Effect.succeed(PluginConfig.DEFAULT_SUMMARY_MODEL) }), Source.fromDatabase(laptop.db))

type Tool = Effect.Success<ReturnType<typeof InspectTool.make>> | Effect.Success<ReturnType<typeof ExpandTool.make>>

const runner =
  (make: () => Effect.Effect<Tool, never, PluginConfig.Service | Source.Service>) =>
  async (input: object, hubConfig: Option.Option<PluginConfig.Hub> = Option.some(config)): Promise<string> => {
    const tool = await Effect.runPromise(make().pipe(Effect.provide(layer(hubConfig))))
    const { content } = await tool.execute(input, context)
    if (typeof content !== "string") throw new Error("expected text content")
    return content
  }

const inspect = runner(InspectTool.make)
const expand = runner(ExpandTool.make)

test("inspect finds messages in another host's session, and expand reads around the message ids it returns", async () => {
  const output = await inspect({ session_id: "ses_remote", query: "needle", mode: "lexical" })
  expect(output).toContain("# Fixing the ingress")
  expect(output).toContain("from desktop, archived revision 5")
  expect(output).toContain('2 of 2 matches for "needle" (lexical)')
  expect(output).toContain("[lexical/text · assistant text] Pushing the «needle» branch.")
  const [first] = [...output.matchAll(/\((msg_[^)]+)\)/g)].map((m) => m[1]!)
  expect(first).toBe("msg_ses_remote_3")

  const around = await expand({ session_id: "ses_remote", message_id: first, window: 2 })
  expect(around).toContain("messages 1-2 of 4")
  expect(around).toContain("── assistant @")
  expect(around).toContain("(msg_ses_remote_3)\n[tool bash] git push (failed: rejected: non-fast-forward)\nPushing the needle branch.")
  expect(around).not.toContain("rebase and retry")
})

test("inspect without a query outlines the user turns by slug", async () => {
  const output = await inspect({ session_id: "brave-otter" })
  expect(output).toContain("session_id=ses_remote slug=brave-otter")
  expect(output).toContain("4 messages · 2 user turns")
  expect(output).toMatch(/1\. \d{4}-\d\d-\d\d \d\d:\d\d \(msg_ses_remote_2\) why did the push fail\?/)
  expect(output).toMatch(/2\. .* \(msg_ses_remote_4\) rebase and retry the needle/)
  expect(await inspect({ session_id: "ses_remote", scope: "user-messages" })).toStartWith("scope=user-messages requires a query")
})

test("expand defaults to the session's end and honours max_chars", async () => {
  const output = await expand({ session_id: "ses_remote", window: 2, max_chars: 100 })
  expect(output).toContain("messages 3-4 of 4")
  expect(output).toContain("rebase and retry the needle")
  expect(output).toContain("(widen with window=4 or center on another message_id)")
})

test("an unknown session, an unconfigured hub, and an unreachable hub are each named", async () => {
  expect(await inspect({ session_id: "ses_nope", query: "x" })).toStartWith("No archived session found for 'ses_nope'")
  expect(await expand({ session_id: "ses_nope" })).toStartWith("No archived session found for 'ses_nope'")
  expect(await inspect({ session_id: "ses_remote" }, Option.none())).toStartWith("recall could not look: no hub is configured")
  await hub.stop()
  expect(await expand({ session_id: "ses_remote" })).toStartWith("recall could not look: the hub request failed")
})
