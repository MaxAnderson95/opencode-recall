# opencode-recall 1.0

Shared conversation memory for OpenCode across machines. A **hub** holds one archive of every session from every host. A thin **plugin** on each host uploads finished sessions and serves the `recall_*` tools against the hub.

This replaces the single-machine recall plugin in `my-opencode-setup/plugins/recall`. The design decisions behind everything here are recorded in issues #6 through #13; this document describes the system, not the argument.

## 1. Scope

1.0 is parity with today's plugin, backed by a shared hub.

In scope: the five `recall_*` tools with today's ladder semantics, instruction injection, upload of every session from every host, an archive any host can search while the originating host is offline, and a backfill of the existing ~4,470 Mac sessions.

Out of scope: resuming a conversation started on another host, porting OpenCode's own database anywhere, a separate human CLI, and hub-side LLM credentials.

Accepted regression: a host loses recall entirely when the hub is unreachable. Today's plugin works offline. There is no local fast path, and adding one is not 1.0 work.

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
| growth | ~12,000 chunks/month |
| searches | ~300/month |
| vector matrix | 115 MB at 384 dims; 16.5 ms per scan |

## 3. Hub

TypeScript on Bun, compiled with `bun build --compile`. Shipped primarily as a **Linux container image**, with the binary as a secondary release artifact. Linux is the only production target; macOS runs from source for development and no darwin binary is published.

One SQLite database plus WAL in one configurable data directory holds the archive, FTS index, vectors, summaries, and tokens. That directory is the container's only volume and a backup is one `sqlite3 .backup`.

Configuration is environment-first (`OPENCODE_RECALL_*`) with an optional JSON file; environment wins. Covered: data directory, listen address, embedding model and dimensions, chunking parameters, log level.

Observability is structured JSON logs to stdout: ingest outcomes, embedding failures, reindex progress, auth rejections, migration results. No OpenTelemetry in 1.0.

### 3.1 Archive module

All SQL lives in one deep module that owns **storage and retrieval together**: every statement, the FTS5 MATCH construction, the in-memory vector matrix, the cosine scan, and RRF fusion. There is no ORM and no repository interface.

Interface, roughly: put a session snapshot, delete a session, search the corpus, search within a session, fetch a transcript window, read a cached summary, write a cached summary, swap the active vector space, report status.

Internal seams are expected inside the implementation and may be used by its own tests. They are not part of the interface. Tests run through the interface against `:memory:`, which is how the current plugin already tests.

Schema evolves by numbered forward-only migrations applied on startup inside a transaction, refusing to start against a database newer than the binary. Derived data the hub can regenerate from its own tables (FTS rows, chunks, vectors) may be dropped and recomputed instead of migrated.

### 3.2 Archive schema

Shape, not literal DDL.

**`sources`**: one per host. Identity, display label, created time. Created by `token issue`.

**`sessions`**: keyed by OpenCode session id alone, with `source_id` as an attribute. Holds slug, title, directory (raw, unnormalized), `parent_id`, `time_created`, `time_updated` (the revision), `compaction_boundary`, and the session content hash.

Keying on the id alone means a database copied between machines, or a rebuilt host, updates one row rather than producing a duplicate conversation in results.

**`messages`**: id, session, role, time, ordering.

**`parts`**: one row per display-relevant part: message, kind (`text` | `reasoning` | `tool`), `tool_name`, `tool_title`, `status`, and the canonical extracted text.

Searchability is a property, not a condition on existence. Parts excluded from search (incomplete tools, empty output) are stored and render in transcripts but produce no segments and no chunks. Without this, failed and in-flight tool calls vanish from transcripts, and those are frequently why someone is searching.

**`segments`**: `(part_id, start, length)`, one per FTS row. **`fts`**: FTS5 external-content table over the segment text, so the search index holds no second copy.

**`chunks`**: `(part_id, start, length)`, plus scope, time, and the chunk content hash. Chunks are references, not stored text. Re-chunking rewrites offsets.

**`vector_spaces`**: one row per space: model, dimensions, chunk size, overlap, per-turn cap, and whether it is active. **`vectors`**: `(chunk_id, space_id, embedding)`.

Space identity covers all five parameters together, because chunk boundaries determine what a vector represents as surely as the model does.

**`summaries`**: `(session_id, model, focus)` with the summary, `time_updated`, and created time. Survives an index rebuild.

**`tombstones`**: session id and deletion time.

### 3.3 Normalization

The plugin extracts; the hub stores what arrives and derives the rest.

Part types: `text` and `reasoning` pass through. A `tool` part contributes searchable text only when completed with non-empty output, rendered as `<tool> <title>\n<output>` and capped at 16,000 characters. File attachments are dropped entirely.

Chunking is hub-side: 1,200 characters with 200 overlap, capped at 60,000 characters per turn.

### 3.4 Retrieval

Unchanged from today, because it was measured and is good.

BM25 over FTS5 with every filter pushed into the SQL, never applied after a fixed top-N cut. Cosine over an in-memory `Float32Array` of the active space. Both branches capped at 60 candidates, fused with RRF at `k=60`, grouped by session with `perBranchCap: 3` and `hitsPerKey: 2`.

