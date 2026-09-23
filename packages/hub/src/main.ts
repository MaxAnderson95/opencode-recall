#!/usr/bin/env bun
import { Cause, Effect, Fiber, Layer } from "effect"
import { HubConfig } from "./config.ts"
import { Log } from "./log.ts"
import { Hub } from "./serve.ts"
import { TOKEN_USAGE, runToken } from "./token.ts"

const [command, ...args] = process.argv.slice(2)
if (command !== "serve" && command !== "token") {
  console.error(`usage: opencode-recall-hub serve\n       ${TOKEN_USAGE}`)
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

if (command === "token") {
  const exit = await Effect.runPromiseExit(
    runToken(args).pipe(Effect.provide(Hub.dataArchive.pipe(Layer.provide(Hub.dataEmbedder), Layer.provide(config)))),
  )
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
