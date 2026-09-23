import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { LogLevel } from "./log.ts"

const fields = {
  dataDir: Schema.String.check(Schema.isNonEmpty()),
  listen: Schema.String.check(Schema.isPattern(/^.+:\d+$/, { message: "expected host:port" })),
  logLevel: LogLevel,
}

export const Settings = Schema.Struct(fields)
export interface Settings extends Schema.Schema.Type<typeof Settings> {}

/** The JSON file: any subset of the settings, and nothing else. Values are checked after merging. */
const FileSettings = Schema.Struct({
  dataDir: Schema.optionalKey(Schema.String),
  listen: Schema.optionalKey(Schema.String),
  logLevel: Schema.optionalKey(Schema.String),
})

const DEFAULTS: Settings = { dataDir: "./data", listen: "127.0.0.1:7438", logLevel: "info" }

export class Invalid extends Schema.TaggedError<Invalid>()("HubConfig.Invalid", { message: Schema.String }) {}

const invalid = (cause: { readonly message: string }) => new Invalid({ message: cause.message })

const fromEnv = (name: string) => Config.option(Config.String(name)).pipe(Config.map(Option.getOrUndefined))

/**
 * Resolve hub configuration: defaults, then the optional JSON file named by
 * `OPENCODE_RECALL_CONFIG`, then `OPENCODE_RECALL_*` variables, which win. Variables are read
 * through the current `ConfigProvider`; an empty one counts as unset.
 */
export const load: Effect.Effect<Settings, Invalid> = Effect.gen(function* () {
  const env = yield* Config.all({
    file: fromEnv("OPENCODE_RECALL_CONFIG"),
    dataDir: fromEnv("OPENCODE_RECALL_DATA_DIR"),
    listen: fromEnv("OPENCODE_RECALL_LISTEN"),
    logLevel: fromEnv("OPENCODE_RECALL_LOG_LEVEL"),
  }).pipe(Effect.mapError(invalid))
  const { file: path, ...overrides } = env
  const file =
    path === undefined
      ? {}
      : yield* Effect.tryPromise({
          try: () => Bun.file(path).json(),
          catch: (cause) => new Invalid({ message: `${path}: ${cause instanceof Error ? cause.message : String(cause)}` }),
        }).pipe(
          Effect.flatMap((json) =>
            Schema.decodeUnknownEffect(FileSettings)(json, { onExcessProperty: "error" }).pipe(Effect.mapError(invalid)),
          ),
        )
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined))
  return yield* Schema.decodeUnknownEffect(Settings)({ ...DEFAULTS, ...file, ...defined }).pipe(Effect.mapError(invalid))
})

export class Service extends Context.Service<Service, Settings>()("@opencode-recall/hub/HubConfig") {}

export const layer = Layer.effect(Service, load)

export * as HubConfig from "./config.ts"
