import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { makeClient, type Client } from "@opencode-recall/protocol"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { PluginConfig } from "./config.ts"
import { sourceDb, startHub, type SourceDb } from "./fixture.ts"
import { readSnapshot } from "./source.ts"
import { SummarizeTool, type Generate } from "./summarize.ts"

let dataDir: string
let hub: Awaited<ReturnType<typeof startHub>>
let desktop: SourceDb
let upload: Client
let config: PluginConfig.Hub

/** Archive the desktop's current copy of `sessionId`, as its uploader would after a turn. */
const archive = (sessionId: string) => Effect.runPromise(upload.snapshot(readSnapshot(desktop.db, sessionId)!))

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "recall-summarize-"))
  hub = await startHub(dataDir)
  config = { url: hub.url.href, token: hub.issueToken("laptop") }
  upload = makeClient({ url: hub.url.href, token: hub.issueToken("desktop") })

  // Only the desktop has this session; the laptop summarizes it from the hub's copy.
  desktop = sourceDb()
  desktop.addSession("ses_remote", { title: "Fixing the ingress", time: 100 })
  desktop.addMessage("ses_remote", "user", { text: "why did the push fail?" }, 101)
  desktop.addMessage("ses_remote", "assistant", { content: [{ type: "text", text: "It was a non-fast-forward; rebased." }] }, 102)
  await archive("ses_remote")
})

afterEach(async () => {
  desktop.close()
  await hub.stop()
  rmSync(dataDir, { recursive: true, force: true })
})

type Input = Parameters<Generate["text"]>[0]

/** A model that records every prompt it is given and answers with `answer`. */
function fakeModel(answer: (input: Input) => Promise<string> | string = () => "SUMMARY: rebased and pushed") {
  const calls: Input[] = []
  const generate: Generate = {
    text: async (input) => {
      calls.push(input)
      return { text: await answer(input) }
    },
  }
  return { calls, generate }
}

const context = { sessionID: "ses_self", progress: async () => {} } as unknown as ToolContext

async function summarize(generate: Generate, input: object, hubConfig: PluginConfig.Hub = config): Promise<string> {
  const layer = Layer.succeed(PluginConfig.Service, {
    hub: Effect.succeed(Option.some(hubConfig)),
    summaryModel: Effect.succeed(PluginConfig.DEFAULT_SUMMARY_MODEL),
  })
  const tool = await Effect.runPromise(SummarizeTool.make(generate).pipe(Effect.provide(layer)))
  const { content } = await tool.execute(input, context)
  if (typeof content !== "string") throw new Error("expected text content")
  return content
}

test("summarizes another host's session from the hub's transcript, with the instructions in the prompt", async () => {
  const model = fakeModel()
  const output = await summarize(model.generate, { session_id: "brave-otter", focus: "why did it fail?" })
  expect(output).toContain("# Fixing the ingress")
  expect(output).toContain("from desktop, archived revision 3")
  expect(output).toMatch(/\(fresh · openai\/gpt-5\.6-luna\/low · 2 messages · [\d.]+s · focus: why did it fail\?\)/)
  expect(output).toEndWith("SUMMARY: rebased and pushed")

  const [call] = model.calls
  expect(call!.model).toEqual({ providerID: "openai", id: "gpt-5.6-luna", variant: "low" })
  expect(call!.prompt).toStartWith("You analyze recorded OpenCode agent session transcripts.")
  expect(call!.prompt).toContain("QUESTION: why did it fail?")
  expect(call!.prompt).toContain("(msg_ses_remote_3)\nIt was a non-fast-forward; rebased.")
})

test("a repeat call is served from the hub's cache on any host, and refresh bypasses it", async () => {
  const model = fakeModel()
  await summarize(model.generate, { session_id: "ses_remote" })
  const desktopHub = { url: hub.url.href, token: hub.issueToken("desktop") }
  const again = await summarize(model.generate, { session_id: "ses_remote" }, desktopHub)
  expect(again).toMatch(/\(cached \d{4}-\d\d-\d\d \d\d:\d\d · openai\/gpt-5\.6-luna\/low\)\n\nSUMMARY: rebased and pushed$/)
  expect(model.calls).toHaveLength(1)

  // Another model, or the provider's default variant, is another cache entry.
  await summarize(model.generate, { session_id: "ses_remote", variant: "default" })
  await summarize(model.generate, { session_id: "ses_remote", providerID: "anthropic", modelID: "claude-haiku" })
  expect(model.calls.map((c) => c.model)).toEqual([
    { providerID: "openai", id: "gpt-5.6-luna", variant: "low" },
    { providerID: "openai", id: "gpt-5.6-luna" },
    { providerID: "anthropic", id: "claude-haiku" },
  ])

  expect(await summarize(model.generate, { session_id: "ses_remote", refresh: true })).toContain("(fresh ·")
  expect(model.calls).toHaveLength(4)
})

