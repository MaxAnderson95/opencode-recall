// @bun
// packages/plugin/src/index.ts
import { homedir as homedir3 } from "os";
import { join as join2 } from "path";
import { Plugin } from "@opencode/plugin";
import { Config as Config2, Effect as Effect12, Layer as Layer5, Logger, ManagedRuntime, Option as Option7, Stream } from "effect";

// packages/plugin/src/config.ts
import { homedir } from "os";
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "path";

// packages/protocol/src/index.ts
import { isIP } from "net";
import { connect } from "tls";
import { Effect, Option, Schema } from "effect";
var PROTOCOL_VERSION = 5;
var Int = Schema.Int;
var NonNegativeInt = Int.check(Schema.isGreaterThanOrEqualTo(0));
var NonEmptyString = Schema.String.check(Schema.isNonEmpty());
var Part = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["text", "reasoning"]), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("tool"),
    tool: Schema.String,
    title: Schema.String,
    status: NonEmptyString,
    error: Schema.optionalKey(Schema.String),
    text: Schema.String,
    searchable: Schema.Boolean
  })
]);
var MessageType = Schema.Literals(["user", "synthetic", "assistant", "compaction", "shell", "skill"]);
var Message = Schema.Struct({
  id: NonEmptyString,
  type: MessageType,
  timeCreated: Int,
  parts: Schema.Array(Part)
});
var Session = Schema.Struct({
  id: NonEmptyString,
  slug: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  timeCreated: Int,
  timeUpdated: Int,
  messages: Schema.Array(Message)
});
var Snapshot = Schema.Struct({
  session: Session,
  revision: NonNegativeInt,
  lastActivity: Int,
  contentHash: NonEmptyString,
  extractorVersion: Int.check(Schema.isGreaterThan(0))
});
var Tombstone = Schema.Struct({
  sessionId: NonEmptyString,
  revision: NonNegativeInt,
  timeDeleted: Int,
  reason: Schema.Literals(["deleted", "excluded"])
});
var Search = Schema.Struct({
  query: Schema.String,
  mode: Schema.optionalKey(Schema.Literals(["hybrid", "lexical", "semantic"])),
  scope: Schema.optionalKey(Schema.Literals(["all", "user-messages"])),
  since: Schema.optionalKey(Int),
  until: Schema.optionalKey(Int),
  directory: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  includeTools: Schema.optionalKey(Schema.Boolean),
  limit: Int.check(Schema.isBetween({ minimum: 1, maximum: 25 })),
  exclude: Schema.optionalKey(Schema.Struct({ sessionId: NonEmptyString, before: Int }))
});
var SessionRef = NonEmptyString;
var Inspect = Schema.Struct({
  session: SessionRef,
  query: Schema.optionalKey(Schema.String),
  mode: Search.fields.mode,
  scope: Search.fields.scope,
  includeTools: Search.fields.includeTools,
  limit: Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })),
  exclude: Search.fields.exclude
});
var Expand = Schema.Struct({
  session: SessionRef,
  messageId: Schema.optionalKey(Schema.String),
  window: Int.check(Schema.isBetween({ minimum: 2, maximum: 60 })),
  maxChars: Int.check(Schema.isBetween({ minimum: 100, maximum: 4000 }))
});
var Transcript = Schema.Struct({
  session: SessionRef,
  budget: Int.check(Schema.isBetween({ minimum: 1000, maximum: 1e6 })),
  maxChars: Int.check(Schema.isBetween({ minimum: 100, maximum: 4000 }))
});
var summaryKeyFields = {
  provider: NonEmptyString,
  model: NonEmptyString,
  variant: Schema.optionalKey(NonEmptyString),
  focus: Schema.String,
  recipe: Int.check(Schema.isGreaterThan(0))
};
var SummaryGet = Schema.Struct({ session: SessionRef, ...summaryKeyFields });
var SummaryPut = Schema.Struct({
  sessionId: NonEmptyString,
  contentHash: NonEmptyString,
  ...summaryKeyFields,
  summary: NonEmptyString,
  omitted: NonNegativeInt,
  clipped: NonNegativeInt
});
var version = { protocolVersion: Schema.Literal(PROTOCOL_VERSION) };
var requests = {
  snapshot: Schema.Struct({ ...version, ...Snapshot.fields }),
  tombstone: Schema.Struct({ ...version, ...Tombstone.fields }),
  manifest: Schema.Struct(version),
  search: Schema.Struct({ ...version, ...Search.fields }),
  inspect: Schema.Struct({ ...version, ...Inspect.fields }),
  expand: Schema.Struct({ ...version, ...Expand.fields }),
  transcript: Schema.Struct({ ...version, ...Transcript.fields }),
  "summary.get": Schema.Struct({ ...version, ...SummaryGet.fields }),
  "summary.put": Schema.Struct({ ...version, ...SummaryPut.fields }),
  status: Schema.Struct(version)
};
var Envelope = Schema.Struct({ protocolVersion: Int });
var Position = { revision: NonNegativeInt, lastActivity: Int, contentHash: NonEmptyString, extractorVersion: Int };
var Manifest = Schema.Struct({
  sessions: Schema.Array(Schema.Struct({ sessionId: Schema.String, ...Position })),
  tombstones: Schema.Array(Schema.Struct({ sessionId: Schema.String, timeDeleted: Int, excludedByCaller: Schema.Boolean }))
});
var hitFields = {
  messageId: Schema.String,
  time: Int,
  snippet: Schema.String
};
var SearchHit = Schema.Union([
  Schema.Struct({
    ...hitFields,
    branch: Schema.Literal("lexical"),
    messageType: MessageType,
    kind: Schema.Literals(["text", "reasoning", "tool"])
  }),
  Schema.Struct({ ...hitFields, branch: Schema.Literal("semantic"), score: Schema.Number })
]);
var archivedFields = {
  sessionId: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  timeUpdated: Int,
  source: Schema.String,
  ownSource: Schema.Boolean,
  revision: Int
};
var resolvedFields = {
  session: Schema.Struct({ ...archivedFields, timeCreated: Int }),
  sameSlug: Schema.Array(Schema.Struct({ sessionId: Schema.String, title: Schema.String, timeUpdated: Int }))
};
var Missing = Schema.Struct({ kind: Schema.Literal("missing") });
var WindowMessage = Schema.Struct({
  messageId: Schema.String,
  type: MessageType,
  time: Int,
  text: Schema.String,
  tools: Schema.Array(Schema.Struct({ tool: Schema.String, title: Schema.String, status: Schema.String, error: Schema.optionalKey(Schema.String) }))
});
var SearchResult = Schema.Struct({
  ...archivedFields,
  lexicalMatches: Int,
  semanticMatches: Int,
  hits: Schema.Array(SearchHit)
});
var SpaceRecipe = Schema.Struct({
  model: Schema.String,
  revision: Schema.String,
  dtype: Schema.String,
  dims: Int,
  runtime: Schema.String,
  pooling: Schema.Literal("mean"),
  normalize: Schema.Boolean,
  queryPrefix: Schema.String,
  chunkChars: Int,
  chunkOverlap: Int,
  turnChars: Int,
  rendering: Int
});
var Divergence = Schema.Struct({
  sessionId: Schema.String,
  title: Schema.String,
  heldFrom: Schema.String,
  refusedFrom: Schema.String,
  timeFirst: Int,
  timeLast: Int
});
var Rewind = Schema.Struct({
  sessionId: Schema.String,
  source: Schema.String,
  fromRevision: Int,
  toRevision: Int,
  time: Int
});
var responses = {
  snapshot: Schema.Struct({ outcome: Schema.Literals(["archived", "rewound", "unchanged"]) }),
  tombstone: Schema.Struct({ removed: Schema.Boolean }),
  manifest: Manifest,
  search: Schema.Struct({ sessions: Schema.Array(SearchResult), semanticUnavailable: Schema.optionalKey(Schema.String) }),
  inspect: Schema.Union([
    Missing,
    Schema.Struct({
      kind: Schema.Literal("outline"),
      ...resolvedFields,
      messages: Int,
      turns: Schema.Array(Schema.Struct({ messageId: Schema.String, time: Int, text: Schema.String }))
    }),
    Schema.Struct({
      kind: Schema.Literal("matches"),
      ...resolvedFields,
      total: Int,
      hits: Schema.Array(SearchHit),
      semanticUnavailable: Schema.optionalKey(Schema.String)
    })
  ]),
  expand: Schema.Union([
    Missing,
    Schema.Struct({
      kind: Schema.Literal("window"),
      ...resolvedFields,
      total: Int,
      start: Int,
      messages: Schema.Array(WindowMessage)
    })
  ]),
  transcript: Schema.Union([
    Missing,
    Schema.Struct({
      kind: Schema.Literal("transcript"),
      ...resolvedFields,
      contentHash: Schema.String,
      messages: Int,
      omitted: Int,
      clipped: Int,
      text: Schema.String
    })
  ]),
  "summary.get": Schema.Union([
    Missing,
    Schema.Struct({ kind: Schema.Literal("absent"), ...resolvedFields }),
    Schema.Struct({
      kind: Schema.Literal("cached"),
      ...resolvedFields,
      summary: Schema.String,
      timeCreated: Int,
      omitted: Int,
      clipped: Int
    })
  ]),
  "summary.put": Schema.Struct({}),
  status: Schema.Struct({
    sessions: Int,
    chunks: Int,
    embeddedChunks: Int,
    activeSpace: Schema.Struct({ recipe: SpaceRecipe, matchesConfigured: Schema.Boolean }),
    sources: Schema.Array(Schema.Struct({ source: Schema.String, archived: Int, searchable: Int, embedded: Int })),
    summaries: Int,
    divergences: Schema.Array(Divergence),
    rewinds: Schema.Struct({ total: Int, recent: Schema.Array(Rewind) })
  })
};
var utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")}Z`;
var divergenceRemedy = (d) => `rename the session on ${d.heldFrom} to keep the archived copy, or on ${d.refusedFrom} to archive ${d.refusedFrom}'s copy instead. ` + "The rename makes that host's next upload later than the held position, so it is accepted and the divergence clears; turns only the other copy holds stay out of the archive.";
function renderHubStatus(s) {
  const { recipe, matchesConfigured } = s.activeSpace;
  const lines = [
    `sessions archived: ${s.sessions}`,
    ...s.sources.map((c) => `  from ${c.source || "(no source)"}: ${c.archived} archived, ${c.searchable} searchable, ${c.embedded} embedded`),
    `chunks: ${s.chunks}, ${s.embeddedChunks} embedded, ${s.chunks - s.embeddedChunks} waiting to be embedded`,
    `vector space: ${recipe.model}@${recipe.revision.slice(0, 12)} (${recipe.dtype}, ${recipe.dims}d, rendering v${recipe.rendering})${matchesConfigured ? "" : "; differs from this hub's configured space, run reindex"}`,
    `cached summaries: ${s.summaries}`,
    `rewinds accepted: ${s.rewinds.total}`,
    ...s.rewinds.recent.map((r) => `  ${r.sessionId} from ${r.source}: revision ${r.fromRevision} -> ${r.toRevision} at ${utc(r.time)}`)
  ];
  if (!s.divergences.length)
    return [...lines, "hash_divergence: none"].join(`
`);
  return [
    ...lines,
    `hash_divergence: ${s.divergences.length} session${s.divergences.length === 1 ? "" : "s"} where two hosts hold different copies`,
    ...s.divergences.flatMap((d) => [
      `  ${d.sessionId} "${d.title}": archived copy from ${d.heldFrom}; ${d.refusedFrom}'s copy refused (first ${utc(d.timeFirst)}, latest ${utc(d.timeLast)})`,
      `    remedy: ${divergenceRemedy(d)}`
    ])
  ].join(`
`);
}
var ErrorCode = Schema.Literals([
  "invalid_token",
  "protocol_version",
  "invalid_request",
  "unknown_verb",
  "stale_revision",
  "hash_divergence",
  "tombstoned",
  "payload_too_large",
  "rate_limited",
  "request_timeout",
  "internal"
]);
var CODE_BY_STATUS = {
  408: "request_timeout",
  413: "payload_too_large",
  429: "rate_limited"
};

