# opencode-recall 1.0

Shared conversation memory for OpenCode across machines. A **hub** holds one archive of every session from every host. A thin **plugin** on each host uploads sessions and serves the `recall_*` tools against the hub.

This replaces the single-machine recall plugin in `my-opencode-setup/plugins/recall`. The decisions behind it are recorded in issues #6 through #13; this document describes the system, not the argument. It has been revised once after independent review; the findings are in the comments on #8 and #11.

## 1. Scope

1.0 is parity with today's plugin, backed by a shared hub.

In scope: the five `recall_*` tools with today's ladder semantics, instruction injection, upload of every session from every host, an archive any host can search while the originating host is offline, and a backfill of the existing ~4,470 Mac sessions.

Out of scope: resuming a conversation started on another host, porting OpenCode's own database anywhere, a separate human CLI, and hub-side LLM credentials.

Accepted regressions, both deliberate:

- A host loses recall entirely when the hub is unreachable. Today's plugin works offline. There is no local fast path.
- A session's newest turn may not be in the archive yet, because uploads happen on turn completion. A long-running turn that compacts and then searches for its own earlier context may not find it. Results and `recall_status` report the hub's archived revision per session so a caller can distinguish an incomplete archive from genuinely absent history.

## 2. Shape

```
host                                  hub (Linux container)
┌──────────────────────────┐          ┌────────────────────────────┐
│ OpenCode + plugin        │          │ HTTP API  /v1/<verb>       │
│  reads opencode.db       │  HTTPS   │ Archive module             │
│  extracts part text      ├─────────►│  SQLite: archive, FTS5,    │
│  excludes directories    │  token   │  vectors, summaries        │
│  work list in ctx.storage│          │ ONNX embedder (in-process) │
│  five recall_* tools     │◄─────────┤                            │
└──────────────────────────┘          └────────────────────────────┘
```

The plugin never indexes, ranks, embeds, or chunks. The hub never reads a host's `opencode.db`.

### Sizing, measured

| quantity | value |
| --- | --- |
| sessions | 4,471 |
| embedded chunks | 75,110 |
| searchable segments | 423,743 |
| extracted text | 597 MB (tool output 505, text 48, reasoning 44) |
| source database | 8.1 GB (bulk is base64 attachments, dropped) |
| projected archive | 1.2 to 1.5 GB |
| growth | ~12,000 chunks/month, so 300,000 chunks is about 19 months away |
| searches | ~300/month |
| vector matrix | 115 MB at 384 dims; 16.5 ms per scan |

Every timing in this document was measured on an M5 Pro. None has been measured on the Linux host that will run the hub. Re-measure before treating any of them as a capacity budget.

## 3. Hub

TypeScript on Bun, compiled with `bun build --compile`. Shipped primarily as a **Linux container image**, with the binary as a secondary release artifact. Linux is the only production target; macOS runs from source for development and no darwin binary is published.

One SQLite database plus WAL in one configurable data directory holds the archive, FTS index, vectors, summaries, and tokens. That directory is the container's only volume and a backup is one `sqlite3 .backup`.

Configuration is environment-first (`OPENCODE_RECALL_*`) with an optional JSON file; environment wins. Covered: data directory, listen address, embedding model and dimensions, chunking parameters, log level.

Observability is structured JSON logs to stdout: ingest outcomes, embedding failures, reindex progress, auth rejections, migration results. No OpenTelemetry in 1.0.

### 3.1 Archive module

All SQL lives in one deep module that owns **storage and retrieval together**: every statement, the FTS5 MATCH construction, the in-memory vector matrix, the cosine scan, and RRF fusion. There is no ORM and no repository interface.

Interface, roughly: put a session snapshot, delete a session, search the corpus, search within a session, fetch a transcript window, fetch a budgeted transcript, read a cached summary, write a cached summary, swap the active vector space, report status.

Internal seams are expected inside the implementation and may be used by its own tests. They are not part of the interface.

Tests run through the interface. `:memory:` covers logic; a temporary file-backed database is also required, because WAL behaviour, restart recovery, migration, and interrupted reindex cannot be exercised in memory.

Schema evolves by numbered forward-only migrations applied on startup inside a transaction, refusing to start against a database newer than the binary. Derived data the hub can regenerate from its own tables (FTS rows, chunks, vectors) may be dropped and recomputed instead of migrated.

### 3.2 Archive schema