test("a summary of a session that advanced while it was generated is returned but not cached", async () => {
  const model = fakeModel(async () => {
    desktop.addMessage("ses_remote", "user", { text: "and the tag?" }, 103)
    await archive("ses_remote")
    return "SUMMARY: before the tag"
  })
  const output = await summarize(model.generate, { session_id: "ses_remote" })
  expect(output).toContain("not cached: the session advanced while it was summarized")
  expect(output).toEndWith("SUMMARY: before the tag")

  const next = fakeModel()
  expect(await summarize(next.generate, { session_id: "ses_remote" })).toContain("(fresh · openai/gpt-5.6-luna/low · 3 messages")
  expect(next.calls[0]!.prompt).toContain("and the tag?")
})

test("a transcript cut to fit the budget says what was cut", async () => {
  desktop.addSession("ses_long", { title: "Long one", time: 200 })
  for (let i = 0; i < 200; i++) desktop.addMessage("ses_long", "user", { text: `turn ${i} ` + "x".repeat(2_500) }, 201 + i)
  await archive("ses_long")

  const model = fakeModel()
  const output = await summarize(model.generate, { session_id: "ses_long" })
  const omitted = Number(output.match(/· (\d+) messages omitted from the middle to fit 300000 characters/)?.[1])
  expect(omitted).toBeGreaterThan(0)
  expect(output).toContain(`· ${200 - omitted} messages cut to 2000 characters`)
  expect(model.calls[0]!.prompt).toContain(`[... ${omitted} of 200 messages omitted ...]`)
  expect(model.calls[0]!.prompt).toContain("turn 0 ")
  expect(model.calls[0]!.prompt).toContain("turn 199 ")
})

test("a batch of 24 sessions runs four at a time, and a larger one is refused", async () => {
  for (let i = 0; i < 23; i++) {
    desktop.addSession(`ses_${i}`, { title: `Session ${i}`, time: 300 + i })
    desktop.addMessage(`ses_${i}`, "user", { text: `question ${i}` }, 301 + i)
    await archive(`ses_${i}`)
  }
  const ids = ["ses_remote", ...Array.from({ length: 23 }, (_, i) => `ses_${i}`)]

  // Calls are held until none has arrived for a while, so each wave holds every call the tool
  // lets run at once. The hub answers a local request in a few milliseconds.
  let active = 0
  let peak = 0
  let waiting: (() => void)[] = []
  let settle: ReturnType<typeof setTimeout> | undefined
  const model = fakeModel(async () => {
    peak = Math.max(peak, ++active)
    await new Promise<void>((resolve) => {
      waiting.push(resolve)
      clearTimeout(settle)
      settle = setTimeout(() => {
        for (const release of waiting.splice(0)) release()
      }, 50)
    })
    active--
    return "SUMMARY"
  })

  const output = await summarize(model.generate, { session_ids: ids })
  expect(model.calls).toHaveLength(24)
  expect(peak).toBe(4)
  expect(output.split("\n\n---\n\n")).toHaveLength(24)
  expect(output).toContain("# Session 22")

  const tooMany = await summarize(model.generate, { session_ids: [...ids, "ses_extra"] })
  expect(tooMany).toBe("Too many sessions (25); max 24 per call. Split into batches.")
})

test("the default summary model comes from the environment, then recall.json, then today's default", async () => {
  const file = join(dataDir, "recall.json")
  const load = (env: Record<string, string>) =>
    Effect.runPromise(
      PluginConfig.loadSummaryModel(file).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
    )
  expect(await load({})).toEqual(PluginConfig.DEFAULT_SUMMARY_MODEL)
  writeFileSync(file, JSON.stringify({ summary: { model: { providerID: "anthropic", modelID: "claude-haiku" } } }))
  expect(await load({})).toEqual({ providerID: "anthropic", modelID: "claude-haiku" })
  expect(await load({ OPENCODE_RECALL_SUMMARY_MODEL: "openrouter/qwen/qwen3/high" })).toEqual({
    providerID: "openrouter",
    modelID: "qwen/qwen3",
    variant: "high",
  })
  await expect(load({ OPENCODE_RECALL_SUMMARY_MODEL: "just-a-model" })).rejects.toThrow("is not provider/model[/variant]")
  writeFileSync(file, JSON.stringify({ summary: { model: "openai/gpt" } }))
  await expect(load({})).rejects.toThrow()
})

test("an unknown session, a failing model, and missing arguments are each named", async () => {
  const failing: Generate = {
    text: async () => {
      throw new Error("Model unavailable: openai/gpt-5.6-luna")
    },
  }
  const output = await summarize(failing, { session_ids: ["ses_nope", "ses_remote"] })
  expect(output).toContain("No archived session found for 'ses_nope'")
  expect(output).toContain("# ses_remote\nSummarization failed with openai/gpt-5.6-luna/low: Model unavailable: openai/gpt-5.6-luna")
  expect(await summarize(failing, {})).toBe("Provide session_id or session_ids.")
})
