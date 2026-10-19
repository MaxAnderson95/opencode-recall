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

The budget is about 1 GB (SPEC §7). The production hub is over it.

### Taking a memory report

`serve` logs one `memory` line at `point: "ready"` once the embedding model has loaded, and one at `point: "signal"` each time it receives SIGUSR2. The numbers come from the serving process itself; the `status` subcommand opens the archive directly and cannot see them. Each report forces a full garbage collection first.

```sh
docker kill --signal USR2 recall-hub
docker logs recall-hub 2>&1 | grep '"msg":"memory"' | tail -1
```

| field | meaning |
| --- | --- |
| `rssMB`, `gcRssMB` | resident memory before and after the forced GC |
| `anonMB`, `fileMB`, `hwmMB` | `RssAnon`, `RssFile`, and the peak `VmHWM` from `/proc/self/status` (Linux only) |
| `heapMB`, `heapCapacityMB` | the JS heap's live objects and capacity after the GC, excluding the next row |
| `externalMB` | memory JSC tracks outside its heap: array buffers, the vector matrix among them |
| `matrix.capacity`, `.live`, `.removed` | rows the vector matrix has room for, rows it holds, and removed rows still occupying slots until its next compaction |
| `matrix.allocatedMB`, `.writtenMB` | the matrix's allocation, and the bytes of the rows written to it so far |

Every `MB` is 10^6 bytes; `/proc` reports its kB fields in 1,024-byte units, which the report converts. Resident memory beyond the JS heap and the matrix is native: ONNX Runtime, SQLite, Bun, and allocator pages freed but not returned to the kernel.

### Production host

GUHQPMAXDEVBOX01 (4 CPUs, 7.4 GiB of memory) running v0.1.2, which predates the `memory` report, read from `/proc` on 2026-10-19 after 25 days of uptime. The archive held 5,007 sessions and 85,257 chunks, all embedded, in a 1.95 GB `archive.db`.

| | |
| --- | --- |
| `VmRSS` | 1,135 MB |
| `RssAnon` | 1,062 MB |
| `RssFile` | 73 MB |
| `VmHWM` | 1,424 MB |

The largest mappings in `/proc/<pid>/smaps`: one anonymous mapping of 983,548 KiB (1,007 MB) with 530 MB resident; two 1 GiB anonymous reservations with 254 MB and 199 MB resident; the `[heap]` segment at 80 MB; the executable and `libonnxruntime.so.1` at 44 MB and 25 MB, file-backed. The 983,548 KiB mapping is within one 4 KiB page of the size of a vector matrix with room for 655,696 rows of 384 dimensions, more than seven times the 85,257 live vectors. That attribution is inferred from the size alone; the `matrix` fields of a report from a deployed build will confirm or refute it.

### Local run on a copy of the production archive

A build of this tree in a linux/arm64 container under OrbStack on an M5 Pro, pinned to 4 CPUs, against a copy of the production archive's 2026-10-19 backup. The replays re-sent each upload in the production hub's log, each session truncated to the message count the log recorded, at a later position than the one held.

| point | `rssMB` | `anonMB` | `hwmMB` | `heapMB` | `externalMB` | matrix capacity / live / removed |
| --- | --- | --- | --- | --- | --- | --- |
| ready, model loaded | 356 | 294 | 437 | 22 | 214 | 131,072 / 85,257 / 0 |
| after the first hybrid search | 391 | 328 | 437 | 22 | 214 | 131,072 / 85,257 / 0 |
| after replaying the last 24 hours of uploads (125 snapshots) | 486 | 419 | 540 | 22 | 216 | 131,072 / 85,257 / 12,136 |
| after replaying the first 3,206 uploads since production's last start (its log through 2026-10-02), 7,400 chunks embedded | 1,247 | 1,222 | 1,623 | 21 | 272 | 170,136 / 85,180 / 4,831 |

The JS heap stays near 22 MB throughout. At the last point the matrix accounts for at most its 261 MB allocation, so at least 920 MB of anonymous memory is native and grew with ingest. ONNX Runtime ran one thread per host core in the container (15, not 4; it logged failed affinity calls), so native figures on the 4-CPU production host may differ.

### Causes and the issues that address them

- The vector matrix holds more than its live rows: capacity doubles on growth and removed rows keep their slots until a compaction. Locally 201 MB was allocated for 131 MB of live vectors; in production, the mapping above. #54.
- Native memory grows with ingest while the JS heap does not: from 328 MB to 1,222 MB anonymous over 3,206 uploads. Candidates are each upload's body and parse buffers, up to four ingests at once, and the startup and migration reads (#71), ONNX Runtime's CPU memory arena and thread count (#72), and the full snapshots the plugin builds and sends (#62, #63). The report does not split native memory further.
- Transcript and expand reads of whole columns (#59) were not exercised by the replays, which sent no `expand` or `transcript` requests.
