import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  Expand,
  Inspect,
  Message,
  Part,
  Search,
  Snapshot,
  SummaryGet,
  SummaryPut,
  Transcript,
} from "@opencode-recall/protocol"
import { Effect, Exit, Option, Scope, type Types } from "effect"
import { Embedder } from "../embedder.ts"
import { fakeEmbedder } from "../fake-embedder.ts"
import { DEFAULT_CHUNKING, type ChunkParams } from "./chunks.ts"
import { Archive, SCHEMA_VERSION } from "./index.ts"
import { SEGMENTED, migrations } from "./migrations.ts"

/** The first schema version with vector spaces. */
const SPACES = 7

const dirs: string[] = []
const scopes: Scope.Closeable[] = []

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "recall-archive-"))
  dirs.push(dir)
  return join(dir, "archive.db")
}

/**
 * The archive with each operation run to completion: synchronously where it never waits, as a
 * promise where it may wait on the embedder, so assertions read like the rules they check.
 */
function handle(archive: Archive.Interface, scope: Scope.Closeable) {
  return {
    migration: archive.migration,
    putSnapshot: (snapshot: Snapshot, sourceId: number) => Effect.runSync(archive.putSnapshot(snapshot, sourceId)),
    putTombstone: (...args: Parameters<Archive.Interface["putTombstone"]>) => Effect.runSync(archive.putTombstone(...args)),
    manifest: (callerSourceId = 0) => Effect.runSync(archive.manifest(callerSourceId)),
    search: (search: Search, callerSourceId: number) => Effect.runPromise(archive.search(search, callerSourceId)),
    inspect: (inspect: Inspect, callerSourceId = 0) => Effect.runPromise(archive.inspect(inspect, callerSourceId)),
    expand: (expand: Expand, callerSourceId = 0) => Effect.runSync(archive.expand(expand, callerSourceId)),
    transcript: (transcript: Transcript, callerSourceId = 0) => Effect.runSync(archive.transcript(transcript, callerSourceId)),
    getSummary: (key: SummaryGet, callerSourceId = 0) => Effect.runSync(archive.getSummary(key, callerSourceId)),
    putSummary: (summary: SummaryPut) => Effect.runSync(archive.putSummary(summary)),
    embedPending: (limit: number) => Effect.runPromise(archive.embedPending(limit)),
    reclaim: () => Effect.runSync(archive.reclaim()),
    rebuild: () => Option.getOrNull(Effect.runSync(archive.rebuild())),
    issueToken: (source: string) => Effect.runSync(archive.issueToken(source)),
    listTokens: () => Effect.runSync(archive.listTokens()),
    revokeToken: (id: number) => Effect.runSync(archive.revokeToken(id)),
    authenticate: (token: string) => Option.getOrNull(Effect.runSync(archive.authenticate(token))),
    status: () => Effect.runSync(archive.status()),
    close: () => Effect.runSync(Scope.close(scope, Exit.void)),
  }
}
type Handle = ReturnType<typeof handle>

/**
 * Open the archive at `path` with `embedder`, set to build `chunking` with the embedder's model;
 * it is closed after the test unless closed before.
 */
function open(path: string, embedder: Embedder.Interface = fakeEmbedder(), chunking?: ChunkParams): Handle {
  const scope = Effect.runSync(Scope.make())
  scopes.push(scope)
  const configured = chunking && Archive.recipeFor(embedder.model, chunking)
  const archive = Effect.runSync(
    Archive.make(path, configured).pipe(Effect.provideService(Embedder.Service, embedder), Scope.provide(scope)),
  )
  return handle(archive, scope)
}