Shape, not literal DDL.

**`sources`**: one per host. Identity, display label, created time. A source is a stable identity that outlives any individual token, so rotation does not create a new source.

**`sessions`**: keyed by OpenCode session id alone, with `source_id` as an attribute. Holds slug, title, directory (raw, unnormalized), `parent_id`, `time_created`, `time_updated` (display only, not a revision), `revision`, `last_activity`, `compaction_boundary`, `extractor_version`, and the session content hash.

Keying on the id alone means a database copied between machines, or a rebuilt host, updates one row rather than producing a duplicate conversation in results.

**`messages`**: id, session, role, type, time, ordering.

**`parts`**: one row per display-relevant part: message, kind (`text` | `reasoning` | `tool`), `tool_name`, `tool_title`, `status`, error text where a tool failed, and the canonical extracted text.

Searchability is a property, not a condition on existence. Parts excluded from search are stored and render in transcripts but produce no segments and no chunks. Without this, failed and in-flight tool calls vanish from transcripts, and those are frequently why someone is searching. A failed tool's error text **is** indexed, since the argument for storing failures applies equally to finding them.

**`segments`**: `(part_id, start, length)`, one per FTS row, at most 8,000 characters each. Long parts are split rather than truncated so nothing becomes unsearchable and BM25 length normalization stays meaningful.

**`fts`**: FTS5 external-content index whose content object is a **view** doing `CAST(substr(CAST(parts.text AS BLOB), start + 1, length) AS TEXT)` over `segments` joined to `parts`. External content over offsets requires a view; naming a table here would be read as "store the segment text", which defeats the purpose.

Two consequences an implementer must honour. Offsets are **zero-based UTF-8 byte positions** in the part text, which are not JavaScript UTF-16 code-unit offsets; the segmenter must emit one convention and the schema must state which. The view slices the text as a BLOB because SQLite's text `substr` stops at an embedded NUL, which tool output such as `find -print0` contains, and SQLite has no NUL-safe character slice; everything after the NUL would otherwise go unindexed. And FTS5 deletes re-tokenize current content to locate postings, so **FTS rows must be deleted before their `parts` and `segments` rows** inside the per-session replace transaction, or the index silently rots.

**`chunks`**: the **exact embedding-input text**, stored, plus provenance (session, anchor message, window index, scope), time, and the chunk content hash. Chunks belong to a chunk set, which belongs to a vector space.

Chunks are not offsets into parts, and cannot be. The embedded unit is a **turn pair**: a user message joined with every assistant message that follows it, rendered `USER: …\nASSISTANT: …`, windowed at 1,200/200, with every window past the first prefixed `(re: <first 160 chars of the user text>)`. Non-assistant roles are rendered `[role] …`. That text spans several messages and contains literals present in no part. A second pass emits `user-messages`-scope chunks from top-level user text alone, so that text is embedded twice under two scopes.

Storing the text costs about 72 MB, roughly 5% of the archive, and makes semantic-hit snippets trivial, which is how the current plugin already works.

**`vector_spaces`**: one row per space, holding the full embedding recipe and whether it is active. **`chunk_sets`**: chunks belong to a set and a set to a space, so a re-chunk builds new chunks alongside the old rather than rewriting them. **`vectors`**: `(chunk_id, space_id, embedding)`.

Space identity is the whole recipe, not five parameters: model artifact revision, dimensions, tokenizer and preprocessing, pooling, normalization, query prefix, chunk size, overlap, per-turn cap, and the chunk-rendering version. Anything that changes the bytes fed to the model changes what a vector means. Vector reuse across a change requires identical input text **and** identical recipe.

**`summaries`**: keyed by session content identity, provider, model, variant, focus, and summary-recipe version. Holds the summary, the archived revision it was computed from, and how many messages its transcript omitted or clipped. Survives an index rebuild.

**`tombstones`**: session id, recording `source_id`, deletion revision, deletion time, and reason (deleted upstream, or excluded by configuration).

### 3.3 Normalization

The plugin extracts; the hub stores what arrives and derives the rest. Extraction rules are versioned as `extractor_version`, because changing them changes content hashes for sessions that never changed.

**v2 only.** `session_v2` and `session_message`. The v1 `session`/`message`/`part` path in today's plugin is dropped.

