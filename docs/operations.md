# Operating the hub

The hub runs in production as a Linux container. This is the procedure for running, probing, backing up, restoring, and upgrading it.

## Image and binary

A published release carries two artifacts, both built by `.github/workflows/hub.yaml` for amd64 and arm64:

- `ghcr.io/maxanderson95/opencode-recall-hub:<tag>`, a Debian slim image (glibc, which `onnxruntime-node` needs). The per-architecture images are `<tag>-amd64` and `<tag>-arm64`.
- `opencode-recall-hub-linux-<arch>.tar.gz`, holding the `bun build --compile` executable and `libonnxruntime.so.1`. Bun embeds ONNX Runtime's Node addon in the executable but not the shared library the addon links against, so the library must be on the loader's path: extract both into one directory and run `LD_LIBRARY_PATH=<that directory> ./opencode-recall-hub serve`, or install the library into `/usr/local/lib` and run `ldconfig`. There is no darwin build; macOS runs the hub from source.

`bun packages/hub/build.ts [outDir]` produces the same two files on a Linux machine; the image is built from them.

The image runs `opencode-recall-hub serve` as uid 10001 and listens on `0.0.0.0:7438`. `/data` is its only volume and holds `archive.db` (with its WAL) and `hub.lock`. It must be writable by the container's user; any uid works with `--user`:

```sh
docker run -d --name recall-hub --restart unless-stopped \
  -p 7438:7438 -v /srv/recall:/data \
  ghcr.io/maxanderson95/opencode-recall-hub:<tag>
docker exec recall-hub opencode-recall-hub token issue <source>
docker exec recall-hub opencode-recall-hub status
```

The hub speaks plain HTTP. Put it behind a Tailscale tailnet or a TLS-terminating reverse proxy, never on an open network (SPEC §4). `docker stop` sends SIGTERM, which stops the listener, waits for an in-flight embedding batch, and closes the archive.

## Health and readiness

Both probes answer `GET` without a token.

- `/healthz` answers 200 `{"ok":true,"schemaVersion":N}` whenever the process answers at all. Use it for liveness.
- `/readyz` answers 200 once the embedding model is loaded, and 503 until then, with the model's state: `{"ready":false,"schemaVersion":N,"model":{"state":"loading"}}`, or `"failed"` with an `error` naming why the last load failed.

Migrations run before the listener opens, in one transaction, so any answer from either probe means the archive is at `schemaVersion`. A migration that fails exits `serve` with status 1 before it listens (see below).

`serve` starts loading the model as soon as it opens the archive; with the model files present this takes about two seconds. A 503 from `/readyz` does not mean the hub is unusable: ingest, lexical search, and every other verb work throughout, and search reports the semantic branch as unavailable.

## The model artifact

Model files are read from `OPENCODE_RECALL_MODELS_DIR`, default `<dataDir>/models`, laid out as Hugging Face's cache (`<model>/<revision>/...`). The image sets it to `/opt/opencode-recall/models`, which holds the default model (`Xenova/bge-small-en-v1.5` at the revision pinned in `packages/hub/src/embedder.ts`), so the image needs no network to embed.

When the configured model's files are missing, the hub downloads them from Hugging Face into the models directory. When that fails too (no network, or a directory the hub cannot write), `serve` keeps running:

- `/readyz` stays 503 with `"state":"failed"` and the download error;
- each failed load is logged as `embedding failed` at warn, and retried after 30 seconds, doubling to at most 10 minutes;
- snapshots are accepted and are lexically searchable at once; their chunks wait in the archive and are embedded once the model loads;
- search answers lexically and names the semantic branch as unavailable, with the reason.

Nothing needs restarting once the files are reachable; the next retry loads them. To use another model with the image, set `OPENCODE_RECALL_MODELS_DIR=/data/models` so its download lands on the volume, then reindex (below).

## Changing the embedding recipe

The recipe is `OPENCODE_RECALL_EMBEDDING_MODEL`, `_REVISION` (a Hugging Face commit), `_DTYPE`, `_DIMS`, and `_QUERY_PREFIX`, with `OPENCODE_RECALL_CHUNK_CHARS`, `OPENCODE_RECALL_CHUNK_OVERLAP`, and `OPENCODE_RECALL_TURN_CHARS`, or the `embedding` and `chunking` objects in the `OPENCODE_RECALL_CONFIG` file with those fields in camelCase.

