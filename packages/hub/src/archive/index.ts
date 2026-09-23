/**
 * The Archive module: the only code that knows the hub's SQL schema.
 *
 * Every statement lives behind this interface. Callers hand it validated
 * protocol values and get plain results back.
 */
import { Database } from "bun:sqlite"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type {
  Manifest,
  Message,
  Responses,
  Search,
  SearchHit,
  SearchResult,
  Snapshot,
  SpaceRecipe,
  Tombstone,
} from "@opencode-recall/protocol"
import type { Embedder, EmbeddingModel } from "../embedder.ts"
import { RENDERING_VERSION, renderChunks, type ChunkSource } from "./chunks.ts"
import { SEGMENTED, migrations } from "./migrations.ts"
import { ftsQuery, fuse, makeSnippet, queryTokens, segments } from "./text.ts"
import { createMatrix, type Matrix, type VectorRow } from "./vectors.ts"

export const SCHEMA_VERSION = migrations.length

const TOKEN_PREFIX = "opencode-recall_"

/** One host. Outlives any single token, so rotating tokens never changes attribution. */
export type Source = { id: number; name: string }

export type TokenInfo = { id: number; source: string; timeCreated: number }

/** How `putSnapshot` resolved a snapshot against the copy the archive holds (§5 acceptance). */
export type PutResult = "archived" | "rewound" | "unchanged" | "stale_revision" | "hash_divergence" | "tombstoned"

export type Archive = {
  /** Schema versions before and after the migrations applied by this open. */
  readonly migration: { from: number; to: number }
  /**
   * Resolve the snapshot against the held copy by position `(lastActivity, revision)` and, when it
   * is accepted, replace the session and its whole transcript in one transaction, attributing it to
   * `sourceId`. A matching content hash is `unchanged` at any position and moves nothing.
   *
   * A tombstoned session is `tombstoned` unless the snapshot's last activity is after the deletion
   * time; such a snapshot is archived and clears the tombstone.
   */
  putSnapshot(snapshot: Snapshot, sourceId: number): PutResult
  /**
   * Delete the session and its transcript, and record a tombstone so no snapshot active at or
   * before the deletion time can bring it back. Of two tombstones for one session the later
   * deletion is kept. A held copy active after the deletion time wins and the tombstone is a
   * no-op, so a retried old deletion cannot remove a later re-import. `removed` is whether a copy
   * was deleted.
   */
  putTombstone(tombstone: Tombstone, sourceId: number): { removed: boolean }
  /** Every held session's position and hash, and every tombstone, across all sources. */
  manifest(): Manifest
  /**
   * Sessions across every source ranked by fusing a BM25 branch and a cosine branch over the
   * active space (or by one alone, per `mode`), each with its best hits. Every filter is applied
   * before either branch's candidate cut. The query's tokens must all match (each quoted as a
   * phrase); when none do and there are several tokens, any may match. `ownSource` compares each
   * session's source against `callerSourceId`.
   *
   * The query is embedded first, in the request. If that fails, or the embedder cannot produce
   * vectors for the active space, the lexical branch still runs and `semanticUnavailable` says why.
   */
  search(search: Search, callerSourceId: number): Promise<Responses["search"]>
  /**
   * Embed up to `limit` chunks waiting in the active space's queue, oldest first, and return how
   * many were taken from it (0 once it is empty, or when the embedder does not match the active
   * space). Rejects, embedding nothing, when the embedder fails; the chunks stay queued.
   */
  embedPending(limit: number): Promise<number>
  /**
   * Mint a token for the named source, creating the source if it is new.
   * The returned value is the only copy; the archive keeps just its hash.
   */
  issueToken(source: string): string
  listTokens(): TokenInfo[]
  /** Delete the token so the next request presenting it fails. False if no such token. */
  revokeToken(id: number): boolean
  /** The source a presented token maps to, or `null`. Compares against every live token in constant time. */
  authenticate(token: string): Source | null
  status(): Responses["status"]
  close(): void
}