class HubError extends Schema.TaggedError()("HubError", {
  code: ErrorCode,
  message: Schema.String,
  status: Schema.Number
}) {
}

class TransportError extends Schema.TaggedError()("TransportError", {
  message: Schema.String,
  cause: Schema.Defect()
}) {
}
var ErrorEnvelope = Schema.Struct({
  error: Schema.Struct({ code: Schema.optionalKey(ErrorCode), message: Schema.optionalKey(Schema.String) })
});
var messageOf = (cause) => cause instanceof Error ? cause.message : String(cause);
function normalizeFingerprint(fingerprint) {
  const hex = fingerprint.replace(/[\s:]/g, "").toUpperCase();
  return /^[0-9A-F]{64}$/.test(hex) ? hex.match(/../g).join(":") : undefined;
}
var mismatch = (got, pin) => new Error(`the hub's TLS certificate ${got ?? "(none)"} does not match the pinned ${pin}`);
var pinnedCertificates = new Map;
var readCertificate = (url, pin, signal) => new Promise((resolve, reject) => {
  const socket = connect({
    host: url.hostname,
    port: Number(url.port || 443),
    servername: isIP(url.hostname) ? undefined : url.hostname,
    rejectUnauthorized: false
  }, () => {
    const cert = socket.getPeerCertificate();
    socket.end();
    if (cert.fingerprint256 !== pin)
      return reject(mismatch(cert.fingerprint256, pin));
    resolve(`-----BEGIN CERTIFICATE-----
${cert.raw.toString("base64").replace(/.{64}/g, `$&
`)}
-----END CERTIFICATE-----
`);
  });
  socket.once("error", reject);
  socket.setTimeout(1e4, () => socket.destroy(new Error("TLS handshake with the hub timed out")));
  signal.addEventListener("abort", () => socket.destroy(new Error("aborted")), { once: true });
});
var pinnedTls = async (url, pin, signal) => {
  let pem = pinnedCertificates.get(pin);
  if (!pem) {
    pem = readCertificate(url, pin, signal);
    pinnedCertificates.set(pin, pem);
    pem.catch(() => pinnedCertificates.delete(pin));
  }
  return {
    ca: await pem,
    checkServerIdentity: (_host, cert) => cert.fingerprint256 === pin ? undefined : mismatch(cert.fingerprint256, pin)
  };
};
function makeClient({ url, token, certSha256, fetch: fetcher = fetch }) {
  const base = url.replace(/\/+$/, "");
  const parsed = new URL(base);
  const pin = parsed.protocol === "https:" ? certSha256 : undefined;
  const call = Effect.fnUntraced(function* (verb, input) {
    const transport = (cause) => new TransportError({ message: messageOf(cause), cause });
    const res = yield* Effect.tryPromise({
      try: async (signal) => fetcher(`${base}/v1/${verb}`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "gzip", authorization: `Bearer ${token}` },
        body: Bun.gzipSync(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...input })),
        signal,
        ...pin && { tls: await pinnedTls(parsed, pin, signal) }
      }),
      catch: transport
    });
    if (res.ok) {
      const body = yield* Effect.tryPromise({ try: () => res.json(), catch: transport });
      const decoded = yield* Schema.decodeUnknownEffect(responses[verb])(body).pipe(Effect.mapError(transport));
      return decoded;
    }
    const body = yield* Effect.promise(() => res.json().catch(() => null));
    const { error } = Option.getOrElse(Schema.decodeUnknownOption(ErrorEnvelope)(body), () => ({ error: {} }));
    return yield* new HubError({
      code: error.code ?? CODE_BY_STATUS[res.status] ?? "internal",
      message: error.message ?? `HTTP ${res.status}`,
      status: res.status
    });
  });
  return {
    snapshot: (snapshot) => call("snapshot", snapshot),
    tombstone: (tombstone) => call("tombstone", tombstone),
    manifest: () => call("manifest", {}),
    search: (search) => call("search", search),
    inspect: (inspect) => call("inspect", inspect),
    expand: (expand) => call("expand", expand),
    transcript: (transcript) => call("transcript", transcript),
    summaryGet: (key) => call("summary.get", key),
    summaryPut: (summary) => call("summary.put", summary),
    status: () => call("status", {})
  };
}

// packages/plugin/src/config.ts
import { Config, Context, Effect as Effect2, Layer, Option as Option2, Schema as Schema2 } from "effect";
var Hub = Schema2.Struct({ url: Schema2.String, token: Schema2.String, certSha256: Schema2.optionalKey(Schema2.String) });
var NonEmptyString2 = Schema2.String.check(Schema2.isNonEmpty());
var SummaryModel = Schema2.Struct({
  providerID: NonEmptyString2,
  modelID: NonEmptyString2,
  variant: Schema2.optionalKey(NonEmptyString2)
});
var DEFAULT_SUMMARY_MODEL = { providerID: "openai", modelID: "gpt-5.6-luna", variant: "low" };
var File = Schema2.Struct({
  hub: Schema2.optionalKey(Schema2.Struct({
    url: Schema2.optionalKey(Schema2.Unknown),
    token: Schema2.optionalKey(Schema2.Unknown),
    certSha256: Schema2.optionalKey(Schema2.Unknown)
  })),
  summary: Schema2.optionalKey(Schema2.Struct({ model: Schema2.optionalKey(Schema2.Unknown) })),
  index: Schema2.optionalKey(Schema2.Struct({ excludeDirectories: Schema2.optionalKey(Schema2.Unknown) }))
});

class Invalid extends Schema2.TaggedError()("PluginConfig.Invalid", { message: Schema2.String }) {
}
var invalid = (cause) => new Invalid({ message: cause instanceof Error ? cause.message : String(cause) });
var optional = (name) => Config.option(Config.String(name)).pipe(Config.map(Option2.getOrUndefined));
var filePath = optional("XDG_CONFIG_HOME").pipe(Config.map((configHome) => join(configHome ?? join(homedir(), ".config"), "opencode", "recall.json")));
var readFile = Effect2.fnUntraced(function* (path) {
  const file = Bun.file(path);
  const json = (yield* Effect2.tryPromise({ try: () => file.exists(), catch: invalid })) ? yield* Effect2.tryPromise({ try: () => file.json(), catch: invalid }) : {};
  return yield* Schema2.decodeUnknownEffect(File)(json).pipe(Effect2.mapError(invalid));
});
var resolve = Effect2.fnUntraced(function* (path) {
  const { hub } = yield* readFile(path);
  const env = yield* Config.all({
    url: optional("OPENCODE_RECALL_HUB_URL"),
    token: optional("OPENCODE_RECALL_TOKEN"),
    certSha256: optional("OPENCODE_RECALL_HUB_CERT_SHA256")
  }).pipe(Effect2.mapError(invalid));
  const url = env.url || hub?.url;
  const token = env.token || hub?.token;
  const pin = env.certSha256 || hub?.certSha256;
  const from = (variable, fromEnv, fromFile) => fromEnv ? variable : fromFile ? path : "not set";
  const source = `hub.url: ${from("OPENCODE_RECALL_HUB_URL", env.url, hub?.url)}; hub.token: ${from("OPENCODE_RECALL_TOKEN", env.token, hub?.token)}`;
  if (!url || !token)
    return { hub: Option2.none(), source };
  const decoded = yield* Schema2.decodeUnknownEffect(Hub)({ url, token, ...pin !== undefined && { certSha256: pin } }).pipe(Effect2.mapError(invalid));
  if (decoded.certSha256 === undefined)
    return { hub: Option2.some(decoded), source };
  const certSha256 = normalizeFingerprint(decoded.certSha256);
  if (!certSha256)
    return yield* invalid(`hub.certSha256 ${JSON.stringify(decoded.certSha256)} is not a SHA-256 fingerprint`);
  if (!decoded.url.startsWith("https://"))
    return yield* invalid(`hub.certSha256 is set, but hub.url ${decoded.url} is not https`);
  return {
    hub: Option2.some({ ...decoded, certSha256 }),
    source: `${source}; hub.certSha256: ${from("OPENCODE_RECALL_HUB_CERT_SHA256", env.certSha256, hub?.certSha256)}`
  };
});
var load = Effect2.fn("PluginConfig.load")(function* (path) {
  return (yield* resolve(path)).hub;
});
var VARIANTS = ["minimal", "none", "low", "medium", "high", "xhigh", "max", "thinking", "default"];
function parseModelSpec(spec) {
  const [providerID, ...rest] = spec.split("/").filter(Boolean);
  if (!providerID || !rest.length)
    return;
  const variant = rest.length > 1 ? rest.at(-1) : "";
  if (VARIANTS.includes(variant))
    return { providerID, modelID: rest.slice(0, -1).join("/"), variant };
  return { providerID, modelID: rest.join("/") };
}
var loadSummaryModel = Effect2.fn("PluginConfig.loadSummaryModel")(function* (path) {
  const env = yield* optional("OPENCODE_RECALL_SUMMARY_MODEL").pipe(Effect2.mapError(invalid));
  if (env) {
    const parsed = parseModelSpec(env);
    if (!parsed)
      return yield* invalid(`OPENCODE_RECALL_SUMMARY_MODEL=${env} is not provider/model[/variant]`);
    return parsed;
  }
  const { summary } = yield* readFile(path);
  if (summary?.model === undefined)
    return DEFAULT_SUMMARY_MODEL;
  return yield* Schema2.decodeUnknownEffect(SummaryModel)(summary.model).pipe(Effect2.mapError(invalid));
});
var expandRoot = (entry, home) => {
  const trimmed = entry.trim();
  if (trimmed === "~")
    return home;
  if (trimmed.startsWith(`~${sep}`))
    return resolvePath(home, trimmed.slice(2));
  return isAbsolute(trimmed) ? resolvePath(trimmed) : undefined;
};
var loadExcludeDirectories = Effect2.fn("PluginConfig.loadExcludeDirectories")(function* (path, home = homedir()) {
  const { index } = yield* readFile(path);
  if (index?.excludeDirectories === undefined)
    return [];
  const entries = yield* Schema2.decodeUnknownEffect(Schema2.Array(Schema2.String))(index.excludeDirectories).pipe(Effect2.mapError((e) => invalid(`index.excludeDirectories: ${e.message}`)));
  const roots = new Set;
  for (const entry of entries) {
    const root = expandRoot(entry, home);
    if (root === undefined)
      return yield* invalid(`index.excludeDirectories entry ${JSON.stringify(entry)} is not an absolute or ~/ path`);
    roots.add(root);
  }
  return [...roots];
});
var isExcluded = (roots, directory) => roots.some((root) => {
  const inner = relative(root, resolvePath(directory));
  return inner === "" || inner !== ".." && !inner.startsWith(`..${sep}`) && !isAbsolute(inner);
});

