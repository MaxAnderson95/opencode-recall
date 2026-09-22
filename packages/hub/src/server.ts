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
  internal: 500,
}

type Handlers = { [V in Verb]: (request: VerbRequest<V>, source: Source) => Responses[V] }

function fail(code: ErrorCode, message: string): Response {
  return Response.json({ error: { code, message } } satisfies ErrorBody, { status: STATUS[code] })
}

const isVerb = (name: string): name is Verb => Object.hasOwn(requests, name)

/**
 * The `POST /v1/<verb>` handler. Every request is authenticated before anything
 * else is read, and every body is schema-validated before any handler sees it.
 */
export function createHandler({ archive, log }: { archive: Archive; log: Log }) {
  const handlers: Handlers = {
    snapshot: ({ session }, source) => {
      archive.putSnapshot(session, source.id)
      log("info", "snapshot archived", { sessionId: session.id, source: source.name, messages: session.messages.length })
      return { outcome: "archived" }
    },
    status: () => archive.status(),
  }

  function dispatch<V extends Verb>(verb: V, body: unknown, source: Source): Response {
    const parsed = requests[verb].safeParse(body)
    if (!parsed.success) return fail("invalid_request", z.prettifyError(parsed.error))
    return Response.json(handlers[verb](parsed.data as VerbRequest<V>, source))
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

    let body: unknown
    try {
      body = await req.json()
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
      return dispatch(verb, body, source)
    } catch (e) {
      log("error", "request failed", { verb, error: e instanceof Error ? e.message : String(e) })
      return fail("internal", "internal error")
    }
  }
}
