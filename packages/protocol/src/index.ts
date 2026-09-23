import { Effect, Option, Schema } from "effect"

/**
 * Bumped on any change to a request or response shape, including an added field. Requests are
 * decoded rejecting unknown fields, so a field sent without a bump fails loudly instead of being
 * stripped while the hub records the content hash that covered it. A new verb needs no bump: a hub
 * without it answers `unknown_verb`.
 */
export const PROTOCOL_VERSION = 3

const Int = Schema.Int
const NonNegativeInt = Int.check(Schema.isGreaterThanOrEqualTo(0))
const NonEmptyString = Schema.String.check(Schema.isNonEmpty())

export const Part = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["text", "reasoning"]), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("tool"),
    tool: Schema.String,
    title: Schema.String,
    /** OpenCode's tool state: `completed`, `error`, or in flight (`streaming`, `running`). */
    status: NonEmptyString,
    /** The failure message, present only on a failed call. */
    error: Schema.optionalKey(Schema.String),
    /** `<tool> <title>\n<output or error>`, at most 16,000 characters; empty while in flight. */
    text: Schema.String,
    /** False for a part archived for transcripts but kept out of the index. */
    searchable: Schema.Boolean,
  }),
])
export type Part = typeof Part.Type

export const MessageType = Schema.Literals(["user", "synthetic", "assistant", "compaction", "shell", "skill"])

export const Message = Schema.Struct({
  id: NonEmptyString,
  type: MessageType,
  timeCreated: Int,
  parts: Schema.Array(Part),
})
export interface Message extends Schema.Schema.Type<typeof Message> {}

export const Session = Schema.Struct({
  id: NonEmptyString,
  slug: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  timeCreated: Int,
  timeUpdated: Int,
  /** In transcript order. */
  messages: Schema.Array(Message),
})
export interface Session extends Schema.Schema.Type<typeof Session> {}

/** One session as the host read it, with the §5 position fields read in the same transaction. */
export const Snapshot = Schema.Struct({
  session: Session,
  /** `event_sequence.seq` for the session. */
  revision: NonNegativeInt,
  /** The later of the newest message's creation time and the session's `time_updated`. */
  lastActivity: Int,
  contentHash: NonEmptyString,
  extractorVersion: Int.check(Schema.isGreaterThan(0)),
})
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

/** An observed upstream deletion of a session. */
export const Tombstone = Schema.Struct({
  sessionId: NonEmptyString,
  /** The `session.deleted` event's own sequence number. */
  revision: NonNegativeInt,
  /** The `session.deleted` event's creation time; a snapshot must be active after it to return. */
  timeDeleted: Int,
})
export interface Tombstone extends Schema.Schema.Type<typeof Tombstone> {}

/** A corpus search. Every filter narrows the candidates inside the query, before any ranking cut. */
export const Search = Schema.Struct({
  query: Schema.String,
  /** `hybrid` (the default) fuses BM25 and cosine rankings; the others run one branch alone. */
  mode: Schema.optionalKey(Schema.Literals(["hybrid", "lexical", "semantic"])),
  /** `user-messages`: only the text of top-level sessions' user messages. */
  scope: Schema.optionalKey(Schema.Literals(["all", "user-messages"])),
  /** Inclusive bounds on message creation time, in epoch milliseconds. */
  since: Schema.optionalKey(Int),
  until: Schema.optionalKey(Int),
  /** Case-insensitive substring of the session's working directory. */
  directory: Schema.optionalKey(Schema.String),
  /** Name of the host the session was archived from. */
  source: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  /** Whether tool output is matched; default true. */
  includeTools: Schema.optionalKey(Schema.Boolean),
  /** Sessions returned. */
  limit: Int.check(Schema.isBetween({ minimum: 1, maximum: 25 })),
  /**
   * The calling session, whose content the caller can already see: its messages created at or after
   * `before` are left out. `before` is the time of its last compaction, or 0 if it never compacted.
   */
  exclude: Schema.optionalKey(Schema.Struct({ sessionId: NonEmptyString, before: Int })),
})
export interface Search extends Schema.Schema.Type<typeof Search> {}

const version = { protocolVersion: Schema.Literal(PROTOCOL_VERSION) }

export const requests = {
  snapshot: Schema.Struct({ ...version, ...Snapshot.fields }),
  tombstone: Schema.Struct({ ...version, ...Tombstone.fields }),
  manifest: Schema.Struct(version),
  search: Schema.Struct({ ...version, ...Search.fields }),
  status: Schema.Struct(version),
}