A changed recipe takes effect only through a reindex: stop `serve`, run `opencode-recall-hub reindex` against the same data directory, then start `serve`. With Compose, `docker compose stop` followed by `docker compose run --rm hub reindex`. `reindex` refuses to run while `serve` holds the data directory, and `serve` refuses while `reindex` does. It logs the chunk count and an estimated duration, embeds every held session into a new vector space, and activates it and drops the old vectors in one transaction. A reindex that fails or is killed leaves the old space active; the next `serve` or `reindex` reclaims its partial work. A `serve` whose configured recipe differs from the active space logs an error at startup and keeps serving the active space with that space's model.

## Backup

A backup is one file, taken while `serve` runs. `sqlite3` is in the image:

```sh
docker exec recall-hub sqlite3 /data/archive.db ".backup /data/archive-$(date +%Y%m%d).db"
```

`.backup` uses SQLite's online backup API, so the copy is consistent even with uploads in flight. The archive holds everything, tokens included. Take one before every upgrade.

## Restore

1. Stop the hub: `docker stop recall-hub`.
2. Check the backup: `sqlite3 <backup> "PRAGMA integrity_check"` must print `ok`.
3. Replace the archive, deleting its WAL and shared-memory files with it. A WAL left beside a restored database is replayed into it and corrupts it. With the image's own tools:

   ```sh
   docker run --rm -v /srv/recall:/data --entrypoint sh ghcr.io/maxanderson95/opencode-recall-hub:<tag> -c \
     'rm -f /data/archive.db /data/archive.db-wal /data/archive.db-shm && cp /data/<backup> /data/archive.db'
   ```

4. Start the hub and wait for `/readyz`.

The archive is then as it was at the backup. Tokens issued after it no longer work, and hosts holding them pause uploads with `invalid_token` until given a new one; tokens revoked after it work again, so revoke them again. Sessions that changed after the backup are behind the hosts' copies: each host re-uploads them when its plugin next diffs the manifest, at OpenCode startup or when OpenCode's event stream reconnects, and any session with a new turn uploads on that turn. Deletions made after the backup are not replayed; a host only tombstones a deletion it observes.

## Upgrades and a failed migration

`serve` applies pending migrations at startup in one `BEGIN IMMEDIATE` transaction. If any statement fails, the transaction rolls back and the archive keeps its old schema version and every row; `serve` logs `startup failed` with the SQL error and exits 1. `packages/hub/src/main.test.ts` exercises a migration failing partway through and checks exactly that.

Recovery from a failed migration:

1. Run the previous image tag again. The archive is untouched at the version it understands, so it serves as before.
2. Report the logged error; the migration needs a fix in a new release.

A hub never runs against an archive a newer binary migrated: it logs `archive schema version N is newer than this binary supports` and exits 1. So rolling back past a migration that succeeded means restoring the backup taken before the upgrade, and then accepting the restore's consequences above.

## Memory

SPEC §7 budgets about 1 GB: about 280 MB for ONNX Runtime and 115 MB for the vector matrix. The production hub is over it, and ONNX Runtime takes more than that budget allows once it has embedded long inputs (below).

### The `memory` line

`serve` logs `memory` at info once after `vectors loaded`, then every hour until it stops. Each line forces a full garbage collection first. The numbers come from the serving process; the `status` subcommand opens the archive in a process of its own and cannot report them.

```sh
docker logs opencode-recall-hub 2>&1 | grep '"msg":"memory"'
```

| field | meaning |
| --- | --- |
| `rss` | resident bytes, after the collection |
| `jscHeapSize`, `jscHeapCapacity` | bytes of live JS objects and the JS heap's capacity, from `heapStats()` in `bun:jsc`; both include `jscExtraMemory` |
| `jscExtraMemory` | bytes JSC tracks outside its heap, such as array buffers; the matrix is one |
| `jscObjects` | live JS objects |
| `matrixCapacity` | rows the vector matrix has room for |
| `matrixSlots` | slots in use: live rows and removed rows' slots waiting for the next added rows |
| `matrixLive` | live rows, one per embedded chunk of the active space |
| `matrixBytes` | the matrix's allocation, `matrixCapacity` times the dimension times 4 |

`matrixSlots - matrixLive` is the matrix's dead slots. Pages of the matrix never written are not resident, so the matrix's resident share is closer to `matrixSlots` rows than to `matrixBytes`. What `rss` holds beyond `jscHeapCapacity` is native: ONNX Runtime, SQLite, Bun, and allocator pages freed but not returned to the kernel.

### Production, 2026-10-19

v0.1.2 after 25 days of uptime, before the `memory` line existed, read from `/proc/<pid>/status` and `/proc/<pid>/smaps`: `VmRSS` 1,094,028 kB and `VmHWM` 1,366,976 kB. A second reading at 17:38 UTC gave `VmRSS` 1,108,648 kB, `RssAnon` 1,037,556 kB, and `VmHWM` 1,390,644 kB. The archive held 5,007 sessions and 85,257 embedded chunks.

