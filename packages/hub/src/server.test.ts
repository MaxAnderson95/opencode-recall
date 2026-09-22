import { afterEach, beforeEach, expect, test } from "bun:test"
import { HubError, PROTOCOL_VERSION, createClient, type Session } from "@opencode-recall/protocol"
import { openArchive, type Archive } from "./archive/index.ts"
import { createLog } from "./log.ts"
import { createHandler } from "./server.ts"

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

const session: Session = {
  id: "ses_a",
  slug: "slug",
  title: "title",
  directory: "/work",
  parentId: null,
  timeCreated: 1,
  timeUpdated: 2,
  messages: [{ id: "msg_1", type: "user", timeCreated: 1, parts: [{ kind: "text", text: "hello" }] }],
}

test("the typed client archives a snapshot and status counts it", async () => {
  const client = createClient({ url: "http://hub/", token, fetch: async (input, init) => handler(new Request(input, init)) })
  expect(await client.snapshot(session)).toEqual({ outcome: "archived" })
  expect(await client.status()).toEqual({ sessions: 1 })
})

test("an unsupported protocol version is rejected with both versions named", async () => {
  const res = await post("snapshot", { protocolVersion: PROTOCOL_VERSION + 1, session })
  expect(res.status).toBe(400)
  const { error } = (await res.json()) as { error: { code: string; message: string } }
  expect(error.code).toBe("protocol_version")
  expect(error.message).toContain(`version ${PROTOCOL_VERSION + 1}`)
  expect(error.message).toContain(`version ${PROTOCOL_VERSION}`)
  expect(archive.status()).toEqual({ sessions: 0 })
})

test.each([
  ["missing protocol version", { session }],
  ["missing session", { protocolVersion: PROTOCOL_VERSION }],
  ["wrong field type", { protocolVersion: PROTOCOL_VERSION, session: { ...session, timeCreated: "yesterday" } }],
  [
    "unknown part kind",
    {
      protocolVersion: PROTOCOL_VERSION,
      session: { ...session, messages: [{ ...session.messages[0], parts: [{ kind: "file", text: "x" }] }] },
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
      const body = JSON.parse(String(init?.body))
      return handler(new Request(input, { ...init, body: JSON.stringify({ ...body, protocolVersion: 0 }) }))
    },
  })
  const error = await client.status().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(HubError)
  expect(error).toMatchObject({ code: "protocol_version", status: 400 })
})

test.each([
  ["JSON without an error envelope", () => Response.json({ message: "Bad Gateway" }, { status: 502 })],
  ["a non-JSON body", () => new Response("<html>Bad Gateway</html>", { status: 502 })],
])("the client falls back to the HTTP status when a proxy answers with %s", async (_, respond) => {
  const client = createClient({ url: "http://hub", token, fetch: async () => respond() })
  const error = await client.status().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(HubError)
  expect(error).toMatchObject({ code: "internal", message: "HTTP 502", status: 502 })
})

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code

test.each([
  ["no Authorization header", null],
  ["an unknown token", "opencode-recall_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  ["a token that is not a bearer credential", ""],
])("a request with %s fails with invalid_token and archives nothing", async (_, bearer) => {
  const res = await post("snapshot", { protocolVersion: PROTOCOL_VERSION, session }, bearer)
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