Message type mapping: `user` and `synthetic` become text; `assistant` content yields text, reasoning, and tool items; a `compaction` summary is stored as text; `shell` and `skill` become tool parts; `system`, `idle`, and `*-switched` are dropped.

Part types: `text` and `reasoning` pass through. A `tool` part contributes searchable text when completed with non-empty output, rendered `<tool> <title>\n<output>` and capped at 16,000 characters, or its error text when it failed. File attachments are dropped entirely.

**Excluded from indexing at extraction time:** the five `recall_*` tools' own outputs, and sessions titled with the `recall-summarizer worker: ` prefix. Without the first, every search result is indexed and later searches match earlier search output. Without the second, the existing worker sessions backfill as noise.

**Searchable and embedded are different sets.** All kinds are segmented into FTS rows. Only `text` parts are embedded: tool output and reasoning are findable by BM25 but never enter a chunk. This is today's behaviour and it is deliberate, since tool output is 85% of the archive's text.

Chunking is hub-side, 1,200 characters with 200 overlap and a 60,000-character per-turn cap, over the turn-pair rendering in §3.2.

### 3.4 Retrieval

Unchanged from today, because it was measured and is good. "Unchanged" includes the embedded unit and the query construction, not just the fusion.

BM25 over FTS5 with every filter pushed into the SQL, never applied after a fixed top-N cut. Query construction quotes every token as a phrase and joins with `AND`, falling back to `OR` when the `AND` form returns nothing and the query has more than one token.

Cosine over an in-memory `Float32Array` of the active space. Both branches capped at 60 candidates, fused with RRF at `k=60`.

`recall_search` fuses by **session**, with `perBranchCap: 3` and `hitsPerKey: 2`. `recall_inspect` fuses by **message** and, in hybrid mode, drops semantic hits below 0.55 cosine.

Filters: scope, since, until, directory (substring), source, session, `include_tools`, and the calling-session exclusion.

**The calling-session exclusion is computed host-side.** The hub's `compaction_boundary` for the calling session is at least one turn stale, because the snapshot uploads after the turn ends, and may be absent entirely. The plugin sends `exclude: { sessionId, before }` from its local database. The hub's stored boundary is only used for the display label that marks a hit as predating the session's last compaction.

Embedding is `bge-small-en-v1.5` at 384 dimensions, q8 ONNX, mean-pooled and normalized, with the query prefix `"Represent this sentence for searching relevant passages: "`. The prefix is load-bearing: omitting it costs measurable recall.

Query embedding is synchronous in the request, no cache. It measures 4.4 ms.

A synchronous scan occupies Bun's main thread, so concurrent searches during ingest serialise. The interface leaves room to move the scan to a worker; do not build that until it is observed to matter.

### 3.5 Failure independence

Ingest, lexical search, and embedding fail independently.

A snapshot is accepted and becomes BM25-searchable whether or not its chunks are embedded. Unembedded chunks sit in a durable retry queue. A search whose query embedding fails returns lexical results and says the semantic branch was unavailable. Status distinguishes **archived**, **lexically searchable**, and **embedded**.

Blocking ingest on embedding was considered. It does not simplify anything, because backfill and reindex both force a pending state to exist regardless; it only adds a second path doing the same job.

### 3.6 Reindex

**Reindex is an offline operation.** Stop `serve`, run `reindex`, start `serve`.

This is the decision that keeps it correct. A separate process cannot swap a running server's state: `serve` holds the vector matrix and the ONNX model in memory and would never observe another process flipping the active space. Taking the archive down for the duration is acceptable for a personal service, and it removes the write barrier, the mutation watermark, the result fencing, and the concurrent-ingest catch-up that an online rebuild would otherwise need.

On boot, if the configured space identity does not match the active one, the hub logs loudly, keeps serving on the existing vectors, and does not re-embed on its own.

`reindex` refuses to run while a server holds the database. It reports chunk count and estimated duration, builds a new chunk set and a new space, and activates it in one transaction. Nothing else writes meanwhile, so the new space is complete by construction. An interrupted run leaves the active space untouched and its partial chunk set and vectors are reclaimed on the next start. The superseded space's vectors are dropped once the new space is active and the run has completed.

A full pass is roughly 75,000 chunks, about half an hour at the 45 chunks/s measured on an M5 Pro, unmeasured on the Linux host.

## 4. API

`POST /v1/<verb>`: `snapshot`, `tombstone`, `manifest`, `search`, `inspect`, `expand`, `transcript`, `summary.get`, `summary.put`, `status`.

