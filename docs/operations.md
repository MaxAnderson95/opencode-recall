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

The budget is about 1 GB (SPEC §7). It has been measured once, not on the production Linux host: in a linux/arm64 container under OrbStack on an M5 Pro, limited with `--memory 1g`, against a synthetic archive at the measured production scale (4,200 sessions, 75,600 chunks with 384-dimension vectors under the real recipe, a 1.05 GB `archive.db`) and the real model. The load was 400 hybrid searches, four at a time, while 40 twelve-message snapshots were ingested and embedded.

| point | hub process RSS |
| --- | --- |
| ready, model loaded, no search yet | 207 MB |
| peak during the load (`VmHWM`) | 661 MB |
| after the load | 525 MB |

The container's page cache filled the rest of the 1 GiB limit and was reclaimed as needed; the kernel recorded no OOM event. Re-measure on the production host before treating these as its budget.