class Service extends Context.Service()("@opencode-recall/plugin/PluginConfig") {
}
var layer = (path) => Layer.succeed(Service, Service.of({
  file: path,
  hub: load(path),
  hubSource: Effect2.map(resolve(path), (r) => r.source),
  summaryModel: loadSummaryModel(path),
  excludeDirectories: loadExcludeDirectories(path)
}));

// packages/plugin/src/expand.ts
import { Effect as Effect4, Result, Schema as Schema4 } from "effect";

// packages/plugin/src/tools.ts
import { homedir as homedir2 } from "os";
import { Effect as Effect3, Option as Option3, Schema as Schema3 } from "effect";
class CouldNotLook extends Schema3.TaggedError()("Tools.CouldNotLook", { message: Schema3.String }) {
}
var withHub = Effect3.fnUntraced(function* (call) {
  const hub = yield* (yield* Service).hub.pipe(Effect3.mapError((e) => new CouldNotLook({ message: `recall could not look: the recall config is invalid (${e.message}). This is not an empty result.` })));
  if (Option3.isNone(hub))
    return yield* new CouldNotLook({
      message: "recall could not look: no hub is configured. Set OPENCODE_RECALL_HUB_URL and OPENCODE_RECALL_TOKEN, or hub.url and hub.token in recall.json. This is not an empty result."
    });
  return yield* call(makeClient(hub.value)).pipe(Effect3.mapError((e) => new CouldNotLook({
    message: `recall could not look: the hub request failed (${e._tag === "HubError" ? `${e.code}: ${e.message}` : e.message}). This is not an empty result.`
  })));
});
var parseWhen = (s) => {
  const ms = s ? Date.parse(s) : NaN;
  return Number.isNaN(ms) ? undefined : ms;
};
var clampInt = (v, lo, hi, dflt) => v === undefined || !Number.isFinite(v) ? dflt : Math.max(lo, Math.min(Math.round(v), hi));
var pad = (n) => String(n).padStart(2, "0");
function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
var home = homedir2();
var shortDir = (dir) => home && dir.startsWith(home) ? "~" + dir.slice(home.length) : dir;
var origin = (s) => `from ${s.source || "an unknown host"}${s.ownSource ? " (this host)" : ""}, archived revision ${s.revision}`;
function via(hit, parentId, scope) {
  if (hit.branch === "semantic")
    return `semantic ${hit.score.toFixed(2)} \xB7 ${scope === "user-messages" ? "Top-level user message" : "Conversation context (mixed origins)"}`;
  const kind = hit.kind === "tool" ? "Tool output" : hit.messageType === "user" ? parentId ? "Child user message" : "Top-level user message" : hit.messageType === "synthetic" ? "Synthetic context" : `${hit.messageType} text`;
  return `lexical/${hit.kind} \xB7 ${kind}`;
}
function header({ session: s, sameSlug }, ref, verb) {
  const note = sameSlug.length ? `NOTE: ${sameSlug.length + 1}+ sessions share slug '${ref}'; ${verb} the most recent. Others: ${sameSlug.map((o) => `${o.sessionId} (${o.title.slice(0, 40)}, ${fmtDate(o.timeUpdated)})`).join("; ")}
` : "";
  return `${note}# ${s.title || "(untitled)"}
session_id=${s.sessionId} slug=${s.slug} \xB7 ${shortDir(s.directory)} \xB7 ${fmtDate(s.timeCreated)} \u2192 ${fmtDate(s.timeUpdated)} \xB7 ${origin(s)}`;
}
var notFound = (ref) => `No archived session found for '${ref}'. A session appears once its host uploads a finished turn.`;

// packages/plugin/src/expand.ts
var Args = Schema4.Struct({
  session_id: Schema4.String,
  message_id: Schema4.optionalKey(Schema4.String),
  window: Schema4.optionalKey(Schema4.Number),
  max_chars: Schema4.optionalKey(Schema4.Number)
});
var INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["session_id"],
  properties: {
    session_id: { type: "string", description: "Session id (ses_...) or slug from recall_search" },
    message_id: {
      type: "string",
      description: "Center the window on this message (msg_...); defaults to the end of the session"
    },
    window: { type: "number", description: "Number of messages to include (default 12, max 60)" },
    max_chars: { type: "number", description: "Max characters per message (default 800, max 4000)" }
  }
};
var DESCRIPTION = "Read a transcript excerpt from a past OpenCode conversation found via recall_search, from any host sharing this recall hub. Given a session_id (or slug) and optionally a message_id to center on, returns the surrounding user/assistant turns with timestamps and one-line tool-call summaries.";
var BUDGET = 20000;
function toolLine({ tool, title, status, error }) {
  const line = `[tool ${tool}] ${title}`.trimEnd();
  if (status === "completed")
    return line;
  return status === "error" ? `${line} (failed: ${error || "no error message"})` : `${line} (${status})`;
}
function block(m) {
  const tools = [];
  let last = "";
  let count = 0;
  const flush = () => {
    if (count)
      tools.push(count > 1 ? `${last} (\xD7${count})` : last);
  };
  for (const line of m.tools.map(toolLine)) {
    if (line === last)
      count++;
    else {
      flush();
      last = line;
      count = 1;
    }
  }
  flush();
  const body = [...tools, m.text].filter(Boolean).join(`
`);
  return body ? `\u2500\u2500 ${m.type} @ ${fmtDateTime(m.time)} (${m.messageId})
${body}` : null;
}
var make = Effect4.fnUntraced(function* () {
  const execute = Effect4.fn("recall_expand")(function* (input) {
    const args = Schema4.decodeUnknownResult(Args)(input);
    if (Result.isFailure(args))
      return { content: `Invalid recall_expand arguments: ${args.failure.message}` };
    const { session_id: ref, message_id: messageId } = args.success;
    const window = clampInt(args.success.window, 2, 60, 12);
    const answer = yield* withHub((hub) => hub.expand({
      session: ref,
      messageId,
      window,
      maxChars: clampInt(args.success.max_chars, 100, 4000, 800)
    }));
    if (answer.kind !== "window")
      return { content: notFound(ref) };
    if (!answer.total)
      return { content: `Session ${answer.session.sessionId} has no archived messages.` };
    const lines = [
      header(answer, ref, "showing"),
      `messages ${answer.start + 1}-${answer.start + answer.messages.length} of ${answer.total}`,
      ""
    ];
    let budget = BUDGET;
    for (const m of answer.messages) {
      const rendered = block(m);
      if (!rendered)
        continue;
      const text = `${rendered}
`;
      if (text.length > budget)
        break;
      budget -= text.length;
      lines.push(text);
    }
    lines.push(`(widen with window=${Math.min(window * 2, 60)} or center on another message_id)`);
    return { content: lines.join(`
`), metadata: { title: `recall: ${answer.session.title}` } };
  }, Effect4.catchTag("Tools.CouldNotLook", (e) => Effect4.succeed({ content: e.message })));
  const context = yield* Effect4.context();
  const info = {
    name: "recall_expand",
    description: DESCRIPTION,
    input: INPUT,
    options: { codemode: false },
    execute: (input) => Effect4.runPromiseWith(context)(execute(input))
  };
  return info;
});

// packages/plugin/src/inspect.ts
import { Effect as Effect6, Result as Result2, Schema as Schema6 } from "effect";

// packages/plugin/src/source.ts
import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { Context as Context2, Effect as Effect5, Layer as Layer2, Option as Option4, Schema as Schema5 } from "effect";

