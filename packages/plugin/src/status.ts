/**
 * The `recall_status` tool: this host's side of recall (its uploads to the hub) and the hub's side
 * (what the shared archive holds), reported separately so either can be read when the other is down.
 */
import type { Info } from "@opencode/plugin/promise/tool"
import { renderHubStatus } from "@opencode-recall/protocol"
import { Effect, Option } from "effect"
import { PluginConfig } from "./config.ts"
import { Tools } from "./tools.ts"
import { Uploader } from "./uploader.ts"

const INPUT = { type: "object", properties: {}, additionalProperties: false } as const

const DESCRIPTION =
  "Show recall's status in two parts. Host: hub reachability, upload queue, backfill progress, last error, excluded directories, and where the config came from. Hub: sessions per source host (archived, searchable, embedded), chunks waiting to be embedded, the vector space, cached summaries, rewinds, and any session two hosts hold different copies of. Use to check recall's health or to explain missing recall_* results."

const indent = (text: string) => text.replace(/^/gm, "  ")

export const make = Effect.fnUntraced(function* () {
  const config = yield* PluginConfig.Service
  const uploader = yield* Uploader.Service

  const execute = Effect.fn("recall_status")(function* () {
    const [hub, url, configSource, state] = yield* Effect.all(
      [
        Effect.result(Tools.withHub((client) => client.status())),
        config.hub.pipe(
          Effect.map(Option.match({ onNone: () => "", onSome: (h) => ` at ${h.url}` })),
          Effect.orElseSucceed(() => ""),
        ),
        config.hubSource.pipe(Effect.catch((e) => Effect.succeed(`invalid (${e.message})`))),
        Effect.result(uploader.state),
      ],
      { concurrency: "unbounded" },
    )

    const host = [`hub${url}: ${hub._tag === "Success" ? "reachable" : hub.failure.message}`, `config: ${configSource}`]
    if (state._tag === "Failure") host.push(`uploads: the work list could not be read (${state.failure.message})`)
    else {
      const s = state.success
      const reconciled = s.reconciling
        ? "running"
        : Option.match(s.lastReconciled, { onNone: () => "not completed yet", onSome: (t) => `last completed ${Tools.fmtDateTime(t)}` })
      host.push(
        `upload queue: ${s.queued} session${s.queued === 1 ? "" : "s"} waiting`,
        `backfill: ${s.answered} of ${s.local} local sessions answered by the hub at their current position; reconciliation ${reconciled}`,
        ...Option.match(s.pausedBy, { onNone: () => [], onSome: (reason) => [`uploads paused: ${reason}`] }),
        `last error: ${Option.match(s.lastError, { onNone: () => "none", onSome: (e) => `${Tools.fmtDateTime(e.time)} ${e.message}` })}`,
      )
    }
    host.push("excluded directories: none; directory exclusion is not implemented yet, so sessions from every directory are uploaded")

    const hubSection =
      hub._tag === "Success"
        ? renderHubStatus(hub.success)
        : "unknown: the hub could not be asked, so nothing here means the archive is empty."
    const reachable = hub._tag === "Success" ? "" : " · hub unreachable"
    return {
      content: `host\n${indent(host.join("\n"))}\n\nhub\n${indent(hubSection)}`,
      metadata: { title: `recall status${reachable}` },
    }
  })

  const context = yield* Effect.context<PluginConfig.Service>()
  const info: Info<typeof INPUT> = {
    name: "recall_status",
    description: DESCRIPTION,
    input: INPUT,
    options: { codemode: false },
    execute: () => Effect.runPromiseWith(context)(execute()),
  }
  return info
})

export * as StatusTool from "./status.ts"
