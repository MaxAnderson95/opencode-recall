import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { makeClient } from "@opencode-recall/protocol"
import { Effect, Layer, Option } from "effect"
import { fakeEmbedder } from "../../hub/src/fake-embedder.ts"
import { PluginConfig } from "./config.ts"
import { sourceDb, startHub, type SourceDb } from "./fixture.ts"
import { SearchTool } from "./search.ts"
import { Source, readSnapshot } from "./source.ts"

let dataDir: string
let hub: Awaited<ReturnType<typeof startHub>>
let laptop: SourceDb
let config: PluginConfig.Hub
let embedder: ReturnType<typeof fakeEmbedder>

async function upload(source: SourceDb, sessionId: string, token: string) {
  await Effect.runPromise(makeClient({ url: hub.url.href, token }).snapshot(readSnapshot(source.db, sessionId)!))
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "recall-search-"))
  embedder = fakeEmbedder()
  hub = await startHub(dataDir, embedder)
  config = { url: hub.url.href, token: hub.issueToken("laptop") }

  // The desktop uploads one session and goes offline; the hub's copy is all that remains.
  const desktop = sourceDb()
  desktop.addSession("ses_remote", { title: "Fixing the ingress", time: 100 })
  desktop.addMessage("ses_remote", "user", { text: "the needle broke the ingress" }, 101)
  await upload(desktop, "ses_remote", hub.issueToken("desktop"))
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

const tool = (hubConfig: Option.Option<PluginConfig.Hub> | PluginConfig.Invalid) =>
  Effect.runPromise(
    SearchTool.make().pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(PluginConfig.Service, {
            hub: hubConfig instanceof PluginConfig.Invalid ? Effect.fail(hubConfig) : Effect.succeed(hubConfig),
            hubSource: Effect.succeed("test"),
            summaryModel: Effect.succeed(PluginConfig.DEFAULT_SUMMARY_MODEL),
          }),
          Source.fromDatabase(laptop.db),
        ),
      ),
    ),
  )

async function run(input: object, hubConfig: Option.Option<PluginConfig.Hub> | PluginConfig.Invalid = Option.some(config)): Promise<string> {
  const { content } = await (await tool(hubConfig)).execute(input, context)
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

test("an unconfigured, misconfigured, or unreachable hub is reported as not having looked", async () => {
  expect(await run({ query: "needle" }, Option.none())).toStartWith("recall could not look")
  expect(await run({ query: "needle" }, new PluginConfig.Invalid({ message: "bad json" }))).toStartWith(
    "recall could not look: the recall config is invalid (bad json).",
  )
  await hub.stop()
  expect(await run({ query: "needle" })).toStartWith("recall could not look: the hub request failed")
})

test("hybrid results carry semantic hits once the hub has embedded the chunks", async () => {
  const status = () => Effect.runPromise(makeClient(config).status())
  for (let s = await status(); s.embeddedChunks < s.chunks; s = await status()) await Bun.sleep(5)

  // BM25 does not stem, so only the semantic branch connects "needles" to "needle".
  expect(await run({ query: "needles", mode: "lexical" })).toStartWith('No matches for "needles" (lexical, scope=all)')
  const output = await run({ query: "needles" })
  expect(output).toContain("Fixing the ingress")
  expect(output).toContain("matches(lex=0,sem=1)")
  expect(output).toMatch(/\[semantic 0\.\d\d · Conversation context \(mixed origins\)\] USER: the needle broke the ingress/)
  expect(await run({ query: "needles", mode: "semantic", scope: "user-messages" })).toContain("· Top-level user message] the needle")
})

test("an unavailable embedder is named: hybrid falls back to lexical and semantic mode could not look", async () => {
  embedder.down = true
  const hybrid = await run({ query: "needle" })
  expect(hybrid).toStartWith("semantic search is unavailable (embedding model unavailable); these results are lexical only.\n")
  expect(hybrid).toContain("Fixing the ingress")
  expect(await run({ query: "needle", mode: "semantic" })).toStartWith(
    "recall could not look: semantic search is unavailable (embedding model unavailable).",
  )
})
