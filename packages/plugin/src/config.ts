import { homedir } from "node:os"
import { join } from "node:path"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"

export const Hub = Schema.Struct({ url: Schema.String, token: Schema.String })
export interface Hub extends Schema.Schema.Type<typeof Hub> {}

// Other sections (`index`, from today's plugin) share the file. Hub values are checked only after the
// environment is applied, so a placeholder the environment overrides cannot invalidate the result.
const File = Schema.Struct({
  hub: Schema.optionalKey(Schema.Struct({ url: Schema.optionalKey(Schema.Unknown), token: Schema.optionalKey(Schema.Unknown) })),
})

/** `recall.json` could not be read, or its hub values are not strings. */
export class Invalid extends Schema.TaggedError<Invalid>()("PluginConfig.Invalid", { message: Schema.String }) {}

const invalid = (cause: unknown) => new Invalid({ message: cause instanceof Error ? cause.message : String(cause) })

const optional = (name: string) => Config.option(Config.String(name)).pipe(Config.map(Option.getOrUndefined))

/** The host-wide `recall.json` shared by every OpenCode process on this machine. */
export const filePath = optional("XDG_CONFIG_HOME").pipe(
  Config.map((configHome) => join(configHome ?? join(homedir(), ".config"), "opencode", "recall.json")),
)

/**
 * Resolve the hub address and token: `OPENCODE_RECALL_HUB_URL` and `OPENCODE_RECALL_TOKEN`, read
 * through the current `ConfigProvider`, win over `hub.url` and `hub.token` in the file at `path`.
 * `None` while either is missing or empty.
 */
export const load = Effect.fn("PluginConfig.load")(function* (path: string) {
  const file = Bun.file(path)
  const json = (yield* Effect.tryPromise({ try: () => file.exists(), catch: invalid }))
    ? yield* Effect.tryPromise({ try: () => file.json(), catch: invalid })
    : {}
  const { hub } = yield* Schema.decodeUnknownEffect(File)(json).pipe(Effect.mapError(invalid))
  const env = yield* Config.all({ url: optional("OPENCODE_RECALL_HUB_URL"), token: optional("OPENCODE_RECALL_TOKEN") }).pipe(
    Effect.mapError(invalid),
  )
  const url = env.url || hub?.url
  const token = env.token || hub?.token
  if (!url || !token) return Option.none<Hub>()
  return Option.some(yield* Schema.decodeUnknownEffect(Hub)({ url, token }).pipe(Effect.mapError(invalid)))
})

export interface Interface {
  /** Read fresh on every run, so an edited file takes effect without restarting OpenCode. */
  readonly hub: Effect.Effect<Option.Option<Hub>, Invalid>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-recall/plugin/PluginConfig") {}

export const layer = (path: string) => Layer.succeed(Service, Service.of({ hub: load(path) }))

export * as PluginConfig from "./config.ts"