| mappings | size | attribution |
| --- | --- | --- |
| high-address anonymous | about 590 MB | native allocations outside Bun's allocator; mostly ONNX Runtime (inferred) |
| low-address mimalloc arenas | about 329 MB | the JS heap, including the matrix (inferred) |
| glibc `brk` heap | 76 MB | native |
| file-backed | 70 MB | the executable and `libonnxruntime.so.1` |

Replaying the production log through the matrix's growth and compaction rules estimates about 131,000 written slots (about 201 MB), about 43,000 of them removed; that is an estimate, not a reading. Loading the vectors at the restart on 2026-09-24 took 59.4 s (the `vectors loaded` line).

Readings from a build that logs the `memory` line are not yet recorded: the startup line, the first hourly line, and a line at least 24 hours after start.

### Local reproductions

On `oven/bun:1.4.2-debian`, linux/amd64, with the real model: resident memory grew from 218 MB with the model loaded to about 720 MB after embedding batches of 8 sequences of 512 tokens, and held at about 315 MB with ONNX Runtime's CPU memory arena off (`session_options: { enableCpuMemArena: false }`). 130,000 `VectorRow` objects took about 51 MB.

A replay of production uploads against a copy of the 2026-10-19 09:15 backup, in a linux/arm64 container under OrbStack pinned to 4 CPUs, re-sent each upload in the production hub's log with the session cut to the logged message count. It ran an earlier version of the report, so the columns are its fields converted to MB (10^6 bytes); "JS heap" excludes JSC's extra memory. ONNX Runtime ran 15 threads there, one per host core, against 4 in production.

| point | RSS | `VmHWM` | JS heap | JSC extra memory | matrix capacity / live / removed |
| --- | --- | --- | --- | --- | --- |
| model loaded | 356 | 437 | 22 | 214 | 131,072 / 85,257 / 0 |
| after one hybrid search | 391 | 437 | 22 | 214 | 131,072 / 85,257 / 0 |
| after the last 24 hours of uploads (125) | 486 | 540 | 22 | 216 | 131,072 / 85,257 / 12,136 |
| after the first 3,206 uploads since production's last start, 7,400 chunks embedded | 1,247 | 1,623 | 21 | 272 | 170,136 / 85,180 / 4,831 |

The table above measures the build before #54. With #54 the matrix is allocated at the loaded vector count, grows by a quarter during ingest, and gives a removed row's slot to the next added row. The same method and the same earlier report, in MB, run on 2026-10-19 with both builds side by side on separate 4-CPU sets against the same backup, with the production log through 18:30 UTC:

| point | build | RSS | `RssAnon` | `VmHWM` | JSC extra memory | matrix capacity / live / removed |
| --- | --- | --- | --- | --- | --- | --- |
| ready, model loaded | before | 391 | 327 | 439 | 214 | 131,072 / 85,257 / 0 |
| | #54 | 390 | 326 | 391 | 143 | 85,257 / 85,257 / 0 |
| after replaying the last 24 hours of uploads (152 snapshots; 141 more named sessions newer than the backup) | before | 492 | 424 | 569 | 212 | 131,072 / 85,257 / 15,292 |
| | #54 | 430 | 392 | 502 | 142 | 85,257 / 85,257 / 0 |
| about 630 uploads into the replay since production's last start, stopped after 12 minutes | before (628 uploads, 2,126 chunks embedded) | 1,314 | 1,294 | 1,319 | 212 | 131,072 / 84,957 / 29,682 |
| | #54 (636 uploads, 2,085 chunks embedded) | 1,045 | 1,025 | 1,150 | 141 | 85,257 / 84,957 / 300 |

Pages of the matrix that were never written are not resident, so at ready the two builds' RSS is equal and the saving is the peak: the old load grew through the doubling copies. During ingest the old build keeps every removed row's pages resident until a compaction. In the last pair the matrices' written bytes differ by 45 MB (176 MB and 131 MB) while RSS differs by 269 MB; the rest of that gap is native memory, which this report does not attribute, from one sample of each build.

### Causes and the issues that address them

- The matrix's dead slots: before #54, removed rows kept their slots until half the matrix was dead, and capacity doubled on growth. #54 sizes the matrix to its live rows and gives a removed row's slot to the next added row; production readings with it are not yet taken.
- ONNX Runtime's CPU memory arena, which keeps the peak of the longest batches it has embedded. #72.
- Upload parse residue: each snapshot's body and its parsed form, with up to four ingests at once. #71.
