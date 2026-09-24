/**
 * Forward-only schema migrations. Entry `i` takes the database from
 * `user_version` i to i + 1. Never edit or reorder an entry once released;
 * append a new one instead.
 */
export const migrations: readonly string[] = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    directory TEXT NOT NULL,
    parent_id TEXT,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    type TEXT NOT NULL,
    time_created INTEGER NOT NULL
  );
  CREATE INDEX messages_session_idx ON messages(session_id, ordinal);
  CREATE TABLE parts (
    id INTEGER PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX parts_message_idx ON parts(message_id, ordinal);
  `,
  `
  CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    time_created INTEGER NOT NULL
  );
  CREATE TABLE tokens (
    -- AUTOINCREMENT: ids are revocation handles, so a revoked id must never name a newer token.
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    hash BLOB NOT NULL UNIQUE,
    time_created INTEGER NOT NULL
  );
  ALTER TABLE sessions ADD COLUMN source_id INTEGER REFERENCES sources(id);
  `,
  // The zero defaults place rows archived before positions existed behind any real snapshot.
  `
  ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN last_activity INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN extractor_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
  `,
  `
  CREATE TABLE tombstones (
    session_id TEXT PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    revision INTEGER NOT NULL,
    time_deleted INTEGER NOT NULL,
    reason TEXT NOT NULL
  );
  `,
  // Every part archived before this is a text part, which is always searchable.
  `
  ALTER TABLE parts ADD COLUMN tool_name TEXT;
  ALTER TABLE parts ADD COLUMN tool_title TEXT;
  ALTER TABLE parts ADD COLUMN status TEXT;
  ALTER TABLE parts ADD COLUMN error TEXT;
  ALTER TABLE parts ADD COLUMN searchable INTEGER NOT NULL DEFAULT 1;
  `,
  // Offsets are zero-based UTF-8 byte positions in the part text, not UTF-16 units, sliced from the
  // text cast to a BLOB: SQLite's text `substr` stops at an embedded NUL, and tool output can hold one.
  // The FTS index keeps no text: its content is the view, so FTS rows must be deleted while their
  // segments and parts still exist, or the delete cannot find the postings to remove.
  `
  CREATE TABLE segments (
    id INTEGER PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    start INTEGER NOT NULL,
    length INTEGER NOT NULL
  );
  CREATE INDEX segments_part_idx ON segments(part_id);
  CREATE VIEW segment_text AS
    SELECT segments.id AS id, CAST(substr(CAST(parts.text AS BLOB), segments.start + 1, segments.length) AS TEXT) AS text
    FROM segments JOIN parts ON parts.id = segments.part_id;
  CREATE VIRTUAL TABLE fts USING fts5(text, content='segment_text', content_rowid='id');
  `,
  // A space's identity is its whole recipe, stored as JSON. A chunk with no vector in its space is
  // waiting to be embedded; that absence is the retry queue, so it survives a restart.
  `
  CREATE TABLE vector_spaces (
    id INTEGER PRIMARY KEY,
    recipe TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 0,
    time_created INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX vector_spaces_one_active ON vector_spaces(active) WHERE active = 1;
  CREATE TABLE chunk_sets (
    id INTEGER PRIMARY KEY,
    space_id INTEGER NOT NULL REFERENCES vector_spaces(id) ON DELETE CASCADE,
    time_created INTEGER NOT NULL
  );
  CREATE TABLE chunks (
    -- AUTOINCREMENT: an embedding batch in flight names its chunks by id, and a chunk replaced
    -- meanwhile must not pass its id to different text.
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_set_id INTEGER NOT NULL REFERENCES chunk_sets(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    window_index INTEGER NOT NULL,
    scope TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    hash TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX chunks_set_idx ON chunks(chunk_set_id, id);
  CREATE INDEX chunks_session_idx ON chunks(session_id);
  CREATE INDEX chunks_message_idx ON chunks(message_id);
  CREATE TABLE vectors (
    chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    space_id INTEGER NOT NULL REFERENCES vector_spaces(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,
    PRIMARY KEY (chunk_id, space_id)
  ) WITHOUT ROWID;
  `,
  // Every accepted snapshot replaces the session row, so the cascade drops summaries of content the
  // archive no longer holds, and a tombstone drops them with the transcript. `variant` is '' for
  // the provider's default.
  `
  CREATE TABLE summaries (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    variant TEXT NOT NULL,
    focus TEXT NOT NULL,
    recipe INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    summary TEXT NOT NULL,
    omitted INTEGER NOT NULL,
    clipped INTEGER NOT NULL,
    time_created INTEGER NOT NULL,
    PRIMARY KEY (session_id, content_hash, provider, model, variant, focus, recipe)
  ) WITHOUT ROWID;
  `,
  // A divergence is one source's copy refused at the held copy's position with other content. The
  // cascade clears it once any copy is accepted or the session is deleted, since either replaces
  // the copy it diverged from. Rewinds are a history of acceptances, so they outlive the row.
  `
  CREATE TABLE divergences (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    content_hash TEXT NOT NULL,
    time_first INTEGER NOT NULL,
    time_last INTEGER NOT NULL,
    PRIMARY KEY (session_id, source_id)
  ) WITHOUT ROWID;
  CREATE TABLE rewinds (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    from_revision INTEGER NOT NULL,
    to_revision INTEGER NOT NULL,
    time INTEGER NOT NULL
  );
  `,
  // Without statistics SQLite answered "this session's chunks in this set" from chunks_set_idx,
  // scanning every chunk of the set once per session: two minutes of status at 75,000 chunks.
  // An index on both columns wins that choice and serves session-only lookups as its prefix.
  `
  CREATE INDEX chunks_session_set_idx ON chunks(session_id, chunk_set_id);
  DROP INDEX chunks_session_idx;
  `,
  // Each vector row holds its embedding inline, so probing the primary key for "has this chunk a
  // vector" reads a page per chunk: 1.8 s for 77,000 chunks on the Linux host. This index holds
  // the key alone. SQLite still prefers the primary key, so the probes name it with INDEXED BY.
  `
  CREATE INDEX vectors_chunk_space_idx ON vectors(chunk_id, space_id);
  `,
]

/** The first schema version with segments; parts archived before it are segmented on migration. */
export const SEGMENTED = 6
