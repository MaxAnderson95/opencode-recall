import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Session } from "@opencode-recall/protocol"
import { SCHEMA_VERSION, openArchive, type Archive } from "./index.ts"

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
    archive.putSnapshot(session("ses_a", ["hello", "hi"]))
    archive.putSnapshot(session("ses_b", ["other"]))
    archive.putSnapshot(session("ses_a", ["hello", "hi", "more"]))
    expect(archive.status()).toEqual({ sessions: 2 })
  })
})

describe("archive (file-backed only)", () => {
  test("stores sessions, messages, and parts rows, and a replace leaves no stale rows", () => {
    const path = tempPath()
    const archive = open(path)
    archive.putSnapshot(session("ses_a", ["one", "two", "three"]))
    archive.putSnapshot(session("ses_a", ["one"]))

    const db = new Database(path, { readonly: true })
    const count = (table: string) => (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    expect([count("sessions"), count("messages"), count("parts")]).toEqual([1, 1, 1])
    expect(db.query("SELECT text FROM parts").get()).toEqual({ text: "one" })
    db.close()
  })

  test("reopening an up-to-date archive applies no migrations and keeps its data", () => {
    const path = tempPath()
    const first = openArchive(path)
    first.putSnapshot(session("ses_a", ["hello"]))
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
