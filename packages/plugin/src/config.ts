import { homedir } from "node:os"
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path"
import { normalizeFingerprint } from "@opencode-recall/protocol"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"

export const Hub = Schema.Struct({ url: Schema.String, token: Schema.String, certSha256: Schema.optionalKey(Schema.String) })
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
  hub: Schema.optionalKey(
    Schema.Struct({
      url: Schema.optionalKey(Schema.Unknown),
      token: Schema.optionalKey(Schema.Unknown),
      certSha256: Schema.optionalKey(Schema.Unknown),
    }),
  ),
  summary: Schema.optionalKey(Schema.Struct({ model: Schema.optionalKey(Schema.Unknown) })),
  index: Schema.optionalKey(Schema.Struct({ excludeDirectories: Schema.optionalKey(Schema.Unknown) })),
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
 * Resolve the hub address, token, and certificate pin: `OPENCODE_RECALL_HUB_URL`,
 * `OPENCODE_RECALL_TOKEN`, and `OPENCODE_RECALL_HUB_CERT_SHA256`, read through the current
 * `ConfigProvider`, win over `hub.url`, `hub.token`, and `hub.certSha256` in the file at `path`.
 * `None` while the address or token is missing or empty. A pin that is not a SHA-256 fingerprint,
 * or one set for an `http` address, is invalid rather than ignored, since ignoring it would send the
 * token without the protection it asked for.
 */
const resolve = Effect.fnUntraced(function* (path: string) {
  const { hub } = yield* readFile(path)
  const env = yield* Config.all({
    url: optional("OPENCODE_RECALL_HUB_URL"),
    token: optional("OPENCODE_RECALL_TOKEN"),
    certSha256: optional("OPENCODE_RECALL_HUB_CERT_SHA256"),
  }).pipe(Effect.mapError(invalid))
  const url = env.url || hub?.url
  const token = env.token || hub?.token
  const pin = env.certSha256 || hub?.certSha256
  const from = (variable: string, fromEnv: string | undefined, fromFile: unknown) => (fromEnv ? variable : fromFile ? path : "not set")
  const source = `hub.url: ${from("OPENCODE_RECALL_HUB_URL", env.url, hub?.url)}; hub.token: ${from("OPENCODE_RECALL_TOKEN", env.token, hub?.token)}`
  if (!url || !token) return { hub: Option.none<Hub>(), source }
  const decoded = yield* Schema.decodeUnknownEffect(Hub)({ url, token, ...(pin !== undefined && { certSha256: pin }) }).pipe(
    Effect.mapError(invalid),
  )
  if (decoded.certSha256 === undefined) return { hub: Option.some(decoded), source }
  const certSha256 = normalizeFingerprint(decoded.certSha256)
  if (!certSha256) return yield* invalid(`hub.certSha256 ${JSON.stringify(decoded.certSha256)} is not a SHA-256 fingerprint`)
  if (!decoded.url.startsWith("https://")) return yield* invalid(`hub.certSha256 is set, but hub.url ${decoded.url} is not https`)
  return {
    hub: Option.some({ ...decoded, certSha256 }),
    source: `${source}; hub.certSha256: ${from("OPENCODE_RECALL_HUB_CERT_SHA256", env.certSha256, hub?.certSha256)}`,
  }
})

export const load = Effect.fn("PluginConfig.load")(function* (path: string) {
  return (yield* resolve(path)).hub
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

const expandRoot = (entry: string, home: string): string | undefined => {
  const trimmed = entry.trim()
  if (trimmed === "~") return home
  if (trimmed.startsWith(`~${sep}`)) return resolvePath(home, trimmed.slice(2))
  return isAbsolute(trimmed) ? resolvePath(trimmed) : undefined
}

/**
 * Resolve `index.excludeDirectories` in the file at `path` to absolute roots, expanding a leading
 * `~` to `home`. The file is the only source: every OpenCode process on the host reads it, so
 * which process uploads a session cannot change whether it is excluded. An entry that is not an
 * absolute or `~/` path fails the whole list rather than being skipped, since skipping it would
 * upload what it was meant to keep on the host.
 */
export const loadExcludeDirectories = Effect.fn("PluginConfig.loadExcludeDirectories")(function* (
  path: string,
  home: string = homedir(),
) {
  const { index } = yield* readFile(path)
  if (index?.excludeDirectories === undefined) return []
  const entries = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.String))(index.excludeDirectories).pipe(
    Effect.mapError((e) => invalid(`index.excludeDirectories: ${e.message}`)),
  )
  const roots = new Set<string>()
  for (const entry of entries) {
    const root = expandRoot(entry, home)
    if (root === undefined)
      return yield* invalid(`index.excludeDirectories entry ${JSON.stringify(entry)} is not an absolute or ~/ path`)
    roots.add(root)
  }
  return [...roots]
})

/** Whether `directory` is one of `roots` or inside one; a sibling sharing a prefix is not. */
export const isExcluded = (roots: readonly string[], directory: string) =>
  roots.some((root) => {
    const inner = relative(root, resolvePath(directory))
    return inner === "" || (inner !== ".." && !inner.startsWith(`..${sep}`) && !isAbsolute(inner))
  })

export interface Interface {
  /** The host-wide config file, for `recall_status`. */
  readonly file: string
  /** Read fresh on every run, so an edited file takes effect without restarting OpenCode. */
  readonly hub: Effect.Effect<Option.Option<Hub>, Invalid>
  /** Where the hub URL and token currently come from, for `recall_status`. Read fresh, as `hub` is. */
  readonly hubSource: Effect.Effect<string, Invalid>
  /** Read fresh on every run, as `hub` is. */
  readonly summaryModel: Effect.Effect<SummaryModel, Invalid>
  /** The resolved `index.excludeDirectories` roots, read fresh on every run; see {@link loadExcludeDirectories}. */
  readonly excludeDirectories: Effect.Effect<readonly string[], Invalid>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-recall/plugin/PluginConfig") {}

export const layer = (path: string) =>
  Layer.succeed(
    Service,
    Service.of({
      file: path,
      hub: load(path),
      hubSource: Effect.map(resolve(path), (r) => r.source),
      summaryModel: loadSummaryModel(path),
      excludeDirectories: loadExcludeDirectories(path),
    }),
  )

export * as PluginConfig from "./config.ts"