Plain HTTP/JSON with a hand-written typed client in the shared package. Every request is validated at the boundary against a schema, with the TypeScript types inferred from it, because plugin and hub deploy independently and shared types check nothing at runtime.

Every request carries an integer protocol version. The hub rejects versions it does not serve, naming both.

`expand` returns a window around a message. `transcript` returns a whole session rendered to a character budget, middle-out truncated, defaulting to today's 300,000-character budget at 2,000 characters per message, and reports what it truncated. `recall_summarize` needs the second and cannot be served by the first. The plugin fetches transcripts from the hub even for local sessions, so the summary cache key describes the content the hub holds.

**Errors.** Classification is by stable code, with HTTP status as a fallback, not by status class alone. `stale_revision`, `tombstoned`, `hash_divergence`, `invalid_token`, `protocol_version`, and `payload_too_large` are terminal. `rate_limited` (429) and `request_timeout` (408) are retryable despite being 4xx. `invalid_token` and `protocol_version` pause the queue rather than discarding work, since both are fixed by configuration and the work is still valid.

**Limits.** One request per session snapshot, gzip-encoded by the plugin with `Content-Encoding: gzip` set explicitly, since Bun's `fetch` does not compress request bodies automatically. The cap is 64 MB **decompressed**, with a compressed cap and a bound on concurrent ingestion as well, so a compressed payload cannot expand without limit. Measured worst case is in the low tens of megabytes before compression. Exceeding a cap is a terminal rejection; truncating to fit is never acceptable for an archive whose purpose is remembering.

**Transport.** The hub speaks plain HTTP and assumes something else provides confidentiality: a Tailscale tailnet or a reverse proxy terminating TLS. Bearer tokens over unprotected HTTP are not acceptable, and the hub does not terminate TLS itself.

**Tokens.** 32 bytes of CSPRNG output rendered with an `opencode-recall_` prefix, which makes the token recognizable to secret scanners if it lands in a committed config. The hub stores a SHA-256 hash and compares in constant time. Auth-rejection logs never include the presented token, not even a prefix. Revocation deletes a row and takes effect immediately; rotation is issue, update the host, revoke, which needs no downtime. Multiple live tokens may map to one source, so rotation never changes source identity or result attribution.

Search results carry the source host name, a boolean for whether that source is the caller's own, and the archived revision of the session. Origin never affects ranking.

## 5. Sync

**Revision** is `event_sequence.seq`, OpenCode's per-session event counter. One row exists per session, keyed by session id. Every durable session event, including every message insert and update, takes the next value in the same transaction, so within one database it only moves forward: through ordinary turns, compaction, and revert.

`session_v2.time_updated` is **not** usable as a revision. Message content is written without bumping it, and turn completion explicitly preserves it, so two different transcripts can carry the same value. Measured against the live database: **865 of 4,461 sessions (19.4%) hold messages newer than their own `time_updated`, by up to 16 hours.** `session_v2.version` is not a counter either; it holds the OpenCode version string that created the session.

**The revision rewinds.** Verified in #15 against OpenCode 2.0.14: the counter is monotonic only within one database lineage. Deleting a session removes its row, and re-importing the export restarts it at the message count (9 became 3). Restoring an older copy restores the older counter, and new activity then reuses revisions the hub already holds for a different transcript (9, rewound to 3, reached 9 again with different messages). OpenCode's own migrations have deleted every row and re-derived them lower. A copied database, or an import on another host, gives two hosts the same counter values for different transcripts. Forks are unaffected: they get a new session id.

**Last activity** is therefore carried alongside the revision: the later of the newest `session_message.time_created` and `session_v2.time_updated`. Messages alone are not enough, because a committed revert deletes the newest messages and moves their maximum backwards; it sets `time_updated` to the revert time instead, as do renames and the other metadata events. A stale snapshot from a racing uploader is an older read of the same database, so its last activity is never newer than what the hub holds. A snapshot after a rewind with new messages or a rename always has a newer one.

The snapshot carries the revision, the last activity, the content hash, and the `extractor_version`, all read in one consistent database transaction so the revision cannot describe a different transcript than the one sent.

