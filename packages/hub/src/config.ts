import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { DEFAULT_CHUNKING } from "./archive/chunks.ts"
import { BGE_SMALL, ModelChoice } from "./embedder.ts"
import { LogLevel } from "./log.ts"

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

/** How held sessions are cut into chunks; part of the vector space's recipe. */
const Chunking = Schema.Struct({
  chunkChars: PositiveInt,
  chunkOverlap: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  turnChars: PositiveInt,
}).check(
  Schema.makeFilter((c) =>
    c.chunkOverlap < c.chunkChars ? undefined : { path: ["chunkOverlap"], issue: "must be less than chunkChars" },
  ),
)

export const Settings = Schema.Struct({
  dataDir: Schema.String.check(Schema.isNonEmpty()),
  listen: Schema.String.check(Schema.isPattern(/^.+:\d+$/, { message: "expected host:port" })),
  logLevel: LogLevel,
  /** The model this hub embeds with. Changing it (or `chunking`) takes effect through `reindex`. */
  embedding: ModelChoice,
  chunking: Chunking,
})
export interface Settings extends Schema.Schema.Type<typeof Settings> {}

/** The JSON file: any subset of the settings, and nothing else. Values are checked after merging. */
const FileSettings = Schema.Struct({
  dataDir: Schema.optionalKey(Schema.String),
  listen: Schema.optionalKey(Schema.String),
  logLevel: Schema.optionalKey(Schema.String),
  embedding: Schema.optionalKey(
    Schema.Struct({
      model: Schema.optionalKey(Schema.String),
      revision: Schema.optionalKey(Schema.String),
      dtype: Schema.optionalKey(Schema.String),
      dims: Schema.optionalKey(Schema.Number),
      queryPrefix: Schema.optionalKey(Schema.String),
    }),
  ),
  chunking: Schema.optionalKey(
    Schema.Struct({
      chunkChars: Schema.optionalKey(Schema.Number),
      chunkOverlap: Schema.optionalKey(Schema.Number),
      turnChars: Schema.optionalKey(Schema.Number),
    }),
  ),
})

export const DEFAULTS: Settings = {
  dataDir: "./data",
  listen: "127.0.0.1:7438",
  logLevel: "info",
  embedding: BGE_SMALL,
  chunking: DEFAULT_CHUNKING,
}

export class Invalid extends Schema.TaggedError<Invalid>()("HubConfig.Invalid", { message: Schema.String }) {}

const invalid = (cause: { readonly message: string }) => new Invalid({ message: cause.message })

const fromEnv = (name: string) => Config.option(Config.String(name)).pipe(Config.map(Option.getOrUndefined))
const intFromEnv = (name: string) => Config.option(Config.Int(name)).pipe(Config.map(Option.getOrUndefined))

const defined = (values: object) => Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined))

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
    embedding: Config.all({
      model: fromEnv("OPENCODE_RECALL_EMBEDDING_MODEL"),
      revision: fromEnv("OPENCODE_RECALL_EMBEDDING_REVISION"),
      dtype: fromEnv("OPENCODE_RECALL_EMBEDDING_DTYPE"),
      dims: intFromEnv("OPENCODE_RECALL_EMBEDDING_DIMS"),
      queryPrefix: fromEnv("OPENCODE_RECALL_EMBEDDING_QUERY_PREFIX"),
    }),
    chunking: Config.all({
      chunkChars: intFromEnv("OPENCODE_RECALL_CHUNK_CHARS"),
      chunkOverlap: intFromEnv("OPENCODE_RECALL_CHUNK_OVERLAP"),
      turnChars: intFromEnv("OPENCODE_RECALL_TURN_CHARS"),
    }),
  }).pipe(Effect.mapError(invalid))
  const { file: path, embedding, chunking, ...overrides } = env
  const file: typeof FileSettings.Type =
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
  return yield* Schema.decodeUnknownEffect(Settings)({
    ...DEFAULTS,
    ...file,
    ...defined(overrides),
    embedding: { ...DEFAULTS.embedding, ...file.embedding, ...defined(embedding) },
    chunking: { ...DEFAULTS.chunking, ...file.chunking, ...defined(chunking) },
  }).pipe(Effect.mapError(invalid))
})

export class Service extends Context.Service<Service, Settings>()("@opencode-recall/hub/HubConfig") {}

export const layer = Layer.effect(Service, load)

export * as HubConfig from "./config.ts"
