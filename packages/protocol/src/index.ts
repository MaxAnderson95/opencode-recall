import { z } from "zod"

/**
 * Bumped on any change to a request or response shape, including an added field. Request schemas
 * reject unknown fields, so a field sent without a bump fails loudly instead of being stripped
 * while the hub records the content hash that covered it.
 */
export const PROTOCOL_VERSION = 2

const version = z.literal(PROTOCOL_VERSION)

export const Part = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["text", "reasoning"]), text: z.string() }),
  z.strictObject({
    kind: z.literal("tool"),
    tool: z.string(),
    title: z.string(),
    /** OpenCode's tool state: `completed`, `error`, or in flight (`streaming`, `running`). */
    status: z.string().min(1),
    /** The failure message, present only on a failed call. */
    error: z.string().optional(),
    /** `<tool> <title>\n<output or error>`, at most 16,000 characters; empty while in flight. */
    text: z.string(),
    /** False for a part archived for transcripts but kept out of the index. */
    searchable: z.boolean(),
  }),
])

export const Message = z.strictObject({
  id: z.string().min(1),
  type: z.enum(["user", "synthetic", "assistant", "compaction", "shell", "skill"]),
  timeCreated: z.number().int(),
  parts: z.array(Part),
})

export const Session = z.strictObject({
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

/** One session as the host read it, with the §5 position fields read in the same transaction. */
export const Snapshot = z.strictObject({
  session: Session,
  /** `event_sequence.seq` for the session. */
  revision: z.number().int().nonnegative(),
  /** The later of the newest message's creation time and the session's `time_updated`. */
  lastActivity: z.number().int(),
  contentHash: z.string().min(1),
  extractorVersion: z.number().int().positive(),
})

/** An observed upstream deletion of a session. */
export const Tombstone = z.strictObject({
  sessionId: z.string().min(1),
  /** The `session.deleted` event's own sequence number. */
  revision: z.number().int().nonnegative(),
  /** The `session.deleted` event's creation time; a snapshot must be active after it to return. */
  timeDeleted: z.number().int(),
})

export const requests = {
  snapshot: z.strictObject({ protocolVersion: version, ...Snapshot.shape }),
  tombstone: z.strictObject({ protocolVersion: version, ...Tombstone.shape }),
  manifest: z.strictObject({ protocolVersion: version }),
  status: z.strictObject({ protocolVersion: version }),
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
export type Snapshot = z.infer<typeof Snapshot>
export type Tombstone = z.infer<typeof Tombstone>
export type Request<V extends Verb> = z.infer<(typeof requests)[V]>

/** What the hub holds for every session from every source, so a host can diff without uploading. */
export type Manifest = {
  sessions: ({ sessionId: string } & Pick<Snapshot, "revision" | "lastActivity" | "contentHash" | "extractorVersion">)[]
  tombstones: Pick<Tombstone, "sessionId" | "timeDeleted">[]
}

export type Responses = {
  /**
   * `unchanged`: the hub already holds this content, so nothing was written.
   * `rewound`: accepted at a later position whose revision is not higher than the one held.
   */
  snapshot: { outcome: "archived" | "rewound" | "unchanged" }
  /** `removed`: whether the archive held a copy of the session that this deleted. */
  tombstone: { removed: boolean }
  manifest: Manifest
  status: { sessions: number }
}

export type ErrorCode =
  | "invalid_token"
  | "protocol_version"
  | "invalid_request"
  | "unknown_verb"
  | "stale_revision"
  | "hash_divergence"
  | "tombstoned"
  | "payload_too_large"
  | "rate_limited"
  | "request_timeout"
  | "internal"
export type ErrorBody = { error: { code: ErrorCode; message: string } }

/** Codes a proxy in front of the hub can produce without the hub's error envelope. */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  408: "request_timeout",
  413: "payload_too_large",
  429: "rate_limited",
}

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

/**
 * Typed client for the hub's `POST /v1/<verb>` API. Bodies are gzip-encoded, since Bun's
 * `fetch` never compresses a request on its own. Non-2xx responses throw {@link HubError}.
 */
export function createClient({ url, token, fetch: fetcher = fetch }: ClientOptions) {
  const base = url.replace(/\/+$/, "")

  async function call<V extends Verb>(verb: V, input: Omit<Request<V>, "protocolVersion">): Promise<Responses[V]> {
    const res = await fetcher(`${base}/v1/${verb}`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip", authorization: `Bearer ${token}` },
      body: Bun.gzipSync(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...input })),
    })
    if (res.ok) return (await res.json()) as Responses[V]
    // A proxy in front of the hub can answer with any body, so the envelope is not assumed.
    const body = (await res.json().catch(() => null)) as Partial<ErrorBody> | null
    const code = body?.error?.code ?? CODE_BY_STATUS[res.status] ?? "internal"
    throw new HubError(code, body?.error?.message ?? `HTTP ${res.status}`, res.status)
  }

  return {
    snapshot: (snapshot: Snapshot) => call("snapshot", snapshot),
    tombstone: (tombstone: Tombstone) => call("tombstone", tombstone),
    manifest: () => call("manifest", {}),
    status: () => call("status", {}),
  }
}

export type Client = ReturnType<typeof createClient>
