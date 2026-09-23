import { afterEach, beforeEach, expect, test } from "bun:test"
import { HubError, PROTOCOL_VERSION, makeClient, type Snapshot } from "@opencode-recall/protocol"
import { Effect, Exit, Layer, Scope } from "effect"
import { Archive } from "./archive/index.ts"
import { fakeEmbedder, fakeLayer } from "./fake-embedder.ts"
import { Log } from "./log.ts"
import { makeHandler, type Limits } from "./server.ts"

let scope: Scope.Closeable
let archive: Archive.Interface
let handler: (req: Request) => Promise<Response>
let token: string
let logLines: string[]

const sync = Effect.runSync
const run = Effect.runPromise
/** The typed failure of `effect`, which must fail. */
const failure = <A, E>(effect: Effect.Effect<A, E>) => run(Effect.flip(effect))

/** A fresh archive with `embedder`, open until the test ends. */
const openArchive = (embedder = fakeEmbedder()) =>
  sync(Archive.make(":memory:").pipe(Effect.provide(fakeLayer(embedder)), Scope.provide(scope)))

/** A handler over `on`, logging to `logLines` at debug, or nowhere. */
const handlerFor = (
  on: Archive.Interface,
  options: Parameters<typeof makeHandler>[0] = {},
  log: Layer.Layer<never> = Log.layer("error", () => {}),
) => run(makeHandler(options).pipe(Effect.provideService(Archive.Service, on), Effect.provide(log)))

beforeEach(async () => {
  scope = sync(Scope.make())
  archive = openArchive()
  token = sync(archive.issueToken("laptop"))
  logLines = []
  handler = await handlerFor(archive, {}, Log.layer("debug", (line) => logLines.push(line)))
})
afterEach(() => sync(Scope.close(scope, Exit.void)))

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
  makeClient({ url: "http://hub/", token, fetch: async (input, init) => h(new Request(input, init)) })

test("the typed client archives a snapshot and status counts it", async () => {
  const client = clientFor(handler)
  expect(await run(client.snapshot(snapshot))).toEqual({ outcome: "archived" })
  expect(await run(client.snapshot(snapshot))).toEqual({ outcome: "unchanged" })
  expect(await run(client.status())).toMatchObject({ sessions: 1 })
})

test("the typed client tombstones a session, lists it in the manifest, and a stale upload is tombstoned", async () => {
  const client = clientFor(handler)
  await run(client.snapshot(snapshot))
  expect(await run(client.manifest())).toEqual({
    sessions: [{ sessionId: "ses_a", revision: 3, lastActivity: 2, contentHash: "hash-1", extractorVersion: 1 }],
    tombstones: [],
  })
  expect(await run(client.tombstone({ sessionId: "ses_a", revision: 4, timeDeleted: 5 }))).toEqual({ removed: true })
  expect(await run(client.manifest())).toEqual({ sessions: [], tombstones: [{ sessionId: "ses_a", timeDeleted: 5 }] })
  const error = await failure(client.snapshot(snapshot))
  expect(error).toMatchObject({ code: "tombstoned", status: 409 })
})

test("search finds another host's session through the caller's own token and names its origin", async () => {
  // The desktop uploads once and goes away; only the archive's copy remains.
  const desktop = makeClient({
    url: "http://hub",
    token: sync(archive.issueToken("desktop")),
    fetch: async (input, init) => handler(new Request(input, init)),
  })
  await run(desktop.snapshot(snapshot))

  const { sessions } = await run(clientFor(handler).search({ query: "hello", limit: 8 }))
  expect(sessions).toMatchObject([{ sessionId: "ses_a", source: "desktop", ownSource: false, revision: 3 }])
  expect(sessions[0]!.hits[0]!.snippet).toBe("«hello»")
})

