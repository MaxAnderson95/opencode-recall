import { afterEach, beforeEach, expect, test } from "bun:test"
import { HubError, PROTOCOL_VERSION, createClient, type Snapshot } from "@opencode-recall/protocol"
import { openArchive, type Archive } from "./archive/index.ts"
import { createLog } from "./log.ts"
import { createHandler, type Limits } from "./server.ts"

let archive: Archive
let handler: ReturnType<typeof createHandler>
let token: string
let logLines: string[]

beforeEach(() => {
  archive = openArchive(":memory:")
  token = archive.issueToken("laptop")
  logLines = []
  handler = createHandler({ archive, log: createLog("debug", (line) => logLines.push(line)) })
})
afterEach(() => archive.close())

const post = (verb: string, body: unknown, bearer: string | null = token) =>
  handler(
    new Request(`http://hub/v1/${verb}`, {
      method: "POST",
      headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    }),
  )

const snapshot: Snapshot = {
  session: {
    id: "ses_a",
    slug: "slug",
    title: "title",
    directory: "/work",
    parentId: null,
    timeCreated: 1,
    timeUpdated: 2,
    messages: [{ id: "msg_1", type: "user", timeCreated: 1, parts: [{ kind: "text", text: "hello" }] }],
  },
  revision: 3,
  lastActivity: 2,
  contentHash: "hash-1",
  extractorVersion: 1,
}
const { session } = snapshot

const clientFor = (h: typeof handler) =>
  createClient({ url: "http://hub/", token, fetch: async (input, init) => h(new Request(input, init)) })

test("the typed client archives a snapshot and status counts it", async () => {
  const client = clientFor(handler)
  expect(await client.snapshot(snapshot)).toEqual({ outcome: "archived" })
  expect(await client.snapshot(snapshot)).toEqual({ outcome: "unchanged" })
  expect(await client.status()).toEqual({ sessions: 1 })
})

test("the typed client tombstones a session, lists it in the manifest, and a stale upload is tombstoned", async () => {
  const client = clientFor(handler)
  await client.snapshot(snapshot)
  expect(await client.manifest()).toEqual({
    sessions: [{ sessionId: "ses_a", revision: 3, lastActivity: 2, contentHash: "hash-1", extractorVersion: 1 }],
    tombstones: [],
  })
  expect(await client.tombstone({ sessionId: "ses_a", revision: 4, timeDeleted: 5 })).toEqual({ removed: true })
  expect(await client.manifest()).toEqual({ sessions: [], tombstones: [{ sessionId: "ses_a", timeDeleted: 5 }] })
  const error = await client.snapshot(snapshot).catch((e: unknown) => e)
  expect(error).toMatchObject({ code: "tombstoned", status: 409 })
})

test("search finds another host's session through the caller's own token and names its origin", async () => {
  // The desktop uploads once and goes away; only the archive's copy remains.
  const desktop = createClient({
    url: "http://hub",
    token: archive.issueToken("desktop"),
    fetch: async (input, init) => handler(new Request(input, init)),
  })
  await desktop.snapshot(snapshot)

  const { sessions } = await clientFor(handler).search({ query: "hello", limit: 8 })
  expect(sessions).toMatchObject([{ sessionId: "ses_a", source: "desktop", ownSource: false, revision: 3 }])
  expect(sessions[0]!.hits[0]!.snippet).toBe("«hello»")
})

test("a search with an unknown filter is rejected rather than silently widened", async () => {
  const res = await post("search", { protocolVersion: PROTOCOL_VERSION, query: "x", limit: 8, project: "y" })
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } })
})

test("the client sends gzip-encoded bodies with Content-Encoding set", async () => {
  let seen: Request | undefined
  const client = createClient({
    url: "http://hub",
    token,
    fetch: async (input, init) => {
      seen = new Request(input, init)
      return handler(seen.clone())
    },
  })
  await client.snapshot(snapshot)
  expect(seen!.headers.get("content-encoding")).toBe("gzip")
  const body = new Uint8Array(await seen!.arrayBuffer())
  expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(body)))).toMatchObject({ contentHash: "hash-1" })
})

