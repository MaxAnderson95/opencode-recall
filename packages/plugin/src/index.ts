import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { Config, Effect, Layer, Logger, ManagedRuntime, Option, Stream } from "effect"
import { PluginConfig } from "./config.ts"
import { SearchTool } from "./search.ts"
import { Source } from "./source.ts"
import { Storage } from "./storage.ts"
import { Uploader } from "./uploader.ts"

type Context = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

const sourceDbPath = Effect.gen(function* () {
  const explicit = yield* Config.option(Config.String("OPENCODE_RECALL_SOURCE_DB"))
  if (Option.isSome(explicit)) return explicit.value
  const data = yield* Config.String("XDG_DATA_HOME").pipe(Config.withDefault(join(homedir(), ".local", "share")))
  return join(data, "opencode", "opencode.db")
})

/** Every plugin log line goes to stderr, prefixed so it can be told apart from OpenCode's own. */
const log = Logger.layer([Logger.make(({ message }) => console.error(`opencode-recall: ${[message].flat().join(" ")}`))])

/** Feed OpenCode's event stream to the uploader for as long as the plugin runs. */
const events = (ctx: Context) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const uploader = yield* Uploader.Service
      yield* Effect.forkScoped(uploader.reconcile)
      const abort = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (abort) => Effect.sync(() => abort.abort()),
      )
      yield* Stream.fromAsyncIterable(ctx.event.subscribe({ signal: abort.signal }), (e) => e).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            // Sent at the start of every (re)connection; events may have been missed while it was down.
            if (event.type === "server.connected") yield* Effect.forkScoped(uploader.reconcile)
            if (event.type === "session.deleted")
              yield* uploader.delete(event.data.sessionID, { revision: event.durable.seq, timeDeleted: Math.ceil(event.created) })
            const changed =
              event.type === "session.execution.succeeded" ||
              event.type === "session.execution.failed" ||
              (event.type === "session.execution.interrupted" && event.data.reason !== "shutdown") ||
              event.type === "session.renamed" ||
              event.type === "session.moved"
            if (changed) yield* uploader.enqueue(event.data.sessionID)
          }),
        ),
        Effect.catch((e) => Effect.logError("event stream failed:", e)),
        Effect.forkScoped,
      )
    }),
  )

export default Plugin.define({
  id: "opencode-recall",
  setup: async (ctx) => {
    const services = Layer.unwrap(
      Effect.gen(function* () {
        const source = Source.layer(yield* sourceDbPath)
        const config = PluginConfig.layer(yield* PluginConfig.filePath)
        return Layer.mergeAll(source, config, Storage.fromDomain(ctx.storage))
      }),
    )
    const runtime = ManagedRuntime.make(
      events(ctx).pipe(Layer.provide(Uploader.layer()), Layer.provideMerge(services), Layer.provideMerge(log)),
    )
    const tool = await runtime.runPromise(SearchTool.make())
    await ctx.tool.transform((tools) => {
      tools.add(tool)
    })
    return () => runtime.dispose()
  },
})
