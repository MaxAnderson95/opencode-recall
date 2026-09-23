import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { makeClient } from "@opencode-recall/protocol"
import { Effect, Layer, Option } from "effect"
import { PluginConfig } from "./config.ts"
import { sourceDb, startHub } from "./fixture.ts"
import { readSnapshot } from "./source.ts"
import { StatusTool } from "./status.ts"
import { Uploader } from "./uploader.ts"

let dataDir: string
let hub: Awaited<ReturnType<typeof startHub>>
let config: PluginConfig.Hub

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "recall-status-"))
  hub = await startHub(dataDir)
  config = { url: hub.url.href, token: hub.issueToken("laptop") }
  const desktop = sourceDb()
  desktop.addSession("ses_remote", { title: "Fixing the ingress", time: 100 })
  desktop.addMessage("ses_remote", "user", { text: "the needle broke the ingress" }, 101)
  await Effect.runPromise(makeClient({ url: hub.url.href, token: hub.issueToken("desktop") }).snapshot(readSnapshot(desktop.db, "ses_remote")!))
  desktop.close()
})

afterEach(async () => {
  await hub.stop()
  rmSync(dataDir, { recursive: true, force: true })
})

const state: Uploader.State = {
  queued: 2,
  local: 5,
  answered: 3,
  reconciling: false,
  lastReconciled: Option.some(Date.parse("2026-09-20T10:00:00")),
  pausedBy: Option.none(),
  lastError: Option.some({ message: "upload of ses_x failed, retrying: connection refused", time: Date.parse("2026-09-20T10:05:00") }),
}

async function run(hubConfig: Option.Option<PluginConfig.Hub> = Option.some(config)): Promise<string> {
  const layer = Layer.mergeAll(
    Layer.succeed(PluginConfig.Service, {
      hub: Effect.succeed(hubConfig),
      hubSource: Effect.succeed("hub.url: OPENCODE_RECALL_HUB_URL; hub.token: /cfg/recall.json"),
      summaryModel: Effect.succeed(PluginConfig.DEFAULT_SUMMARY_MODEL),
    }),
    Layer.succeed(Uploader.Service, {
      enqueue: () => Effect.void,
      delete: () => Effect.void,
      reconcile: Effect.void,
      state: Effect.succeed(state),
    }),
  )
  const tool = await Effect.runPromise(StatusTool.make().pipe(Effect.provide(layer)))
  const { content } = await tool.execute({}, {} as ToolContext)
  if (typeof content !== "string") throw new Error("expected text content")
  return content
}

test("reports this host's uploads and the hub's archive in separate sections", async () => {
  const output = await run()
  expect(output).toStartWith(`host\n  hub at ${hub.url.href}: reachable\n  config: hub.url: OPENCODE_RECALL_HUB_URL; hub.token: /cfg/recall.json\n`)
  expect(output).toContain("  upload queue: 2 sessions waiting\n")
  expect(output).toContain("  backfill: 3 of 5 local sessions answered by the hub at their current position; reconciliation last completed 2026-09-20 10:00\n")
  expect(output).toContain("  last error: 2026-09-20 10:05 upload of ses_x failed, retrying: connection refused\n")
  expect(output).toContain("  excluded directories: none;")
  // The hub embeds in the background, so the session may or may not be embedded yet.
  expect(output).toMatch(/\n\nhub\n {2}sessions archived: 1\n {4}from desktop: 1 archived, 1 searchable, [01] embedded\n/)
  expect(output).toContain("  hash_divergence: none")
})

test("an unreachable or unconfigured hub is reported as not having looked, and the host section still reads", async () => {
  await hub.stop()
  const down = await run()
  expect(down).toContain(`  hub at ${hub.url.href}: recall could not look: the hub request failed (`)
  expect(down).toContain("  upload queue: 2 sessions waiting\n")
  expect(down).toEndWith("\n\nhub\n  unknown: the hub could not be asked, so nothing here means the archive is empty.")
  expect(await run(Option.none())).toStartWith("host\n  hub: recall could not look: no hub is configured.")
})