export type Verb = keyof typeof requests
export type Request<V extends Verb> = (typeof requests)[V]["Type"]

/** Decodes a verb's body, rejecting any field its schema does not declare. */
export const decodeRequest = <V extends Verb>(verb: V, body: unknown): Effect.Effect<Request<V>, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(requests[verb])(body, { onExcessProperty: "error" })

/**
 * Read before the verb's own schema, so a client on another protocol version is told about the
 * version rather than about whichever field changed shape. Other fields are left for the verb.
 */
export const Envelope = Schema.Struct({ protocolVersion: Int })

const Position = { revision: NonNegativeInt, lastActivity: Int, contentHash: NonEmptyString, extractorVersion: Int }

/** What the hub holds for every session from every source, so a host can diff without uploading. */
export const Manifest = Schema.Struct({
  sessions: Schema.Array(Schema.Struct({ sessionId: Schema.String, ...Position })),
  tombstones: Schema.Array(Schema.Struct({ sessionId: Schema.String, timeDeleted: Int })),
})
export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}

const hitFields = {
  messageId: Schema.String,
  /** The message's creation time. */
  time: Int,
  /** An excerpt of the matching segment or chunk, query terms marked `«…»`. */
  snippet: Schema.String,
}

/**
 * One hit of a search result. A lexical hit is a matching part; a semantic hit is an embedded
 * chunk of the turn anchored at `messageId`, scored by cosine similarity to the query.
 */
export const SearchHit = Schema.Union([
  Schema.Struct({
    ...hitFields,
    branch: Schema.Literal("lexical"),
    messageType: MessageType,
    kind: Schema.Literals(["text", "reasoning", "tool"]),
  }),
  Schema.Struct({ ...hitFields, branch: Schema.Literal("semantic"), score: Schema.Number }),
])
export type SearchHit = typeof SearchHit.Type

/** One ranked session. Where it came from is reported and never affects its rank. */
export const SearchResult = Schema.Struct({
  sessionId: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  timeUpdated: Int,
  /** Name of the host the archived copy was last accepted from. */
  source: Schema.String,
  /** Whether that host is the caller's own. */
  ownSource: Schema.Boolean,
  /** The archived revision, which may trail the host's newest turn. */
  revision: Int,
  /** Lexical candidates that matched in this session. */
  lexicalMatches: Int,
  /** Semantic candidates that matched in this session. */
  semanticMatches: Int,
  /** Its best hits, at most two, one per message. */
  hits: Schema.Array(SearchHit),
})
export interface SearchResult extends Schema.Schema.Type<typeof SearchResult> {}

/**
 * Everything that decides what a stored vector means. Two spaces with any field different hold
 * incomparable vectors, even at the same model and dimensions.
 */
export const SpaceRecipe = Schema.Struct({
  /** Model repository and the exact artifact revision its files were fetched at. */
  model: Schema.String,
  revision: Schema.String,
  dtype: Schema.String,
  dims: Int,
  /** The runtime that tokenizes and runs the model. */
  runtime: Schema.String,
  pooling: Schema.Literal("mean"),
  normalize: Schema.Boolean,
  /** Prepended to a query, never to a chunk. */
  queryPrefix: Schema.String,
  /** Characters per chunk window and the overlap between consecutive windows. */
  chunkChars: Int,
  chunkOverlap: Int,
  /** Characters of one turn embedded at most; a longer turn keeps its head and tail. */
  turnChars: Int,
  /** Version of the turn-pair rendering that produces chunk text. */
  rendering: Int,
})
export interface SpaceRecipe extends Schema.Schema.Type<typeof SpaceRecipe> {}