**Acceptance** orders snapshots by the **position** `(last activity, revision)`, compared in that order. A snapshot whose hash matches what the hub holds is a no-op at any position, which absorbs a rewind that did not change content. A later position is accepted; when its revision is not higher than the held one, the acceptance is a **rewind** and is recorded for `recall_status`. An equal position with a differing hash is accepted **if** the `extractor_version` is higher and rejected as `hash_divergence` if not. An earlier position is rejected as `stale_revision`.

Last activity leads the comparison so acceptance is a single total order with no cycle. If a higher revision always won, a copy still holding the pre-rewind transcript at revision 9 would overwrite an accepted rewind at revision 3 on its next reconciliation, and the rewound copy would win it back on the one after. Revision breaks ties, which covers turn completion and other message updates that change content without creating a message or bumping `time_updated`.

That exception is not a detail. Extraction rules will change (a tool cap, the skip list, a bug fix), which changes content hashes for sessions that never changed. Without it there is no path to re-extract history, because reconciliation only enqueues newer revisions, and every affected session would be permanently stuck.

A persistent `hash_divergence` means two hosts hold genuinely different copies of one session. Last accepted wins, and `source_id` moves to whichever source last had a snapshot accepted; a no-op does not move it. This can discard one copy's changes, so it is reported in `recall_status` as a named condition with a documented operator remedy rather than being swallowed. The remedy is to rename the session on the host whose copy should be kept: the rename moves that host's last activity past the held position, so its next upload is accepted. The condition clears when any copy of the session is accepted, when the session is deleted, or when the refused source uploads the held content.

**Triggers.** `session.execution.succeeded`, `session.execution.failed`, and `session.execution.interrupted`, excluding `reason: "shutdown"`, plus `session.deleted`, `session.renamed`, and `session.moved`. `session.idle` is dead on v2 and is not used. A short quiet period precedes snapshot building: a subagent-heavy session fires an execution event per child turn, and each would otherwise trigger a full re-extract and re-upload of the parent.

**Queue.** A work list of dirty session ids and observed positions in `ctx.storage`. Snapshots are built at send time, so many changes to one session collapse into a single upload of current state, the queue stays small enough for a key-value store, and a session deleted before its upload sends a tombstone instead.

**No lease.** `ctx.storage` offers only `get`, `set`, `remove`, and `scan`, with no compare-and-set, so a lease cannot be made race-free there. Duplicate uploaders are tolerated instead: the content hash turns a duplicate into a no-op, so a race costs bytes, not correctness. One rule makes this safe and is mandatory: **an acknowledgement clears only the exact work it acknowledges**, comparing the position it uploaded against the marker, or it will erase a dirty marker created while its upload was in flight.

**Reconciliation.** At startup, after any event-stream reconnection, and on a periodic sweep. Startup-only is insufficient: servers run for days, the event stream is documented as lossy under slow-consumer overflow, and multiple `opencode serve` processes exist on one machine. The periodic sweep needs no network: keep the acked position per session in `ctx.storage` and scan for any session whose local position is later. Revision alone would miss a rewind: after revision 9 is acked, a restore to 3 followed by new messages at 6 stays below the checkpoint if its execution event was lost. `ctx.storage` lives in `opencode.db`, so a restore rolls the checkpoint back with the transcript, and the new activity is still later than the restored checkpoint.

The hub returns a manifest of session id to `(revision, last activity, content hash, extractor_version, tombstone marker)`, **across all sources, not just the caller's**. The host diffs and enqueues what is missing, at a later local position, or extracted by an older extractor.

Three details, each fixing a failure the obvious version has. The manifest spans sources, or a rebuilt host under a new token sees all 4,500 sessions as missing and uploads every one to receive equal-hash no-ops. It carries the content hash, so a host can skip a matching session without building a payload. It includes tombstones, or a session deleted on the hub but still present locally is "missing" on every sweep, is uploaded, is rejected, and repeats forever.

**Tombstones** block resurrection: a snapshot whose last activity is not after the deletion time is rejected as `tombstoned`. A snapshot with activity after the deletion clears it, which is the only way a deleted session legitimately returns. Revisions are not compared here, because delete-then-reimport restarts the counter below the tombstone's revision. Re-importing sets `time_updated` to the import time, so an explicit re-import after the deletion does return the session.

The deletion time depends on the reason. For an upstream deletion it is the `session.deleted` event's creation time. For an exclusion (§6) no OpenCode event exists, so it is the host's clock when the plugin applied the changed `excludeDirectories` or observed the `session.moved` into an excluded directory. Either way the plugin records the time in the queued tombstone when it is created, so every retry sends the same value. An exclusion tombstone is also cleared by any snapshot from the source that recorded it, because that host uploading the session means its exclusion was lifted; a later-activity snapshot from another source clears it as it would a deletion.