// packages/plugin/src/extract.ts
var WORKER_PREFIX = "recall-summarizer worker: ";
var TOOL_TEXT_CHARS = 16000;
var UNSEARCHABLE_TOOLS = new Set([
  "recall_search",
  "recall_expand",
  "recall_inspect",
  "recall_status",
  "recall_summarize"
]);
var ANSI_RE = /[\u001b\u009b](?:\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\[[0-9;?]*[0-9A-ORZcf-nqry=><]|[()#][0-9A-Za-z])/g;
var stripAnsi = (text) => text.replace(ANSI_RE, "");
var isObject = (value) => typeof value === "object" && value !== null;
var nonBlank = (text) => typeof text === "string" && text.trim() !== "";
function toolTitle(input, metadata) {
  if (isObject(metadata) && typeof metadata.title === "string")
    return metadata.title;
  if (!isObject(input))
    return "";
  return Object.values(input).filter((v) => typeof v === "string").join(" ").slice(0, 200);
}
function toolOutput(content) {
  if (!Array.isArray(content))
    return "";
  return content.filter((c) => isObject(c) && c.type === "text" && typeof c.text === "string").map((c) => c.text).join(`
`);
}
function toolPart(tool, title, status, output, error) {
  const body = status === "completed" ? output : error;
  const text = body === undefined ? "" : `${tool} ${title}
${stripAnsi(body)}`.slice(0, TOOL_TEXT_CHARS);
  return {
    kind: "tool",
    tool,
    title,
    status,
    ...error !== undefined && { error },
    text,
    searchable: !UNSEARCHABLE_TOOLS.has(tool) && text.trim() !== ""
  };
}
function assistantItem(item) {
  if (!isObject(item))
    return [];
  if ((item.type === "text" || item.type === "reasoning") && nonBlank(item.text))
    return [{ kind: item.type, text: item.text }];
  if (item.type !== "tool" || typeof item.name !== "string")
    return [];
  const state = isObject(item.state) ? item.state : {};
  const status = typeof state.status === "string" ? state.status : "unknown";
  const error = status === "error" && isObject(state.error) ? state.error.message : undefined;
  return [
    toolPart(item.name, toolTitle(state.input, state.metadata), status, status === "completed" ? toolOutput(state.content) : "", typeof error === "string" ? error : undefined)
  ];
}
function extractParts(type, data) {
  switch (type) {
    case "user":
    case "synthetic":
      return nonBlank(data.text) ? [{ kind: "text", text: data.text }] : [];
    case "compaction":
      return data.status === "completed" && nonBlank(data.summary) ? [{ kind: "text", text: data.summary }] : [];
    case "shell": {
      const output = isObject(data.output) ? data.output.output : undefined;
      const command = typeof data.command === "string" ? data.command : "";
      return [toolPart("shell", command, "completed", typeof output === "string" ? output : "")];
    }
    case "skill":
      return [
        toolPart("skill", typeof data.name === "string" ? data.name : "", "completed", typeof data.text === "string" ? data.text : "")
      ];
    case "assistant":
      return Array.isArray(data.content) ? data.content.flatMap(assistantItem) : [];
  }
}

// packages/plugin/src/source.ts
var EXTRACTOR_VERSION = 2;
var Position2 = Schema5.Struct({ lastActivity: Schema5.Int, revision: Schema5.Int });
var isMessageType = Schema5.is(MessageType);
var UPLOADED = `substr(coalesce(s.title, ''), 1, ${WORKER_PREFIX.length}) <> '${WORKER_PREFIX}'`;
var POSITIONS = `SELECT * FROM (SELECT s.id AS sessionId, s.directory,
    coalesce((SELECT seq FROM event_sequence WHERE aggregate_id = s.id), 0) AS revision,
    max(s.time_updated, coalesce((SELECT max(time_created) FROM session_message WHERE session_id = s.id), 0))
      AS lastActivity
  FROM session_v2 s WHERE ${UPLOADED}) WHERE revision >= 0`;
function readPosition(db, sessionId) {
  const row = db.query(`${POSITIONS} AND sessionId = ?`).get(sessionId);
  return row && { revision: row.revision, lastActivity: row.lastActivity };
}
function readPositions(db) {
  const rows = db.query(POSITIONS).all();
  return new Map(rows.map(({ sessionId, directory, revision, lastActivity }) => [sessionId, { position: { revision, lastActivity }, directory }]));
}
function readSnapshot(db, sessionId) {
  return db.transaction(() => {
    const position = readPosition(db, sessionId);
    const session = readSession(db, sessionId);
    if (!position || !session)
      return null;
    const contentHash = createHash("sha256").update(JSON.stringify(session)).digest("hex");
    return { session, ...position, contentHash, extractorVersion: EXTRACTOR_VERSION };
  })();
}
function compactionBoundary(db, sessionId) {
  const row = db.query(`SELECT max(time_created) AS t FROM session_message
       WHERE session_id = ? AND type = 'compaction' AND json_extract(data, '$.status') = 'completed'`).get(sessionId);
  return row.t ?? 0;
}
function readSession(db, sessionId) {
  const row = db.query(`SELECT id, slug, title, directory, parent_id, time_created, time_updated FROM session_v2 s
       WHERE ${UPLOADED} AND id = ?`).get(sessionId);
  if (!row)
    return null;
  const rows = db.query("SELECT id, type, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq").all(sessionId);
  const messages = rows.flatMap((m) => {
    const type = m.type;
    if (!isMessageType(type))
      return [];
    return [{ id: m.id, type, timeCreated: m.time_created, parts: extractParts(type, JSON.parse(m.data)) }];
  });
  return {
    id: row.id,
    slug: row.slug,
    title: row.title ?? "",
    directory: row.directory,
    parentId: row.parent_id,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    messages
  };
}

class Service2 extends Context2.Service()("@opencode-recall/plugin/Source") {
}
var fromDatabase = (db) => Layer2.succeed(Service2, Service2.of({
  position: (sessionId) => Effect5.sync(() => Option4.fromNullishOr(readPosition(db, sessionId))),
  positions: () => Effect5.sync(() => readPositions(db)),
  snapshot: (sessionId) => Effect5.sync(() => Option4.fromNullishOr(readSnapshot(db, sessionId))),
  compactionBoundary: (sessionId) => Effect5.sync(() => compactionBoundary(db, sessionId))
}));
var layer2 = (path) => Layer2.unwrap(Effect5.acquireRelease(Effect5.sync(() => new Database(path, { readonly: true })), (db) => Effect5.sync(() => db.close())).pipe(Effect5.map(fromDatabase)));

// packages/plugin/src/inspect.ts
var Args2 = Schema6.Struct({
  session_id: Schema6.String,
  query: Schema6.optionalKey(Schema6.String),
  scope: Schema6.optionalKey(Inspect.fields.scope.schema),
  mode: Schema6.optionalKey(Inspect.fields.mode.schema),
  include_tools: Schema6.optionalKey(Schema6.Boolean),
  limit: Schema6.optionalKey(Schema6.Number)
});
var INPUT2 = {
  type: "object",
  additionalProperties: false,
  required: ["session_id"],
  properties: {
    session_id: { type: "string", description: "Session id (ses_...) or slug from recall_search" },
    query: { type: "string", description: "Search within the session (omit for a user-turn outline)" },
    scope: {
      type: "string",
      enum: ["all", "user-messages"],
      description: "Search scope in query mode: all (default), or top-level user messages without known synthetic context or child assignments."
    },
    mode: {
      type: "string",
      enum: ["hybrid", "lexical", "semantic"],
      description: "hybrid (default) fuses both; lexical = exact terms only; semantic = meaning only"
    },
    include_tools: {
      type: "boolean",
      description: "Include tool outputs (bash/file contents) in lexical matching (default true)"
    },
    limit: { type: "number", description: "Max hits in query mode (default 12, max 30)" }
  }
};
var DESCRIPTION2 = "Look inside ONE past session, from any host sharing this recall hub: the cheap, instant first stop after recall_search finds it, before reaching for recall_summarize. With a query: hybrid-search within that session, returning message-level hits in chronological order with message_ids ready for recall_expand. Without a query: an outline of the session's user turns (its intent skeleton). No worker model, no wait.";
function outline(answer, ref) {
  const line = (t, i) => `${i + 1}. ${fmtDateTime(t.time)} (${t.messageId}) ${t.text}`;
  const { turns } = answer;
  const toc = turns.length > 60 ? [
    ...turns.slice(0, 30).map(line),
    `[... ${turns.length - 60} turns omitted \u2014 search them with query=... ]`,
    ...turns.slice(-30).map((t, i) => line(t, turns.length - 30 + i))
  ] : turns.map(line);
  return [
    header(answer, ref, "inspecting"),
    `${answer.messages} messages \xB7 ${turns.length} user turns`,
    "",
    "USER TURNS:",
    ...toc,
    "",
    "Search within: query=...; read around a turn: recall_expand(session_id, message_id); whole-session story: recall_summarize."
  ].join(`
`);
}
var make2 = Effect6.fnUntraced(function* () {
  const source = yield* Service2;
  const execute = Effect6.fn("recall_inspect")(function* (input, ctx) {
    const args = Schema6.decodeUnknownResult(Args2)(input);
    if (Result2.isFailure(args))
      return { content: `Invalid recall_inspect arguments: ${args.failure.message}` };
    const { session_id: ref, query } = args.success;
    const title = (t) => ({ title: `recall inspect: ${t}` });
    if (!query?.trim()) {
      if (args.success.scope === "user-messages")
        return { content: "scope=user-messages requires a query; omit scope for the standard user-turn outline." };
      const answer = yield* withHub((hub) => hub.inspect({ session: ref, limit: 12 }));
      if (answer.kind !== "outline")
        return { content: notFound(ref) };
      return { content: outline(answer, ref), metadata: title(answer.session.title) };
    }
    const mode = args.success.mode ?? "hybrid";
    const scope = args.success.scope ?? "all";
    const request = {
      session: ref,
      query,
      mode,
      scope,
      includeTools: args.success.include_tools,
      limit: clampInt(args.success.limit, 1, 30, 12),
      exclude: { sessionId: ctx.sessionID, before: yield* source.compactionBoundary(ctx.sessionID) }
    };
    const answer = yield* withHub((hub) => hub.inspect(request));
    if (answer.kind !== "matches")
      return { content: notFound(ref) };
    const { semanticUnavailable } = answer;
    if (semanticUnavailable !== undefined && mode === "semantic")
      return {
        content: `recall could not look: semantic search is unavailable (${semanticUnavailable}). Retry with mode=lexical or hybrid. This is not an empty result.`
      };
    const note = semanticUnavailable === undefined ? "" : `semantic search is unavailable (${semanticUnavailable}); these results are lexical only.
`;
    const head = note + header(answer, ref, "inspecting");
    if (!answer.hits.length)
      return {
        content: `${head}

No matches for "${query}" (${mode}, scope=${scope}) in this session. Likely not discussed in this session, or only in a turn not archived yet. Try different keywords, mode=semantic (unfiltered ranking), or omit query for a user-turn outline. User-message scope excludes child sessions.`
      };
    const lines = [
      head,
      `${answer.hits.length} of ${answer.total} matches for "${query}" (${mode}) \u2014 chronological:`,
      "",
      ...answer.hits.flatMap((h, i) => [
        `${i + 1}. ${fmtDateTime(h.time)} (${h.messageId})`,
        `   [${via(h, answer.session.parentId, scope)}] ${h.snippet}`
      ]),
      "",
      "Read around a hit: recall_expand(session_id, message_id). Escalate to recall_summarize only if this doesn't answer it."
    ];
    return { content: lines.join(`
`), metadata: title(answer.session.title) };
  }, Effect6.catchTag("Tools.CouldNotLook", (e) => Effect6.succeed({ content: e.message })));
  const context = yield* Effect6.context();
  const info = {
    name: "recall_inspect",
    description: DESCRIPTION2,
    input: INPUT2,
    options: { codemode: false },
    execute: (input, ctx) => Effect6.runPromiseWith(context)(execute(input, ctx))
  };
  return info;
});

// packages/plugin/src/instructions.ts
var TEXT = `# Persistent memory (recall)

Every past OpenCode conversation from every host sharing this recall hub is archived and searchable via the recall tools (\`recall_search\`, \`recall_inspect\`, \`recall_expand\`, \`recall_summarize\`, \`recall_status\`). This is your long-term memory: the sessions themselves are the record, so nothing needs to be saved or summarized. Treat searching it as part of the default workflow, not an optional tool.

- **Search before answering.** Whenever the user references prior work that isn't in your context (an existing project, bug, feature, decision, follow-up, or anything phrased in the past tense: "we discussed", "last time", "the X we built", "do you remember"), run \`recall_search\` before answering. The user will assume you remember; searching is how you do.
- **Check recall when troubleshooting.** Before digging into a bug, failure, or unexpected behavior, run one focused \`recall_search\` to see whether it has been investigated or fixed before. Prior sessions may contain the root cause, fix, or known dead ends. If that quick check produces no useful hit, move on with normal troubleshooting rather than spending time forcing recall to help.
- **Climb the ladder, cheapest rung first.** \`recall_search\` finds the session; \`recall_inspect\` finds where inside it (or outlines its user turns with no query); \`recall_expand\` reads the transcript around a hit. All three are instant; for a targeted question about a session, they usually answer it.
- When the user provides a \`ses_...\` ID for review, read that session with \`recall_expand\` directly.
- **Summarize is the escalation, not the default.** \`recall_summarize\` runs a worker model (10-30 s fresh). Reach for it only when inspect/expand can't answer cleanly, the session is too large to page, or you genuinely need the whole-session story. When you do, use a \`focus\` question, and batch several sessions in one \`session_ids\` call (they run concurrently; results are cached in the hub for every host).
- **Pick the right mode.** Default hybrid. Use \`lexical\` for exact identifiers, error strings, commands, and filenames; \`semantic\` for fuzzy "I know this came up before" recall. Scope with \`directory\`/\`since\`/\`until\` when the ask is scoped.
- **Filter by host with \`source\`.** \`source\` is a \`recall_search\` filter alongside \`directory\`, \`since\`, and \`until\`: pass a host name as results show it to search only sessions archived from that host.
- **Results name their origin.** Every result names the host its session was archived from (marked "this host" when it is yours) and the archived revision. A session's newest turn may not be archived yet, so the archive can trail what its host holds.
- **"Could not look" is not "nothing found".** A result that says recall could not look means the hub was unreachable, unconfigured, or refused the request, so no search happened. Never conclude from it that no prior work exists: retry, check \`recall_status\`, or tell the user recall is unavailable.
- **Hand back ses_ ids.** When the user asks you to find a session, give the bare \`ses_...\` id; sessions are continued in the TUI with \`opencode -s <id>\`.
- **Recover from compaction.** If this session was compacted and a detail seems missing, search for it; recall returns this session's own pre-compaction history, labeled as such.
- **Recalled context can be stale.** When a past conversation disagrees with the current state of code or config, trust the present, and say when an answer leans on recalled context.
- **Don't spam it.** Self-contained asks need no search; one well-chosen query beats several vague ones. Recall is a quick context check, not a detour from the task.`;
function inject(request) {
  request.system.push({ type: "text", text: TEXT });
}

// packages/plugin/src/search.ts
import { Effect as Effect7, Result as Result3, Schema as Schema7 } from "effect";
var Args3 = Schema7.Struct({
  query: Schema7.String,
  scope: Schema7.optionalKey(Search.fields.scope.schema),
  mode: Schema7.optionalKey(Search.fields.mode.schema),
  directory: Schema7.optionalKey(Schema7.String),
  source: Schema7.optionalKey(Schema7.String),
  since: Schema7.optionalKey(Schema7.String),
  until: Schema7.optionalKey(Schema7.String),
  include_tools: Schema7.optionalKey(Schema7.Boolean),
  limit: Schema7.optionalKey(Schema7.Number)
});
var INPUT3 = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", description: "Search query: natural language or exact keywords/identifiers" },
    scope: {
      type: "string",
      enum: ["all", "user-messages"],
      description: "Default all. Use user-messages to search top-level user text, excluding known synthetic context and child assignments."
    },
    mode: {
      type: "string",
      enum: ["hybrid", "lexical", "semantic"],
      description: "hybrid (default) fuses both; lexical = exact terms only; semantic = meaning only"
    },
    directory: {
      type: "string",
      description: "Substring filter on the session working directory, e.g. 'infrastructure' or 'Projects_personal'"
    },
    source: { type: "string", description: "Only sessions archived from this host, by the name shown in results" },
    since: { type: "string", description: "Only sessions after this ISO date, e.g. 2026-05-01" },
    until: { type: "string", description: "Only sessions before this ISO date" },
    include_tools: {
      type: "boolean",
      description: "Include tool outputs (bash/file contents) in lexical matching (default true)"
    },
    limit: { type: "number", description: "Max sessions returned (default 8, max 25)" }
  }
};
function render(sessions, scope, callerSessionId) {
  const lines = sessions.flatMap((s, i) => {
    const self = s.sessionId === callerSessionId ? " \u2190 THIS session, before its last compaction" : "";
    return [
      `${i + 1}. ${s.title || "(untitled)"} \u2014 ${fmtDate(s.timeUpdated)} \xB7 ${shortDir(s.directory)} \xB7 ${origin(s)}${self}`,
      `   session_id=${s.sessionId} message_id=${s.hits[0]?.messageId} matches(lex=${s.lexicalMatches},sem=${s.semanticMatches})`,
      ...s.hits.map((h) => `   [${via(h, s.parentId, scope)}] ${h.snippet}`)
    ];
  });
  return lines.join(`
`);
}
var DESCRIPTION3 = "Search ALL past OpenCode conversations from every host sharing this recall hub (every project, full history) with hybrid lexical (FTS5/BM25 over messages, reasoning, and tool outputs) + semantic (embedding) search. Use when the user references a previous discussion ('do you remember', 'we discussed', 'in another session'), or when past decisions, fixes, commands, or error messages would help. Also searches THIS session's history from before its last compaction, useful for recovering details lost to context compaction. Results name the host each session came from and its archived revision; the newest turn of a session may not be archived yet.";
var make3 = Effect7.fnUntraced(function* () {
  const source = yield* Service2;
  const execute = Effect7.fn("recall_search")(function* (input, ctx) {
    const args = Schema7.decodeUnknownResult(Args3)(input);
    if (Result3.isFailure(args))
      return { content: `Invalid recall_search arguments: ${args.failure.message}` };
    const { query } = args.success;
    const mode = args.success.mode ?? "hybrid";
    const search = {
      query,
      mode,
      scope: args.success.scope,
      since: parseWhen(args.success.since),
      until: parseWhen(args.success.until),
      directory: args.success.directory,
      source: args.success.source,
      includeTools: args.success.include_tools,
      limit: clampInt(args.success.limit, 1, 25, 8),
      exclude: { sessionId: ctx.sessionID, before: yield* source.compactionBoundary(ctx.sessionID) }
    };
    const { sessions, semanticUnavailable } = yield* withHub((hub) => hub.search(search));
    if (semanticUnavailable !== undefined && mode === "semantic")
      return {
        content: `recall could not look: semantic search is unavailable (${semanticUnavailable}). Retry with mode=lexical or hybrid. This is not an empty result.`
      };
    const note = semanticUnavailable === undefined ? "" : `semantic search is unavailable (${semanticUnavailable}); these results are lexical only.
`;
    if (!sessions.length)
      return {
        content: `${note}No matches for "${query}" (${mode}, scope=${search.scope ?? "all"}). Try mode=semantic for fuzzy recall, fewer or different keywords, or drop filters.`
      };
    return { content: note + render(sessions, search.scope, ctx.sessionID), metadata: { title: `recall: ${query}` } };
  }, Effect7.catchTag("Tools.CouldNotLook", (e) => Effect7.succeed({ content: e.message })));
  const context = yield* Effect7.context();
  const info = {
    name: "recall_search",
    description: DESCRIPTION3,
    input: INPUT3,
    options: { codemode: false },
    execute: (input, ctx) => Effect7.runPromiseWith(context)(execute(input, ctx))
  };
  return info;
});

// packages/plugin/src/status.ts
import { Effect as Effect10, Option as Option6 } from "effect";

// packages/plugin/src/uploader.ts
import {
  Clock,
  Context as Context4,
  Deferred,
  Effect as Effect9,
  FiberHandle,
  FiberMap,
  Layer as Layer4,
  Option as Option5,
  Schedule,
  Schema as Schema9,
  Semaphore
} from "effect";

// packages/plugin/src/storage.ts
import { Context as Context3, Effect as Effect8, Layer as Layer3, Schema as Schema8 } from "effect";

class Failed extends Schema8.TaggedError()("Storage.Failed", { message: Schema8.String, cause: Schema8.Defect() }) {
}
var failed = (cause) => new Failed({ message: cause instanceof Error ? cause.message : String(cause), cause });

class Service3 extends Context3.Service()("@opencode-recall/plugin/Storage") {
}
var fromDomain = (domain) => Layer3.succeed(Service3, Service3.of({
  get: Effect8.fn("Storage.get")(function* (key, schema) {
    const value = yield* Effect8.tryPromise({ try: () => domain.get(key), catch: failed });
    if (value === undefined)
      return;
    return yield* Schema8.decodeUnknownEffect(schema)(value).pipe(Effect8.mapError(failed));
  }),
  set: (key, value) => Effect8.tryPromise({ try: () => domain.set(key, value), catch: failed }),
  remove: (key) => Effect8.tryPromise({ try: () => domain.remove(key), catch: failed }),
  scan: Effect8.fn("Storage.scan")(function* (prefix, schema) {
    const found = [];
    let after;
    do {
      const page = yield* Effect8.tryPromise({ try: () => domain.scan({ prefix, after }), catch: failed });
      for (const { key, value } of page.entries)
        found.push({ key, value: yield* Schema8.decodeUnknownEffect(schema)(value).pipe(Effect8.mapError(failed)) });
      after = page.next;
    } while (after !== undefined);
    return found;
  })
}));

// packages/plugin/src/uploader.ts
var PAUSING = new Set(["invalid_token", "protocol_version"]);
var TERMINAL = new Set([
  "stale_revision",
  "hash_divergence",
  "tombstoned",
  "payload_too_large",
  "invalid_request",
  "unknown_verb"
]);
var RETRYABLE = new Set(["rate_limited", "request_timeout"]);
function classify(e) {
  if (!(e instanceof HubError))
    return "retry";
  if (PAUSING.has(e.code))
    return "pause";
  if (TERMINAL.has(e.code))
    return "terminal";
  if (RETRYABLE.has(e.code))
    return "retry";
  return e.status >= 500 ? "retry" : "terminal";
}
var describe = (e) => e instanceof HubError ? `${e.code}: ${e.message}` : e.message;
var DIRTY = "dirty/";
var DELETED = "deleted/";
var ACKED = "acked/";
var sessionPrefix = (sessionId) => `${DIRTY}${sessionId}/`;
var entryKey = (sessionId, p) => `${sessionPrefix(sessionId)}${p.lastActivity}-${p.revision}`;
var deletedPrefix = (sessionId) => `${DELETED}${sessionId}/`;
var later = (a, b) => a.lastActivity - b.lastActivity || a.revision - b.revision;
var newestFirst = (sessions) => [...sessions].sort(([, a], [, b]) => later(b.position, a.position));
var Deletion = Schema9.Struct({ revision: Tombstone.fields.revision, timeDeleted: Tombstone.fields.timeDeleted });
var Queued = Schema9.Struct({ ...Deletion.fields, reason: Tombstone.fields.reason });

class Service4 extends Context4.Service()("@opencode-recall/plugin/Uploader") {
}
var defectMessage = (defect) => defect instanceof Error ? defect.message : String(defect);
var layer3 = ({
  quietMs = 2000,
  retryMs = 30000,
  probeIntervalMs = 30000,
  sweepIntervalMs = 300000,
  configPollMs = 5000,
  uploadIntervalMs = 500
} = {}) => Layer4.effect(Service4, Effect9.gen(function* () {
  const source = yield* Service2;
  const storage = yield* Service3;
  const config = yield* Service;
  const scope = yield* Effect9.scope;
  const due = new Set;
  const activity = new Map;
  const noteActivity = (sessionId, time) => activity.set(sessionId, Math.max(time, activity.get(sessionId) ?? time));
  const newestDue = () => {
    let newest;
    let latest = -Infinity;
    for (const sessionId of due) {
      const time = activity.get(sessionId) ?? 0;
      if (time > latest)
        [newest, latest] = [sessionId, time];
    }
    return newest;
  };
  let nextRequestAt = 0;
  const timers = yield* FiberMap.make();
  const probing = yield* FiberHandle.make();
  const reconcileRetry = yield* FiberHandle.make();
  const sweeping = yield* FiberHandle.make();
  const draining = yield* Semaphore.make(1);
  let pausedBy = null;
  let reconciling;
  let reconcileOnResume = false;
  let lastReconciled = null;
  let lastError = null;
  const warn = (message) => Effect9.gen(function* () {
    yield* Effect9.logWarning(message);
    lastError = { message, time: yield* Clock.currentTimeMillis };
  });
  const logAndContinue = (message) => (self) => self.pipe(Effect9.catch((e) => warn(message(describe(e)))), Effect9.catchDefect((defect) => warn(message(defectMessage(defect)))));
  const background = (effect) => Effect9.asVoid(Effect9.forkIn(effect, scope));
  const scanKept = Effect9.fnUntraced(function* (prefix, schema) {
    const kept = [];
    for (const { key, value } of yield* storage.scan(prefix, Schema9.Unknown)) {
      const decoded = Schema9.decodeUnknownOption(schema)(value);
      if (Option5.isSome(decoded))
        kept.push({ key, value: decoded.value });
      else {
        yield* warn(`dropped unreadable work-list entry ${key}: ${JSON.stringify(value)}`);
        yield* storage.remove(key);
      }
    }
    return kept;
  });
  const entries = (sessionId) => scanKept(sessionPrefix(sessionId), Position2).pipe(Effect9.map((found) => found.map(({ key, value }) => ({ key, position: value }))));
  const acknowledged = Effect9.map(scanKept(ACKED, Position2), (found) => new Map(found.map(({ key, value }) => [key.slice(ACKED.length), value])));
  const schedule = (sessionId, ms) => Effect9.asVoid(FiberMap.run(timers, sessionId, Effect9.sleep(ms).pipe(Effect9.andThen(Effect9.sync(() => due.add(sessionId))), Effect9.andThen(background(drain)))));
  const markDirty = (sessionId, position) => storage.set(entryKey(sessionId, position), position).pipe(Effect9.andThen(Effect9.sync(() => noteActivity(sessionId, position.lastActivity))), Effect9.andThen(schedule(sessionId, quietMs)));
  const markDeleted = (sessionId, queued) => storage.set(`${deletedPrefix(sessionId)}${queued.timeDeleted}`, queued).pipe(Effect9.andThen(Effect9.sync(() => noteActivity(sessionId, queued.timeDeleted))), Effect9.andThen(schedule(sessionId, quietMs)));
  const recordAcked = Effect9.fnUntraced(function* (sessionId, position, held) {
    const current = held ?? (yield* storage.get(ACKED + sessionId, Position2));
    if (!current || later(position, current) > 0)
      yield* storage.set(ACKED + sessionId, position);
  });
  const pause = (reason) => Effect9.gen(function* () {
    if (pausedBy === null)
      yield* warn(`uploads paused until configuration is fixed: ${reason}`);
    pausedBy = reason;
    yield* FiberHandle.run(probing, probeUntilResumed, { onlyIfMissing: true });
  });
  const probe = Effect9.gen(function* () {
    const hub = yield* config.hub;
    yield* config.excludeDirectories;
    if (Option5.isNone(hub))
      return false;
    yield* makeClient(hub.value).status();
    return true;
  }).pipe(Effect9.catch((e) => Effect9.sync(() => {
    if (e instanceof HubError && PAUSING.has(e.code))
      pausedBy = describe(e);
    return false;
  })));
  const probeUntilResumed = Effect9.gen(function* () {
    yield* probe.pipe(Effect9.delay(probeIntervalMs), Effect9.repeat({ until: (accepted) => accepted }));
    yield* Effect9.logInfo("configuration accepted by the hub; uploads resumed");
    pausedBy = null;
    if (reconcileOnResume)
      yield* background(reconcile);
    yield* background(drain);
  });
  const acknowledge = Effect9.fnUntraced(function* (sessionId, sent) {
    for (const { key, position } of yield* entries(sessionId))
      if (later(position, sent) <= 0)
        yield* storage.remove(key);
    yield* recordAcked(sessionId, sent);
  });
  const exclude = Effect9.fnUntraced(function* (sessionId, revision) {
    const timeDeleted = yield* Clock.currentTimeMillis;
    yield* markDeleted(sessionId, { revision, timeDeleted, reason: "excluded" });
  });
  const awaitTurn = Effect9.gen(function* () {
    const wait = nextRequestAt - (yield* Clock.currentTimeMillis);
    if (wait > 0)
      yield* Effect9.sleep(wait);
  });
  const attempt = (sessionId, request) => request.pipe(Effect9.ensuring(Effect9.flatMap(Clock.currentTimeMillis, (now) => Effect9.sync(() => nextRequestAt = now + uploadIntervalMs))), Effect9.as("done"), Effect9.catch((e) => {
    const kind = classify(e);
    if (kind === "pause")
      return Effect9.sync(() => due.add(sessionId)).pipe(Effect9.andThen(pause(describe(e))), Effect9.as("pause"));
    if (kind === "retry")
      return warn(`upload of ${sessionId} failed, retrying: ${describe(e)}`).pipe(Effect9.andThen(schedule(sessionId, retryMs)), Effect9.as("retry"));
    return warn(`upload of ${sessionId} rejected and dropped: ${describe(e)}`).pipe(Effect9.as("done"));
  }));
  const sendTombstone = Effect9.fnUntraced(function* (client, sessionId, deletions) {
    const { value: deletion } = deletions.reduce((a, b) => b.value.timeDeleted > a.value.timeDeleted ? b : a);
    const pending = yield* entries(sessionId);
    const outcome = yield* attempt(sessionId, client.tombstone({ sessionId, ...deletion }));
    if (outcome !== "done")
      return outcome;
    for (const { key } of deletions)
      yield* storage.remove(key);
    yield* storage.remove(ACKED + sessionId);
    let reimported = false;
    for (const { key, position } of pending)
      if (position.lastActivity <= deletion.timeDeleted)
        yield* storage.remove(key);
      else
        reimported = true;
    if (reimported)
      yield* schedule(sessionId, quietMs);
    return outcome;
  });
  const send = Effect9.fnUntraced(function* (client, sessionId) {
    const deletions = yield* scanKept(deletedPrefix(sessionId), Queued);
    if (deletions.length > 0)
      return yield* sendTombstone(client, sessionId, deletions);
    const pending = yield* entries(sessionId);
    if (pending.length === 0)
      return "done";
    const snapshot = yield* source.snapshot(sessionId);
    const excluded = Effect9.map(config.excludeDirectories, (roots) => Option5.isSome(snapshot) && isExcluded(roots, snapshot.value.session.directory));
    if (Option5.isNone(snapshot) || (yield* excluded)) {
      for (const { key } of pending)
        yield* storage.remove(key);
      if (Option5.isSome(snapshot) && (yield* storage.get(ACKED + sessionId, Position2)))
        yield* exclude(sessionId, snapshot.value.revision);
      return "done";
    }
    const outcome = yield* attempt(sessionId, client.snapshot(snapshot.value));
    if (outcome !== "done")
      return outcome;
    yield* acknowledge(sessionId, snapshot.value);
    if (yield* excluded)
      yield* exclude(sessionId, snapshot.value.revision);
    return outcome;
  });
  const pass = Effect9.gen(function* () {
    if (pausedBy !== null)
      return;
    const hub = yield* config.excludeDirectories.pipe(Effect9.andThen(config.hub), Effect9.catch((e) => pause(`config could not be read: ${e.message}`).pipe(Effect9.as(undefined))));
    if (hub === undefined)
      return;
    if (Option5.isNone(hub))
      return yield* pause("hub URL or token is not configured");
    const client = makeClient(hub.value);
    while (due.size > 0) {
      yield* awaitTurn;
      const sessionId = newestDue();
      if (sessionId === undefined)
        return;
      due.delete(sessionId);
      const retry = (reason) => warn(`upload of ${sessionId} failed, retrying: ${reason}`).pipe(Effect9.andThen(schedule(sessionId, retryMs)), Effect9.as("retry"));
      const outcome = yield* send(client, sessionId).pipe(Effect9.catch((e) => retry(e.message)), Effect9.catchDefect((defect) => retry(defectMessage(defect))));
      if (outcome === "pause")
        return;
    }
  });
  const drain = Effect9.gen(function* () {
    const ran = yield* pass.pipe(draining.withPermitsIfAvailable(1));
    if (Option5.isSome(ran) && due.size > 0 && pausedBy === null)
      yield* drain;
  });
  const queuedSessions = Effect9.gen(function* () {
    const ids = new Set;
    for (const { key } of yield* storage.scan(DIRTY, Schema9.Unknown))
      ids.add(key.slice(DIRTY.length, key.lastIndexOf("/")));
    for (const { key } of yield* storage.scan(DELETED, Schema9.Unknown))
      ids.add(key.slice(DELETED.length, key.lastIndexOf("/")));
    return ids;
  });
  const resume = Effect9.gen(function* () {
    const found = [
      ...(yield* scanKept(DIRTY, Position2)).map(({ key, value }) => ({ key, time: value.lastActivity })),
      ...(yield* scanKept(DELETED, Queued)).map(({ key, value }) => ({ key, time: value.timeDeleted }))
    ];
    for (const { key, time } of found) {
      const sessionId = key.slice(key.indexOf("/") + 1, key.lastIndexOf("/"));
      noteActivity(sessionId, time);
      due.add(sessionId);
    }
  });
  const sweep = Effect9.gen(function* () {
    const acked = yield* acknowledged;
    const roots = yield* config.excludeDirectories;
    const tombstoning = new Set((yield* storage.scan(DELETED, Schema9.Unknown)).map(({ key }) => key.split("/")[1]));
    for (const [sessionId, { position, directory }] of newestFirst(yield* source.positions())) {
      const held = acked.get(sessionId);
      if (isExcluded(roots, directory)) {
        if (held && !tombstoning.has(sessionId))
          yield* exclude(sessionId, position.revision);
        continue;
      }
      if (!held || later(position, held) > 0)
        yield* markDirty(sessionId, position);
    }
  });
  const sweepForever = sweep.pipe(logAndContinue((reason) => `sweep failed: ${reason}`), Effect9.delay(sweepIntervalMs), Effect9.repeat(Schedule.forever));
  const diffManifest = Effect9.gen(function* () {
    const hub = yield* config.hub;
    if (Option5.isNone(hub) || pausedBy !== null) {
      reconcileOnResume = true;
      if (Option5.isNone(hub))
        yield* pause("hub URL or token is not configured");
      return;
    }
    const roots = yield* config.excludeDirectories;
    const manifest = yield* makeClient(hub.value).manifest();
    const held = new Map(manifest.sessions.map((s) => [s.sessionId, s]));
    const tombstones = new Map(manifest.tombstones.map((t) => [t.sessionId, t]));
    const acked = yield* acknowledged;
    const queued = new Map;
    for (const { key, value } of yield* scanKept(DIRTY, Position2)) {
      const sessionId = key.slice(DIRTY.length, key.lastIndexOf("/"));
      queued.set(sessionId, [...queued.get(sessionId) ?? [], { key, position: value }]);
    }
    for (const [sessionId, { position: local, directory }] of newestFirst(yield* source.positions())) {
      const tombstone = tombstones.get(sessionId);
      const hubCopy = held.get(sessionId);
      if (isExcluded(roots, directory)) {
        if (hubCopy !== undefined)
          yield* exclude(sessionId, local.revision);
        continue;
      }
      const current = !tombstone?.excludedByCaller && (tombstone !== undefined ? local.lastActivity <= tombstone.timeDeleted : hubCopy !== undefined && hubCopy.extractorVersion >= EXTRACTOR_VERSION && (later(local, hubCopy) <= 0 || Option5.getOrUndefined(yield* source.snapshot(sessionId))?.contentHash === hubCopy.contentHash));
      if (current) {
        for (const { key, position } of queued.get(sessionId) ?? [])
          if (later(position, local) <= 0)
            yield* storage.remove(key);
        yield* recordAcked(sessionId, local, acked.get(sessionId));
      } else
        yield* markDirty(sessionId, local);
    }
    reconcileOnResume = false;
    lastReconciled = yield* Clock.currentTimeMillis;
    yield* FiberHandle.run(sweeping, sweepForever, { onlyIfMissing: true });
  }).pipe(Effect9.catch((e) => {
    if (classify(e) !== "pause")
      return retryReconcile(describe(e));
    reconcileOnResume = true;
    return pause(describe(e));
  }), Effect9.catchDefect((defect) => retryReconcile(defectMessage(defect))));
  const retryReconcile = (reason) => warn(`reconciliation failed, retrying: ${reason}`).pipe(Effect9.andThen(FiberHandle.run(reconcileRetry, Effect9.delay(reconcile, retryMs))), Effect9.asVoid);
  const reconcile = Effect9.gen(function* () {
    if (reconciling)
      return yield* Deferred.await(reconciling);
    const done = yield* Deferred.make();
    reconciling = done;
    const run = diffManifest.pipe(Effect9.ensuring(Effect9.sync(() => reconciling = undefined)), Effect9.exit, Effect9.flatMap((exit) => Deferred.done(done, exit)));
    yield* Effect9.forkIn(run, scope);
    yield* Deferred.await(done);
  });
  const reconcileAgain = Effect9.gen(function* () {
    if (reconciling)
      yield* Deferred.await(reconciling);
    yield* reconcile;
  });
  const exclusionsKey = config.excludeDirectories.pipe(Effect9.map((roots) => JSON.stringify(roots)), Effect9.option);
  let appliedExclusions = yield* exclusionsKey;
  const watchExclusions = Effect9.gen(function* () {
    const key = yield* exclusionsKey;
    if (Option5.isNone(key) || Option5.getOrUndefined(appliedExclusions) === key.value)
      return;
    appliedExclusions = key;
    yield* Effect9.logInfo(`excluded directories changed to ${key.value}; reconciling`);
    yield* reconcileAgain;
  }).pipe(Effect9.delay(configPollMs), Effect9.repeat(Schedule.forever));
  yield* Effect9.forkIn(watchExclusions, scope);
  yield* resume.pipe(logAndContinue((reason) => `work list could not be read: ${reason}`));
  yield* background(drain);
  return Service4.of({
    enqueue: (sessionId) => source.position(sessionId).pipe(Effect9.flatMap(Option5.match({ onNone: () => Effect9.void, onSome: (position) => markDirty(sessionId, position) })), logAndContinue((reason) => `could not record ${sessionId} as dirty: ${reason}`)),
    delete: (sessionId, deletion) => markDeleted(sessionId, { ...deletion, reason: "deleted" }).pipe(logAndContinue((reason) => `could not record ${sessionId} as deleted: ${reason}`)),
    reconcile,
    state: Effect9.gen(function* () {
      const queued = yield* queuedSessions;
      const acked = yield* acknowledged;
      const roots = yield* config.excludeDirectories.pipe(Effect9.orElseSucceed(() => []));
      let local = 0;
      let answered = 0;
      for (const [sessionId, { position, directory }] of yield* source.positions()) {
        if (isExcluded(roots, directory))
          continue;
        local++;
        const held = acked.get(sessionId);
        if (held && later(position, held) <= 0)
          answered++;
      }
      return {
        queued: queued.size,
        local,
        answered,
        reconciling: reconciling !== undefined,
        lastReconciled: Option5.fromNullishOr(lastReconciled),
        pausedBy: Option5.fromNullishOr(pausedBy),
        lastError: Option5.fromNullishOr(lastError)
      };
    })
  });
}));

// packages/plugin/src/status.ts
var INPUT4 = { type: "object", properties: {}, additionalProperties: false };
var DESCRIPTION4 = "Show recall's status in two parts. Host: hub reachability, upload queue, backfill progress, last error, excluded directories, and where the config came from. Hub: sessions per source host (archived, searchable, embedded), chunks waiting to be embedded, the vector space, cached summaries, rewinds, and any session two hosts hold different copies of. Use to check recall's health or to explain missing recall_* results.";
var indent = (text) => text.replace(/^/gm, "  ");
var make4 = Effect10.fnUntraced(function* () {
  const config = yield* Service;
  const uploader = yield* Service4;
  const execute = Effect10.fn("recall_status")(function* () {
    const [hub, url, configSource, state, excluded] = yield* Effect10.all([
      Effect10.result(withHub((client) => client.status())),
      config.hub.pipe(Effect10.map(Option6.match({ onNone: () => "", onSome: (h) => ` at ${h.url}` })), Effect10.orElseSucceed(() => "")),
      config.hubSource.pipe(Effect10.catch((e) => Effect10.succeed(`invalid (${e.message})`))),
      Effect10.result(uploader.state),
      Effect10.result(config.excludeDirectories)
    ], { concurrency: "unbounded" });
    const host = [`hub${url}: ${hub._tag === "Success" ? "reachable" : hub.failure.message}`, `config: ${configSource}`];
    if (state._tag === "Failure")
      host.push(`uploads: the work list could not be read (${state.failure.message})`);
    else {
      const s = state.success;
      const reconciled = s.reconciling ? "running" : Option6.match(s.lastReconciled, { onNone: () => "not completed yet", onSome: (t) => `last completed ${fmtDateTime(t)}` });
      host.push(`upload queue: ${s.queued} session${s.queued === 1 ? "" : "s"} waiting`, `backfill: ${s.answered} of ${s.local} eligible local sessions answered by the hub at their current position; reconciliation ${reconciled}`, ...Option6.match(s.pausedBy, { onNone: () => [], onSome: (reason) => [`uploads paused: ${reason}`] }), `last error: ${Option6.match(s.lastError, { onNone: () => "none", onSome: (e) => `${fmtDateTime(e.time)} ${e.message}` })}`);
    }
    host.push(excluded._tag === "Failure" ? `excluded directories: unreadable, so uploads are held (${excluded.failure.message})` : `excluded directories (index.excludeDirectories in ${config.file}): ${excluded.success.join(", ") || "none"}`);
    const hubSection = hub._tag === "Success" ? renderHubStatus(hub.success) : "unknown: the hub could not be asked, so nothing here means the archive is empty.";
    const reachable = hub._tag === "Success" ? "" : " \xB7 hub unreachable";
    return {
      content: `host
${indent(host.join(`
`))}

hub
${indent(hubSection)}`,
      metadata: { title: `recall status${reachable}` }
    };
  });
  const context = yield* Effect10.context();
  const info = {
    name: "recall_status",
    description: DESCRIPTION4,
    input: INPUT4,
    options: { codemode: false },
    execute: () => Effect10.runPromiseWith(context)(execute())
  };
  return info;
});

// packages/plugin/src/summarize.ts
import { Clock as Clock2, Effect as Effect11, Result as Result4, Schema as Schema10 } from "effect";
var BATCH_MAX = 24;
var CONCURRENCY = 4;
var RECIPE = 1;
var BUDGET2 = 300000;
var MESSAGE_CHARS = 2000;
var TIMEOUT_MS = 180000;
var WORKER_SYSTEM = "You analyze recorded OpenCode agent session transcripts. Follow the task instructions in this message exactly, and answer ONLY from the transcript provided. No preamble.";
var TASK_FOCUSED = "Answer the question below using only the transcript. Be specific: name files, commands, ids, and decisions. If the transcript does not contain the answer, say so plainly.";
var TASK_GENERAL = "Produce a tight summary of the transcript structured as: Goal; What was done (bullets); Key decisions & why; Gotchas/discoveries; Final state; Loose ends. Be specific: name files, commands, and ids. At most 350 words.";
var Args4 = Schema10.Struct({
  session_id: Schema10.optionalKey(Schema10.String),
  session_ids: Schema10.optionalKey(Schema10.Array(Schema10.String)),
  focus: Schema10.optionalKey(Schema10.String),
  refresh: Schema10.optionalKey(Schema10.Boolean),
  providerID: Schema10.optionalKey(Schema10.String),
  modelID: Schema10.optionalKey(Schema10.String),
  variant: Schema10.optionalKey(Schema10.String)
});
var INPUT5 = {
  type: "object",
  additionalProperties: false,
  properties: {
    session_id: { type: "string", description: "Session id (ses_...) or slug from recall_search" },
    session_ids: {
      type: "array",
      items: { type: "string" },
      description: `Batch: several session ids/slugs summarized concurrently in one call (max ${BATCH_MAX})`
    },
    focus: {
      type: "string",
      description: "Optional question to answer from each session instead of a general summary, e.g. 'what did we decide about auth?'"
    },
    refresh: { type: "boolean", description: "Bypass the cache and re-summarize (default false)" },
    providerID: { type: "string", description: "Provider override (default from the recall config)" },
    modelID: { type: "string", description: "Model override (default from the recall config)" },
    variant: { type: "string", description: "Reasoning-effort variant override, or 'default' for the provider's own" }
  }
};
var DESCRIPTION5 = "ESCALATION rung: summarize entire past OpenCode sessions from any host sharing this recall hub (or answer a focused question about them) with a model this host has credentials for. Defaults to the summary model in the recall config (openai/gpt-5.6-luna at low reasoning unless configured otherwise); providerID, modelID, and variant may override that per call. Each fresh summary takes 10-30s, so try the instant tools first: recall_inspect to search within the session, recall_expand to read around a hit. Reach for this when inspection can't answer cleanly, the session is too large to page, or you genuinely need the whole-session story (results are cached in the hub, so repeats are instant from any host). Batch multiple sessions in one call via session_ids; they run concurrently.";
var truncation = ({ omitted, clipped }) => (omitted ? ` \xB7 ${omitted} messages omitted from the middle to fit ${BUDGET2} characters` : "") + (clipped ? ` \xB7 ${clipped} messages cut to ${MESSAGE_CHARS} characters` : "");

class Failed2 extends Schema10.TaggedError()("Summarize.Failed", { message: Schema10.String }) {
}
var messageOf2 = (cause) => cause instanceof Error ? cause.message : String(cause);
var make5 = Effect11.fnUntraced(function* (generate) {
  const config = yield* Service;
  const summarize = Effect11.fnUntraced(function* (ref, key, refresh, tag) {
    const suffix = key.focus ? ` \xB7 focus: ${key.focus}` : "";
    let session = ref;
    if (!refresh) {
      const cached = yield* withHub((hub) => hub.summaryGet({ ...key, session: ref }));
      if (cached.kind === "missing")
        return notFound(ref);
      if (cached.kind === "cached")
        return `${header(cached, ref, "summarizing")}
(cached ${fmtDateTime(cached.timeCreated)} \xB7 ${tag}${truncation(cached)}${suffix})

${cached.summary}`;
      session = cached.session.sessionId;
    }
    const transcript = yield* withHub((hub) => hub.transcript({ session, budget: BUDGET2, maxChars: MESSAGE_CHARS }));
    if (transcript.kind === "missing")
      return notFound(ref);
    if (!transcript.text)
      return `${header(transcript, ref, "summarizing")}
Nothing to summarize: the archived session has no transcript content.`;
    const s = transcript.session;
    const prompt = [
      WORKER_SYSTEM,
      "",
      key.focus ? TASK_FOCUSED : TASK_GENERAL,
      "",
      ...key.focus ? [`QUESTION: ${key.focus}`, ""] : [],
      `SESSION: ${s.title} (${shortDir(s.directory)}, ${fmtDate(s.timeCreated)})`,
      "TRANSCRIPT:",
      transcript.text
    ].join(`
`);
    const started = yield* Clock2.currentTimeMillis;
    const model = { providerID: key.provider, id: key.model, ...key.variant !== undefined && { variant: key.variant } };
    const { text } = yield* Effect11.tryPromise({
      try: () => generate.text({ prompt, model }),
      catch: (e) => new Failed2({ message: messageOf2(e) })
    }).pipe(Effect11.timeoutOrElse({
      duration: TIMEOUT_MS,
      orElse: () => Effect11.fail(new Failed2({ message: `the model did not answer within ${TIMEOUT_MS / 1000}s` }))
    }));
    const summary = text.trim();
    if (!summary)
      return yield* new Failed2({ message: "the model returned no text" });
    const secs = ((yield* Clock2.currentTimeMillis) - started) / 1000;
    const { omitted, clipped } = transcript;
    const put = { ...key, sessionId: s.sessionId, contentHash: transcript.contentHash, summary, omitted, clipped };
    const cachedNote = yield* withHub((hub) => hub.summaryPut(put).pipe(Effect11.as(""), Effect11.catchIf((e) => e._tag === "HubError" && e.code === "stale_revision", () => Effect11.succeed(" \xB7 not cached: the session advanced while it was summarized")))).pipe(Effect11.catchTag("Tools.CouldNotLook", (e) => Effect11.succeed(` \xB7 not cached: ${e.message}`)));
    const status = `(fresh \xB7 ${tag} \xB7 ${transcript.messages} messages${truncation(transcript)} \xB7 ${secs.toFixed(1)}s${suffix}${cachedNote})`;
    return `${header(transcript, ref, "summarizing")}
${status}

${summary}`;
  });
  const execute = Effect11.fn("recall_summarize")(function* (input, ctx) {
    const args = Schema10.decodeUnknownResult(Args4)(input);
    if (Result4.isFailure(args))
      return { content: `Invalid recall_summarize arguments: ${args.failure.message}` };
    const { session_id, session_ids = [], focus = "", refresh = false } = args.success;
    const ids = [...new Set([session_id, ...session_ids].flatMap((id) => id?.trim() ? [id.trim()] : []))];
    if (!ids.length)
      return { content: "Provide session_id or session_ids." };
    if (ids.length > BATCH_MAX)
      return { content: `Too many sessions (${ids.length}); max ${BATCH_MAX} per call. Split into batches.` };
    const configured = yield* config.summaryModel.pipe(Effect11.mapError((e) => new CouldNotLook({ message: `recall_summarize: the recall config is invalid (${e.message}).` })));
    const provider = args.success.providerID?.trim() || configured.providerID;
    const model = args.success.modelID?.trim() || configured.modelID;
    const isConfigured = provider === configured.providerID && model === configured.modelID;
    const requested = args.success.variant?.trim() || (isConfigured ? configured.variant : undefined);
    const variant = requested && requested.toLowerCase() !== "default" ? requested : undefined;
    const key = { provider, model, ...variant && { variant }, focus: focus.trim(), recipe: RECIPE };
    const tag = `${provider}/${model}${variant ? `/${variant}` : ""}`;
    let done = 0;
    const blocks = yield* Effect11.forEach(ids, (ref) => summarize(ref, key, refresh, tag).pipe(Effect11.catchTags({
      "Tools.CouldNotLook": (e) => Effect11.succeed(`# ${ref}
${e.message}`),
      "Summarize.Failed": (e) => Effect11.logWarning("summarize failed", ref, e.message).pipe(Effect11.as(`# ${ref}
Summarization failed with ${tag}: ${e.message}`))
    }), Effect11.tap(() => {
      done++;
      return ids.length > 1 ? Effect11.promise(() => ctx.progress({ title: `recall summarize: ${done}/${ids.length}` }).catch(() => {})) : Effect11.void;
    })), { concurrency: CONCURRENCY });
    if (blocks.length === 1)
      return { content: blocks[0], metadata: { title: `recall summary: ${ids[0]}` } };
    return { content: blocks.join(`

---

`), metadata: { title: `recall summaries: ${blocks.length} sessions` } };
  }, Effect11.catchTag("Tools.CouldNotLook", (e) => Effect11.succeed({ content: e.message })));
  const context = yield* Effect11.context();
  const info = {
    name: "recall_summarize",
    description: DESCRIPTION5,
    input: INPUT5,
    options: { codemode: false },
    execute: (input, ctx) => Effect11.runPromiseWith(context)(execute(input, ctx), { signal: ctx.signal })
  };
  return info;
});

// packages/plugin/src/index.ts
var sourceDbPath = Effect12.gen(function* () {
  const explicit = yield* Config2.option(Config2.String("OPENCODE_RECALL_SOURCE_DB"));
  if (Option7.isSome(explicit))
    return explicit.value;
  const data = yield* Config2.String("XDG_DATA_HOME").pipe(Config2.withDefault(join2(homedir3(), ".local", "share")));
  return join2(data, "opencode", "opencode.db");
});
var log = Logger.layer([Logger.make(({ message }) => console.error(`opencode-recall: ${[message].flat().join(" ")}`))]);
var events = (ctx) => Layer5.effectDiscard(Effect12.gen(function* () {
  const uploader = yield* Service4;
  yield* Effect12.forkScoped(uploader.reconcile);
  const abort = yield* Effect12.acquireRelease(Effect12.sync(() => new AbortController), (abort) => Effect12.sync(() => abort.abort()));
  yield* Stream.fromAsyncIterable(ctx.event.subscribe({ signal: abort.signal }), (e) => e).pipe(Stream.runForEach((event) => Effect12.gen(function* () {
    if (event.type === "server.connected")
      yield* Effect12.forkScoped(uploader.reconcile);
    if (event.type === "session.deleted")
      yield* uploader.delete(event.data.sessionID, { revision: event.durable.seq, timeDeleted: Math.ceil(event.created) });
    const changed = event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.execution.interrupted" && event.data.reason !== "shutdown" || event.type === "session.renamed" || event.type === "session.moved";
    if (changed)
      yield* uploader.enqueue(event.data.sessionID);
  })), Effect12.catch((e) => Effect12.logError("event stream failed:", e)), Effect12.forkScoped);
}));
var src_default = Plugin.define({
  id: "opencode-recall",
  setup: async (ctx) => {
    const services = Layer5.unwrap(Effect12.gen(function* () {
      const source = layer2(yield* sourceDbPath);
      const config = layer(yield* filePath);
      return Layer5.mergeAll(source, config, fromDomain(ctx.storage));
    }));
    const runtime = ManagedRuntime.make(events(ctx).pipe(Layer5.provideMerge(layer3()), Layer5.provideMerge(services), Layer5.provideMerge(log)));
    try {
      const tools = await runtime.runPromise(Effect12.all([make3(), make2(), make(), make5(ctx.generate), make4()]));
      await ctx.tool.transform((editor) => {
        for (const tool of tools)
          editor.add(tool);
      });
      await ctx.session.hook("context", inject);
    } catch (e) {
      await runtime.dispose();
      throw e;
    }
    return () => runtime.dispose();
  }
});
export {
  src_default as default
};
