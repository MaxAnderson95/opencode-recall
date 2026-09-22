import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Snapshot } from "@opencode-recall/protocol"
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

/** A snapshot whose position defaults to one past its last message and whose hash names its texts. */
function session(id: string, texts: string[], fields: Partial<Omit<Snapshot, "session">> = {}): Snapshot {
  return {
    session: {
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
    },
    revision: texts.length,
    lastActivity: 10 + texts.length,
    contentHash: texts.join("|"),
    extractorVersion: 1,
    ...fields,
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

  test("a later position replaces the held copy; an earlier one is stale and changes nothing", () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    expect(archive.putSnapshot(session("ses_a", ["one"]), laptop)).toBe("archived")
    expect(archive.putSnapshot(session("ses_a", ["one", "two"]), laptop)).toBe("archived")
    expect(archive.putSnapshot(session("ses_a", ["one"]), laptop)).toBe("stale_revision")
    expect(archive.putSnapshot(session("ses_a", ["one", "two", "x"], { revision: 1, lastActivity: 12 }), laptop)).toBe(
      "stale_revision",
    )
    expect(archive.putSnapshot(session("ses_a", ["one", "two"]), laptop)).toBe("unchanged")
  })

  test("a matching hash is a no-op at any position", () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_a", ["one", "two"]), laptop)
    expect(archive.putSnapshot(session("ses_a", ["one", "two"]), laptop)).toBe("unchanged")
    expect(archive.putSnapshot(session("ses_a", ["one", "two"], { revision: 9, lastActivity: 99 }), laptop)).toBe(
      "unchanged",
    )
    expect(archive.putSnapshot(session("ses_a", ["one", "two"], { revision: 0, lastActivity: 0 }), laptop)).toBe(
      "unchanged",
    )
  })

  test("an equal position with different content diverges unless the extractor is newer", () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_a", ["one", "two"], { extractorVersion: 2 }), laptop)
    const differing = { revision: 2, lastActivity: 12, contentHash: "re-extracted" }
    expect(archive.putSnapshot(session("ses_a", ["one", "two"], { ...differing, extractorVersion: 2 }), laptop)).toBe(
      "hash_divergence",
    )
    expect(archive.putSnapshot(session("ses_a", ["one", "two"], { ...differing, extractorVersion: 1 }), laptop)).toBe(
      "hash_divergence",
    )
    expect(archive.putSnapshot(session("ses_a", ["one", "two"], { ...differing, extractorVersion: 3 }), laptop)).toBe(
      "archived",
    )
  })

  test("a rewind with newer activity is accepted and the stale pre-rewind copy never displaces it", () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    const preRewind = session("ses_a", ["x1", "x2"], { revision: 9, lastActivity: 50 })
    const rewound = session("ses_a", ["y1"], { revision: 6, lastActivity: 60 })
    archive.putSnapshot(preRewind, desktop)
    expect(archive.putSnapshot(rewound, laptop)).toBe("rewound")
    for (let sweep = 0; sweep < 3; sweep++) {
      expect(archive.putSnapshot(preRewind, desktop)).toBe("stale_revision")
      expect(archive.putSnapshot(rewound, laptop)).toBe("unchanged")
    }
  })

  test("a tombstone deletes the session and rejects snapshots active at or before the deletion", () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_a", ["one", "two"]), laptop)
    expect(archive.putTombstone({ sessionId: "ses_a", revision: 3, timeDeleted: 20 }, laptop)).toEqual({ removed: true })
    expect(archive.status()).toEqual({ sessions: 0 })

    expect(archive.putSnapshot(session("ses_a", ["one", "two"]), laptop)).toBe("tombstoned")
    // The deletion time decides, not the revision.
    expect(archive.putSnapshot(session("ses_a", ["one", "two", "x"], { revision: 99, lastActivity: 20 }), laptop)).toBe(
      "tombstoned",
    )
    expect(archive.status()).toEqual({ sessions: 0 })
  })

  test("a snapshot active after the deletion is archived and clears the tombstone", () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_a", ["one", "two"], { revision: 9 }), laptop)
    archive.putTombstone({ sessionId: "ses_a", revision: 10, timeDeleted: 20 }, laptop)
    // A re-import restarts the counter below the tombstone's revision.
    expect(archive.putSnapshot(session("ses_a", ["one"], { revision: 2, lastActivity: 30 }), laptop)).toBe("archived")
    expect(archive.manifest().tombstones).toEqual([])
    expect(archive.putSnapshot(session("ses_a", ["one"], { revision: 1, lastActivity: 15 }), laptop)).toBe("unchanged")
  })

  test("a tombstone for a session never archived is still recorded, and the later deletion wins", () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    expect(archive.putTombstone({ sessionId: "ses_a", revision: 3, timeDeleted: 50 }, laptop)).toEqual({ removed: false })
    archive.putTombstone({ sessionId: "ses_a", revision: 2, timeDeleted: 40 }, laptop)
    expect(archive.manifest().tombstones).toEqual([{ sessionId: "ses_a", timeDeleted: 50 }])
    expect(archive.putSnapshot(session("ses_a", ["one"], { lastActivity: 45 }), laptop)).toBe("tombstoned")
  })

  test("the manifest spans every source and lists tombstones", () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    archive.putSnapshot(session("ses_a", ["one"]), laptop)
    archive.putSnapshot(session("ses_b", ["two", "three"], { extractorVersion: 2 }), desktop)
    archive.putSnapshot(session("ses_c", ["gone"]), desktop)
    archive.putTombstone({ sessionId: "ses_c", revision: 2, timeDeleted: 99 }, desktop)
    expect(archive.manifest()).toEqual({
      sessions: [
        { sessionId: "ses_a", revision: 1, lastActivity: 11, contentHash: "one", extractorVersion: 1 },
        { sessionId: "ses_b", revision: 2, lastActivity: 12, contentHash: "two|three", extractorVersion: 2 },
      ],
      tombstones: [{ sessionId: "ses_c", timeDeleted: 99 }],
    })
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

  test("a revoked token's id is never reused, so repeating the revoke cannot hit a newer token", () => {
    const archive = open(path())
    archive.issueToken("laptop")
    const [revoked] = archive.listTokens()
    archive.revokeToken(revoked!.id)

    const desktop = archive.issueToken("desktop")
    expect(archive.listTokens()[0]!.id).not.toBe(revoked!.id)
    expect(archive.revokeToken(revoked!.id)).toBe(false)
    expect(archive.authenticate(desktop)).toMatchObject({ name: "desktop" })
  })
})