export const responses = {
  /**
   * `unchanged`: the hub already holds this content, so nothing was written.
   * `rewound`: accepted at a later position whose revision is not higher than the one held.
   */
  snapshot: Schema.Struct({ outcome: Schema.Literals(["archived", "rewound", "unchanged"]) }),
  /** `removed`: whether the archive held a copy of the session that this deleted. */
  tombstone: Schema.Struct({ removed: Schema.Boolean }),
  manifest: Manifest,
  /**
   * Best first. `semanticUnavailable` is set, with the reason, when the requested semantic branch
   * could not run; hybrid results are then lexical only.
   */
  search: Schema.Struct({ sessions: Schema.Array(SearchResult), semanticUnavailable: Schema.optionalKey(Schema.String) }),
  status: Schema.Struct({
    sessions: Int,
    /** Chunks in the active space, and how many of them are embedded; the rest wait in the queue. */
    chunks: Int,
    embeddedChunks: Int,
    /** `matchesConfigured` is false when this hub would build a different space than the active one. */
    activeSpace: Schema.Struct({ recipe: SpaceRecipe, matchesConfigured: Schema.Boolean }),
  }),
} satisfies Record<Verb, Schema.Top>

export type Responses = { [V in Verb]: (typeof responses)[V]["Type"] }

export const ErrorCode = Schema.Literals([
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
  "internal",
])
export type ErrorCode = typeof ErrorCode.Type
export type ErrorBody = { error: { code: ErrorCode; message: string } }

/** Codes a proxy in front of the hub can produce without the hub's error envelope. */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  408: "request_timeout",
  413: "payload_too_large",
  429: "rate_limited",
}

/** A non-2xx answer, from the hub or from a proxy in front of it. */
export class HubError extends Schema.TaggedError<HubError>()("HubError", {
  code: ErrorCode,
  message: Schema.String,
  status: Schema.Number,
}) {}

/** No answer to read: the request failed to send, or a 2xx body is not the verb's response. */
export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export type ClientOptions = {
  url: string
  /** Bearer token issued by the hub's `token issue`; it identifies this host's source. */
  token: string
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}

export interface Client {
  readonly snapshot: (snapshot: Snapshot) => Effect.Effect<Responses["snapshot"], HubError | TransportError>
  readonly tombstone: (tombstone: Tombstone) => Effect.Effect<Responses["tombstone"], HubError | TransportError>
  readonly manifest: () => Effect.Effect<Responses["manifest"], HubError | TransportError>
  readonly search: (search: Search) => Effect.Effect<Responses["search"], HubError | TransportError>
  readonly status: () => Effect.Effect<Responses["status"], HubError | TransportError>
}

// A proxy in front of the hub can answer with any body, so the envelope is not assumed.
const ErrorEnvelope = Schema.Struct({
  error: Schema.Struct({ code: Schema.optionalKey(ErrorCode), message: Schema.optionalKey(Schema.String) }),
})

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/**
 * Typed client for the hub's `POST /v1/<verb>` API. Bodies are gzip-encoded, since Bun's `fetch`
 * never compresses a request on its own. A non-2xx answer fails with {@link HubError}; anything
 * that is not an answer fails with {@link TransportError}. Interrupting a call aborts its request.
 */
export function makeClient({ url, token, fetch: fetcher = fetch }: ClientOptions): Client {
  const base = url.replace(/\/+$/, "")

  const call = Effect.fnUntraced(function* <V extends Verb>(verb: V, input: Omit<Request<V>, "protocolVersion">) {
    const transport = (cause: unknown) => new TransportError({ message: messageOf(cause), cause })
    const res = yield* Effect.tryPromise({
      try: (signal) =>
        fetcher(`${base}/v1/${verb}`, {
          method: "POST",
          headers: { "content-type": "application/json", "content-encoding": "gzip", authorization: `Bearer ${token}` },
          body: Bun.gzipSync(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...input })),
          signal,
        }),
      catch: transport,
    })
    if (res.ok) {
      const body = yield* Effect.tryPromise({ try: () => res.json(), catch: transport })
      const decoded: (typeof responses)[V]["Type"] = yield* Schema.decodeUnknownEffect(responses[verb])(body).pipe(Effect.mapError(transport))
      return decoded
    }
    const body = yield* Effect.promise(() => res.json().catch(() => null))
    const { error } = Option.getOrElse(Schema.decodeUnknownOption(ErrorEnvelope)(body), (): typeof ErrorEnvelope.Type => ({ error: {} }))
    return yield* new HubError({
      code: error.code ?? CODE_BY_STATUS[res.status] ?? "internal",
      message: error.message ?? `HTTP ${res.status}`,
      status: res.status,
    })
  })

  return {
    snapshot: (snapshot) => call("snapshot", snapshot),
    tombstone: (tombstone) => call("tombstone", tombstone),
    manifest: () => call("manifest", {}),
    search: (search) => call("search", search),
    status: () => call("status", {}),
  }
}