test("the typed client reads a transcript and caches a summary, which a later snapshot makes stale", async () => {
  const client = clientFor(handler)
  await run(client.snapshot(snapshot))
  const transcript = await run(client.transcript({ session: "ses_a", budget: 300_000, maxChars: 2_000 }))
  expect(transcript).toMatchObject({ kind: "transcript", contentHash: "hash-1", messages: 1, omitted: 0, clipped: 0 })

  const key = { provider: "openai", model: "gpt", focus: "", recipe: 1 }
  const put = { ...key, sessionId: "ses_a", contentHash: "hash-1", summary: "a greeting" }
  expect(await run(client.summaryPut(put))).toEqual({})
  expect(await run(client.summaryGet({ ...key, session: "ses_a" }))).toMatchObject({ kind: "cached", summary: "a greeting" })

  await run(client.snapshot({ ...snapshot, revision: 4, lastActivity: 3, contentHash: "hash-2" }))
  expect(await failure(client.summaryPut(put))).toMatchObject({ _tag: "HubError", code: "stale_revision", status: 409 })
  expect(await run(client.summaryGet({ ...key, session: "ses_a" }))).toMatchObject({ kind: "absent" })
})

test("hybrid search over the API names an unavailable semantic branch, and status reports the active space", async () => {
  const embedder = fakeEmbedder()
  embedder.down = true
  const down = openArchive(embedder)
  const h = await handlerFor(down)
  const client = makeClient({
    url: "http://hub",
    token: sync(down.issueToken("laptop")),
    fetch: async (input, init) => h(new Request(input, init)),
  })
  await run(client.snapshot(snapshot))

  const result = await run(client.search({ query: "hello", limit: 8 }))
  expect(result.semanticUnavailable).toBe("embedding model unavailable")
  expect(result.sessions.map((s) => s.sessionId)).toEqual(["ses_a"])
  expect(await run(client.status())).toEqual({
    sessions: 1,
    chunks: 2,
    embeddedChunks: 0,
    activeSpace: { recipe: expect.objectContaining({ model: "fake/bag-of-words", chunkChars: 1200 }), matchesConfigured: true },
  })
})

test("each snapshot the archive accepts is announced, and a no-op is not", async () => {
  let archived = 0
  const h = await handlerFor(archive, { onArchived: Effect.sync(() => archived++) })
  const client = clientFor(h)
  await run(client.snapshot(snapshot))
  await run(client.snapshot(snapshot))
  await run(client.snapshot({ ...snapshot, revision: 4, lastActivity: 3, contentHash: "hash-2" }))
  expect(archived).toBe(2)
})

test("a search with an unknown filter is rejected rather than silently widened", async () => {
  const res = await post("search", { protocolVersion: PROTOCOL_VERSION, query: "x", limit: 8, project: "y" })
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } })
})

test("the client sends gzip-encoded bodies with Content-Encoding set", async () => {
  let seen: Request | undefined
  const client = makeClient({
    url: "http://hub",
    token,
    fetch: async (input, init) => {
      seen = new Request(input, init)
      return handler(seen.clone())
    },
  })
  await run(client.snapshot(snapshot))
  expect(seen!.headers.get("content-encoding")).toBe("gzip")
  const body = new Uint8Array(await seen!.arrayBuffer())
  expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(body)))).toMatchObject({ contentHash: "hash-1" })
})

test.each([
  ["an earlier position", { revision: 2, contentHash: "hash-0" }, "stale_revision"],
  ["an equal position with different content", { contentHash: "hash-2" }, "hash_divergence"],
] as const)("a snapshot at %s is rejected as %s", async (_, fields, code) => {
  const client = clientFor(handler)
  await run(client.snapshot(snapshot))
  const error = await failure(client.snapshot({ ...snapshot, ...fields }))
  expect(error).toMatchObject({ code, status: 409 })
})