test.each([
  ["an earlier position", { revision: 2, contentHash: "hash-0" }, "stale_revision"],
  ["an equal position with different content", { contentHash: "hash-2" }, "hash_divergence"],
] as const)("a snapshot at %s is rejected as %s", async (_, fields, code) => {
  const client = clientFor(handler)
  await client.snapshot(snapshot)
  const error = await client.snapshot({ ...snapshot, ...fields }).catch((e: unknown) => e)
  expect(error).toMatchObject({ code, status: 409 })
})

const small: Limits = { compressedBytes: 1_000, decompressedBytes: 4_000, concurrentIngest: 1 }
const limitedHandler = (limits: Limits = small) => createHandler({ archive, log: () => {}, limits })
const withText = (text: string): Snapshot => ({
  ...snapshot,
  session: { ...session, messages: [{ ...session.messages[0]!, parts: [{ kind: "text", text }] }] },
})

test.each([
  ["too large once decoded, though small on the wire", withText("a".repeat(10_000))],
  ["too large on the wire", withText(crypto.getRandomValues(new Uint8Array(2_000)).toBase64())],
])("a body %s is rejected as payload_too_large and nothing is archived", async (_, big) => {
  const error = await clientFor(limitedHandler()).snapshot(big).catch((e: unknown) => e)
  expect(error).toMatchObject({ code: "payload_too_large", status: 413 })
  expect(archive.status()).toEqual({ sessions: 0 })
})

test("a declared Content-Length over the wire cap is rejected before the body is read", async () => {
  const res = await limitedHandler()(
    new Request("http://hub/v1/snapshot", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-length": String(small.compressedBytes + 1) },
      body: "{}",
    }),
  )
  expect(res.status).toBe(413)
})

test("an unsupported Content-Encoding or a corrupt gzip body is an invalid request", async () => {
  const send = (encoding: string, body: BodyInit) =>
    handler(
      new Request("http://hub/v1/status", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-encoding": encoding },
        body,
      }),
    )
  expect(await errorCode(await send("br", "{}"))).toBe("invalid_request")
  expect(await errorCode(await send("gzip", "not gzip"))).toBe("invalid_request")
})

test("a snapshot beyond the concurrent ingestion bound is answered with rate_limited", async () => {
  const h = limitedHandler()
  let release!: () => void
  const held = new ReadableStream<Uint8Array>({
    start(controller) {
      release = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...snapshot })))
        controller.close()
      }
    },
  })
  const first = h(
    new Request("http://hub/v1/snapshot", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: held }),
  )
  const error = await clientFor(h).snapshot(snapshot).catch((e: unknown) => e)
  expect(error).toMatchObject({ code: "rate_limited", status: 429 })
  expect(await clientFor(h).status()).toEqual({ sessions: 0 })

  release()
  expect((await first).status).toBe(200)
  expect(await clientFor(h).snapshot(snapshot)).toEqual({ outcome: "unchanged" })
})

test("an unsupported protocol version is rejected with both versions named", async () => {
  const res = await post("snapshot", { protocolVersion: PROTOCOL_VERSION + 1, ...snapshot })
  expect(res.status).toBe(400)
  const { error } = (await res.json()) as { error: { code: string; message: string } }
  expect(error.code).toBe("protocol_version")
  expect(error.message).toContain(`version ${PROTOCOL_VERSION + 1}`)
  expect(error.message).toContain(`version ${PROTOCOL_VERSION}`)
  expect(archive.status()).toEqual({ sessions: 0 })
})

test("a snapshot with tool parts from a protocol 1 client is refused rather than stripped", async () => {
  const toolPart = { kind: "tool", tool: "recall_search", title: "x", status: "completed", text: "hits", searchable: false }
  const res = await post("snapshot", {
    ...snapshot,
    protocolVersion: 1,
    session: { ...session, messages: [{ ...session.messages[0], parts: [toolPart] }] },
  })
  expect(res.status).toBe(400)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("protocol_version")
  expect(archive.status()).toEqual({ sessions: 0 })
})