/**
 * Open (creating if needed) and migrate the archive at `path`, or `:memory:`.
 * Throws without touching the database when it was migrated by a newer binary.
 *
 * An archive with no active vector space gets one built from `embedder`'s model and this binary's
 * chunking, and every held session is chunked into it. An existing active space is kept even when
 * it differs (see `status().activeSpace.matchesConfigured`); only a reindex replaces it.
 */
export function openArchive(path: string, embedder: Embedder): Archive {
  const db = new Database(path, { create: true, strict: true })
  try {
    db.run("PRAGMA foreign_keys = ON")
    // `token` subcommands write while `serve` holds the same file.
    db.run("PRAGMA busy_timeout = 5000")
    if (path !== ":memory:") db.run("PRAGMA journal_mode = WAL")
    const migration = migrate(db)
    return bind(db, migration, embedder)
  } catch (e) {
    db.close()
    throw e
  }
}

function migrate(db: Database): { from: number; to: number } {
  return db
    .transaction(() => {
      const { user_version: from } = db.query("PRAGMA user_version").get() as { user_version: number }
      if (from > SCHEMA_VERSION)
        throw new Error(
          `archive schema version ${from} is newer than this binary supports (${SCHEMA_VERSION}); refusing to start`,
        )
      for (const sql of migrations.slice(from)) db.run(sql)
      if (from > 0 && from < SEGMENTED) {
        const segment = segmenter(db)
        const rows = db.query("SELECT id, text FROM parts WHERE searchable = 1").all() as { id: number; text: string }[]
        for (const { id, text } of rows) segment(id, text)
      }
      // PRAGMA takes no bound parameters; SCHEMA_VERSION is a compile-time integer.
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      return { from, to: SCHEMA_VERSION }
    })
    .immediate()
}

/** At most this many characters (UTF-16 code units) per FTS row. */
const SEGMENT_CHARS = 8_000
/** Candidates each branch ranks before fusion. */
const CANDIDATES = 60
const RRF_K = 60

/** The space this binary builds for `model`. Key order is fixed, since the JSON is the identity. */
function recipeFor(model: EmbeddingModel): SpaceRecipe {
  return {
    model: model.model,
    revision: model.revision,
    dtype: model.dtype,
    dims: model.dims,
    runtime: model.runtime,
    pooling: model.pooling,
    normalize: model.normalize,
    queryPrefix: model.queryPrefix,
    chunkChars: 1_200,
    chunkOverlap: 200,
    turnChars: 60_000,
    rendering: RENDERING_VERSION,
  }
}

/** Whether vectors of one recipe answer queries embedded by another's model. */
const sameModel = (a: EmbeddingModel, b: EmbeddingModel) =>
  a.model === b.model &&
  a.revision === b.revision &&
  a.dtype === b.dtype &&
  a.dims === b.dims &&
  a.runtime === b.runtime &&
  a.pooling === b.pooling &&
  a.normalize === b.normalize &&
  a.queryPrefix === b.queryPrefix

const blobOf = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
/** Copied, since a blob's bytes need not be aligned for a `Float32Array` view. */
const vectorOf = (blob: Uint8Array) => new Float32Array(blob.slice().buffer)
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

/** Write a searchable part's segments and index each one from the view, so indexed text is what a delete re-reads. */
function segmenter(db: Database) {
  const insertSegment = db.prepare("INSERT INTO segments (part_id, start, length) VALUES (?, ?, ?)")
  const indexSegments = db.prepare(
    "INSERT INTO fts (rowid, text) SELECT id, text FROM segment_text WHERE id IN (SELECT id FROM segments WHERE part_id = ?)",
  )
  return (partId: number, text: string) => {
    for (const { start, length } of segments(text, SEGMENT_CHARS)) insertSegment.run(partId, start, length)
    indexSegments.run(partId)
  }
}

