import { z } from "zod"
import {
  Envelope,
  PROTOCOL_VERSION,
  requests,
  type ErrorBody,
  type ErrorCode,
  type Request as VerbRequest,
  type Responses,
  type Verb,
} from "@opencode-recall/protocol"
import type { Archive, Source } from "./archive/index.ts"
import type { Log } from "./log.ts"

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
async function readBody(req: Request, limits: Limits): Promise<string | Response> {
  const encoding = req.headers.get("content-encoding")?.toLowerCase() ?? "identity"
  if (encoding !== "identity" && encoding !== "gzip") return fail("invalid_request", `unsupported content-encoding: ${encoding}`)
  const tooLarge = () =>
    fail(
      "payload_too_large",
      `body exceeds ${limits.compressedBytes} bytes on the wire or ${limits.decompressedBytes} bytes decoded`,
    )
  if (Number(req.headers.get("content-length")) > limits.compressedBytes) return tooLarge()

  let stream = (req.body ?? new Blob().stream()).pipeThrough(capped(limits.compressedBytes))
  // The DOM typing accepts any BufferSource on the writable side; a request body only yields Uint8Array.
  if (encoding === "gzip")
    stream = stream.pipeThrough(new DecompressionStream("gzip") as ReadableWritablePair<Uint8Array, Uint8Array>)
  try {
    return await new Response(stream.pipeThrough(capped(limits.decompressedBytes))).text()
  } catch (e) {
    return e instanceof TooLarge ? tooLarge() : fail("invalid_request", "body could not be decoded")
  }
}

type Handlers = { [V in Verb]: (request: VerbRequest<V>, source: Source) => Responses[V] | Promise<Responses[V]> }

/** A handler's refusal, answered with its code rather than as an internal error. */
class Rejection extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
  }
}

function fail(code: ErrorCode, message: string): Response {
  return Response.json({ error: { code, message } } satisfies ErrorBody, { status: STATUS[code] })
}

const isVerb = (name: string): name is Verb => Object.hasOwn(requests, name)

/**
 * The `POST /v1/<verb>` handler. Every request is authenticated before anything
 * else is read, and every body is schema-validated before any handler sees it.
 * `onArchived` runs after each snapshot the archive accepts.
 */
export function createHandler({
  archive,
  log,
  limits = DEFAULT_LIMITS,
  onArchived = () => {},
}: {
  archive: Archive
  log: Log
  limits?: Limits
  onArchived?: () => void
}) {
  let ingesting = 0

  const handlers: Handlers = {
    snapshot: ({ protocolVersion: _, ...snapshot }, source) => {
      const result = archive.putSnapshot(snapshot, source.id)
      const fields = { sessionId: snapshot.session.id, source: source.name, revision: snapshot.revision }
      switch (result) {
        case "stale_revision":
          log("info", "snapshot rejected", { ...fields, reason: result })
          throw new Rejection(result, "the archive holds a later position for this session")
        case "hash_divergence":
          log("warn", "snapshot rejected", { ...fields, reason: result })
          throw new Rejection(result, "the archive holds different content at this position")
        case "tombstoned":
          log("info", "snapshot rejected", { ...fields, reason: result })
          throw new Rejection(result, "the session was deleted after this snapshot's last activity")
        case "rewound":
          log("warn", "snapshot accepted as a rewind", fields)
          break
        default:
          log("info", `snapshot ${result}`, { ...fields, messages: snapshot.session.messages.length })
      }
      if (result !== "unchanged") onArchived()
      return { outcome: result }
    },
    tombstone: ({ protocolVersion: _, ...tombstone }, source) => {
      const result = archive.putTombstone(tombstone, source.id)
      log("info", "session tombstoned", { sessionId: tombstone.sessionId, source: source.name, ...result })
      return result
    },
    manifest: () => archive.manifest(),
    search: ({ protocolVersion: _, ...search }, source) => archive.search(search, source.id),
    status: () => archive.status(),
  }

  async function dispatch<V extends Verb>(verb: V, body: unknown, source: Source): Promise<Response> {
    const parsed = requests[verb].safeParse(body)
    if (!parsed.success) return fail("invalid_request", z.prettifyError(parsed.error))
    return Response.json(await handlers[verb](parsed.data as VerbRequest<V>, source))
  }

  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url)

    const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1]
    const source = token ? archive.authenticate(token) : null
    if (!source) {
      // Never log the presented token or any part of it.
      log("warn", "auth rejected", { path: pathname, reason: token ? "unknown token" : "missing bearer token" })
      return fail("invalid_token", "missing, malformed, or revoked bearer token")
    }

    const verb = pathname.match(/^\/v1\/([\w.]+)$/)?.[1]
    if (req.method !== "POST" || !verb || !isVerb(verb)) return fail("unknown_verb", `no such verb: ${req.method} ${pathname}`)

    const ingest = verb === "snapshot"
    if (ingest && ingesting >= limits.concurrentIngest)
      return fail("rate_limited", `already ingesting ${ingesting} snapshots; retry later`)
    if (ingest) ingesting++
    try {
      return await handle(req, verb, source)
    } finally {
      if (ingest) ingesting--
    }
  }

  async function handle(req: Request, verb: Verb, source: Source): Promise<Response> {
    const text = await readBody(req, limits)
    if (text instanceof Response) return text
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return fail("invalid_request", "body is not valid JSON")
    }
    const envelope = Envelope.safeParse(body)
    if (!envelope.success) return fail("invalid_request", z.prettifyError(envelope.error))
    if (envelope.data.protocolVersion !== PROTOCOL_VERSION)
      return fail(
        "protocol_version",
        `client speaks protocol version ${envelope.data.protocolVersion}; this hub serves version ${PROTOCOL_VERSION}`,
      )

    try {
      return await dispatch(verb, body, source)
    } catch (e) {
      if (e instanceof Rejection) return fail(e.code, e.message)
      log("error", "request failed", { verb, error: e instanceof Error ? e.message : String(e) })
      return fail("internal", "internal error")
    }
  }
}