afterEach(() => {
  for (const scope of scopes.splice(0)) Effect.runSync(Scope.close(scope, Exit.void))
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

type Draft = Types.DeepMutable<Snapshot>

/** A snapshot whose position defaults to one past its last message and whose hash names its texts. */
function session(id: string, texts: string[], fields: Partial<Omit<Snapshot, "session">> = {}): Draft {
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

type Shape = { directory?: string; type?: Message["type"]; part?: Part; time?: number }

/** A one-message session whose message is shaped by `shape`, for search tests. */
function single(id: string, text: string, { directory = "/work", type = "user", part, time = 10 }: Shape = {}): Draft {
  const snapshot = session(id, [text])
  snapshot.session.directory = directory
  snapshot.session.messages[0] = { id: `${id}_msg_0`, type, timeCreated: time, parts: [part ?? { kind: "text", text }] }
  return snapshot
}

/** Lexical unless `filters` says otherwise, so ranking tests are not perturbed by the fake embedder. */
const search = async (archive: Handle, query: string, filters: Partial<Search> = {}, caller = 0) =>
  (await archive.search({ query, limit: 25, mode: "lexical", ...filters }, caller)).sessions

const ids = (results: readonly { sessionId: string }[]) => results.map((r) => r.sessionId).sort()

/** The id of the source `name`, issuing it a token (and creating it) if needed. */
const sourceOf = (archive: Handle, name = "laptop") => archive.authenticate(archive.issueToken(name))!.id

const backends = [
  { name: ":memory:", path: () => ":memory:" },
  { name: "file-backed", path: tempPath },
]

describe.each(backends)("archive ($name)", ({ path }) => {
  test("a fresh archive is migrated to the current schema and holds nothing", async () => {
    const archive = open(path())
    expect(archive.migration).toEqual({ from: 0, to: SCHEMA_VERSION })
    expect(archive.status()).toMatchObject({ sessions: 0 })
  })

  test("snapshots are counted once per session and replacing one does not duplicate it", async () => {
    const archive = open(path())
    archive.putSnapshot(session("ses_a", ["hello", "hi"]), sourceOf(archive))
    archive.putSnapshot(session("ses_b", ["other"]), sourceOf(archive))
    archive.putSnapshot(session("ses_a", ["hello", "hi", "more"]), sourceOf(archive))
    expect(archive.status()).toMatchObject({ sessions: 2 })
  })

  test("a later position replaces the held copy; an earlier one is stale and changes nothing", async () => {
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

  test("a matching hash is a no-op at any position", async () => {
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

  test("an equal position with different content diverges unless the extractor is newer", async () => {
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

  test("a rewind with newer activity is accepted and the stale pre-rewind copy never displaces it", async () => {
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
    expect(archive.status().rewinds).toEqual({
      total: 1,
      recent: [{ sessionId: "ses_a", source: "laptop", fromRevision: 9, toRevision: 6, time: expect.any(Number) }],
    })
  })

  test("a hash_divergence stays in status until a copy is accepted or the refused host sends the held content", async () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    const held = session("ses_a", ["one", "two"])
    const other = session("ses_a", ["one", "deux"], { revision: held.revision, lastActivity: held.lastActivity })
    archive.putSnapshot(held, laptop)
    expect(archive.status().divergences).toEqual([])

    expect(archive.putSnapshot(other, desktop)).toBe("hash_divergence")
    expect(archive.putSnapshot(other, desktop)).toBe("hash_divergence")
    const [divergence] = archive.status().divergences
    expect(divergence).toMatchObject({ sessionId: "ses_a", title: "title", heldFrom: "laptop", refusedFrom: "desktop" })
    expect(divergence!.timeLast).toBeGreaterThanOrEqual(divergence!.timeFirst)
    // Another host's no-op says nothing about the refused copy.
    expect(archive.putSnapshot(held, laptop)).toBe("unchanged")
    expect(archive.status().divergences).toHaveLength(1)

    expect(archive.putSnapshot(held, desktop)).toBe("unchanged")
    expect(archive.status().divergences).toEqual([])

    archive.putSnapshot(other, desktop)
    // The remedy: a rename on the host whose copy is kept moves its activity past the held position.
    const renamed = { ...other, revision: other.revision + 1, lastActivity: other.lastActivity + 1, contentHash: "renamed" }
    expect(archive.putSnapshot(renamed, desktop)).toBe("archived")
    expect(archive.status().divergences).toEqual([])

    archive.putSnapshot(held, laptop)
    archive.putTombstone({ sessionId: "ses_a", revision: 9, timeDeleted: 99, reason: "deleted" }, laptop)
    expect(archive.status().divergences).toEqual([])
  })

  test("status counts sessions per source as archived, searchable, and embedded, and counts cached summaries", async () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    archive.putSnapshot(session("ses_a", ["one"]), laptop)
    archive.putSnapshot(session("ses_b", ["two"]), laptop)
    const toolOnly = single("ses_c", "", { part: { kind: "tool", tool: "bash", title: "ls", status: "running", text: "", searchable: false } })
    archive.putSnapshot({ ...toolOnly, contentHash: "tool-only" }, desktop)
    expect(archive.status().sources).toEqual([
      { source: "desktop", archived: 1, searchable: 0, embedded: 0 },
      { source: "laptop", archived: 2, searchable: 2, embedded: 0 },
    ])
    while (await archive.embedPending(1));
    expect(archive.status().sources).toContainEqual({ source: "laptop", archived: 2, searchable: 2, embedded: 2 })

    const key = { provider: "p", model: "m", focus: "", recipe: 1 }
    archive.putSummary({ ...key, sessionId: "ses_a", contentHash: "one", summary: "s", omitted: 0, clipped: 0 })
    expect(archive.status().summaries).toBe(1)
  })

  test("a tombstone deletes the session and rejects snapshots active at or before the deletion", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_a", ["one", "two"]), laptop)
    expect(archive.putTombstone({ sessionId: "ses_a", revision: 3, timeDeleted: 20, reason: "deleted" }, laptop)).toEqual({ removed: true })
    expect(archive.status()).toMatchObject({ sessions: 0 })

    expect(archive.putSnapshot(session("ses_a", ["one", "two"]), laptop)).toBe("tombstoned")
    // The deletion time decides, not the revision.
    expect(archive.putSnapshot(session("ses_a", ["one", "two", "x"], { revision: 99, lastActivity: 20 }), laptop)).toBe(
      "tombstoned",
    )
    expect(archive.status()).toMatchObject({ sessions: 0 })
  })

  test("a snapshot active after the deletion is archived and clears the tombstone", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_a", ["one", "two"], { revision: 9 }), laptop)
    archive.putTombstone({ sessionId: "ses_a", revision: 10, timeDeleted: 20, reason: "deleted" }, laptop)
    // A re-import restarts the counter below the tombstone's revision.
    expect(archive.putSnapshot(session("ses_a", ["one"], { revision: 2, lastActivity: 30 }), laptop)).toBe("archived")
    expect(archive.manifest().tombstones).toEqual([])
    expect(archive.putSnapshot(session("ses_a", ["one"], { revision: 1, lastActivity: 15 }), laptop)).toBe("unchanged")
  })

  test("a tombstone for a session never archived is still recorded, and the later deletion wins", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    expect(archive.putTombstone({ sessionId: "ses_a", revision: 3, timeDeleted: 50, reason: "deleted" }, laptop)).toEqual({ removed: false })
    archive.putTombstone({ sessionId: "ses_a", revision: 2, timeDeleted: 40, reason: "deleted" }, laptop)
    expect(archive.manifest().tombstones).toEqual([{ sessionId: "ses_a", timeDeleted: 50, excludedByCaller: false }])
    expect(archive.putSnapshot(session("ses_a", ["one"], { lastActivity: 45 }), laptop)).toBe("tombstoned")
  })

  test("a retried deletion older than the held copy's activity leaves the re-import archived", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putTombstone({ sessionId: "ses_a", revision: 3, timeDeleted: 200, reason: "deleted" }, laptop)
    expect(archive.putSnapshot(session("ses_a", ["one"], { lastActivity: 300 }), laptop)).toBe("archived")
    expect(archive.putTombstone({ sessionId: "ses_a", revision: 3, timeDeleted: 200, reason: "deleted" }, laptop)).toEqual({ removed: false })
    expect(archive.status()).toMatchObject({ sessions: 1 })
    expect(archive.manifest().tombstones).toEqual([])
    expect(archive.putTombstone({ sessionId: "ses_a", revision: 5, timeDeleted: 400, reason: "deleted" }, laptop)).toEqual({ removed: true })
  })

  test("an exclusion drops cached summaries and is lifted only by the excluding source's snapshot", async () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    archive.putSnapshot(session("ses_a", ["one"], { lastActivity: 10 }), laptop)
    const key = { provider: "p", model: "m", focus: "", recipe: 1 }
    archive.putSummary({ ...key, sessionId: "ses_a", contentHash: "one", summary: "s", omitted: 0, clipped: 0 })
    expect(archive.putTombstone({ sessionId: "ses_a", revision: 1, timeDeleted: 50, reason: "excluded" }, laptop)).toEqual({
      removed: true,
    })
    expect(archive.status()).toMatchObject({ sessions: 0, summaries: 0 })
    expect(archive.manifest(laptop).tombstones).toEqual([{ sessionId: "ses_a", timeDeleted: 50, excludedByCaller: true }])
    expect(archive.manifest(desktop).tombstones).toEqual([{ sessionId: "ses_a", timeDeleted: 50, excludedByCaller: false }])

    // Another host's copy from before the exclusion stays out; the excluding host's comes back.
    expect(archive.putSnapshot(session("ses_a", ["one"], { lastActivity: 10 }), desktop)).toBe("tombstoned")
    expect(archive.putSnapshot(session("ses_a", ["one"], { lastActivity: 10 }), laptop)).toBe("archived")
    expect(archive.manifest(laptop).tombstones).toEqual([])
  })

  test("the manifest spans every source and lists tombstones", async () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    archive.putSnapshot(session("ses_a", ["one"]), laptop)
    archive.putSnapshot(session("ses_b", ["two", "three"], { extractorVersion: 2 }), desktop)
    archive.putSnapshot(session("ses_c", ["gone"]), desktop)
    archive.putTombstone({ sessionId: "ses_c", revision: 2, timeDeleted: 99, reason: "deleted" }, desktop)
    expect(archive.manifest()).toEqual({
      sessions: [
        { sessionId: "ses_a", revision: 1, lastActivity: 11, contentHash: "one", extractorVersion: 1 },
        { sessionId: "ses_b", revision: 2, lastActivity: 12, contentHash: "two|three", extractorVersion: 2 },
      ],
      tombstones: [{ sessionId: "ses_c", timeDeleted: 99, excludedByCaller: false }],
    })
  })

  test("an issued token authenticates as its source and has the documented shape", async () => {
    const archive = open(path())
    const token = archive.issueToken("laptop")
    expect(token).toMatch(/^opencode-recall_[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token.slice("opencode-recall_".length), "base64url")).toHaveLength(32)
    expect(archive.authenticate(token)).toMatchObject({ name: "laptop" })
    expect(archive.authenticate(`${token}x`)).toBeNull()
    expect(archive.authenticate("opencode-recall_nope")).toBeNull()
  })

  test("several tokens for one source share its identity; other sources get their own", async () => {
    const archive = open(path())
    const [a, b, c] = [archive.issueToken("laptop"), archive.issueToken("laptop"), archive.issueToken("desktop")]
    expect(a).not.toBe(b)
    expect(archive.authenticate(a)!.id).toBe(archive.authenticate(b)!.id)
    expect(archive.authenticate(c)!.id).not.toBe(archive.authenticate(a)!.id)
  })

  test("listing shows tokens by source without their values, and revoking one fails it at once", async () => {
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

  test("a revoked token's id is never reused, so repeating the revoke cannot hit a newer token", async () => {
    const archive = open(path())
    archive.issueToken("laptop")
    const [revoked] = archive.listTokens()
    archive.revokeToken(revoked!.id)

    const desktop = archive.issueToken("desktop")
    expect(archive.listTokens()[0]!.id).not.toBe(revoked!.id)
    expect(archive.revokeToken(revoked!.id)).toBe(false)
    expect(archive.authenticate(desktop)).toMatchObject({ name: "desktop" })
  })

  test("search ranks sessions from every source with snippets, origin, own-source flag, and revision", async () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    archive.putSnapshot(single("ses_a", "the deploy failed on the ingress controller"), laptop)
    archive.putSnapshot(
      single("ses_b", "a long note about the deploy of many unrelated things, eventually mentioning failed once"),
      desktop,
    )
    archive.putSnapshot(single("ses_c", "nothing relevant"), desktop)

    const results = await search(archive, "deploy failed", {}, laptop)
    expect(results.map((r) => [r.sessionId, r.source, r.ownSource, r.revision])).toEqual([
      ["ses_a", "laptop", true, 1],
      ["ses_b", "desktop", false, 1],
    ])
    expect(results[0]!.hits).toEqual([
      {
        branch: "lexical",
        messageId: "ses_a_msg_0",
        messageType: "user",
        kind: "text",
        time: 10,
        snippet: "the «deploy» «failed» on the ingress controller",
      },
    ])
    expect(results[0]).toMatchObject({ title: "title", directory: "/work", lexicalMatches: 1 })
  })

  test("all tokens must match unless none do, and then any may", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(single("ses_both", "alpha beta"), laptop)
    archive.putSnapshot(single("ses_one", "alpha only"), laptop)
    expect(ids(await search(archive, "alpha beta"))).toEqual(["ses_both"])
    expect(ids(await search(archive, "alpha gamma"))).toEqual(["ses_both", "ses_one"])
    expect(await search(archive, "gamma")).toEqual([])
    // Operators and quotes are matched as text, never parsed.
    expect(ids(await search(archive, 'alpha" OR "x'))).toEqual(["ses_both", "ses_one"])
    expect(await search(archive, "  ")).toEqual([])
  })

  test("every filter narrows inside the query, even when the crowd fills every candidate slot", async () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    // 70 short, top-ranked matches that each filter rejects: a post-filter over the top 60 finds nothing.
    for (let i = 0; i < 70; i++) {
      const part: Part = { kind: "tool", tool: "bash", title: "run", status: "completed", text: "bash run\nneedle", searchable: true }
      archive.putSnapshot(single(`ses_crowd_${i}`, "", { directory: "/crowd", type: "assistant", part, time: 1000 }), laptop)
    }
    const long = `needle ${"filler ".repeat(200)}`
    archive.putSnapshot(single("ses_early", long, { directory: "/target", time: 1 }), desktop)
    archive.putSnapshot(single("ses_late", long, { directory: "/target", time: 5000 }), desktop)

    expect(ids(await search(archive, "needle"))).not.toContain("ses_early")
    expect(ids(await search(archive, "needle", { directory: "targ" }))).toEqual(["ses_early", "ses_late"])
    expect(ids(await search(archive, "needle", { source: "desktop" }))).toEqual(["ses_early", "ses_late"])
    expect(ids(await search(archive, "needle", { sessionId: "ses_late" }))).toEqual(["ses_late"])
    expect(ids(await search(archive, "needle", { includeTools: false }))).toEqual(["ses_early", "ses_late"])
    expect(ids(await search(archive, "needle", { scope: "user-messages" }))).toEqual(["ses_early", "ses_late"])
    expect(ids(await search(archive, "needle", { since: 2000 }))).toEqual(["ses_late"])
    expect(ids(await search(archive, "needle", { until: 100 }))).toEqual(["ses_early"])
    // LIKE wildcards in the directory filter are literal.
    expect(await search(archive, "needle", { directory: "t_rget" })).toEqual([])
  })

  test("user-messages scope skips synthetic context and child sessions' user messages", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(single("ses_user", "needle"), laptop)
    archive.putSnapshot(single("ses_synthetic", "needle", { type: "synthetic" }), laptop)
    const child = single("ses_child", "needle")
    child.session.parentId = "ses_user"
    archive.putSnapshot(child, laptop)
    expect(ids(await search(archive, "needle", { scope: "user-messages" }))).toEqual(["ses_user"])
    expect(ids(await search(archive, "needle"))).toEqual(["ses_child", "ses_synthetic", "ses_user"])
  })

  test("the calling session is searched only before its last compaction", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_self", ["needle early", "needle late"]), laptop)
    archive.putSnapshot(single("ses_other", "needle"), laptop)

    const excluding = (before: number) => search(archive, "needle", { exclude: { sessionId: "ses_self", before } })
    expect((await excluding(11)).find((r) => r.sessionId === "ses_self")!.hits.map((h) => h.messageId)).toEqual(["ses_self_msg_0"])
    // Never compacted: all of it is already in the caller's context.
    expect(ids(await excluding(0))).toEqual(["ses_other"])
  })

  test("failed tool error text is searchable; parts flagged not searchable are not", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    const snapshot = session("ses_a", ["x"])
    snapshot.session.messages[0]!.parts = [
      { kind: "tool", tool: "bash", title: "git push", status: "error", error: "rejected", text: "bash git push\nrejected", searchable: true },
      { kind: "tool", tool: "recall_search", title: "q", status: "completed", text: "recall_search q\nechoed", searchable: false },
    ]
    archive.putSnapshot(snapshot, laptop)
    expect((await search(archive, "rejected"))[0]!.hits[0]).toMatchObject({ kind: "tool", snippet: "bash git push «rejected»" })
    expect(await search(archive, "echoed")).toEqual([])
  })

  test("replacing or deleting a session leaves no stale postings behind", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_a", ["removedword"]), laptop)
    expect(ids(await search(archive, "removedword"))).toEqual(["ses_a"])

    // The new segment reuses the old row id, so a posting left behind would match it.
    archive.putSnapshot(session("ses_a", ["freshword"], { revision: 2, lastActivity: 20 }), laptop)
    expect(await search(archive, "removedword")).toEqual([])
    expect(ids(await search(archive, "freshword"))).toEqual(["ses_a"])

    archive.putTombstone({ sessionId: "ses_a", revision: 3, timeDeleted: 30, reason: "deleted" }, laptop)
    archive.putSnapshot(session("ses_b", ["other"]), laptop)
    expect(await search(archive, "freshword")).toEqual([])
    expect(ids(await search(archive, "other"))).toEqual(["ses_b"])
  })

  test("a long non-ASCII part is split on encoded positions and its snippets are exact", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    // Astral characters are two UTF-16 units but four UTF-8 bytes, so any unit/byte mix-up
    // shifts every later segment.
    const text = `${"😀 ".repeat(3000)}résumé needle 東京 ${"🎉".repeat(9000)} tail`
    archive.putSnapshot(single("ses_a", text), laptop)
    const [hit] = (await search(archive, "needle"))[0]!.hits
    expect(hit!.snippet).toContain("😀 résumé «needle» 東京 🎉")
    expect((await search(archive, "tail"))[0]!.hits[0]!.snippet).toEndWith("🎉 «tail»")
  })

  test("text after an embedded NUL stays searchable, in its own segment and in later ones", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    // Shell output such as `find -print0` carries NULs, and SQLite's text functions stop at one.
    archive.putSnapshot(single("ses_short", "prefix\u0000needle"), laptop)
    archive.putSnapshot(single("ses_long", `a\u0000 ${"word ".repeat(2000)}latertoken`), laptop)
    expect((await search(archive, "needle"))[0]!.hits[0]!.snippet).toBe("prefix\u0000«needle»")
    expect(ids(await search(archive, "latertoken"))).toEqual(["ses_long"])
  })

  test("hybrid fuses both branches; semantic finds by meaning what BM25 misses, and each mode runs one branch", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    archive.putSnapshot(single("ses_meaning", "the deployment kept failing overnight"), laptop)
    archive.putSnapshot(single("ses_words", "deploying needs a green build"), laptop)
    archive.putSnapshot(single("ses_other", "lunch plans for friday"), laptop)
    while ((await archive.embedPending(2)) > 0);

    const run = (mode: Search["mode"]) => archive.search({ query: "deploying failing", limit: 25, mode }, laptop)
    const lexical = await run("lexical")
    expect(ids(lexical.sessions)).toEqual(["ses_meaning", "ses_words"])
    expect(lexical.sessions.every((s) => s.semanticMatches === 0 && s.hits.every((h) => h.branch === "lexical"))).toBe(true)

    const semantic = await run("semantic")
    expect(semantic.sessions[0]!.sessionId).toBe("ses_meaning")
    expect(semantic.sessions[0]!.lexicalMatches).toBe(0)
    expect(semantic.sessions[0]!.hits[0]).toEqual({
      branch: "semantic",
      messageId: "ses_meaning_msg_0",
      time: 10,
      score: expect.any(Number),
      snippet: "USER: the deployment kept «failing» overnight",
    })

    const hybrid = await run("hybrid")
    expect(hybrid.semanticUnavailable).toBeUndefined()
    expect(hybrid.sessions[0]).toMatchObject({ sessionId: "ses_meaning", lexicalMatches: 1, semanticMatches: 1 })
    expect(await run(undefined)).toEqual(hybrid)
  })

  test("a snapshot is lexically searchable before its chunks are embedded", async () => {
    const embedder = fakeEmbedder()
    const archive = open(path(), embedder)
    archive.putSnapshot(session("ses_a", ["where is the needle", "in the haystack"]), sourceOf(archive))
    expect(archive.status()).toMatchObject({ sessions: 1, chunks: 2, embeddedChunks: 0 })

    const { sessions, semanticUnavailable } = await archive.search({ query: "needle", limit: 8 }, 0)
    expect(semanticUnavailable).toBeUndefined()
    expect(sessions.map((s) => [s.sessionId, s.lexicalMatches, s.semanticMatches])).toEqual([["ses_a", 1, 0]])

    expect(await archive.embedPending(32)).toBe(2)
    expect(archive.status()).toMatchObject({ chunks: 2, embeddedChunks: 2 })
    // Only the `all`-scope chunk competes; the `user-messages` one answers that scope alone.
    expect((await archive.search({ query: "needle", limit: 8 }, 0)).sessions[0]!.semanticMatches).toBe(1)
    expect(await archive.embedPending(32)).toBe(0)
  })

  test("with the embedder down, hybrid returns lexical results and says the semantic branch was unavailable", async () => {
    const embedder = fakeEmbedder()
    const archive = open(path(), embedder)
    archive.putSnapshot(single("ses_a", "the needle"), sourceOf(archive))
    await archive.embedPending(32)
    embedder.down = true

    const hybrid = await archive.search({ query: "needle", limit: 8 }, 0)
    expect(hybrid.semanticUnavailable).toBe("embedding model unavailable")
    expect(hybrid.sessions.map((s) => [s.sessionId, s.lexicalMatches, s.semanticMatches])).toEqual([["ses_a", 1, 0]])
    expect(await archive.search({ query: "needle", limit: 8, mode: "semantic" }, 0)).toEqual({
      sessions: [],
      semanticUnavailable: "embedding model unavailable",
    })
    // Lexical mode never asks the embedder.
    expect(await archive.search({ query: "needle", limit: 8, mode: "lexical" }, 0)).not.toHaveProperty("semanticUnavailable")
  })

  test("embedding rejects and leaves the chunks queued while the embedder fails", async () => {
    const embedder = fakeEmbedder()
    const archive = open(path(), embedder)
    archive.putSnapshot(single("ses_a", "the needle"), sourceOf(archive))
    embedder.down = true
    await expect(archive.embedPending(32)).rejects.toThrow("embedding model unavailable")
    expect(archive.status()).toMatchObject({ chunks: 2, embeddedChunks: 0 })
    embedder.down = false
    expect(await archive.embedPending(32)).toBe(2)
  })

  test.each(["replaced", "deleted"])(
    "a session %s while its batch is being embedded gives the batch's vectors to no other chunk",
    async (how) => {
      const fake = fakeEmbedder()
      let gate = Promise.resolve()
      const archive = open(path(), {
        model: fake.model,
        embed: (texts) => Effect.promise(() => gate).pipe(Effect.andThen(fake.embed(texts))),
      })
      const laptop = sourceOf(archive)
      archive.putSnapshot(single("ses_a", "zebra stripes"), laptop)
      // Load the matrix, so a stale vector would also reach it.
      await archive.search({ query: "zebra", limit: 8, mode: "semantic" }, 0)
      let release = () => {}
      gate = new Promise<void>((resolve) => (release = resolve))
      const inFlight = archive.embedPending(32)

      if (how === "replaced") archive.putSnapshot(session("ses_a", ["walrus tusks"], { revision: 2, lastActivity: 20 }), laptop)
      else {
        archive.putTombstone({ sessionId: "ses_a", revision: 2, timeDeleted: 20, reason: "deleted" }, laptop)
        archive.putSnapshot(single("ses_b", "walrus tusks"), laptop)
      }
      release()
      await inFlight

      expect(archive.status()).toMatchObject({ chunks: 2, embeddedChunks: 0 })
      expect(await archive.embedPending(32)).toBe(2)
      const { sessions } = await archive.search({ query: "walrus", limit: 8, mode: "semantic" }, 0)
      expect(sessions.map((s) => s.hits[0]!.snippet)).toEqual(["USER: «walrus» tusks"])
    },
  )

  test("a grown session keeps the vectors of its unchanged chunks and embeds only the new ones", async () => {
    const embedder = fakeEmbedder()
    const archive = open(path(), embedder)
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_a", ["first question", "first answer"]), laptop)
    await archive.embedPending(32)
    embedder.calls.length = 0

    archive.putSnapshot(session("ses_a", ["first question", "first answer", "second question"]), laptop)
    expect(archive.status()).toMatchObject({ chunks: 4, embeddedChunks: 2 })
    await archive.embedPending(32)
    expect(embedder.calls).toEqual([["USER: second question", "second question"]])
    const { sessions } = await archive.search({ query: "first answer", limit: 8, mode: "semantic" }, 0)
    expect(sessions[0]!.hits[0]).toMatchObject({ messageId: "ses_a_msg_0", snippet: "USER: «first» question ASSISTANT: «first» «answer»" })
  })

  test("a replaced or deleted session's chunks leave the semantic results", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    const semantic = async (query: string) =>
      ids((await archive.search({ query, limit: 8, mode: "semantic" }, 0)).sessions)
    archive.putSnapshot(single("ses_a", "zebra"), laptop)
    archive.putSnapshot(single("ses_b", "yak"), laptop)
    await archive.embedPending(32)
    expect(await semantic("zebra")).toEqual(["ses_a", "ses_b"])

    archive.putSnapshot(session("ses_a", ["walrus"], { revision: 2, lastActivity: 20 }), laptop)
    await archive.embedPending(32)
    const zebra = await archive.search({ query: "zebra", limit: 8, mode: "semantic" }, 0)
    expect(zebra.sessions.flatMap((s) => s.hits.map((h) => h.snippet))).not.toContain("USER: zebra")

    archive.putTombstone({ sessionId: "ses_a", revision: 3, timeDeleted: 30, reason: "deleted" }, laptop)
    expect(await semantic("walrus")).toEqual(["ses_b"])
  })

  test("every filter narrows the semantic branch before its candidate cut", async () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    // 70 exact matches that each filter rejects, so a post-filter over the top 60 would find nothing.
    for (let i = 0; i < 70; i++)
      archive.putSnapshot(single(`ses_crowd_${i}`, "needle", { directory: "/crowd", type: "synthetic", time: 1000 }), laptop)
    archive.putSnapshot(single("ses_early", "needle and more words", { directory: "/target", time: 1 }), desktop)
    archive.putSnapshot(single("ses_late", "needle and more words", { directory: "/target", time: 5000 }), desktop)
    const child = single("ses_child", "needle and more words", { directory: "/target", time: 5000 })
    child.session.parentId = "ses_early"
    archive.putSnapshot(child, desktop)
    while ((await archive.embedPending(64)) > 0);

    const semantic = async (filters: Partial<Search>) =>
      ids((await archive.search({ query: "needle", limit: 25, mode: "semantic", ...filters }, 0)).sessions)
    expect(await semantic({})).not.toContain("ses_early")
    expect(await semantic({ directory: "targ" })).toEqual(["ses_child", "ses_early", "ses_late"])
    expect(await semantic({ source: "desktop" })).toEqual(["ses_child", "ses_early", "ses_late"])
    expect(await semantic({ sessionId: "ses_late" })).toEqual(["ses_late"])
    expect(await semantic({ scope: "user-messages" })).toEqual(["ses_early", "ses_late"])
    expect(await semantic({ directory: "/target", since: 2000 })).toEqual(["ses_child", "ses_late"])
    expect(await semantic({ directory: "/target", until: 100 })).toEqual(["ses_early"])
    expect(await semantic({ directory: "/target", exclude: { sessionId: "ses_late", before: 0 } })).toEqual([
      "ses_child",
      "ses_early",
    ])
  })

  test("inspect ranks one session's messages by message, returned chronologically, with ids expand accepts", async () => {
    const archive = open(path())
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    archive.putSnapshot(session("ses_a", ["needle one", "no match", "needle needle two", "needle three"]), desktop)
    archive.putSnapshot(session("ses_b", ["needle elsewhere"]), desktop)

    const answer = await archive.inspect({ session: "ses_a", query: "needle", mode: "lexical", limit: 2 }, laptop)
    if (answer.kind !== "matches") throw new Error(`expected matches, got ${answer.kind}`)
    expect(answer.session).toMatchObject({ sessionId: "ses_a", source: "desktop", ownSource: false, revision: 4 })
    expect(answer.total).toBe(3)
    // The best two by BM25, then put in transcript order.
    const ids = answer.hits.map((h) => h.messageId)
    expect(ids).toHaveLength(2)
    expect(ids).toContain("ses_a_msg_2")
    expect(answer.hits.map((h) => h.time)).toEqual([...answer.hits.map((h) => h.time)].sort((a, b) => a - b))
    expect(answer.hits.find((h) => h.messageId === "ses_a_msg_2")!.snippet).toBe("«needle» «needle» two")

    const window = archive.expand({ session: "ses_a", messageId: ids[0]!, window: 2, maxChars: 800 })
    if (window.kind !== "window") throw new Error(`expected a window, got ${window.kind}`)
    expect(window.messages.map((m) => m.messageId)).toContain(ids[0]!)

    const excluded = await archive.inspect(
      { session: "ses_a", query: "needle", mode: "lexical", limit: 30, exclude: { sessionId: "ses_a", before: 12 } },
      laptop,
    )
    expect(excluded).toMatchObject({ kind: "matches", total: 1, hits: [{ messageId: "ses_a_msg_0" }] })
  })

  test("inspect without a query outlines the session's user turns", async () => {
    const archive = open(path())
    const draft = session("ses_a", ["first  question\n\nwith newlines", "answer", "x".repeat(200), "answer"])
    draft.session.messages.push({ id: "ses_a_synthetic", type: "synthetic", timeCreated: 20, parts: [{ kind: "text", text: "injected" }] })
    archive.putSnapshot(draft, sourceOf(archive))

    const outline = await archive.inspect({ session: "ses_a", query: "  ", limit: 12 })
    expect(outline).toMatchObject({
      kind: "outline",
      messages: 5,
      turns: [
        { messageId: "ses_a_msg_0", time: 10, text: "first question with newlines" },
        { messageId: "ses_a_msg_2", time: 12, text: "x".repeat(120) + "…" },
      ],
    })
  })

  test("a hybrid inspect drops semantic hits below 0.55 cosine; semantic mode keeps them", async () => {
    const archive = open(path())
    archive.putSnapshot(session("ses_a", ["walrus tusks walrus tusks", "ok", "zebra stripes", "fine"]), sourceOf(archive))
    while ((await archive.embedPending(64)) > 0);

    const semantic = await archive.inspect({ session: "ses_a", query: "walrus tusks", mode: "semantic", limit: 30 })
    if (semantic.kind !== "matches") throw new Error(`expected matches, got ${semantic.kind}`)
    const scores = new Map(semantic.hits.map((h) => [h.messageId, h.branch === "semantic" ? h.score : NaN]))
    expect(scores.get("ses_a_msg_0")).toBeGreaterThanOrEqual(0.55)
    expect(scores.get("ses_a_msg_2")).toBeLessThan(0.55)

    const hybrid = await archive.inspect({ session: "ses_a", query: "walrus tusks", limit: 30 })
    expect(hybrid).toMatchObject({ kind: "matches", total: 1, hits: [{ messageId: "ses_a_msg_0" }] })
  })

  test("expand returns a window around a message, or the session's end, capping each message's text", async () => {
    const archive = open(path())
    const draft = session("ses_a", Array.from({ length: 10 }, (_, i) => `message ${i} ` + "word ".repeat(100)))
    draft.session.messages[9]!.parts.push(
      { kind: "reasoning", text: "hidden thoughts" },
      { kind: "tool", tool: "bash", title: "git   push", status: "error", error: "rejected:\n non-fast-forward", text: "bash git push\nrejected", searchable: true },
      { kind: "tool", tool: "bash", title: "sleep 9", status: "running", text: "", searchable: false },
    )
    archive.putSnapshot(draft, sourceOf(archive))

    const at = (f: Omit<Expand, "session">) => {
      const answer = archive.expand({ session: "ses_a", ...f })
      if (answer.kind !== "window") throw new Error(`expected a window, got ${answer.kind}`)
      return answer
    }
    const end = at({ window: 4, maxChars: 100 })
    expect([end.total, end.start]).toEqual([10, 6])
    expect(end.messages.map((m) => m.messageId)).toEqual(["ses_a_msg_6", "ses_a_msg_7", "ses_a_msg_8", "ses_a_msg_9"])
    const last = end.messages.at(-1)!
    expect(last.text).toBe(("message 9 " + "word ".repeat(100)).slice(0, 100) + "…")
    expect(last.tools).toEqual([
      { tool: "bash", title: "git push", status: "error", error: "rejected: non-fast-forward" },
      { tool: "bash", title: "sleep 9", status: "running" },
    ])

    expect(at({ messageId: "ses_a_msg_4", window: 3, maxChars: 4000 }).start).toBe(3)
    expect(at({ messageId: "ses_a_msg_0", window: 4, maxChars: 4000 }).start).toBe(0)
    expect(at({ messageId: "msg_not_here", window: 4, maxChars: 4000 }).start).toBe(6)
    expect(at({ window: 60, maxChars: 4000 }).messages).toHaveLength(10)
  })

  test("a transcript renders every message, keeps the head and tail within its budget, and reports what it cut", async () => {
    const archive = open(path())
    const draft = session("ses_a", Array.from({ length: 10 }, (_, i) => `message ${i} ` + "word ".repeat(100)))
    draft.session.messages[9]!.parts.push(
      { kind: "reasoning", text: "hidden thoughts" },
      { kind: "tool", tool: "bash", title: "git push", status: "error", error: "rejected", text: "bash git push\nrejected", searchable: true },
    )
    draft.session.messages.push({ id: "ses_a_msg_10", type: "assistant", timeCreated: 20, parts: [{ kind: "reasoning", text: "only thoughts" }] })
    archive.putSnapshot(draft, sourceOf(archive))

    const whole = archive.transcript({ session: "slug", budget: 100_000, maxChars: 4_000 })
    if (whole.kind !== "transcript") throw new Error(`expected a transcript, got ${whole.kind}`)
    expect(whole).toMatchObject({ session: { sessionId: "ses_a" }, contentHash: draft.contentHash, messages: 11, omitted: 0, clipped: 0 })
    expect(whole.text).toStartWith(`── user @ 1970-01-01 00:00Z (ses_a_msg_0)\nmessage 0 word`)
    expect(whole.text).toContain("(ses_a_msg_9)\n[tool bash] git push (failed: rejected)\nmessage 9 word")
    expect(whole.text).not.toContain("thoughts")

    const cut = archive.transcript({ session: "ses_a", budget: 1_000, maxChars: 100 })
    if (cut.kind !== "transcript") throw new Error(`expected a transcript, got ${cut.kind}`)
    const blocks = cut.text.split("\n── ")
    const note = blocks.findIndex((b) => b.includes(`[... ${cut.omitted} of 10 messages omitted ...]`))
    expect(cut.omitted).toBeGreaterThan(0)
    expect(cut.clipped).toBe(10 - cut.omitted)
    expect(cut.text).toStartWith("── user @ 1970-01-01 00:00Z (ses_a_msg_0)\n" + ("message 0 " + "word ".repeat(100)).slice(0, 100) + "…")
    expect(cut.text).toContain("(ses_a_msg_9)")
    expect(note).toBeGreaterThanOrEqual(0)
    expect(cut.text.length - blocks[note]!.length).toBeLessThanOrEqual(1_000)

    expect(archive.transcript({ session: "nope", budget: 1_000, maxChars: 100 })).toEqual({ kind: "missing" })
  })

  test("a summary is cached per key for the held content and dropped once the session advances or is deleted", async () => {
    const archive = open(path())
    const laptop = sourceOf(archive)
    const first = session("ses_a", ["hello", "hi"])
    archive.putSnapshot(first, laptop)
    const key = { provider: "openai", model: "gpt", variant: "low", focus: "", recipe: 1 }
    const put = (fields: Partial<SummaryPut> = {}) =>
      archive.putSummary({ ...key, sessionId: "ses_a", contentHash: first.contentHash, summary: "it said hello", omitted: 1, clipped: 2, ...fields })

    expect(archive.getSummary({ ...key, session: "nope" })).toEqual({ kind: "missing" })
    expect(archive.getSummary({ ...key, session: "slug" })).toMatchObject({ kind: "absent", session: { sessionId: "ses_a" } })
    expect(put()).toBe("stored")
    expect(archive.getSummary({ ...key, session: "slug" })).toMatchObject({ kind: "cached", summary: "it said hello", omitted: 1, clipped: 2, session: { revision: 2 } })
    const { variant: _, ...defaultVariant } = key
    for (const other of [{ ...key, focus: "why?" }, { ...key, model: "other" }, { ...key, provider: "anthropic" }, { ...key, recipe: 2 }, defaultVariant])
      expect(archive.getSummary({ ...other, session: "ses_a" })).toMatchObject({ kind: "absent" })
    expect(put({ summary: "rewritten" })).toBe("stored")
    expect(archive.getSummary({ ...key, session: "ses_a" })).toMatchObject({ kind: "cached", summary: "rewritten" })

    // A summarizer that read the old transcript finishes after the session moved on.
    const second = session("ses_a", ["hello", "hi", "more"])
    archive.putSnapshot(second, laptop)
    expect(archive.getSummary({ ...key, session: "ses_a" })).toMatchObject({ kind: "absent" })
    expect(put()).toBe("stale_revision")
    expect(archive.getSummary({ ...key, session: "ses_a" })).toMatchObject({ kind: "absent" })
    expect(put({ sessionId: "nope" })).toBe("stale_revision")

    expect(put({ contentHash: second.contentHash })).toBe("stored")
    archive.putTombstone({ sessionId: "ses_a", revision: 9, timeDeleted: 100, reason: "deleted" }, laptop)
    expect(put({ contentHash: second.contentHash })).toBe("stale_revision")
    // Re-imported with the same content after the deletion: the old summary did not survive it.
    archive.putSnapshot(session("ses_a", ["hello", "hi", "more"], { lastActivity: 200 }), laptop)
    expect(archive.getSummary({ ...key, session: "ses_a" })).toMatchObject({ kind: "absent" })
  })

  test("a slug names the most recently updated session with it and lists the others; an unknown one is missing", async () => {
    const archive = open(path())
    const older = session("ses_old", ["old"])
    const newer = session("ses_new", ["new"])
    newer.session.timeUpdated = 50
    archive.putSnapshot(older, sourceOf(archive))
    archive.putSnapshot(newer, sourceOf(archive))

    expect(archive.expand({ session: "slug", window: 12, maxChars: 800 })).toMatchObject({
      kind: "window",
      session: { sessionId: "ses_new" },
      sameSlug: [{ sessionId: "ses_old", title: "title", timeUpdated: 2 }],
    })
    expect(archive.expand({ session: "ses_old", window: 12, maxChars: 800 })).toMatchObject({ sameSlug: [] })
    expect(archive.expand({ session: "nope", window: 12, maxChars: 800 })).toEqual({ kind: "missing" })
    expect(await archive.inspect({ session: "nope", limit: 12 })).toEqual({ kind: "missing" })
    expect(await archive.inspect({ session: "nope", query: "x", limit: 12 })).toEqual({ kind: "missing" })
  })

  test("status reports the active space's full recipe", async () => {
    const archive = open(path())
    expect(archive.status().activeSpace).toEqual({
      recipe: {
        model: "fake/bag-of-words",
        revision: "1",
        dtype: "fp32",
        dims: 64,
        runtime: "fake",
        pooling: "mean",
        normalize: true,
        queryPrefix: "query: ",
        chunkChars: 1200,
        chunkOverlap: 200,
        turnChars: 60000,
        rendering: 1,
      },
      matchesConfigured: true,
    })
  })
})