**Hub-has-but-host-lacks.** Absence is never deletion. OpenCode may have removed a session while the plugin was down, the host may be new, or a restored database may be older. The host never infers a deletion from absence; only an observed `session.deleted` produces a tombstone. Sessions the hub holds from a host that no longer reports them stay in the archive.

**Backfill** is ordinary reconciliation against a hub that lacks the host's history, so it needs no mode of its own. It runs newest first: the uploader sends whichever due session has the latest recorded activity, so recent history is searchable first and a live turn is never queued behind old sessions. Tombstones take their deletion time as their activity, which puts purges ahead of old history. It is throttled: each plugin instance has one request in flight and waits 500 ms after each snapshot or tombstone request before sending the next, so one instance sends at most two a second. That is about the rate the hub embeds at (45 chunks/s over roughly 17 chunks per session) and keeps snapshot building from monopolising OpenCode's event loop. Every `opencode serve` process on a host drains the same work list, so the bound is per process, and duplicates cost no-ops. It resumes from the manifest diff: an interrupted run leaves every unacknowledged session in the work list and every acknowledged one checkpointed, so a restart sends only what is left. `recall_status` reports progress as how many local sessions outside excluded directories the hub has answered at their current position.

Backfill does not yield to interactive searches. A search can come from any OpenCode process on any host while every process on every host may be uploading, so no one process can make room for it, and pausing the uploads of the process that searched would leave the others running. The throttle bounds ingest load on the hub for every caller instead.

## 6. Plugin

A rewrite in structure, not a line-by-line port. Architecture, storage, and responsibilities change completely.

Pure functions that encode measured behaviour are carried over deliberately rather than reimplemented, because rewriting them is pure parity risk with no upside: part extraction, turn-pair and chunk rendering, FTS query construction, segmentation, and the RRF fusion. Reimplementing any of those from the prose in this document would change results.

The plugin keeps only what requires being on the host: reading `opencode.db`, extracting part text, enforcing `excludeDirectories`, the upload work list, and the five tools. It has no index of its own.

Extraction stays host-side deliberately. Uploading raw v2 messages would ship base64 attachments, an order of magnitude more bytes for content the archive discards.

**Exclusions purge, they are not merely prospective.** Adding a path to `excludeDirectories`, or a session moving into an excluded directory, tombstones the affected sessions in the hub, and `tombstone` deletes their cached summaries. A summary of an excluded transcript is itself a leak. This requires the plugin to keep watching its config file, which the research says is the only hot-reload path for out-of-band settings. Queued uploads for newly excluded sessions are dropped rather than sent.

Because instances load per location and any of them may be the uploader, the exclusion list must come from one host-wide configuration source. Privacy behaviour must not depend on which instance happens to upload. `index.excludeDirectories` is therefore read from the config file only, never from the environment, which is per process. Entries are absolute or `~/` paths; an entry that is neither, or a list that cannot be read, holds every upload until it is fixed rather than being skipped.

`recall_summarize` calls `ctx.generate.text`, replacing the hidden worker session, keeping the LLM call plugin-side so the hub holds no credentials. It fetches a budgeted transcript from the hub (§4) rather than reading locally. Batch shape is preserved: up to 24 session ids per call at concurrency 4. `ctx.generate.text` takes only a prompt and a model reference; verified in #25 against OpenCode 2.0.14, it sends the prompt as a single user message with no system prompt, agent, or tools, so `WORKER_SYSTEM` leads the prompt text. `summary.put` carries the content hash the transcript was read at and is rejected as `stale_revision` unless the archive still holds that content, so a slow summarizer cannot cache a stale result as current; the caller still gets its summary, uncached. Accepting a snapshot or a tombstone drops the session's cached summaries.

`recall_status` reports both sides separately. Host: hub reachability, queue depth, backfill progress, last error, excluded directories, config source. Hub: total sessions and chunks, per-source counts, active space identity, pending embedding backlog, cached summaries, and any session in persistent `hash_divergence`.

Instruction injection keeps today's ladder text, adding that results name their origin machine and archived revision, that `source` is a filter, and that an unreachable hub means "could not look" rather than "nothing found".