describe("archive (file-backed only)", () => {
  test("stores sessions, messages, and parts rows, and a replace leaves no stale rows", () => {
    const path = tempPath()
    const archive = open(path)
    archive.putSnapshot(session("ses_a", ["one", "two", "three"]), sourceOf(archive))
    // A revert: fewer messages, a newer `time_updated`, and a higher revision.
    expect(archive.putSnapshot(session("ses_a", ["one"], { revision: 5, lastActivity: 20 }), sourceOf(archive))).toBe(
      "archived",
    )

    const db = new Database(path, { readonly: true })
    const count = (table: string) => (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    expect([count("sessions"), count("messages"), count("parts")]).toEqual([1, 1, 1])
    expect(db.query("SELECT text FROM parts").get()).toEqual({ text: "one" })
    db.close()
  })

  test("source_id moves to the source of each accepted snapshot, but not on a no-op", () => {
    const path = tempPath()
    const archive = open(path)
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    const db = new Database(path, { readonly: true })
    const owner = () => (db.query("SELECT sources.name FROM sessions JOIN sources ON sources.id = source_id").get() as { name: string }).name

    archive.putSnapshot(session("ses_a", ["one"]), laptop)
    expect(owner()).toBe("laptop")
    archive.putSnapshot(session("ses_a", ["one"]), desktop)
    expect(owner()).toBe("laptop")
    archive.putSnapshot(session("ses_a", ["one", "two"]), desktop)
    expect(owner()).toBe("desktop")
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
    // A row archived before positions existed sits behind any real snapshot.
    expect(archive.putSnapshot(session("ses_old", ["one"]), sourceOf(archive))).toBe("archived")
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
