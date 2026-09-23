#!/usr/bin/env bun
import { renderHubStatus } from "@opencode-recall/protocol"
import { Cause, Console, Effect, Fiber, Layer } from "effect"
import { Archive } from "./archive/index.ts"
import { HubConfig } from "./config.ts"
import { Log } from "./log.ts"
import { Hub } from "./serve.ts"
import { TOKEN_USAGE, runToken } from "./token.ts"

const [command, ...args] = process.argv.slice(2)
if (command !== "serve" && command !== "token" && command !== "status") {
  console.error(`usage: opencode-recall-hub serve\n       opencode-recall-hub status\n       ${TOKEN_USAGE}`)
  process.exit(2)
}

const messageOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

const loaded = await Effect.runPromiseExit(HubConfig.load)
if (loaded._tag === "Failure") {
  console.error(messageOf(loaded.cause))
  process.exit(1)
}
const config = Layer.succeed(HubConfig.Service, loaded.value)
const archive = Hub.dataArchive.pipe(Layer.provide(Hub.dataEmbedder), Layer.provide(config))

/** The `status` subcommand: the hub's side of `recall_status`, read from the archive directly. */
const runStatus = Effect.fn("Status.run")(function* (args: readonly string[]) {
  if (args.length > 0) {
    yield* Console.error("usage: opencode-recall-hub status")
    return 2
  }
  yield* Console.log(renderHubStatus(yield* (yield* Archive.Service).status()))
  return 0
})

if (command === "token" || command === "status") {
  const run = command === "token" ? runToken(args) : runStatus(args)
  const exit = await Effect.runPromiseExit(run.pipe(Effect.provide(archive)))
  if (exit._tag === "Failure") console.error(messageOf(exit.cause))
  process.exit(exit._tag === "Success" ? exit.value : 1)
}

const log = Log.layer(loaded.value.logLevel)

const hub = Effect.runFork(
  Layer.launch(Hub.layer().pipe(Layer.provide(config))).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.logError("startup failed").pipe(
            Effect.annotateLogs({ error: messageOf(cause) }),
            Effect.andThen(Effect.sync(() => process.exit(1))),
          ),
    ),
    Effect.provide(log),
  ),
)

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await Effect.runPromise(Effect.logInfo("shutting down").pipe(Effect.annotateLogs({ signal }), Effect.provide(log)))
    await Effect.runPromise(Fiber.interrupt(hub))
    process.exit(0)
  })