Filters: scope, since, until, directory (substring), session, source, and the calling-session exclusion against its compaction boundary.

Embedding is `bge-small-en-v1.5` at 384 dimensions, q8 ONNX, mean-pooled and normalized, with the query prefix `"Represent this sentence for searching relevant passages: "`. The prefix is load-bearing: omitting it costs measurable recall.

Query embedding is synchronous in the request, no cache. It measures 4.4 ms.

A synchronous scan occupies Bun's main thread, so concurrent searches during ingest serialise. The interface leaves room to move the scan to a worker; do not build that until it is observed to matter.

### 3.5 Failure independence

Ingest, lexical search, and embedding fail independently.

A snapshot is accepted and becomes BM25-searchable whether or not its chunks are embedded. Unembedded chunks sit in a durable retry queue. A search whose query embedding fails returns lexical results and says the semantic branch was unavailable. Status distinguishes **archived**, **lexically searchable**, and **embedded**.

Blocking ingest on embedding was considered. It does not simplify anything, because backfill and reindex both force a pending state to exist regardless; it only adds a second path doing the same job.

### 3.6 Reindex

On boot, if the configured space identity does not match the active one, the hub logs loudly, keeps serving on the existing vectors, and does not re-embed on its own.

`reindex` reports chunk count and estimated duration, then builds the replacement space alongside the live one and swaps atomically. An interrupted reindex leaves the existing index untouched.

Two requirements. Query embedding belongs to the **active** space, not the configured one, or queries get embedded with the new model and compared against old vectors. And ingest continues during the rebuild, so the new space runs a chunk-hash catch-up before the swap.

A full pass is roughly 75,000 chunks at ~45 chunks/s, about half an hour.

## 4. API

`POST /v1/<verb>`: `snapshot`, `tombstone`, `manifest`, `search`, `inspect`, `expand`, `summary.get`, `summary.put`, `status`.

Plain HTTP/JSON with a hand-written typed client in the shared package. Every request is validated at the boundary against a schema, with the TypeScript types inferred from it, because plugin and hub deploy independently and shared types check nothing at runtime.

Every request carries an integer protocol version. The hub rejects versions it does not serve, naming both.

Errors: **4xx terminal, 5xx retryable**, with a stable code and a human message. Codes include `stale_revision`, `tombstoned`, `hash_divergence`, `invalid_token`, `protocol_version`, `payload_too_large`. The plugin branches on the code; `recall_status` shows the message.

Authentication is `Authorization: Bearer opencode-recall_<32 random bytes>`. The hub stores only a hash. Revocation deletes a row and takes effect immediately; rotation is issue, update the host, revoke, which needs no downtime.

Snapshots are one gzipped request per session, capped at 64 MB. Measured worst case is in the low tens of megabytes before compression. Oversize is rejected, never truncated.

Search results carry the source host name and a boolean for whether that source is the caller's own, which the hub computes from the request token. Origin never affects ranking.

## 5. Sync

**Revision** is `session_v2.time_updated`. OpenCode has no per-session counter; `version` holds the OpenCode version string that created the session.

The hub accepts a snapshot newer than what it holds, treats equal-with-matching-hash as a no-op, and rejects older or equal-with-different-hash. A clock stepping backwards costs a rejected upload and a status line, not silent data loss.

**Queue.** A work list of dirty session ids and observed `time_updated`, in `ctx.storage`. Snapshots are built at send time. Many offline changes to one session collapse into a single upload of current state, the queue stays small enough for a key-value store, and a session deleted before its upload sends a tombstone instead.

**Deduplication.** One plugin instance runs per open location and every instance sees every event, so instances contend for a short-lived uploader lease in `ctx.storage`. The holder drains; the others enqueue.

**Reconciliation.** On startup the hub returns a manifest of session id to accepted revision for that source, about 4,500 pairs and 200 KB. The host diffs and enqueues what is missing or locally newer. A high-water timestamp cannot see an old session edited recently, nor detect a gap.

**Tombstones** block resurrection: any snapshot predating the tombstone is rejected. A genuinely newer snapshot clears it.

**Retry.** Transport failures back off exponentially to a few minutes and retry indefinitely. Rejections are terminal, leave the queue, and are recorded.

**Backfill** runs newest-first and throttled, yielding to live uploads and interactive searches, resuming from the manifest diff.

## 6. Plugin

A rewrite, not a port. The old plugin is a reference for rules, not a source of code.

It keeps only what requires being on the host: reading `opencode.db`, extracting part text, enforcing `excludeDirectories` before anything leaves the machine, the work list and lease, and the five tools. It has no index of its own.

Extraction stays host-side deliberately. Uploading raw v2 messages would ship base64 attachments, an order of magnitude more bytes for content the archive discards.

`recall_summarize` calls `ctx.generate.text` directly, replacing the hidden worker session. The call stays plugin-side so the hub holds no LLM credentials; the hub caches the result by session, model, and focus, invalidated by the session's `time_updated`, so the second host to ask gets it free.