Configuration is `OPENCODE_RECALL_*` first, then the config file. The file keeps today's name and location. `ctx.options` from `opencode.jsonc` is not a configuration source, because settings there cannot be hot-reloaded out of band. The plugin must be installed in the global OpenCode config so every `opencode serve` process loads it.

Gone from today's plugin: the local SQLite index, chunking, embedding, ranking, backfill state, and the Hark notifications in `notify.ts`.

## 7. Operations

Four subcommands. `serve` runs the service and applies migrations. `token` issues, lists, and revokes. `status` reports the archive. `reindex` rebuilds the vector space offline and refuses to run while `serve` holds the database.

No `migrate` subcommand: the hub is single-node and single-writer, so `serve` applying them is safe. No `backfill` subcommand: the initial load arrives through ordinary host reconciliation.

Container specifics: `onnxruntime-node` requires glibc, so a debian-slim base rather than alpine, with separate amd64 and arm64 images. Budget roughly 1 GB of memory: about 280 MB for ONNX, 115 MB for the vector matrix, plus SQLite page cache and request buffers.

The image carries the pinned model outside the data volume, so it embeds without network access. `GET /healthz` is liveness; `GET /readyz` answers 503 until the model is loaded. A missing model artifact that cannot be downloaded leaves the hub serving ingest and lexical search, with readiness at 503 naming the reason and the load retried on the embedding backoff. Backup, restore, and recovery from a failed migration (which rolls back and leaves the archive at its old version) are in `docs/operations.md`.

## 8. Measurement

`tools/eval/` scores retrieval against real usage. Labels come from pairing every real `recall_search` with the `recall_expand` or `recall_inspect` that followed it. Scoring is at session level, over the full corpus, through the hybrid pipeline.

These numbers were measured against turn-pair chunks as §3.2 describes them. Any change to the chunk rendering invalidates the comparison, which is why the rendering version is part of the space identity and why build step 4 gates on reproducing this table rather than assuming parity.

Current baseline, 393 real queries:

| configuration | MRR@10 | Hit@1 | Hit@5 | Hit@10 |
| --- | --- | --- | --- | --- |
| BM25 only | 0.4079 | 0.3003 | 0.5471 | 0.6234 |
| semantic only | 0.4198 | 0.2901 | 0.6081 | 0.7226 |
| hybrid | 0.5069 | 0.3664 | 0.7023 | 0.7863 |

The columns are **hit rate, not recall**: they measure whether any relevant session appears in the top K, and some queries have several relevant sessions.

That table came from the single-machine plugin's index, with the semantic branch reimplemented in the harness. The harness now runs every query through the hub's Archive module on a **frozen corpus**: the same 393 labels, every v2 session up to the newest labelled search (4,418 sessions, 74,675 chunks), and a record of the labels' hash, every session's content hash, and the vector space recipe, which scoring checks before it runs. Two runs over one frozen corpus give identical numbers. Reproduced there:

| configuration | MRR@10 | Hit@1 | Hit@5 | Hit@10 |
| --- | --- | --- | --- | --- |
| BM25 only | 0.4106 | 0.3053 | 0.5471 | 0.6234 |
| semantic only | 0.4177 | 0.2875 | 0.6081 | 0.7048 |
| hybrid | 0.5116 | 0.3766 | 0.7099 | 0.7786 |

Every cell is within 0.02 of the table above. The largest gap is semantic Hit@10, 7 queries lower with none higher. Two of those queries point only at sessions that exist solely in OpenCode's v1 tables, which §3.3 drops, so no v2 archive can find them. The other five sat at ranks 7 to 10 in the old harness and rank 11 to 22 here, with one beyond 25.

Three further limits on what these numbers can support. Relevance is inferred from a subsequent tool call, and opening a session can be an investigation that proved irrelevant. Labels carry incumbent bias, since the human could only open what the current ranking showed. And a change to chunk rendering or the embedding recipe needs a newly frozen corpus, since the recorded fingerprint covers both.

## 9. Rejected, with the measurements that rejected them

Recorded because each looks obviously correct on paper and will otherwise be proposed again.

