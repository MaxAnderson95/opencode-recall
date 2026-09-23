import { afterEach, beforeEach, expect, test } from "bun:test"
import { HubError, PROTOCOL_VERSION, createClient, type Session } from "@opencode-recall/protocol"
import { openArchive, type Archive } from "./archive/index.ts"
import { createLog } from "./log.ts"
import { createHandler } from "./server.ts"

let archive: Archive
let handler: ReturnType<typeof createHandler>

beforeEach(() => {
  archive = openArchive(":memory:")
  handler = createHandler({ archive, log: createLog("error", () => {}) })
})
afterEach(() => archive.close())

const post = (verb: string, body: unknown) =>
  handler(new Request(`http://hub/v1/${verb}`, { method: "POST", body: JSON.stringify(body) }))

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
  const client = createClient({ url: "http://hub/", fetch: async (input, init) => handler(new Request(input, init)) })
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
  const res = await handler(new Request("http://hub/v1/snapshot", { method: "POST", body: "{" }))
  expect(res.status).toBe(400)
})

test("an unknown verb is rejected", async () => {
  const res = await post("nope", { protocolVersion: PROTOCOL_VERSION })
  expect(res.status).toBe(404)
})

test("the client raises the hub's rejection as a HubError carrying its code", async () => {
  const client = createClient({
    url: "http://hub",
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
  const client = createClient({ url: "http://hub", fetch: async () => respond() })
  const error = await client.status().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(HubError)
  expect(error).toMatchObject({ code: "internal", message: "HTTP 502", status: 502 })
})