`recall_status` reports both sides separately. Host: hub reachability, queue depth, backfill progress, last error, excluded directories, config source. Hub: total sessions and chunks, per-source counts, active space identity, pending embedding backlog, cached summaries.

Instruction injection keeps today's ladder text, adding that results name their origin machine, that `source` is a filter, and that an unreachable hub means "could not look" rather than "nothing found".

Configuration is `OPENCODE_RECALL_*` first, config file second. New keys: hub URL, API token. Gone with the local index: embedding model, dimensions, chunking, search tuning.

## 7. Operations

Four subcommands. `serve` runs the service and applies migrations. `token` issues, lists, and revokes. `status` reports the archive. `reindex` changes the embedding configuration.

No `migrate` subcommand: the hub is single-node and single-writer, so `serve` applying them is safe. No `backfill` subcommand: the initial load arrives through ordinary host reconciliation.

## 8. Measurement

`tools/eval/` scores retrieval against real usage. Labels come from pairing every real `recall_search` with the `recall_expand` or `recall_inspect` that followed it. Scoring is at session level, over the full corpus, through the real hybrid pipeline.

Current baseline, 393 real queries:

| configuration | MRR@10 | R@1 | R@5 | R@10 |
| --- | --- | --- | --- | --- |
| BM25 only | 0.4079 | 0.3003 | 0.5471 | 0.6234 |
| semantic only | 0.4198 | 0.2901 | 0.6081 | 0.7226 |
| hybrid | 0.5069 | 0.3664 | 0.7023 | 0.7863 |

Any change to the model, chunking, fusion, or ranking is expected to carry a number from this harness. Two properties limit what it can prove: relevance is incomplete, since a label records the session opened rather than every session that would have served, and labels carry incumbent bias, since the human could only open what the current ranking showed. A challenger that wins has won against a loaded baseline.

## 9. Rejected, with the measurements that rejected them

Recorded because each looks obviously correct on paper and will otherwise be proposed again.

**A better embedding model.** `voyage-4-lite` at 512 dims and `pplx-embed` at 1024 both beat `bge-small` on the semantic branch by 0.024 to 0.040 MRR@10. Through the full hybrid pipeline the gain was +0.0112 and +0.0113, with 95% confidence intervals of [-0.0142, +0.0363] and [-0.0132, +0.0352], p = 0.380 and 0.368. Voyage won 75 queries and lost 75. RRF fusion absorbs most of what a better embedder contributes.

**`gte-modernbert-base`.** Recommended by earlier research on MTEB(Code) 71.1 against bge-small's 47.3. On this corpus: 0.7667 against 0.7531, a 1.8% gain, at a quarter the ingest throughput and 2,861 MB RSS. Benchmark scores on code did not transfer to conversation transcripts.

**Hosted embedding APIs.** Would have removed all native-inference packaging. Rejected once the quality gain measured as zero: it adds ~100 ms to every search against 4.4 ms locally, sends every chunk of a private work archive to a third party, and costs an irreversible retention decision. Under $1/month, which was never the obstacle.

**Reranking.** `voyageai/rerank-2.5-lite`, `voyageai/rerank-2.5`, and `cohere/rerank-4-fast` over the fused top 30 scored 0.4444, 0.4561, and 0.4518 against the 0.5069 baseline, at 229 to 311 ms. Confounded (click labels penalise reordering, and documents were assembled from at most two hits) so this is evidence against this configuration, not against reranking.

**Go for the hub.** Genuinely better on packaging: `modernc.org/sqlite` is cgo-free with FTS5 and sqlite-vec bundled and cross-compiles everywhere from one machine. Lost on the cost of a second language for one maintainer once remote embeddings were rejected and the native-addon problem disappeared with the container.

**sqlite-vec and bit quantization.** Unnecessary at this scale. The scan is 16.5 ms over 75,110 chunks at 384 dims and stays under 70 ms at 300,000, which is years away at 12,000 chunks a month.

**A repository interface over storage.** One adapter exists and no second store is in prospect; an interface written against one implementation is shaped by it. The problem it would have solved, SQL spread across 57 call sites, is solved by concentration instead.

## 10. Build order

Each layer is usable before the next exists.

1. Archive module and schema, with migrations. Tested through its interface against `:memory:`.
2. Extraction and normalization, ported as rules from the current plugin, verified against real sessions.
3. Embedding and the vector space, including space identity and the active-space concept.
4. Retrieval: BM25, cosine, fusion, filters. Gate on `tools/eval/` reproducing the baseline above.
5. HTTP API, schema validation, tokens, `serve`.
6. Plugin: extraction, exclusion, work list, lease, upload.
7. Reconciliation, tombstones, backfill.
8. The five tools and instruction injection.
9. `reindex`, `token`, `status` subcommands.
10. Container image and release pipeline.
11. Cutover: run both plugins, compare, retire the old one.

Cutover detail is unspecified. Since 1.0 keeps the same model and dimensions as today, existing vectors are reusable rather than needing recomputation.
