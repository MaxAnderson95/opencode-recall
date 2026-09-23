import {
  Envelope,
  ErrorCode,
  PROTOCOL_VERSION,
  decodeRequest,
  requests,
  type ErrorBody,
  type Request as VerbRequest,
  type Responses,
  type Verb,
} from "@opencode-recall/protocol"
import { Effect, Schema, Semaphore } from "effect"
import { Archive, type Source } from "./archive/index.ts"

const STATUS: Record<ErrorCode, number> = {
  invalid_token: 401,
  protocol_version: 400,
  invalid_request: 400,
  unknown_verb: 404,
  stale_revision: 409,
  hash_divergence: 409,
  tombstoned: 409,
  payload_too_large: 413,
  rate_limited: 429,
  request_timeout: 408,
  internal: 500,
}

export type Limits = {
  /** Largest body accepted on the wire, before any decompression. */
  compressedBytes: number
  /** Largest body accepted after gzip decoding. */
  decompressedBytes: number
  /** Snapshots read and applied at once; one more is answered with `rate_limited`. */
  concurrentIngest: number
}

const MiB = 1024 * 1024
export const DEFAULT_LIMITS: Limits = { compressedBytes: 32 * MiB, decompressedBytes: 64 * MiB, concurrentIngest: 4 }

class TooLarge extends Error {}

/** A refusal answered with its code, rather than as an internal error. */
class Rejected extends Schema.TaggedError<Rejected>()("Server.Rejected", { code: ErrorCode, message: Schema.String }) {}

const reject = (code: ErrorCode, message: string) => new Rejected({ code, message })

function respond({ code, message }: Rejected): Response {
  return Response.json({ error: { code, message } } satisfies ErrorBody, { status: STATUS[code] })
}

/** Passes bytes through until more than `max` have been seen, then errors the stream. */
function capped(max: number) {
  let seen = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength
      if (seen > max) throw new TooLarge()
      controller.enqueue(chunk)
    },
  })
}

/**
 * Read a request body as text, decoding gzip, without ever buffering more than the caps allow.
 * An over-cap body is rejected, never truncated.
 */
const readBody = Effect.fnUntraced(function* (req: Request, limits: Limits) {
  const encoding = req.headers.get("content-encoding")?.toLowerCase() ?? "identity"
  if (encoding !== "identity" && encoding !== "gzip")
    return yield* reject("invalid_request", `unsupported content-encoding: ${encoding}`)
  const tooLarge = () =>
    reject(
      "payload_too_large",
      `body exceeds ${limits.compressedBytes} bytes on the wire or ${limits.decompressedBytes} bytes decoded`,
    )
  if (Number(req.headers.get("content-length")) > limits.compressedBytes) return yield* tooLarge()

  let stream = (req.body ?? new Blob().stream()).pipeThrough(capped(limits.compressedBytes))
  // The DOM typing accepts any BufferSource on the writable side; a request body only yields Uint8Array.
  if (encoding === "gzip")
    stream = stream.pipeThrough(new DecompressionStream("gzip") as ReadableWritablePair<Uint8Array, Uint8Array>)
  const decoded = stream.pipeThrough(capped(limits.decompressedBytes))
  return yield* Effect.tryPromise({
    try: () => new Response(decoded).text(),
    catch: (e) => (e instanceof TooLarge ? tooLarge() : reject("invalid_request", "body could not be decoded")),
  })
})

type Handlers = {
  [V in Verb]: (request: VerbRequest<V>, source: Source) => Effect.Effect<Responses[V], Rejected>
}

const isVerb = (name: string): name is Verb => Object.hasOwn(requests, name)

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * The `POST /v1/<verb>` handler, for `Bun.serve`: each request runs as an Effect with the services
 * and logger this was built with. Every request is authenticated before anything else is read,
 * and every body is schema-validated before any handler sees it. `onArchived` runs after each
 * snapshot the archive accepts.
 */
