# SQLite FTS5 and vector search options for the hub

Research for issue #4. Question: what SQLite setup should the hub's search store use, given a contentful (or external content) FTS5 requirement and 50k to 500k embedding chunks at 384 dimensions, in either Go or TypeScript on Bun.

All measurements below were run on 2026-09-16 on this Mac (Apple Silicon, macOS, Homebrew SQLite 3.53.4, sqlite-vec v0.1.9, Bun 1.4.2, Go 1.27.1). Scratch files lived under the approved temp directory and were removed afterwards. Where a number is an estimate rather than a measurement, it is labeled as such.

## Recommendation

Both languages: store chunk text and embeddings once in ordinary tables, index the text with an FTS5 external content table (`content='<hub text table>'`) rather than a contentful table, and run the semantic branch as a brute-force dot product over an in-memory float32 matrix loaded at startup, exactly as the current plugin does. Use sqlite-vec only if the corpus is expected to exceed roughly 200k chunks or the hub must serve many processes that cannot each afford the matrix, and in that case use a binary-quantized `vec0` table with float rescoring, not a float `vec0` table. Do not use sqlite-vss.

TypeScript on Bun: `bun:sqlite`. FTS5 is available everywhere. Extension loading works on Linux out of the box and on macOS only after `Database.setCustomSQLite()` points at a Homebrew `libsqlite3.dylib`, so a sqlite-vec dependency adds a macOS setup step. The in-memory path has no such dependency.

Go: `modernc.org/sqlite` (cgo-free). FTS5 is compiled in, and as of v1.59.0 the module bundles sqlite-vec v0.1.9 as `modernc.org/sqlite/vec`, so vec0 is available with a blank import and no cgo. `mattn/go-sqlite3` also works (needs `-tags sqlite_fts5` plus the sqlite-vec cgo bindings) but requires a C toolchain. Avoid `ncruces/go-sqlite3` for this project until the sqlite-vec ncruces bindings are updated: they do not compile against current ncruces (see below).

## Sources consulted

- SQLite FTS5 documentation, sections 4.4 (external content and contentless tables), 4.5 (columnsize), 4.6 (detail): https://www.sqlite.org/fts5.html
- sqlite-vec repository, README, `sqlite-vec.c` source, releases and issue #25: https://github.com/asg017/sqlite-vec
- sqlite-vec documentation (KNN, vec0, JavaScript, Go pages): https://alexgarcia.xyz/sqlite-vec/
- sqlite-vec v0.1.0 release post with the author's benchmarks: https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html
- sqlite-vss README: https://github.com/asg017/sqlite-vss
- Bun `bun:sqlite` docs: https://bun.com/docs/runtime/sqlite and Bun's SQLite build definition `scripts/build/deps/sqlite.ts` in https://github.com/oven-sh/bun
- better-sqlite3 `docs/api.md` and `docs/compilation.md`: https://github.com/WiseLibs/better-sqlite3
- modernc.org/sqlite README and `vec` package docs: https://gitlab.com/cznic/sqlite and https://pkg.go.dev/modernc.org/sqlite/vec
- mattn/go-sqlite3 README (build tags): https://github.com/mattn/go-sqlite3
- ncruces/go-sqlite3 README and release notes v0.32.0 through v0.35.5: https://github.com/ncruces/go-sqlite3
- sqlite-vec Go bindings source: https://github.com/asg017/sqlite-vec-go-bindings
- The current plugin at `~/my-opencode-setup/plugins/recall` (`lib/schema.ts`, `lib/search.ts`, `lib/config.ts`) and its live index at `~/.local/share/opencode-recall/index.db`, read with `sqlite3 -readonly`

## The corpus today

Read from the live index on 2026-09-16 (`sqlite3 -readonly`, `dbstat`, `fts5vocab`):