**A better embedding model.** `voyage-4-lite` at 512 dims and `pplx-embed` at 1024 both beat `bge-small` on the semantic branch by 0.024 to 0.040 MRR@10. Through the full hybrid pipeline the gain was +0.0112 and +0.0113, with 95% confidence intervals of [-0.0142, +0.0363] and [-0.0132, +0.0352], p = 0.380 and 0.368. Voyage won 75 queries and lost 75. This is **no statistically resolved gain on this evaluation**, not a demonstration that alternatives are worthless: the intervals admit modest regressions and useful gains alike. RRF fusion absorbs most of what a better embedder contributes.

**`gte-modernbert-base`.** Recommended by earlier research on MTEB(Code) 71.1 against bge-small's 47.3. On this corpus: 0.7667 against 0.7531, a 1.8% gain, at a quarter the ingest throughput and 2,861 MB RSS. Benchmark scores on code did not transfer to conversation transcripts.

**Hosted embedding APIs.** Would have removed all native-inference packaging. Rejected once the quality gain failed to resolve: it adds ~100 ms to every search against 4.4 ms locally, sends every chunk of a private work archive to a third party, and costs an irreversible retention decision. Under $1/month, which was never the obstacle.

**Reranking.** `voyageai/rerank-2.5-lite`, `voyageai/rerank-2.5`, and `cohere/rerank-4-fast` over the fused top 30 scored 0.4444, 0.4561, and 0.4518 against the 0.5069 baseline, at 229 to 311 ms. Confounded (click labels penalise reordering, and documents were assembled from at most two hits) so this is evidence against this configuration, not against reranking.

**Go for the hub.** Genuinely better on packaging: `modernc.org/sqlite` is cgo-free with FTS5 and sqlite-vec bundled and cross-compiles everywhere from one machine. Lost on the cost of a second language for one maintainer once remote embeddings were rejected and the native-addon problem disappeared with the container.

**sqlite-vec and bit quantization.** Unnecessary at this scale. The scan is 16.5 ms over 75,110 chunks at 384 dims and stays under 70 ms at 300,000, about 19 months away.

**A repository interface over storage.** One adapter exists and no second store is in prospect; an interface written against one implementation is shaped by it. The problem it would have solved, SQL spread across 57 call sites, is solved by concentration instead.

## 10. Build order

1. **Sync correctness slice, before anything else.** One host uploads a consistent snapshot, updates it, retries after a lost acknowledgement, deletes it, restarts, and reconciles. Exercise two plugin instances against it. Then rewind it: restore an older database, add messages, and reconcile against a second host still holding the pre-rewind copy at a higher revision; the rewound copy must stay accepted across repeated sweeps on both hosts. This is where the subtle failures live, and building retrieval first would hide them behind something that appears to work.
2. Archive module and schema, with migrations, tested through its interface against both `:memory:` and a file-backed database.
3. Extraction and normalization, carrying the pure functions over, verified against real sessions.
4. Embedding and the vector space, including space identity and the active-space concept.
5. Retrieval: BM25, cosine, fusion, filters. Gate on a ported `tools/eval/` reproducing §8 against a frozen corpus.
6. HTTP API, schema validation, tokens, `serve`.
7. Plugin: extraction, exclusion, work list, upload.
8. Reconciliation, tombstones, backfill.
9. The five tools and instruction injection.
10. `reindex`, `token`, `status` subcommands.
11. Container image and release pipeline.
12. Cutover.

**Cutover.** The hub re-embeds everything; existing vectors are not reusable despite 1.0 keeping the same model and dimensions, because the hub never reads the old `index.db`, no import path exists, and chunk text will not be byte-identical once rendering is reimplemented. Budget a full embed of roughly 75,000 chunks on first backfill and measure the rate on the Linux host.

Running both plugins at once does not compare them: OpenCode lets a later tool registration override an earlier one, so identical tool names mean one silently wins. Give the new plugin distinct temporary tool names for any shadow comparison.

## 11. Known gaps

Carried deliberately, so they are found on purpose rather than in production.

- A rewind whose only change updates an existing message (a turn completing after the restore) has no newer last activity, so it is rejected until the session gets a new message or a metadata change. A higher revision alone does not help, because last activity leads the comparison.
- Rewind and tombstone acceptance compare message creation times written by host clocks. Within one host that is one clock; across hosts holding copies of one session, clock skew decides which copy counts as newer.
- No timing in this document has been measured on the Linux host.
- `docs/agents/domain.md` expects a `CONTEXT.md` and `docs/adr/`; neither exists, and this spec plus the resolved issues serve as both. A later session looking for a glossary will not find one.
