import { homedir } from "node:os"
import { join } from "node:path"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"

export const Hub = Schema.Struct({ url: Schema.String, token: Schema.String })
export interface Hub extends Schema.Schema.Type<typeof Hub> {}

const NonEmptyString = Schema.String.check(Schema.isNonEmpty())

/** The model `recall_summarize` generates with when a call names none, as OpenCode refers to it. */
export const SummaryModel = Schema.Struct({
  providerID: NonEmptyString,
  modelID: NonEmptyString,
  variant: Schema.optionalKey(NonEmptyString),
})
export interface SummaryModel extends Schema.Schema.Type<typeof SummaryModel> {}

/** Today's plugin's default: a cheap model at low reasoning. */
export const DEFAULT_SUMMARY_MODEL: SummaryModel = { providerID: "openai", modelID: "gpt-5.6-luna", variant: "low" }

// Other sections (`index`, from today's plugin) share the file. Hub values are checked only after the
// environment is applied, so a placeholder the environment overrides cannot invalidate the result.
const File = Schema.Struct({
  hub: Schema.optionalKey(Schema.Struct({ url: Schema.optionalKey(Schema.Unknown), token: Schema.optionalKey(Schema.Unknown) })),
  summary: Schema.optionalKey(Schema.Struct({ model: Schema.optionalKey(Schema.Unknown) })),
})

/** `recall.json` could not be read, or its hub values or summary model are malformed. */
export class Invalid extends Schema.TaggedError<Invalid>()("PluginConfig.Invalid", { message: Schema.String }) {}

const invalid = (cause: unknown) => new Invalid({ message: cause instanceof Error ? cause.message : String(cause) })

const optional = (name: string) => Config.option(Config.String(name)).pipe(Config.map(Option.getOrUndefined))

/** The host-wide `recall.json` shared by every OpenCode process on this machine. */
export const filePath = optional("XDG_CONFIG_HOME").pipe(
  Config.map((configHome) => join(configHome ?? join(homedir(), ".config"), "opencode", "recall.json")),
)

const readFile = Effect.fnUntraced(function* (path: string) {
  const file = Bun.file(path)
  const json = (yield* Effect.tryPromise({ try: () => file.exists(), catch: invalid }))
    ? yield* Effect.tryPromise({ try: () => file.json(), catch: invalid })
    : {}
  return yield* Schema.decodeUnknownEffect(File)(json).pipe(Effect.mapError(invalid))
})

/**
 * Resolve the hub address and token: `OPENCODE_RECALL_HUB_URL` and `OPENCODE_RECALL_TOKEN`, read
 * through the current `ConfigProvider`, win over `hub.url` and `hub.token` in the file at `path`.
 * `None` while either is missing or empty.
 */
export const load = Effect.fn("PluginConfig.load")(function* (path: string) {
  const { hub } = yield* readFile(path)
  const env = yield* Config.all({ url: optional("OPENCODE_RECALL_HUB_URL"), token: optional("OPENCODE_RECALL_TOKEN") }).pipe(
    Effect.mapError(invalid),
  )
  const url = env.url || hub?.url
  const token = env.token || hub?.token
  if (!url || !token) return Option.none<Hub>()
  return Option.some(yield* Schema.decodeUnknownEffect(Hub)({ url, token }).pipe(Effect.mapError(invalid)))
})

/** Today's plugin's variant names, so a trailing one is not read as part of a slash-containing model id. */
const VARIANTS = ["minimal", "none", "low", "medium", "high", "xhigh", "max", "thinking", "default"]

/** `provider/model` or `provider/model/variant`; a model id may itself contain slashes. */
function parseModelSpec(spec: string): SummaryModel | undefined {
  const [providerID, ...rest] = spec.split("/").filter(Boolean)
  if (!providerID || !rest.length) return undefined
  const variant = rest.length > 1 ? rest.at(-1)! : ""
  if (VARIANTS.includes(variant)) return { providerID, modelID: rest.slice(0, -1).join("/"), variant }
  return { providerID, modelID: rest.join("/") }
}

/**
 * Resolve the default summary model: `OPENCODE_RECALL_SUMMARY_MODEL` as `provider/model[/variant]`
 * wins over `summary.model` in the file at `path`, and {@link DEFAULT_SUMMARY_MODEL} applies when
 * neither is set.
 */
export const loadSummaryModel = Effect.fn("PluginConfig.loadSummaryModel")(function* (path: string) {
  const env = yield* optional("OPENCODE_RECALL_SUMMARY_MODEL").pipe(Effect.mapError(invalid))
  if (env) {
    const parsed = parseModelSpec(env)
    if (!parsed) return yield* invalid(`OPENCODE_RECALL_SUMMARY_MODEL=${env} is not provider/model[/variant]`)
    return parsed
  }
  const { summary } = yield* readFile(path)
  if (summary?.model === undefined) return DEFAULT_SUMMARY_MODEL
  return yield* Schema.decodeUnknownEffect(SummaryModel)(summary.model).pipe(Effect.mapError(invalid))
})

export interface Interface {
  /** Read fresh on every run, so an edited file takes effect without restarting OpenCode. */
  readonly hub: Effect.Effect<Option.Option<Hub>, Invalid>
  /** Read fresh on every run, as `hub` is. */
  readonly summaryModel: Effect.Effect<SummaryModel, Invalid>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-recall/plugin/PluginConfig") {}

export const layer = (path: string) =>
  Layer.succeed(Service, Service.of({ hub: load(path), summaryModel: loadSummaryModel(path) }))

export * as PluginConfig from "./config.ts"