test.each([
  ["missing protocol version", { session }],
  ["missing session", { protocolVersion: PROTOCOL_VERSION }],
  ["missing revision", { protocolVersion: PROTOCOL_VERSION, ...snapshot, revision: undefined }],
  ["wrong field type", { protocolVersion: PROTOCOL_VERSION, ...snapshot, session: { ...session, timeCreated: "yesterday" } }],
  [
    "unknown part kind",
    {
      protocolVersion: PROTOCOL_VERSION,
      ...snapshot,
      session: { ...session, messages: [{ ...session.messages[0], parts: [{ kind: "file", text: "x" }] }] },
    },
  ],
  ["unknown top-level field", { protocolVersion: PROTOCOL_VERSION, ...snapshot, extra: 1 }],
  [
    "unknown part field",
    {
      protocolVersion: PROTOCOL_VERSION,
      ...snapshot,
      session: { ...session, messages: [{ ...session.messages[0], parts: [{ kind: "text", text: "x", extra: 1 }] }] },
    },
  ],
])("a malformed snapshot (%s) is rejected before reaching the archive", async (_, body) => {
  const res = await post("snapshot", body)
  expect(res.status).toBe(400)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_request")
  expect(archive.status()).toEqual({ sessions: 0 })
})

test("a body that is not JSON is rejected", async () => {
  const res = await handler(
    new Request("http://hub/v1/snapshot", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{" }),
  )
  expect(res.status).toBe(400)
})

test("an unknown verb is rejected", async () => {
  const res = await post("nope", { protocolVersion: PROTOCOL_VERSION })
  expect(res.status).toBe(404)
})

test("the client raises the hub's rejection as a HubError carrying its code", async () => {
  const client = createClient({
    url: "http://hub",
    token,
    fetch: async (input, init) => {
      const body = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(init.body as Uint8Array<ArrayBuffer>)))
      return handler(new Request(input, { ...init, body: Bun.gzipSync(JSON.stringify({ ...body, protocolVersion: 0 })) }))
    },
  })
  const error = await client.status().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(HubError)
  expect(error).toMatchObject({ code: "protocol_version", status: 400 })
})

test.each([
  ["JSON without an error envelope", 502, () => Response.json({ message: "Bad Gateway" }, { status: 502 }), "internal"],
  ["a non-JSON body", 502, () => new Response("<html>Bad Gateway</html>", { status: 502 }), "internal"],
  ["408", 408, () => new Response("timeout", { status: 408 }), "request_timeout"],
  ["413", 413, () => new Response("too big", { status: 413 }), "payload_too_large"],
  ["429", 429, () => new Response("slow down", { status: 429 }), "rate_limited"],
])("the client falls back to the HTTP status when a proxy answers with %s", async (_, status, respond, code) => {
  const client = createClient({ url: "http://hub", token, fetch: async () => respond() })
  const error = await client.status().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(HubError)
  expect(error).toMatchObject({ code, message: `HTTP ${status}`, status })
})

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code

test.each([
  ["no Authorization header", null],
  ["an unknown token", "opencode-recall_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  ["a token that is not a bearer credential", ""],
])("a request with %s fails with invalid_token and archives nothing", async (_, bearer) => {
  const res = await post("snapshot", { protocolVersion: PROTOCOL_VERSION, ...snapshot }, bearer)
  expect(res.status).toBe(401)
  expect(await errorCode(res)).toBe("invalid_token")
  expect(archive.status()).toEqual({ sessions: 0 })
})

test("authentication is checked before the protocol version", async () => {
  const res = await post("status", { protocolVersion: PROTOCOL_VERSION + 1 }, null)
  expect(await errorCode(res)).toBe("invalid_token")
})

test("a revoked token fails on the very next request", async () => {
  expect((await post("status", { protocolVersion: PROTOCOL_VERSION })).status).toBe(200)
  archive.revokeToken(archive.listTokens()[0]!.id)
  const res = await post("status", { protocolVersion: PROTOCOL_VERSION })
  expect(res.status).toBe(401)
  expect(await errorCode(res)).toBe("invalid_token")
})

test("the auth-rejection log line contains no token material", async () => {
  archive.revokeToken(archive.listTokens()[0]!.id)
  await post("status", { protocolVersion: PROTOCOL_VERSION })
  const rejection = logLines.map((l) => JSON.parse(l)).find((l) => l.msg === "auth rejected")
  expect(rejection).toMatchObject({ level: "warn", reason: "unknown token" })
  const secret = token.slice("opencode-recall_".length)
  // Any 8-character run of the secret, including its prefix, would be token material.
  for (let i = 0; i + 8 <= secret.length; i++) expect(logLines.join("")).not.toContain(secret.slice(i, i + 8))
})