describe("archive (file-backed only)", () => {
  test("a divergence and a rewind are still reported after the archive is reopened", async () => {
    const path = tempPath()
    const archive = open(path)
    const [laptop, desktop] = [sourceOf(archive, "laptop"), sourceOf(archive, "desktop")]
    archive.putSnapshot(session("ses_a", ["one", "two"], { revision: 9 }), laptop)
    archive.putSnapshot(session("ses_a", ["one"], { revision: 3, lastActivity: 20 }), laptop)
    archive.putSnapshot(session("ses_a", ["uno"], { revision: 3, lastActivity: 20 }), desktop)
    archive.close()

    const reopened = open(path).status()
    expect(reopened.divergences).toMatchObject([{ sessionId: "ses_a", heldFrom: "laptop", refusedFrom: "desktop" }])
    expect(reopened.rewinds).toMatchObject({ total: 1, recent: [{ fromRevision: 9, toRevision: 3 }] })
  })

  test("stores sessions, messages, and parts rows, and a replace leaves no stale rows", async () => {
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

  test("tool parts keep their name, title, status, error text, and searchability", async () => {
    const path = tempPath()
    const archive = open(path)
    const snapshot = session("ses_a", ["one"])
    snapshot.session.messages[0]!.parts = [
      { kind: "tool", tool: "bash", title: "git push", status: "error", error: "rejected", text: "bash git push\nrejected", searchable: true },
      { kind: "tool", tool: "bash", title: "sleep 9", status: "running", text: "", searchable: false },
      { kind: "tool", tool: "recall_search", title: "x", status: "completed", text: "recall_search x\nhits", searchable: false },
    ]
    archive.putSnapshot(snapshot, sourceOf(archive))

    const db = new Database(path, { readonly: true })
    expect(db.query("SELECT tool_name, tool_title, status, error, text, searchable FROM parts ORDER BY ordinal").all()).toEqual([
      { tool_name: "bash", tool_title: "git push", status: "error", error: "rejected", text: "bash git push\nrejected", searchable: 1 },
      { tool_name: "bash", tool_title: "sleep 9", status: "running", error: null, text: "", searchable: 0 },
      { tool_name: "recall_search", tool_title: "x", status: "completed", error: null, text: "recall_search x\nhits", searchable: 0 },
    ])
    db.close()
  })

  test("segments are at most 8,000 characters, stored as byte positions that reassemble the part", async () => {
    const path = tempPath()
    const archive = open(path)
    const text = `${"😀 ".repeat(3000)}résumé\u0000東京\n${"🎉".repeat(9000)} tail`
    archive.putSnapshot(single("ses_a", text), sourceOf(archive))

    const db = new Database(path, { readonly: true })
    const rows = db.query("SELECT text FROM segment_text ORDER BY id").all() as { text: string }[]
    expect(rows.length).toBeGreaterThan(2)
    expect(rows.map((r) => r.text).join("")).toBe(text)
    // Each segment is the JavaScript slice it was cut as, so a UTF-16 offset read as a byte
    // position (which still tiles the text) is caught too.
    expect(rows[0]!.text).toBe("😀 ".repeat(2666))
    expect(rows.every((r) => r.text.length <= 8_000)).toBe(true)
    db.close()
  })

  test("the FTS index stays consistent with its content across replaces and deletions", async () => {
    const path = tempPath()
    const archive = open(path)
    const laptop = sourceOf(archive)
    archive.putSnapshot(session("ses_a", ["one two", "three"]), laptop)
    archive.putSnapshot(session("ses_a", ["four"], { revision: 5, lastActivity: 50 }), laptop)
    archive.putSnapshot(session("ses_b", ["five"]), laptop)
    archive.putTombstone({ sessionId: "ses_b", revision: 9, timeDeleted: 90, reason: "deleted" }, laptop)
    archive.close()

    const db = new Database(path)
    // Rank 1 compares the index against the content view, not just its own structure.
    db.run("INSERT INTO fts (fts, rank) VALUES ('integrity-check', 1)")
    expect(db.query("SELECT count(*) AS n FROM segments").get()).toEqual({ n: 1 })
    db.close()
  })

  test("parts archived before segments existed are segmented and searchable after migrating", async () => {
    const path = tempPath()
    const db = new Database(path, { create: true })
    for (const sql of migrations.slice(0, SEGMENTED - 1)) db.run(sql)
    db.run(`PRAGMA user_version = ${SEGMENTED - 1}`)
    db.run("INSERT INTO sessions (id, slug, title, directory, time_created, time_updated) VALUES ('ses_old', 's', 't', '/w', 1, 2)")
    db.run("INSERT INTO messages VALUES ('msg_old', 'ses_old', 0, 'user', 5)")
    db.run("INSERT INTO parts (message_id, ordinal, kind, text) VALUES ('msg_old', 0, 'text', 'legacy needle')")
    db.run(
      "INSERT INTO parts (message_id, ordinal, kind, text, searchable) VALUES ('msg_old', 1, 'tool', 'hidden needle', 0)",
    )
    db.close()

    const archive = open(path)
    expect(archive.migration.from).toBe(SEGMENTED - 1)
    expect((await search(archive, "needle"))[0]!.hits.map((h) => h.snippet)).toEqual(["legacy «needle»"])
    expect(await search(archive, "hidden")).toEqual([])
  })

  test("source_id moves to the source of each accepted snapshot, but not on a no-op", async () => {
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

  test("stores only a SHA-256 of each token, and attributes snapshots to the source", async () => {
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

  test("an archive from before sources existed migrates forward and keeps its sessions", async () => {
    const path = tempPath()
    const db = new Database(path, { create: true })
    db.run(migrations[0]!)
    db.run("PRAGMA user_version = 1")
    db.run("INSERT INTO sessions VALUES ('ses_old', 's', 't', '/w', NULL, 1, 2)")
    db.close()

    const archive = open(path)
    expect(archive.migration).toEqual({ from: 1, to: SCHEMA_VERSION })
    expect(archive.status()).toMatchObject({ sessions: 1 })
    // A row archived before positions existed sits behind any real snapshot.
    expect(archive.putSnapshot(session("ses_old", ["one"]), sourceOf(archive))).toBe("archived")
  })

  test("a token revoked through another connection fails on the serving connection's next check", async () => {
    const path = tempPath()
    const serving = open(path)
    const token = serving.issueToken("laptop")
    expect(serving.authenticate(token)).not.toBeNull()

    const admin = open(path)
    admin.revokeToken(admin.listTokens()[0]!.id)
    admin.close()
    expect(serving.authenticate(token)).toBeNull()
  })

  test("chunks whose embedding failed are embedded from the queue after a restart", async () => {
    const path = tempPath()
    const down = fakeEmbedder()
    down.down = true
    const first = open(path, down)
    first.putSnapshot(single("ses_a", "the needle"), sourceOf(first))
    await expect(first.embedPending(32)).rejects.toThrow()
    first.close()

    const second = open(path)
    expect(second.status()).toMatchObject({ chunks: 2, embeddedChunks: 0 })
    expect(await second.embedPending(32)).toBe(2)
    const { sessions } = await second.search({ query: "needle", limit: 8, mode: "semantic" }, 0)
    expect(ids(sessions)).toEqual(["ses_a"])
  })

  test("the active space is kept when the hub's embedder differs, and the semantic branch says to reindex", async () => {
    const path = tempPath()
    const first = open(path)
    first.putSnapshot(single("ses_a", "the needle"), sourceOf(first))
    first.close()

    const other = fakeEmbedder({ model: "fake/other" })
    const archive = open(path, other)
    expect(archive.status().activeSpace).toMatchObject({ recipe: { model: "fake/bag-of-words" }, matchesConfigured: false })
    expect(await archive.embedPending(32)).toBe(0)
    const { sessions, semanticUnavailable } = await archive.search({ query: "needle", limit: 8 }, 0)
    expect(ids(sessions)).toEqual(["ses_a"])
    expect(semanticUnavailable).toContain("run reindex")
    expect(other.calls).toEqual([])
  })

  test("stores each chunk's exact text, provenance, and hash in the active space's chunk set", async () => {
    const path = tempPath()
    const archive = open(path)
    archive.putSnapshot(session("ses_a", ["question", "answer"]), sourceOf(archive))
    await archive.embedPending(32)

    const db = new Database(path, { readonly: true })
    const rows = db
      .query(
        `SELECT c.session_id, c.message_id, c.window_index, c.scope, c.time_created, c.text, c.hash, length(v.embedding) AS bytes
         FROM chunks c JOIN chunk_sets cs ON cs.id = c.chunk_set_id JOIN vector_spaces s ON s.id = cs.space_id AND s.active = 1
         JOIN vectors v ON v.chunk_id = c.id AND v.space_id = s.id ORDER BY c.id`,
      )
      .all()
    const sha = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex")
    expect(rows).toEqual([
      { session_id: "ses_a", message_id: "ses_a_msg_0", window_index: 0, scope: "all", time_created: 10, text: "USER: question\nASSISTANT: answer", hash: sha("USER: question\nASSISTANT: answer"), bytes: 256 },
      { session_id: "ses_a", message_id: "ses_a_msg_0", window_index: 0, scope: "user-messages", time_created: 10, text: "question", hash: sha("question"), bytes: 256 },
    ])
    db.close()
  })

  test("sessions archived before vector spaces existed are chunked on migrating", async () => {
    const path = tempPath()
    const db = new Database(path, { create: true })
    for (const sql of migrations.slice(0, SPACES - 1)) db.run(sql)
    db.run(`PRAGMA user_version = ${SPACES - 1}`)
    db.run("INSERT INTO sessions (id, slug, title, directory, time_created, time_updated) VALUES ('ses_old', 's', 't', '/w', 1, 2)")
    db.run("INSERT INTO messages VALUES ('msg_old', 'ses_old', 0, 'user', 5)")
    db.run("INSERT INTO parts (message_id, ordinal, kind, text) VALUES ('msg_old', 0, 'text', 'legacy needle')")
    db.close()

    const archive = open(path)
    expect(archive.status()).toMatchObject({ sessions: 1, chunks: 2, embeddedChunks: 0 })
    await archive.embedPending(32)
    const { sessions } = await archive.search({ query: "needle", limit: 8, mode: "semantic" }, 0)
    expect(sessions[0]!.hits[0]!.snippet).toBe("USER: legacy «needle»")
  })

  test("reopening an up-to-date archive applies no migrations and keeps its data", async () => {
    const path = tempPath()
    const first = open(path)
    first.putSnapshot(session("ses_a", ["hello"]), sourceOf(first))
    first.close()

    const second = open(path)
    expect(second.migration).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
    expect(second.status()).toMatchObject({ sessions: 1 })
  })

  /** Windows small enough that one short session yields several chunks. */
  const SMALL: ChunkParams = { ...DEFAULT_CHUNKING, chunkChars: 10, chunkOverlap: 2 }

  /** Every vector space's activity, chunk size, and vector count, and the chunks held in all of them. */
  function spaces(path: string) {
    const db = new Database(path, { readonly: true })
    const rows = db
      .query(
        `SELECT active, json_extract(recipe, '$.model') AS model, json_extract(recipe, '$.chunkChars') AS chunkChars,
           (SELECT count(*) FROM vectors v WHERE v.space_id = s.id) AS vectors
         FROM vector_spaces s ORDER BY id`,
      )
      .all()
    const { n: chunks } = db.query("SELECT count(*) AS n FROM chunks").get() as { n: number }
    db.close()
    return { spaces: rows, chunks }
  }

  const embedAll = async (rebuild: Archive.Rebuild) => {
    let embedded = 0
    for (let n; (n = await Effect.runPromise(rebuild.embedNext(4))); ) embedded += n
    return embedded
  }

  /** An archive holding one embedded session in a space of the default chunking. */
  async function seeded(embedder = fakeEmbedder()) {
    const path = tempPath()
    const first = open(path, embedder)
    first.putSnapshot(session("ses_a", ["deployment question", "a long answer about the rollout"]), sourceOf(first))
    await first.embedPending(32)
    first.close()
    return path
  }

  test("a rebuild fills a new space beside the active one; activating it drops the old space and its vectors", async () => {
    const path = await seeded()
    const archive = open(path, fakeEmbedder(), SMALL)
    expect(archive.status().activeSpace.matchesConfigured).toBe(false)

    const rebuild = archive.rebuild()!
    expect(rebuild.recipe.chunkChars).toBe(10)
    expect(rebuild.chunks).toBeGreaterThan(2)
    expect(await embedAll(rebuild)).toBe(rebuild.chunks)
    // Until the new space is activated, searches and status stay on the old one.
    expect(archive.status()).toMatchObject({ chunks: 2, embeddedChunks: 2, activeSpace: { recipe: { chunkChars: 1200 } } })
    expect(ids((await archive.search({ query: "deploying", limit: 8, mode: "semantic" }, 0)).sessions)).toEqual(["ses_a"])

    await Effect.runPromise(rebuild.activate)
    expect(archive.status()).toMatchObject({
      chunks: rebuild.chunks,
      embeddedChunks: rebuild.chunks,
      activeSpace: { recipe: { chunkChars: 10 }, matchesConfigured: true },
    })
    expect(spaces(path)).toEqual({
      spaces: [{ active: 1, model: "fake/bag-of-words", chunkChars: 10, vectors: rebuild.chunks }],
      chunks: rebuild.chunks,
    })
    const [hit] = (await archive.search({ query: "deploying", limit: 8, mode: "semantic" }, 0)).sessions
    expect(hit!.hits[0]!.snippet.length).toBeLessThan(20)
    expect(archive.rebuild()).toBeNull()
  })

  test("activating refuses while any chunk of the new space is unembedded, and the old space stays active", async () => {
    const archive = open(await seeded(), fakeEmbedder(), SMALL)
    const rebuild = archive.rebuild()!
    await Effect.runPromise(rebuild.embedNext(1))
    const refused = await Effect.runPromise(Effect.flip(rebuild.activate))
    expect(refused).toBeInstanceOf(Archive.Incomplete)
    expect(refused.pending).toBe(rebuild.chunks - 1)
    expect(archive.status()).toMatchObject({ chunks: 2, activeSpace: { recipe: { chunkChars: 1200 } } })
  })

  test("an abandoned rebuild leaves the old space serving until it is reclaimed, and never piles up", async () => {
    const path = await seeded()
    const interrupted = open(path, fakeEmbedder(), SMALL)
    const rebuild = interrupted.rebuild()!
    await Effect.runPromise(rebuild.embedNext(2))
    interrupted.close()

    const archive = open(path)
    expect(archive.status()).toMatchObject({ chunks: 2, embeddedChunks: 2, activeSpace: { matchesConfigured: true } })
    expect(ids((await archive.search({ query: "deploying", limit: 8, mode: "semantic" }, 0)).sessions)).toEqual(["ses_a"])
    expect(spaces(path).spaces).toHaveLength(2)
    expect(archive.reclaim()).toBe(rebuild.chunks)
    expect(spaces(path)).toEqual({ spaces: [{ active: 1, model: "fake/bag-of-words", chunkChars: 1200, vectors: 2 }], chunks: 2 })
    expect(archive.reclaim()).toBe(0)
    archive.close()

    open(path, fakeEmbedder(), SMALL).rebuild()
    open(path, fakeEmbedder(), SMALL).rebuild()
    expect(spaces(path).spaces).toHaveLength(2)
  })

  test("once a space of another model is active, the hub's embedder answers queries and fills its queue again", async () => {
    const path = await seeded()
    const other = fakeEmbedder({ model: "fake/other" })
    const archive = open(path, other)
    expect((await archive.search({ query: "deploying", limit: 8 }, 0)).semanticUnavailable).toContain("run reindex")

    const rebuild = archive.rebuild()!
    await embedAll(rebuild)
    await Effect.runPromise(rebuild.activate)
    const { sessions, semanticUnavailable } = await archive.search({ query: "deploying", limit: 8, mode: "semantic" }, 0)
    expect(semanticUnavailable).toBeUndefined()
    expect(ids(sessions)).toEqual(["ses_a"])
    archive.putSnapshot(single("ses_b", "fresh needle"), sourceOf(archive))
    expect(await archive.embedPending(32)).toBe(2)
    expect(spaces(path).spaces).toEqual([{ active: 1, model: "fake/other", chunkChars: 1200, vectors: 4 }])
  })

  test("refuses a database migrated by a newer binary, naming both versions", async () => {
    const path = tempPath()
    const db = new Database(path, { create: true })
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()

    const refused = Effect.runSync(
      Effect.scoped(Archive.make(path)).pipe(Effect.provideService(Embedder.Service, fakeEmbedder()), Effect.flip),
    )
    expect(refused).toBeInstanceOf(Archive.NewerSchema)
    expect(refused.message).toContain(
      `archive schema version ${SCHEMA_VERSION + 1} is newer than this binary supports (${SCHEMA_VERSION})`,
    )
    const after = new Database(path, { readonly: true })
    expect(after.query("SELECT count(*) AS n FROM sqlite_master").get()).toEqual({ n: 0 })
    after.close()
  })
})
