import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Session } from "@opencode-recall/protocol"
import { SCHEMA_VERSION, openArchive, type Archive } from "./index.ts"
import { migrations } from "./migrations.ts"

const dirs: string[] = []
const archives: Archive[] = []

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "recall-archive-"))
  dirs.push(dir)
  return join(dir, "archive.db")
}

function open(path: string): Archive {
  const archive = openArchive(path)
  archives.push(archive)
  return archive
}

afterEach(() => {
  for (const a of archives.splice(0)) a.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function session(id: string, texts: string[]): Session {
  return {
    id,
    slug: "slug",
    title: "title",
    directory: "/work",
    parentId: null,
    timeCreated: 1,
    timeUpdated: 2,
    messages: texts.map((text, i) => ({
      id: `${id}_msg_${i}`,
      type: i % 2 ? "assistant" : "user",
      timeCreated: 10 + i,
      parts: [{ kind: "text", text }],
    })),
  }
}

/** The id of the source `name`, issuing it a token (and creating it) if needed. */
const sourceOf = (archive: Archive, name = "laptop") => archive.authenticate(archive.issueToken(name))!.id

const backends = [
  { name: ":memory:", path: () => ":memory:" },
  { name: "file-backed", path: tempPath },
]

describe.each(backends)("archive ($name)", ({ path }) => {
  test("a fresh archive is migrated to the current schema and holds nothing", () => {
    const archive = open(path())
    expect(archive.migration).toEqual({ from: 0, to: SCHEMA_VERSION })
    expect(archive.status()).toEqual({ sessions: 0 })
  })

  test("snapshots are counted once per session and replacing one does not duplicate it", () => {
    const archive = open(path())
    archive.putSnapshot(session("ses_a", ["hello", "hi"]), sourceOf(archive))
    archive.putSnapshot(session("ses_b", ["other"]), sourceOf(archive))
    archive.putSnapshot(session("ses_a", ["hello", "hi", "more"]), sourceOf(archive))
    expect(archive.status()).toEqual({ sessions: 2 })
  })

  test("an issued token authenticates as its source and has the documented shape", () => {
    const archive = open(path())
    const token = archive.issueToken("laptop")
    expect(token).toMatch(/^opencode-recall_[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token.slice("opencode-recall_".length), "base64url")).toHaveLength(32)
    expect(archive.authenticate(token)).toMatchObject({ name: "laptop" })
    expect(archive.authenticate(`${token}x`)).toBeNull()
    expect(archive.authenticate("opencode-recall_nope")).toBeNull()
  })

  test("several tokens for one source share its identity; other sources get their own", () => {
    const archive = open(path())
    const [a, b, c] = [archive.issueToken("laptop"), archive.issueToken("laptop"), archive.issueToken("desktop")]
    expect(a).not.toBe(b)
    expect(archive.authenticate(a)!.id).toBe(archive.authenticate(b)!.id)
    expect(archive.authenticate(c)!.id).not.toBe(archive.authenticate(a)!.id)
  })

  test("listing shows tokens by source without their values, and revoking one fails it at once", () => {
    const archive = open(path())
    const old = archive.issueToken("laptop")
    const fresh = archive.issueToken("laptop")
    const tokens = archive.listTokens()
    const listed = { id: expect.any(Number), source: "laptop", timeCreated: expect.any(Number) }
    expect(tokens).toEqual([listed, listed])

    expect(archive.revokeToken(tokens[0]!.id)).toBe(true)
    expect(archive.authenticate(old)).toBeNull()
    expect(archive.authenticate(fresh)).toMatchObject({ name: "laptop" })
    expect(archive.revokeToken(tokens[0]!.id)).toBe(false)
  })
})

describe("archive (file-backed only)", () => {
  test("stores sessions, messages, and parts rows, and a replace leaves no stale rows", () => {
    const path = tempPath()
    const archive = open(path)
    archive.putSnapshot(session("ses_a", ["one", "two", "three"]), sourceOf(archive))
    archive.putSnapshot(session("ses_a", ["one"]), sourceOf(archive))

    const db = new Database(path, { readonly: true })
    const count = (table: string) => (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    expect([count("sessions"), count("messages"), count("parts")]).toEqual([1, 1, 1])
    expect(db.query("SELECT text FROM parts").get()).toEqual({ text: "one" })
    db.close()
  })

  test("stores only a SHA-256 of each token, and attributes snapshots to the source", () => {
    const path = tempPath()
    const archive = open(path)
    const token = archive.issueToken("laptop")
    archive.putSnapshot(session("ses_a", ["one"]), archive.authenticate(token)!.id)

    const db = new Database(path, { readonly: true })
    const { hash } = db.query("SELECT hash FROM tokens").get() as { hash: Uint8Array }
    expect(Buffer.from(hash).toString("hex")).toBe(new Bun.CryptoHasher("sha256").update(token).digest("hex"))
    expect(db.query("SELECT sessions.id, sources.name FROM sessions JOIN sources ON sources.id = source_id").all()).toEqual([
      { id: "ses_a", name: "laptop" },
    ])
    db.close()
  })

  test("an archive from before sources existed migrates forward and keeps its sessions", () => {
    const path = tempPath()
    const db = new Database(path, { create: true })
    db.run(migrations[0]!)
    db.run("PRAGMA user_version = 1")
    db.run("INSERT INTO sessions VALUES ('ses_old', 's', 't', '/w', NULL, 1, 2)")
    db.close()

    const archive = open(path)
    expect(archive.migration).toEqual({ from: 1, to: SCHEMA_VERSION })
    expect(archive.status()).toEqual({ sessions: 1 })
  })

  test("a token revoked through another connection fails on the serving connection's next check", () => {
    const path = tempPath()
    const serving = open(path)
    const token = serving.issueToken("laptop")
    expect(serving.authenticate(token)).not.toBeNull()

    const admin = openArchive(path)
    admin.revokeToken(admin.listTokens()[0]!.id)
    admin.close()
    expect(serving.authenticate(token)).toBeNull()
  })

  test("reopening an up-to-date archive applies no migrations and keeps its data", () => {
    const path = tempPath()
    const first = openArchive(path)
    first.putSnapshot(session("ses_a", ["hello"]), sourceOf(first))
    first.close()

    const second = open(path)
    expect(second.migration).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
    expect(second.status()).toEqual({ sessions: 1 })
  })

  test("refuses a database migrated by a newer binary, naming both versions", () => {
    const path = tempPath()
    const db = new Database(path, { create: true })
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()

    expect(() => openArchive(path)).toThrow(
      `archive schema version ${SCHEMA_VERSION + 1} is newer than this binary supports (${SCHEMA_VERSION})`,
    )
    const after = new Database(path, { readonly: true })
    expect(after.query("SELECT count(*) AS n FROM sqlite_master").get()).toEqual({ n: 0 })
    after.close()
  })
})