| Measure | Value |
| --- | --- |
| File size | 576.6 MB (`index.db`), 4 KB pages, 1,433 free pages |
| FTS rows (`fts`, contentless, one row per part segment of up to 8,000 chars) | 418,540 |
| Embedding chunks (`chunks`, 384-dim float32 blobs, 1,536 bytes each) | 74,348 (18,611 with `scope='user-messages'`) |
| Sessions | 4,419 |
| Distinct FTS terms / postings / indexed tokens | 462,223 / 39,888,180 / 88,861,212 |
| `chunks` table on disk | 274.0 MB (text avg 960 chars plus the 1,536-byte blob per row) |
| `fts_data` (inverted index) | 212.2 MB |
| `parts` + `parts_session` | 73.7 MB |
| `fts_docsize` | 5.6 MB |

The ticket text says ~50k chunks and ~369k FTS rows; the index has grown since. The rest of this document uses 50k, 200k and 500k chunks as the scale points the ticket asked for.

## FTS5: contentless, contentful, and external content

Facts from the FTS5 documentation:

- A contentless table (`content=''`) stores only the inverted index. Column values cannot be read back, and `highlight()`/`snippet()` cannot work. `contentless_delete=1` (SQLite 3.43+) adds DELETE, UPDATE-all-columns and INSERT OR REPLACE support. This is what the plugin uses today, which is why snippets are re-read from OpenCode's own database.
- A contentful table (the default) keeps a private copy of every row in the `<name>_content` shadow table.
- An external content table (`content='<table>'`, optional `content_rowid=`) stores only the index and reads column values from the named table when needed. All FTS5 functionality works, including `snippet()` and `highlight()`. Keeping the index consistent with the content table is the caller's job; the documented pattern is AFTER INSERT/UPDATE/DELETE triggers, or explicit `INSERT INTO ft(ft) VALUES('rebuild')`. For deletes, the FTS row must be removed while the content row still exists, because FTS5 re-tokenizes the old content to find the postings to remove.
- `detail=column` drops term offsets (no phrase or NEAR queries); `detail=none` also drops column numbers. The documentation's own test on 1,636 MiB of email gave an index of 743 MiB (full), 340 MiB (column) and 134 MiB (none).
- `columnsize=0` drops the `_docsize` shadow table; on a non-contentless table `bm25()` still works but must re-tokenize to count tokens, so it is much slower.

### Measured size impact

Built in a scratch database from the live index's 74,367 chunk texts (71,823,821 bytes of UTF-8), attached read-only, then `optimize`d. Sizes are `dbstat` page totals.

| Variant | Inverted index (`_data` + `_idx`) | Stored content | `_docsize` | Total FTS footprint |
| --- | --- | --- | --- | --- |
| `content=''`, `contentless_delete=1` | 32.5 MB | 0 | 0.94 MB | 33.4 MB |
| Default contentful | 32.5 MB | 91.0 MB (`_content`) | 0.79 MB | 124.3 MB |
| `content='raw'` (external) | 32.5 MB | 0 (text already in `raw`, 91.0 MB) | 0.79 MB | 33.3 MB |
| Contentful, `detail=column` | 25.8 MB | 91.0 MB | 0.79 MB | 117.6 MB |

Findings:

