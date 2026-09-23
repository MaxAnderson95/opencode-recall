import { z } from "zod"

/** Bumped on any incompatible change to a request or response shape. */
export const PROTOCOL_VERSION = 1

const version = z.literal(PROTOCOL_VERSION)

export const Part = z.object({
  kind: z.enum(["text", "reasoning", "tool"]),
  text: z.string(),
})

export const Message = z.object({
  id: z.string().min(1),
  type: z.enum(["user", "synthetic", "assistant", "compaction", "shell", "skill"]),
  timeCreated: z.number().int(),
  parts: z.array(Part),
})

export const Session = z.object({
  id: z.string().min(1),
  slug: z.string(),
  title: z.string(),
  directory: z.string(),
  parentId: z.string().nullable(),
  timeCreated: z.number().int(),
  timeUpdated: z.number().int(),
  /** In transcript order. */
  messages: z.array(Message),
})

export const requests = {
  snapshot: z.object({ protocolVersion: version, session: Session }),
  status: z.object({ protocolVersion: version }),
}

/**
 * Read before the verb's own schema, so a client on another protocol version
 * is told about the version rather than about whichever field changed shape.
 */
export const Envelope = z.looseObject({ protocolVersion: z.number().int() })

export type Verb = keyof typeof requests
export type Part = z.infer<typeof Part>
export type Message = z.infer<typeof Message>
export type Session = z.infer<typeof Session>
export type Request<V extends Verb> = z.infer<(typeof requests)[V]>

export type Responses = {
  snapshot: { outcome: "archived" }
  status: { sessions: number }
}

export type ErrorCode = "invalid_token" | "protocol_version" | "invalid_request" | "unknown_verb" | "internal"
export type ErrorBody = { error: { code: ErrorCode; message: string } }

export class HubError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "HubError"
  }
}

export type ClientOptions = {
  url: string
  /** Bearer token issued by the hub's `token issue`; it identifies this host's source. */
  token: string
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}

/** Typed client for the hub's `POST /v1/<verb>` API. Non-2xx responses throw {@link HubError}. */
export function createClient({ url, token, fetch: fetcher = fetch }: ClientOptions) {
  const base = url.replace(/\/+$/, "")

  async function call<V extends Verb>(verb: V, input: Omit<Request<V>, "protocolVersion">): Promise<Responses[V]> {
    const res = await fetcher(`${base}/v1/${verb}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...input }),
    })
    if (res.ok) return (await res.json()) as Responses[V]
    // A proxy in front of the hub can answer with any body, so the envelope is not assumed.
    const body = (await res.json().catch(() => null)) as Partial<ErrorBody> | null
    throw new HubError(body?.error?.code ?? "internal", body?.error?.message ?? `HTTP ${res.status}`, res.status)
  }

  return {
    snapshot: (session: Session) => call("snapshot", { session }),
    status: () => call("status", {}),
  }
}

export type Client = ReturnType<typeof createClient>
