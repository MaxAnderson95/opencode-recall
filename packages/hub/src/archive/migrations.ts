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
]