const small: Limits = { compressedBytes: 1_000, decompressedBytes: 4_000, concurrentIngest: 1 }
const limitedHandler = (limits: Limits = small) => handlerFor(archive, { limits })
const withText = (text: string): Snapshot => ({
  ...snapshot,
  session: { ...session, messages: [{ ...session.messages[0]!, parts: [{ kind: "text", text }] }] },
})

test.each([
  ["too large once decoded, though small on the wire", withText("a".repeat(10_000))],
  ["too large on the wire", withText(crypto.getRandomValues(new Uint8Array(2_000)).toBase64())],
])("a body %s is rejected as payload_too_large and nothing is archived", async (_, big) => {
  const error = await failure(clientFor(await limitedHandler()).snapshot(big))
  expect(error).toMatchObject({ code: "payload_too_large", status: 413 })
  expect(sync(archive.status())).toMatchObject({ sessions: 0 })
})

test("a declared Content-Length over the wire cap is rejected before the body is read", async () => {
  const res = await (await limitedHandler())(
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
  const h = await limitedHandler()
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
  const error = await failure(clientFor(h).snapshot(snapshot))
  expect(error).toMatchObject({ code: "rate_limited", status: 429 })
  expect(await run(clientFor(h).status())).toMatchObject({ sessions: 0 })

  release()
  expect((await first).status).toBe(200)
  expect(await run(clientFor(h).snapshot(snapshot))).toEqual({ outcome: "unchanged" })
})

test("an unsupported protocol version is rejected with both versions named", async () => {
  const res = await post("snapshot", { protocolVersion: PROTOCOL_VERSION + 1, ...snapshot })
  expect(res.status).toBe(400)
  const { error } = (await res.json()) as { error: { code: string; message: string } }
  expect(error.code).toBe("protocol_version")
  expect(error.message).toContain(`version ${PROTOCOL_VERSION + 1}`)
  expect(error.message).toContain(`version ${PROTOCOL_VERSION}`)
  expect(sync(archive.status())).toMatchObject({ sessions: 0 })
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
  expect(sync(archive.status())).toMatchObject({ sessions: 0 })
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
  expect(sync(archive.status())).toMatchObject({ sessions: 0 })
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
  const client = makeClient({
    url: "http://hub",
    token,
    fetch: async (input, init) => {
      const body = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(init.body as Uint8Array<ArrayBuffer>)))
      return handler(new Request(input, { ...init, body: Bun.gzipSync(JSON.stringify({ ...body, protocolVersion: 0 })) }))
    },
  })
  const error = await failure(client.status())
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
  const client = makeClient({ url: "http://hub", token, fetch: async () => respond() })
  const error = await failure(client.status())
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
  expect(sync(archive.status())).toMatchObject({ sessions: 0 })
})

test("authentication is checked before the protocol version", async () => {
  const res = await post("status", { protocolVersion: PROTOCOL_VERSION + 1 }, null)
  expect(await errorCode(res)).toBe("invalid_token")
})

test("a revoked token fails on the very next request", async () => {
  expect((await post("status", { protocolVersion: PROTOCOL_VERSION })).status).toBe(200)
  sync(archive.revokeToken(sync(archive.listTokens())[0]!.id))
  const res = await post("status", { protocolVersion: PROTOCOL_VERSION })
  expect(res.status).toBe(401)
  expect(await errorCode(res)).toBe("invalid_token")
})

test("the auth-rejection log line contains no token material", async () => {
  sync(archive.revokeToken(sync(archive.listTokens())[0]!.id))
  await post("status", { protocolVersion: PROTOCOL_VERSION })
  const rejection = logLines.map((l) => JSON.parse(l)).find((l) => l.msg === "auth rejected")
  expect(rejection).toMatchObject({ level: "warn", reason: "unknown token" })
  const secret = token.slice("opencode-recall_".length)
  // Any 8-character run of the secret, including its prefix, would be token material.
  for (let i = 0; i + 8 <= secret.length; i++) expect(logLines.join("")).not.toContain(secret.slice(i, i + 8))
})