- The inverted index is byte-identical across contentless, contentful and external content; the `content` option only changes whether text is duplicated. Index bytes were 0.45x the raw text for this sample (2.97 bytes per token), and 0.24x on the full live corpus (212 MB for 88.9M tokens, 2.39 bytes per token; larger corpora compress better because the term dictionary is amortized).
- Storing text in SQLite costs about 1.27x its byte length (91.0 MB for 71.8 MB of text) because of page fill and row overhead at ~960 bytes per row. A contentful table pays that once for the FTS copy; if the hub also keeps the text in its own table (it must, since it cannot re-read OpenCode's database), a contentful table pays it twice. An external content table pays it once.
- `detail=column` saves about 21% of index bytes but removes phrase queries, which the plugin's `ftsQuery()` relies on for quoted terms. Not worth it at these sizes.
- Extrapolation (estimate, not measured): the live FTS index covers 88.9M tokens. At the sample's 6.57 bytes per token that is about 584 MB of raw text, or about 740 MB stored in SQLite. So a hub that stores the full indexed text will be roughly 212 MB (index) + 740 MB (text) + 74 MB (parts metadata) + embeddings, around 1.1 GB before embeddings for today's corpus, versus 576 MB today. That growth is inherent to "the hub owns the text", not to the FTS table type. The only lever is whether to index tool output at all or at a shorter cap than the current 16,000 chars; the current plugin indexes `kind='tool'` parts and most of the 88.9M tokens are almost certainly tool output (inferred from the config caps, not measured).
- Query performance: FTS5 MATCH queries read the inverted index, not the content, so contentful versus external content does not change MATCH latency. `snippet()` and `highlight()` on an external content table run one `SELECT ... WHERE rowid = ?` per returned row against the content table, which is a primary-key lookup. The plugin already does the equivalent by re-reading OpenCode's database for the handful of displayed hits.

Recommendation: hub text table `parts(id INTEGER PRIMARY KEY, session_id, message_id, part_id, kind, role, time, seg_start, text)` plus `CREATE VIRTUAL TABLE fts USING fts5(text, content='parts', content_rowid='id')`. Keep `detail=full` and `columnsize=1`. Maintain the index in the same transaction as the per-session replacement (delete FTS rows first, then parts rows, then insert both), which is the ordering the FTS5 docs require for external content deletes. The hub gets `snippet()` for free and stores text once.

## Vector search options

### Candidates

- In-memory brute force: load all embeddings into a `Float32Array` (or `[]float32`) at startup, dot product per query, top-k. This is the current plugin (`lib/search.ts`).
- sqlite-vec `vec0` virtual table: brute-force KNN inside SQLite over chunked shadow tables; supports float32, int8 and bit vectors, metadata columns for `WHERE` filters, partition keys, auxiliary columns, and `rowid IN (...)` pre-filters. Current release v0.1.9 (2026-03-31); v0.1.10-alpha.4 exists. Pre-1.0, "expect breaking changes" per the README.
- sqlite-vec scalar functions (`vec_distance_cosine()` over a plain blob column with `ORDER BY ... LIMIT`): no virtual table, SQLite does the top-k sort.
- sqlite-vss: Faiss-based predecessor. Its README states it "is not in active development" and points to sqlite-vec. It requires two shared libraries plus libgomp/atlas/lapack on Linux, caps indexes at 1 GB, does not support UPDATE, needs the whole index in RAM, and pre-built binaries exist only for Linux x86_64 and macOS x86_64 (no arm64). Excluded.
- ANN indexes: sqlite-vec has none. Tracking issue #25 (ANN) is still open as of 2026-06-13. Draft files `sqlite-vec-diskann.c`, `sqlite-vec-ivf.c` and `sqlite-vec-rescore.c` exist in the repository but are not part of the released extension's documented surface.

### sqlite-vec KNN performance claims and their source

The author's own numbers (v0.1.0 post, Mac M1 mini, 8 GB): 100k float vectors at 384 dims answered in under 75 ms; 100k bit vectors at 3,072 dims in 11 ms; at 1M vectors no float dimensionality met his 100 ms target (192 dims took 192 ms). For 500k GIST vectors at 960 dims, `vec0` took 87 to 89 ms per query and 13.6 to 15.5 s to build. He states the practical limit for latency-sensitive use is "probably in the 100's of thousands depending on your dimensions/quantization techniques". These are the only primary-source benchmarks; there is no published number for 384 dims at 50k/200k/500k, so I measured.

### Local micro-benchmark

Bun 1.4.2, `bun:sqlite` with `Database.setCustomSQLite('/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib')` (SQLite 3.53.4), sqlite-vec v0.1.9 from npm, WAL mode, `synchronous=NORMAL`. Random unit vectors, 384 dims, k=60 (the plugin's `search.candidates`), 20 queries averaged after one warm-up, 40 chunks per synthetic session. Brute-force cost does not depend on the vector distribution, so random vectors are a fair timing proxy; recall is not measured here.

| Metric | 50k chunks | 200k chunks | 500k chunks |
| --- | --- | --- | --- |
| Float32 matrix bytes (N x 384 x 4) | 76.8 MB | 307.2 MB | 768.0 MB |
| Observed RSS delta after matrix load (includes page cache and GC garbage) | 184 MB | 697 MB | 1,712 MB |
| In-memory matrix load from `chunks` table (startup, per process) | 51 ms | 202 ms | 581 ms |
| In-memory query, current code (score all, sort all, slice) | 21.4 ms | 90.3 ms | 291.9 ms |
| In-memory query, bounded top-k (no full sort) | 13.7 ms | 51.3 ms | 153.6 ms |
| In-memory top-k with a 25% time-window filter applied in the loop | 3.5 ms | 13.1 ms | 39.3 ms |
| `vec0 float[384]` on-disk bytes | 78.7 MB | 315.0 MB | 786.0 MB |
| `vec0 float[384]` build from `chunks` | 0.63 s | 2.56 s | 7.96 s |
| `vec0 float[384]` KNN | 22.8 ms | 91.6 ms | 255.0 ms |
| `vec0 float[384]` KNN with `time BETWEEN` metadata filter (25% window) | 13.9 ms | 56.1 ms | 161.4 ms |
| `vec0 bit[384]` on-disk bytes | 3.6 MB | 14.3 MB | 35.9 MB |
| `vec0 bit[384]` KNN (`vec_quantize_binary` on both sides) | 2.4 ms | 9.1 ms | 26.2 ms |
| `vec0 bit[384]` KNN k=240 then float rescore via `vec_distance_cosine` join | 8.6 ms | 33.7 ms | 94.9 ms |
| Scalar `vec_distance_cosine` over `chunks` with `ORDER BY LIMIT` | 40.9 ms | 158.1 ms | 515.2 ms |
| `chunks` table on disk (text-free, blob only, for reference) | 102.7 MB | 410.6 MB | 1,026.6 MB |

Per-session replacement (delete one session's 40 chunks and insert 40 new ones, one transaction):

| Operation | 50k | 200k | 500k |
| --- | --- | --- | --- |
| `chunks` table only (in-memory path); next query then pays a full matrix reload | 0.6 ms (+51 ms reload) | 0.8 ms (+202 ms) | 0.8 ms (+581 ms) |
| `chunks` + `vec0 float` + `vec0 bit`, deletes written as `WHERE chunk_id IN (SELECT ...)` | 13.9 ms | 78.5 ms | 199.6 ms |
| `vec0 float` delete of 40 rows via `IN (json_each(?))` | 5.9 ms | 30.0 ms | not run |
| `vec0 float` delete of 40 rows as 40 point deletes `WHERE chunk_id = ?` | 0.6 ms | 0.6 ms | not run |
| `vec0 float` insert of 40 rows | 0.8 ms | 1.0 ms | not run |

`EXPLAIN QUERY PLAN` confirms the `IN` form plans as `SCAN vec_f VIRTUAL TABLE`, a full scan, while `chunk_id = ?` is a point lookup. Per-session replacement in vec0 is cheap only when written as point deletes.

`rowid IN (subquery)` pre-filtering on KNN at 200k: no filter 90.8 ms; filter to 2% of rows by directory `LIKE` 66.6 ms; filter to 50% of rows 87.4 ms. The pre-filter shrinks the candidate set but sqlite-vec still walks every chunk's validity bitmap and rowid list, so the saving is modest. The in-memory loop applying the same 25% window dropped to 13.1 ms because it skips the dot product entirely for excluded rows. (`rowid IN` support is confirmed in `vec0BestIndex` in `sqlite-vec.c`; metadata-column `IN` appears in the source enum `VEC0_METADATA_OPERATOR_IN` but is not in the documentation.)

### Reading the numbers

- Float `vec0` and the current in-memory code have the same query latency to within a few percent at every scale. Both are linear in N. A bounded top-k in the in-memory loop is about 1.7x faster than either, and the plugin's filter-in-the-loop approach is far cheaper than vec0's metadata filters because it never touches excluded vectors.
- The in-memory approach's real costs are startup (51 ms to 581 ms per process, and the plugin reloads the matrix after every content change) and memory (the matrix is 77 MB to 768 MB; observed RSS was 2.2x to 2.4x that during load). In the hub design this is one long-lived process, not N OpenCode processes each holding their own copy, which removes the multiplication the plugin suffers today.
- Binary quantization is where sqlite-vec earns its keep: 26 ms at 500k with a 36 MB table, or 95 ms with float rescoring of 4k candidates. The author reports roughly 95% agreement after binary quantization for `text-embedding-3-large`; for the plugin's 384-dim model the recall loss is unmeasured and would need a check against real queries before adoption. The same binary trick is available in-memory (pack bits, popcount), so it is not exclusive to sqlite-vec.
- 500k float chunks in either approach is 150 ms to 300 ms per query, which is acceptable for a tool call but past the 100 ms target the sqlite-vec author uses. The current corpus is 74k chunks; at the observed growth (the ticket's 50k became 74k in the time between drafting and research) 200k is plausible within a year, 500k is not imminent.

### Startup, memory, and index maintenance summary

| Aspect | In-memory brute force | sqlite-vec `vec0` |
| --- | --- | --- |
| Startup | Load N x 1,536 bytes; 0.05 s to 0.6 s measured | None beyond opening the database |
| Steady-state memory | Matrix plus id/time/session arrays; 77 MB to 768 MB for the matrix | SQLite page cache only; vectors stay on disk |
| Query latency at 384 dims | 14 ms to 154 ms (bounded top-k) | 23 ms to 255 ms float; 2 ms to 26 ms bit |
| Filters | Any predicate in the loop, effectively free | `=`, `!=`, `<`, `>`, `BETWEEN` on metadata columns; `rowid IN`; partition keys need hundreds of rows per key |
| Per-session replacement | Sub-millisecond write, then full matrix reload | Sub-millisecond as point deletes; full scan if written as `IN (subquery)` |
| Dependency | None | Loadable extension or bundled build; pre-1.0 API |
| Disk | Blob column, about 1.5 KB per chunk | Duplicate of the blob column in shadow tables (plus 1/32 for a bit table) |

## Driver capability matrix

Verified 2026-09-16 unless noted.

| Driver | Language | cgo / native build | SQLite version | FTS5 | Loadable extensions | sqlite-vec path | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bun:sqlite` on macOS | TS | Dynamically loads Apple's system `libsqlite3.dylib` | 3.54.0 here (system) | Yes (`ENABLE_FTS5` in `PRAGMA compile_options`) | No: `OMIT_LOAD_EXTENSION` in Apple's build; use `Database.setCustomSQLite('/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib')` before opening any database | `sqlite-vec` npm package (`sqliteVec.load(db)`) after `setCustomSQLite`; worked in the benchmark | Apple's build also sets persistent WAL; Bun docs cover the cleanup |
| `bun:sqlite` on Linux/Windows | TS | Statically linked amalgamation from Bun's tree | Per Bun release (not checked here) | Yes (`SQLITE_ENABLE_FTS5: 1` in `scripts/build/deps/sqlite.ts`) | Yes; `load_extension` is not omitted in Bun's defines (read from source, not run) | `sqlite-vec` npm package with `db.loadExtension` via `sqliteVec.load(db)` | Bun's `node:sqlite` shares the same library |
| `better-sqlite3` 13.0.3 | TS/Node | Prebuilt native addon, bundles its own SQLite | 3.53.4 (per `docs/compilation.md`) | Yes (`SQLITE_ENABLE_FTS5` in bundled options) | Yes: `db.loadExtension(path, [entryPoint])` | `sqlite-vec` npm `load()` is documented for it | Works under Bun too per sqlite-vec docs; adds a native addon dependency that `bun:sqlite` avoids |
| `modernc.org/sqlite` v1.59.0 | Go | cgo-free (transpiled C) | 3.53.4 | Yes (`ENABLE_FTS5`, `CREATE VIRTUAL TABLE ... fts5` succeeded) | `load_extension()` returns "not authorized" by default; dynamic loading of shared-library extensions is not a supported path in a cgo-free build (inferred from the transpiled design; not tested further) | Bundled: `import _ "modernc.org/sqlite/vec"` registers sqlite-vec v0.1.9 via `sqlite3_auto_extension`; `vec_version()` and `vec0` tables worked | `THREADSAFE=1`; module download is large (per-GOOS/GOARCH generated files) |
| `mattn/go-sqlite3` v1.14.52 | Go | cgo, bundles amalgamation | 3.53.4 | Only with `-tags sqlite_fts5` (`no such module: fts5` without it) | Yes by default (`sqlite_omit_load_extension` tag disables); DSN has no switch, use `sqlite3_enable_load_extension` via `ConnectHook` or `load_extension()` after enabling | `github.com/asg017/sqlite-vec-go-bindings/cgo` v0.1.6, `sqlite_vec.Auto()`; worked, reports `vec_version() = v0.1.6` (bindings lag sqlite-vec v0.1.9) | Requires a C compiler at build time; macOS SDK warns that `sqlite3_auto_extension` is deprecated on Apple platforms but it linked and ran |
| `ncruces/go-sqlite3` v0.35.5 | Go | cgo-free (Wasm translated to Go by `wasm2go` since v0.33.x) | 3.54.x (Wasm module v6.2.35304) | Yes, but since v0.35.0 only with `import _ "github.com/ncruces/go-sqlite3/ext/fts5"` (breaking change in the release notes) | No shared-library loading; extensions are Go packages | Broken: `github.com/asg017/sqlite-vec-go-bindings/ncruces` v0.1.6 sets `sqlite3.Binary`, which no longer exists after the `wasm2go` switch; `go run` fails with `undefined: sqlite3.Binary`. The bindings' last automated update was 2025-01-10 | Author's benchmarks show competitive performance; memory per connection is higher because of the sandbox |

Notes on the TypeScript column: on macOS the Homebrew path means the hub binary depends on `brew install sqlite` being present, or on shipping a vanilla `libsqlite3.dylib` alongside the hub. The in-memory design needs neither.

## Recommendation per language

### TypeScript on Bun

Use `bun:sqlite`. Schema: `parts` (text and metadata), `fts` as an external content table over `parts`, `chunks(id, session_id, message_id, time, scope, text, emb BLOB)`. Semantic branch: keep the in-memory matrix, but change the scoring loop to a bounded top-k (measured 1.7x faster than sort-all: 51 ms versus 90 ms at 200k). Because the hub is one long-lived process, load the matrix once and update it incrementally on per-session replacement (append new rows, tombstone deleted ids) instead of the plugin's full reload, which would otherwise cost 0.2 s to 0.6 s after every upload at 200k to 500k chunks. Do not add sqlite-vec now. If the corpus passes about 200k chunks or RSS becomes a problem, add a `vec0 bit[384]` table plus float rescoring behind the same interface, which needs `setCustomSQLite` on macOS and the `sqlite-vec` npm package; measured at 34 ms per query at 200k and 95 ms at 500k, with a 14 MB to 36 MB table.

### Go

Use `modernc.org/sqlite` v1.59.0 or later: cgo-free, FTS5 on, and sqlite-vec v0.1.9 bundled as `modernc.org/sqlite/vec`, so the vector branch can be either in-memory (`[]float32`, same design as above; Go's loop will be at least as fast as Bun's JIT) or `vec0` with zero extra build steps. That makes Go the language where adopting sqlite-vec later is free of platform setup. Start with in-memory for parity with the TypeScript path and the plugin's proven filter semantics; switch the semantic branch to `vec0 bit[384]` plus rescoring if scale demands, writing deletes as point deletes by primary key. `mattn/go-sqlite3` is a working fallback (`-tags sqlite_fts5`, cgo bindings at sqlite-vec v0.1.6) at the cost of a C toolchain. Do not pick `ncruces/go-sqlite3` if sqlite-vec is on the roadmap until its bindings are rebuilt for the `wasm2go` era.

## Open points

- Recall loss from binary quantization on the plugin's 384-dim embedding model is unmeasured; measure against real queries before switching the semantic branch to bit vectors.
- The share of the 88.9M indexed tokens that is tool output is inferred from config, not measured; the hub's text storage size depends heavily on whether tool output is indexed at the current 16,000-char cap.
- Bun's Linux extension loading and bundled SQLite version were read from Bun's build definition, not executed on Linux.
- Whether `modernc.org/sqlite` can load a shared-library extension at all was not tested beyond observing the default "not authorized"; it is irrelevant if the bundled `vec` package is used.
