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
import type { Archive } from "./archive/index.ts"
import type { Log } from "./log.ts"

const STATUS: Record<ErrorCode, number> = {
  protocol_version: 400,
  invalid_request: 400,
  unknown_verb: 404,
  internal: 500,
}

type Handlers = { [V in Verb]: (request: VerbRequest<V>) => Responses[V] }

function fail(code: ErrorCode, message: string): Response {
  return Response.json({ error: { code, message } } satisfies ErrorBody, { status: STATUS[code] })
}

const isVerb = (name: string): name is Verb => Object.hasOwn(requests, name)

/** The `POST /v1/<verb>` handler. Every body is schema-validated before any handler sees it. */
export function createHandler({ archive, log }: { archive: Archive; log: Log }) {
  const handlers: Handlers = {
    snapshot: ({ session }) => {
      archive.putSnapshot(session)
      log("info", "snapshot archived", { sessionId: session.id, messages: session.messages.length })
      return { outcome: "archived" }
    },
    status: () => archive.status(),
  }

  function dispatch<V extends Verb>(verb: V, body: unknown): Response {
    const parsed = requests[verb].safeParse(body)
    if (!parsed.success) return fail("invalid_request", z.prettifyError(parsed.error))
    return Response.json(handlers[verb](parsed.data as VerbRequest<V>))
  }

  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url)
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
      return dispatch(verb, body)
    } catch (e) {
      log("error", "request failed", { verb, error: e instanceof Error ? e.message : String(e) })
      return fail("internal", "internal error")
    }
  }
}