export const makeHandler = Effect.fnUntraced(function* ({
  limits = DEFAULT_LIMITS,
  onArchived = Effect.void,
}: {
  limits?: Limits
  onArchived?: Effect.Effect<void>
} = {}) {
  const archive = yield* Archive.Service
  const ingest = yield* Semaphore.make(limits.concurrentIngest)

  const handlers: Handlers = {
    snapshot: Effect.fnUntraced(function* ({ protocolVersion: _, ...snapshot }, source) {
      const result = yield* archive.putSnapshot(snapshot, source.id)
      const fields = { sessionId: snapshot.session.id, source: source.name, revision: snapshot.revision }
      switch (result) {
        case "stale_revision":
          yield* Effect.logInfo("snapshot rejected").pipe(Effect.annotateLogs({ ...fields, reason: result }))
          return yield* reject(result, "the archive holds a later position for this session")
        case "hash_divergence":
          yield* Effect.logWarning("snapshot rejected").pipe(Effect.annotateLogs({ ...fields, reason: result }))
          return yield* reject(result, "the archive holds different content at this position")
        case "tombstoned":
          yield* Effect.logInfo("snapshot rejected").pipe(Effect.annotateLogs({ ...fields, reason: result }))
          return yield* reject(result, "the session was deleted after this snapshot's last activity")
        case "rewound":
          yield* Effect.logWarning("snapshot accepted as a rewind").pipe(Effect.annotateLogs(fields))
          break
        default:
          yield* Effect.logInfo(`snapshot ${result}`).pipe(
            Effect.annotateLogs({ ...fields, messages: snapshot.session.messages.length }),
          )
      }
      if (result !== "unchanged") yield* onArchived
      return { outcome: result }
    }),
    tombstone: Effect.fnUntraced(function* ({ protocolVersion: _, ...tombstone }, source) {
      const result = yield* archive.putTombstone(tombstone, source.id)
      yield* Effect.logInfo("session tombstoned").pipe(
        Effect.annotateLogs({ sessionId: tombstone.sessionId, source: source.name, reason: tombstone.reason, ...result }),
      )
      return result
    }),
    manifest: (_, source) => archive.manifest(source.id),
    search: ({ protocolVersion: _, ...search }, source) => archive.search(search, source.id),
    inspect: ({ protocolVersion: _, ...inspect }, source) => archive.inspect(inspect, source.id),
    expand: ({ protocolVersion: _, ...expand }, source) => archive.expand(expand, source.id),
    transcript: ({ protocolVersion: _, ...transcript }, source) => archive.transcript(transcript, source.id),
    "summary.get": ({ protocolVersion: _, ...key }, source) => archive.getSummary(key, source.id),
    "summary.put": Effect.fnUntraced(function* ({ protocolVersion: _, ...summary }) {
      if ((yield* archive.putSummary(summary)) === "stale_revision")
        return yield* reject("stale_revision", "the archive no longer holds the content this summary was computed from")
      return {}
    }),
    status: () => archive.status(),
  }

  const dispatch = <V extends Verb>(verb: V, body: unknown, source: Source) =>
    decodeRequest(verb, body).pipe(
      Effect.mapError((e) => reject("invalid_request", e.message)),
      Effect.flatMap((request) => handlers[verb](request, source)),
      Effect.map((result) => Response.json(result)),
      Effect.catchDefect((defect) =>
        Effect.logError("request failed").pipe(
          Effect.annotateLogs({ verb, error: messageOf(defect) }),
          Effect.andThen(reject("internal", "internal error")),
        ),
      ),
    )

  const read = Effect.fnUntraced(function* (req: Request, verb: Verb, source: Source) {
    const text = yield* readBody(req, limits)
    const body = yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: () => reject("invalid_request", "body is not valid JSON"),
    })
    const envelope = yield* Schema.decodeUnknownEffect(Envelope)(body).pipe(
      Effect.mapError((e) => reject("invalid_request", e.message)),
    )
    if (envelope.protocolVersion !== PROTOCOL_VERSION)
      return yield* reject(
        "protocol_version",
        `client speaks protocol version ${envelope.protocolVersion}; this hub serves version ${PROTOCOL_VERSION}`,
      )
    return yield* dispatch(verb, body, source)
  })

  const handle = Effect.fnUntraced(function* (req: Request) {
    const { pathname } = new URL(req.url)

    const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1]
    const source = token ? yield* archive.authenticate(token) : undefined
    if (source?._tag !== "Some") {
      // Never log the presented token or any part of it.
      yield* Effect.logWarning("auth rejected").pipe(
        Effect.annotateLogs({ path: pathname, reason: token ? "unknown token" : "missing bearer token" }),
      )
      return yield* reject("invalid_token", "missing, malformed, or revoked bearer token")
    }

    const verb = pathname.match(/^\/v1\/([\w.]+)$/)?.[1]
    if (req.method !== "POST" || !verb || !isVerb(verb))
      return yield* reject("unknown_verb", `no such verb: ${req.method} ${pathname}`)

    if (verb !== "snapshot") return yield* read(req, verb, source.value)
    const ingested = yield* read(req, verb, source.value).pipe(ingest.withPermitsIfAvailable(1))
    if (ingested._tag === "Some") return ingested.value
    return yield* reject("rate_limited", `already ingesting ${limits.concurrentIngest} snapshots; retry later`)
  })

  const context = yield* Effect.context<never>()
  return (req: Request): Promise<Response> =>
    Effect.runPromiseWith(context)(handle(req).pipe(Effect.catchTag("Server.Rejected", (e) => Effect.succeed(respond(e)))))
})
