import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { Config, Context, Effect, FiberHandle, Layer, Logger, ManagedRuntime, Option, Stream } from "effect"
import { PluginConfig } from "./config.ts"
import { ExpandTool } from "./expand.ts"
import { InspectTool } from "./inspect.ts"
import { Instructions } from "./instructions.ts"
import { SearchTool } from "./search.ts"
import { Source } from "./source.ts"
import { StatusTool } from "./status.ts"
import { Storage } from "./storage.ts"
import { SummarizeTool } from "./summarize.ts"
import { Uploader } from "./uploader.ts"

type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

const sourceDbPath = Effect.gen(function* () {
  const explicit = yield* Config.option(Config.String("OPENCODE_RECALL_SOURCE_DB"))
  if (Option.isSome(explicit)) return explicit.value
  const data = yield* Config.String("XDG_DATA_HOME").pipe(Config.withDefault(join(homedir(), ".local", "share")))
  return join(data, "opencode", "opencode.db")
})

/** Every plugin log line goes to stderr, prefixed so it can be told apart from OpenCode's own. */
const log = Logger.layer([Logger.make(({ message }) => console.error(`opencode-recall: ${[message].flat().join(" ")}`))])

/**
 * The live plugin instances in this process, oldest first. OpenCode runs one `setup` per open
 * location and hands each the whole server's event stream, so they share one uploader rather than
 * each uploading every change.
 */
const instances = new Set<PluginContext>()

const oldest = () => {
  for (const ctx of instances) return ctx
  throw new Error("no opencode-recall plugin instance is loaded")
}

/** Every instance addresses the same `ctx.storage` namespace, so the oldest live one serves them all. */
const storage: Storage.Domain = {
  get: (key) => oldest().storage.get(key),
  set: (key, value) => oldest().storage.set(key, value),
  remove: (key) => oldest().storage.remove(key),
  scan: (options) => oldest().storage.scan(options),
}

/** OpenCode's event stream, read through one instance at a time. */
class Subscription extends Context.Service<
  Subscription,
  {
    /** Read `ctx`'s event stream in place of the one read now, then reconcile to cover events missed during the switch. */
    readonly follow: (ctx: PluginContext) => Effect.Effect<void>
  }
>()("@opencode-recall/plugin/Subscription") {}

const subscription = Layer.effect(
  Subscription,
  Effect.gen(function* () {
    const uploader = yield* Uploader.Service
    const scope = yield* Effect.scope
    const following = yield* FiberHandle.make()
    const reconcile = Effect.asVoid(Effect.forkIn(uploader.reconcile, scope))

    const read = (ctx: PluginContext) =>
      Effect.gen(function* () {
        const abort = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (abort) => Effect.sync(() => abort.abort()),
        )
        yield* Stream.fromAsyncIterable(ctx.event.subscribe({ signal: abort.signal }), (e) => e).pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              // Sent at the start of every (re)connection; events may have been missed while it was down.
              if (event.type === "server.connected") yield* reconcile
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
        )
      }).pipe(Effect.scoped)

    return Subscription.of({
      follow: Effect.fn("Subscription.follow")(function* (ctx: PluginContext) {
        yield* FiberHandle.clear(following)
        yield* FiberHandle.run(following, read(ctx))
        yield* reconcile
      }),
    })
  }),
)

const makeRuntime = () =>
  ManagedRuntime.make(
    subscription.pipe(
      Layer.provideMerge(Uploader.layer()),
      Layer.provideMerge(
        Layer.unwrap(
          Effect.gen(function* () {
            const source = Source.layer(yield* sourceDbPath)
            const config = PluginConfig.layer(yield* PluginConfig.filePath)
            return Layer.mergeAll(source, config, Storage.fromDomain(storage))
          }),
        ),
      ),
      Layer.provideMerge(log),
    ),
  )

/** Built by the first instance and disposed with the last; building it starts the uploader. */
let runtime: ReturnType<typeof makeRuntime> | undefined

let turn: Promise<unknown> = Promise.resolve()
/** Instances join and leave one at a time, so concurrent setups share one runtime and the stream has one reader. */
const serially = <A>(change: () => Promise<A>): Promise<A> => {
  const result = turn.then(change)
  turn = result.catch(() => {})
  return result
}

const follow = (ctx: PluginContext) => Subscription.use((s) => s.follow(ctx))

const enter = async (ctx: PluginContext) => {
  instances.add(ctx)
  runtime ??= makeRuntime()
  if (oldest() === ctx) await runtime.runPromise(follow(ctx))
  return runtime
}

const leave = async (ctx: PluginContext) => {
  if (!instances.has(ctx)) return
  if (instances.size === 1) {
    // Storage still goes through this instance while the uploader stops.
    const last = runtime
    runtime = undefined
    await last?.dispose()
    instances.delete(ctx)
    return
  }
  const followed = oldest() === ctx
  instances.delete(ctx)
  if (followed && runtime) await runtime.runPromise(follow(oldest()))
}

export default Plugin.define({
  id: "opencode-recall",
  setup: async (ctx) => {
    // A failed setup returns no cleanup to the host, so it leaves the process registry itself.
    try {
      const shared = await serially(() => enter(ctx))
      const tools = await shared.runPromise(
        Effect.all([SearchTool.make(), InspectTool.make(), ExpandTool.make(), SummarizeTool.make(ctx.generate), StatusTool.make()]),
      )
      await ctx.tool.transform((editor) => {
        for (const tool of tools) editor.add(tool)
      })
      await ctx.session.hook("context", Instructions.inject)
    } catch (e) {
      await serially(() => leave(ctx))
      throw e
    }
    return () => serially(() => leave(ctx))
  },
})