type Candidate = { sessionId: string } & (
  | (Omit<Extract<SearchHit, { branch: "lexical" }>, "snippet"> & { segmentId: number })
  | (Omit<Extract<SearchHit, { branch: "semantic" }>, "snippet"> & { chunkId: number })
)

const likeSubstring = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`

/** The ids of sessions passing the session-level filters, or `null` when none is set. */
function sessionFilterQuery(f: Search): { sql: string; args: string[] } | null {
  const where: string[] = []
  const args: string[] = []
  if (f.directory !== undefined) {
    where.push("s.directory LIKE ? ESCAPE '\\'")
    args.push(likeSubstring(f.directory))
  }
  if (f.source !== undefined) {
    where.push("src.name = ?")
    args.push(f.source)
  }
  if (!where.length) return null
  return {
    sql: `SELECT s.id FROM sessions s LEFT JOIN sources src ON src.id = s.source_id WHERE ${where.join(" AND ")}`,
    args,
  }
}

/** The lexical branch's statement and arguments. Every filter is a condition here, never a post-filter. */
function lexicalQuery(match: string, f: Search): { sql: string; args: (string | number)[] } {
  const where = ["fts MATCH ?"]
  const args: (string | number)[] = [match]
  const add = (condition: string, ...values: (string | number)[]) => {
    where.push(condition)
    args.push(...values)
  }
  if (f.sessionId !== undefined) add("s.id = ?", f.sessionId)
  if (f.directory !== undefined) add("s.directory LIKE ? ESCAPE '\\'", likeSubstring(f.directory))
  if (f.source !== undefined) add("src.name = ?", f.source)
  if (f.includeTools === false) add("p.kind <> 'tool'")
  if (f.scope === "user-messages") add("m.type = 'user' AND p.kind = 'text' AND s.parent_id IS NULL")
  if (f.since !== undefined) add("m.time_created >= ?", f.since)
  if (f.until !== undefined) add("m.time_created <= ?", f.until)
  if (f.exclude) add("NOT (s.id = ? AND m.time_created >= ?)", f.exclude.sessionId, f.exclude.before)
  const sql = `SELECT 'lexical' AS branch, s.id AS sessionId, m.id AS messageId, m.type AS messageType, p.kind,
      m.time_created AS time, seg.id AS segmentId
    FROM fts
    JOIN segments seg ON seg.id = fts.rowid
    JOIN parts p ON p.id = seg.part_id
    JOIN messages m ON m.id = p.message_id
    JOIN sessions s ON s.id = m.session_id
    LEFT JOIN sources src ON src.id = s.source_id
    WHERE ${where.join(" AND ")}
    ORDER BY rank LIMIT ${CANDIDATES}`
  return { sql, args }
}

type Space = { id: number; setId: number; recipe: SpaceRecipe }
/** A vector already in the space, carried over to the new chunk with the same text. */
type Reused = { row: VectorRow; vector: Float32Array }

function bind(db: Database, migration: { from: number; to: number }, embedder: Embedder): Archive {
  const segment = segmenter(db)
  const insertChunk = db.prepare(
    `INSERT INTO chunks (chunk_set_id, session_id, message_id, window_index, scope, time_created, hash, text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  // A chunk deleted while its batch was being embedded gets no vector.
  const insertVector = db.prepare(
    `INSERT OR IGNORE INTO vectors (chunk_id, space_id, embedding)
     SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM chunks WHERE id = ?)`,
  )
  const selectChunkSource = db.prepare(
    `SELECT m.id, m.type, m.time_created AS timeCreated, p.text FROM messages m
     LEFT JOIN parts p ON p.message_id = m.id AND p.kind = 'text'
     WHERE m.session_id = ? ORDER BY m.ordinal, p.ordinal`,
  )

  /** Chunk a session into the space, reusing `prior` vectors by chunk hash. The rest join the queue. */
  function writeChunks(space: Space, sessionId: string, source: ChunkSource, prior: Map<string, Uint8Array>): Reused[] {
    const reused: Reused[] = []
    for (const chunk of renderChunks(source, space.recipe)) {
      const hash = sha256(chunk.text)
      const { lastInsertRowid } = insertChunk.run(
        space.setId,
        sessionId,
        chunk.messageId,
        chunk.window,
        chunk.scope,
        chunk.time,
        hash,
        chunk.text,
      )
      const embedding = prior.get(hash)
      if (!embedding) continue
      const chunkId = Number(lastInsertRowid)
      insertVector.run(chunkId, space.id, embedding, chunkId)
      const row = { chunkId, sessionId, messageId: chunk.messageId, time: chunk.time, scope: chunk.scope }
      reused.push({ row, vector: vectorOf(embedding) })
    }
    return reused
  }

  /** A held session's chunking input, read back from its stored messages and text parts. */
  function readChunkSource(sessionId: string, parentId: string | null): ChunkSource {
    type Row = { id: string; type: Message["type"]; timeCreated: number; text: string | null }
    const messages: ChunkSource["messages"] = []
    for (const { text, ...message } of selectChunkSource.all(sessionId) as Row[]) {
      if (messages.at(-1)?.id !== message.id) messages.push({ ...message, parts: [] })
      if (text !== null) messages.at(-1)!.parts.push({ kind: "text", text })
    }
    return { parentId, messages }
  }

  const configured = recipeFor(embedder.model)
  const space = db
    .transaction((): Space => {
      const held = db
        .query(
          `SELECT s.id, c.id AS setId, s.recipe FROM vector_spaces s JOIN chunk_sets c ON c.space_id = s.id
           WHERE s.active = 1`,
        )
        .get() as { id: number; setId: number; recipe: string } | null
      if (held) return { ...held, recipe: JSON.parse(held.recipe) as SpaceRecipe }
      const { id } = db
        .query("INSERT INTO vector_spaces (recipe, active, time_created) VALUES (?, 1, ?) RETURNING id")
        .get(JSON.stringify(configured), Date.now()) as { id: number }
      const { id: setId } = db
        .query("INSERT INTO chunk_sets (space_id, time_created) VALUES (?, ?) RETURNING id")
        .get(id, Date.now()) as { id: number }
      const created = { id, setId, recipe: configured }
      // Sessions archived before vector spaces existed.
      const archived = db.query("SELECT id, parent_id AS parentId FROM sessions").all() as { id: string; parentId: string | null }[]
      for (const s of archived) writeChunks(created, s.id, readChunkSource(s.id, s.parentId), new Map())
      return created
    })
    .immediate()
  const matchesConfigured = JSON.stringify(space.recipe) === JSON.stringify(configured)
  const embedderFits = sameModel(space.recipe, embedder.model)

  const selectPriorVectors = db.prepare(
    `SELECT c.hash, v.embedding FROM chunks c JOIN vectors v ON v.chunk_id = c.id AND v.space_id = ?
     WHERE c.session_id = ?`,
  )
  const selectPending = db.prepare(
    `SELECT c.id AS chunkId, c.session_id AS sessionId, c.message_id AS messageId, c.time_created AS time, c.scope, c.text
     FROM chunks c
     WHERE c.chunk_set_id = ? AND NOT EXISTS (SELECT 1 FROM vectors v WHERE v.chunk_id = c.id AND v.space_id = ?)
     ORDER BY c.id LIMIT ?`,
  )
  const selectSpaceVectors = db.prepare(
    `SELECT c.id AS chunkId, c.session_id AS sessionId, c.message_id AS messageId, c.time_created AS time, c.scope,
       v.embedding
     FROM vectors v JOIN chunks c ON c.id = v.chunk_id WHERE v.space_id = ? ORDER BY c.id`,
  )
  const selectChunkText = db.prepare("SELECT text FROM chunks WHERE id = ?")
  const countChunks = db.prepare("SELECT count(*) AS n FROM chunks WHERE chunk_set_id = ?")
  const countVectors = db.prepare("SELECT count(*) AS n FROM vectors WHERE space_id = ?")

  /** Loaded on the first semantic search, then kept in step with every write. */
  let matrix: Matrix | null = null
  function vectors(): Matrix {
    if (matrix) return matrix
    const loaded = createMatrix(space.recipe.dims)
    for (const { embedding, ...row } of selectSpaceVectors.iterate(space.id) as Iterable<VectorRow & { embedding: Uint8Array }>)
      loaded.add(row, vectorOf(embedding))
    return (matrix = loaded)
  }

  const storeVectors = db.transaction((rows: VectorRow[], embedded: Float32Array[]): Reused[] =>
    rows.flatMap((row, i) => {
      const vector = embedded[i]!
      return insertVector.run(row.chunkId, space.id, blobOf(vector), row.chunkId).changes ? [{ row, vector }] : []
    }),
  )

  async function embedPending(limit: number): Promise<number> {
    if (!embedderFits) return 0
    type Pending = VectorRow & { text: string }
    const pending = (selectPending.all(space.setId, space.id, limit) as Pending[]).map(({ text, ...row }) => ({ row, text }))
    if (!pending.length) return 0
    const embedded = await embedder.embed(pending.map((p) => p.text))
    if (embedded.length !== pending.length || embedded.some((v) => v.length !== space.recipe.dims))
      throw new Error(`embedder returned ${embedded.length} vectors for ${pending.length} chunks, or the wrong dimensions`)
    for (const { row, vector } of storeVectors.immediate(pending.map((p) => p.row), embedded)) matrix?.add(row, vector)
    return pending.length
  }

  async function embedQuery(query: string): Promise<Float32Array> {
    if (!embedderFits)
      throw new Error(
        `the active vector space was embedded by ${space.recipe.model}@${space.recipe.revision}, ` +
          `but this hub embeds with ${embedder.model.model}@${embedder.model.revision}; run reindex`,
      )
    const [vector] = await embedder.embed([space.recipe.queryPrefix + query])
    if (vector?.length !== space.recipe.dims) throw new Error("embedder returned no vector of the space's dimensions")
    return vector
  }

  /** The cosine branch. Every filter is applied before the candidate cut, as the lexical branch does. */
  function semantic(query: Float32Array, f: Search): Candidate[] {
    const filter = sessionFilterQuery(f)
    const allowed = filter && new Set((db.query(filter.sql).all(...filter.args) as { id: string }[]).map((r) => r.id))
    const scope = f.scope ?? "all"
    const accept = (r: VectorRow) =>
      r.scope === scope &&
      (f.sessionId === undefined || r.sessionId === f.sessionId) &&
      (f.since === undefined || r.time >= f.since) &&
      (f.until === undefined || r.time <= f.until) &&
      !(f.exclude && r.sessionId === f.exclude.sessionId && r.time >= f.exclude.before) &&
      (!allowed || allowed.has(r.sessionId))
    return vectors()
      .scan(query, accept, CANDIDATES)
      .map(({ row, score }) => ({
        branch: "semantic",
        sessionId: row.sessionId,
        messageId: row.messageId,
        time: row.time,
        score,
        chunkId: row.chunkId,
      }))
  }

  // FTS rows first: the delete re-reads each row's text through the view to find its postings.
  const unindexSession = db.prepare(
    `INSERT INTO fts (fts, rowid, text)
     SELECT 'delete', v.id, v.text FROM segment_text v
     JOIN segments seg ON seg.id = v.id JOIN parts p ON p.id = seg.part_id JOIN messages m ON m.id = p.message_id
     WHERE m.session_id = ?`,
  )
  const deleteSessionRow = db.prepare("DELETE FROM sessions WHERE id = ?")
  /** Cascades to messages, parts, and segments, so a shrunken transcript leaves nothing behind. */
  const deleteSession = (id: string) => {
    unindexSession.run(id)
    return deleteSessionRow.run(id).changes > 0
  }
  const selectHeld = db.prepare(
    `SELECT revision, last_activity AS lastActivity, extractor_version AS extractorVersion, content_hash AS contentHash
     FROM sessions WHERE id = ?`,
  )
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, source_id, slug, title, directory, parent_id, time_created, time_updated,
       revision, last_activity, extractor_version, content_hash)
     VALUES ($id, $sourceId, $slug, $title, $directory, $parentId, $timeCreated, $timeUpdated,
       $revision, $lastActivity, $extractorVersion, $contentHash)`,
  )
  const insertMessage = db.prepare(
    `INSERT INTO messages (id, session_id, ordinal, type, time_created)
     VALUES ($id, $sessionId, $ordinal, $type, $timeCreated)`,
  )
  const insertPart = db.prepare(
    `INSERT INTO parts (message_id, ordinal, kind, text, tool_name, tool_title, status, error, searchable)
     VALUES ($messageId, $ordinal, $kind, $text, $toolName, $toolTitle, $status, $error, $searchable)`,
  )
  const selectResultSession = db.prepare(
    `SELECT s.id AS sessionId, s.slug, s.title, s.directory, s.parent_id AS parentId, s.time_updated AS timeUpdated,
       coalesce(src.name, '') AS source, s.source_id IS ? AS ownSource, s.revision
     FROM sessions s LEFT JOIN sources src ON src.id = s.source_id WHERE s.id = ?`,
  )
  const selectSegmentText = db.prepare("SELECT text FROM segment_text WHERE id = ?")
  const countSessions = db.prepare("SELECT count(*) AS n FROM sessions")
  const selectTombstone = db.prepare("SELECT time_deleted AS timeDeleted FROM tombstones WHERE session_id = ?")
  const deleteTombstone = db.prepare("DELETE FROM tombstones WHERE session_id = ?")
  const upsertTombstone = db.prepare(
    `INSERT INTO tombstones (session_id, source_id, revision, time_deleted, reason)
     VALUES ($sessionId, $sourceId, $revision, $timeDeleted, 'deleted')
     ON CONFLICT (session_id) DO UPDATE SET source_id = excluded.source_id, revision = excluded.revision,
       time_deleted = excluded.time_deleted, reason = excluded.reason
     WHERE excluded.time_deleted > tombstones.time_deleted`,
  )
  const selectManifestSessions = db.prepare(
    `SELECT id AS sessionId, revision, last_activity AS lastActivity, content_hash AS contentHash,
       extractor_version AS extractorVersion
     FROM sessions ORDER BY id`,
  )
  const selectManifestTombstones = db.prepare(
    "SELECT session_id AS sessionId, time_deleted AS timeDeleted FROM tombstones ORDER BY session_id",
  )
  const upsertSource = db.prepare(
    `INSERT INTO sources (name, time_created) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`,
  )
  const insertToken = db.prepare("INSERT INTO tokens (source_id, hash, time_created) VALUES (?, ?, ?)")
  const selectTokens = db.prepare(
    `SELECT tokens.id, sources.name AS source, tokens.time_created AS timeCreated
     FROM tokens JOIN sources ON sources.id = tokens.source_id ORDER BY sources.name, tokens.id`,
  )
  const deleteToken = db.prepare("DELETE FROM tokens WHERE id = ?")
  const selectTokenHashes = db.prepare(
    "SELECT tokens.hash, sources.id, sources.name FROM tokens JOIN sources ON sources.id = tokens.source_id",
  )

  const issueToken = db.transaction((source: string) => {
    const { id } = upsertSource.get(source, Date.now()) as { id: number }
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url")
    insertToken.run(id, hashToken(token), Date.now())
    return token
  })

  function authenticate(token: string): Source | null {
    const presented = hashToken(token)
    const rows = selectTokenHashes.all() as { hash: Uint8Array; id: number; name: string }[]
    let match: Source | null = null
    // No early exit, so response time does not depend on which row matched.
    for (const row of rows) if (timingSafeEqual(row.hash, presented)) match = { id: row.id, name: row.name }
    return match
  }

  const putSnapshot = db.transaction((snapshot: Snapshot, sourceId: number): { result: PutResult; reused: Reused[] } => {
    const { session } = snapshot
    const tombstone = selectTombstone.get(session.id) as Pick<Tombstone, "timeDeleted"> | null
    // Revisions are not compared: a delete-then-reimport restarts the counter below the tombstone's.
    if (tombstone && snapshot.lastActivity <= tombstone.timeDeleted) return { result: "tombstoned", reused: [] }
    const held = selectHeld.get(session.id) as Held | null
    const result = held ? resolve(snapshot, held) : "archived"
    if (result !== "archived" && result !== "rewound") return { result, reused: [] }

    if (tombstone) deleteTombstone.run(session.id)
    // A growing session re-renders mostly the same chunks; their vectors survive the replace.
    const prior = new Map(
      (selectPriorVectors.all(space.id, session.id) as { hash: string; embedding: Uint8Array }[]).map((r) => [
        r.hash,
        r.embedding,
      ]),
    )
    deleteSession(session.id)
    insertSession.run({
      id: session.id,
      sourceId,
      slug: session.slug,
      title: session.title,
      directory: session.directory,
      parentId: session.parentId,
      timeCreated: session.timeCreated,
      timeUpdated: session.timeUpdated,
      revision: snapshot.revision,
      lastActivity: snapshot.lastActivity,
      extractorVersion: snapshot.extractorVersion,
      contentHash: snapshot.contentHash,
    })
    session.messages.forEach((message, ordinal) => {
      insertMessage.run({
        id: message.id,
        sessionId: session.id,
        ordinal,
        type: message.type,
        timeCreated: message.timeCreated,
      })
      message.parts.forEach((part, partOrdinal) => {
        const tool = part.kind === "tool" ? part : undefined
        const searchable = tool?.searchable ?? true
        const { lastInsertRowid } = insertPart.run({
          messageId: message.id,
          ordinal: partOrdinal,
          kind: part.kind,
          text: part.text,
          toolName: tool?.tool ?? null,
          toolTitle: tool?.title ?? null,
          status: tool?.status ?? null,
          error: tool?.error ?? null,
          searchable,
        })
        if (searchable) segment(Number(lastInsertRowid), part.text)
      })
    })
    return { result, reused: writeChunks(space, session.id, session, prior) }
  })

  const putTombstone = db.transaction((tombstone: Tombstone, sourceId: number) => {
    // A copy active after the deletion already superseded it, as it would have cleared the tombstone.
    const held = selectHeld.get(tombstone.sessionId) as Held | null
    if (held && held.lastActivity > tombstone.timeDeleted) return { removed: false }
    upsertTombstone.run({ ...tombstone, sourceId })
    return { removed: deleteSession(tombstone.sessionId) }
  })

  const lexical = (match: string, f: Search): Candidate[] => {
    const { sql, args } = lexicalQuery(match, f)
    // `query` caches the compiled statement per distinct filter combination.
    return db.query(sql).all(...args) as Candidate[]
  }

  /** Both branches and the fusion, over one consistent read. `query` is absent when semantic is not run. */
  const rank = db.transaction((f: Search, lexicalToo: boolean, query: Float32Array | undefined, callerSourceId: number) => {
    const tokens = queryTokens(f.query)
    let lex: Candidate[] = []
    if (lexicalToo && tokens.length) {
      lex = lexical(ftsQuery(f.query, "AND")!, f)
      if (!lex.length && tokens.length > 1) lex = lexical(ftsQuery(f.query, "OR")!, f)
    }
    const sem = query ? semantic(query, f) : []

    const groups = fuse(
      [
        { hits: lex, which: "lex" },
        { hits: sem, which: "sem" },
      ],
      (h) => h.sessionId,
      { rrfK: RRF_K, perBranchCap: 3, hitsPerKey: 2 },
    )
    const snippet = (text: string) => makeSnippet(text, tokens)
    const hit = (c: Candidate): SearchHit => {
      if (c.branch === "lexical") {
        const { sessionId: _, segmentId, ...rest } = c
        return { ...rest, snippet: snippet((selectSegmentText.get(segmentId) as { text: string }).text) }
      }
      const { sessionId: _, chunkId, ...rest } = c
      return { ...rest, snippet: snippet((selectChunkText.get(chunkId) as { text: string }).text) }
    }
    return groups.slice(0, f.limit).map((g): SearchResult => {
      type Row = Omit<SearchResult, "lexicalMatches" | "semanticMatches" | "hits" | "ownSource"> & { ownSource: number }
      const row = selectResultSession.get(callerSourceId, g.key) as Row
      return { ...row, ownSource: row.ownSource === 1, lexicalMatches: g.nLex, semanticMatches: g.nSem, hits: g.hits.map(hit) }
    })
  })

  async function search(f: Search, callerSourceId: number): Promise<Responses["search"]> {
    if (!f.query.trim()) return { sessions: [] }
    const mode = f.mode ?? "hybrid"
    let query: Float32Array | undefined
    let semanticUnavailable: string | undefined
    if (mode !== "lexical")
      try {
        query = await embedQuery(f.query)
      } catch (e) {
        semanticUnavailable = e instanceof Error ? e.message : String(e)
      }
    const sessions = rank(f, mode !== "semantic", query, callerSourceId)
    return semanticUnavailable === undefined ? { sessions } : { sessions, semanticUnavailable }
  }

  return {
    migration,
    // Immediate: the read-then-write must not race a `token` subcommand writing the same file.
    putSnapshot: (snapshot, sourceId) => {
      const { result, reused } = putSnapshot.immediate(snapshot, sourceId)
      if (matrix && (result === "archived" || result === "rewound")) {
        matrix.removeSession(snapshot.session.id)
        for (const { row, vector } of reused) matrix.add(row, vector)
      }
      return result
    },
    putTombstone: (tombstone, sourceId) => {
      const result = putTombstone.immediate(tombstone, sourceId)
      if (result.removed) matrix?.removeSession(tombstone.sessionId)
      return result
    },
    manifest: db.transaction(() => ({
      sessions: selectManifestSessions.all() as Manifest["sessions"],
      tombstones: selectManifestTombstones.all() as Manifest["tombstones"],
    })),
    search,
    embedPending,
    issueToken: (source) => issueToken(source),
    listTokens: () => selectTokens.all() as TokenInfo[],
    revokeToken: (id) => deleteToken.run(id).changes > 0,
    authenticate,
    status: db.transaction(() => ({
      sessions: (countSessions.get() as { n: number }).n,
      chunks: (countChunks.get(space.setId) as { n: number }).n,
      embeddedChunks: (countVectors.get(space.id) as { n: number }).n,
      activeSpace: { recipe: space.recipe, matchesConfigured },
    })),
    close: () => db.close(),
  }
}

type Held = Pick<Snapshot, "revision" | "lastActivity" | "extractorVersion" | "contentHash">

/**
 * The §5 acceptance rules. Last activity leads the comparison so that a rewound copy, once
 * accepted, is never displaced by a stale copy still holding the pre-rewind revision.
 */
function resolve(incoming: Snapshot, held: Held): PutResult {
  if (incoming.contentHash === held.contentHash) return "unchanged"
  const order = Math.sign(incoming.lastActivity - held.lastActivity) || Math.sign(incoming.revision - held.revision)
  if (order > 0) return incoming.revision > held.revision ? "archived" : "rewound"
  if (order < 0) return "stale_revision"
  // Equal position, different content: only a newer extractor may re-extract unchanged history.
  return incoming.extractorVersion > held.extractorVersion ? "archived" : "hash_divergence"
}

const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest()
