# opencode-recall

> [!WARNING]
> This project is a work in progress. It is still being built and is not ready for use.

Shared conversation memory for OpenCode across multiple machines. A central recall service holds an archive of every OpenCode session from every host; a thin OpenCode plugin on each host uploads finished sessions and exposes `recall_*` tools that query the service.

This project replaces the single-machine recall plugin in `my-opencode-setup/plugins/recall`.

## Development

The repo is a Bun workspace: `packages/protocol` holds the wire schemas and typed client, `packages/hub` the hub service, and `packages/plugin` the OpenCode plugin.

```sh
bun install
bun test
bun run typecheck
```

Run the hub with `bun packages/hub/src/main.ts serve`. It reads `OPENCODE_RECALL_DATA_DIR` (default `./data`), `OPENCODE_RECALL_LISTEN` (default `127.0.0.1:7438`), `OPENCODE_RECALL_LOG_LEVEL` (default `info`), and `OPENCODE_RECALL_CONFIG`, an optional JSON file with the same keys (`dataDir`, `listen`, `logLevel`) that the environment overrides.

The hub embeds chunks with `bge-small-en-v1.5` (q8 ONNX, in-process), reading the model from `OPENCODE_RECALL_MODELS_DIR` (default `<dataDir>/models`) or downloading it there from Hugging Face (about 33 MB); `serve` loads it at startup. Until the model loads, search runs lexically and says so, and unembedded chunks wait in the archive and are retried with backoff, including after a restart. `GET /healthz` and `GET /readyz` need no token; `/readyz` answers 503 until the model is loaded.

In production the hub runs as the container image built from `Dockerfile`, or as the Linux executable `bun packages/hub/build.ts` compiles. Running it, backups, restores, and failed migrations are covered in `docs/operations.md`.

The embedding recipe is configurable: `OPENCODE_RECALL_EMBEDDING_MODEL`, `_REVISION` (a Hugging Face commit), `_DTYPE`, `_DIMS`, and `_QUERY_PREFIX`, and `OPENCODE_RECALL_CHUNK_CHARS`, `OPENCODE_RECALL_CHUNK_OVERLAP`, and `OPENCODE_RECALL_TURN_CHARS`, or the `embedding` and `chunking` objects in the JSON file with those fields in camelCase. A changed recipe takes effect only through a reindex: stop `serve`, run `bun packages/hub/src/main.ts reindex`, start `serve`. `reindex` refuses to run while `serve` holds the data directory (and `serve` refuses while `reindex` does), logs the chunk count and an estimated duration, embeds every held session into a new vector space, and activates it and drops the old vectors in one transaction. A reindex that fails or is killed leaves the old space active; the next `serve` or `reindex` reclaims its partial work. A `serve` whose configured recipe differs from the active space logs an error at startup and keeps serving the active space with that space's model.

Every hub request needs a bearer token, which identifies the source (host) its uploads are attributed to. `bun packages/hub/src/main.ts token issue <source>` prints a new token once; `token list` shows token ids by source; `token revoke <id>` makes that token fail on the next request. A source can hold several tokens, so rotating one (issue, update the host, revoke the old id) keeps its identity.

The plugin loads from the `packages/plugin` directory. It uploads a session two seconds after its last turn ends, rename, or move, so a burst of subagent turns produces one upload, reading OpenCode's database from `OPENCODE_RECALL_SOURCE_DB` or `$XDG_DATA_HOME/opencode/opencode.db`. Pending uploads are kept in OpenCode's plugin storage and survive a restart; a rate-limited or timed-out upload is retried every 30 seconds, and one the hub rejects outright (stale, divergent, or over the 64 MB cap) is dropped. The hub address and token come from `OPENCODE_RECALL_HUB_URL` and `OPENCODE_RECALL_TOKEN`, or from `hub.url` and `hub.token` in `~/.config/opencode/recall.json`; the environment wins. A missing config, a rejected token, or a protocol version mismatch pauses uploads with the work kept; the plugin re-reads the config file and probes the hub every 30 seconds, and resumes once the hub accepts it.

`bun packages/hub/src/main.ts status` prints what the archive holds: sessions per source (archived, searchable, embedded), the embedding backlog, the vector space, cached summaries, recent rewinds, and every session in `hash_divergence`, where two hosts hold different copies at the same position. For each divergent session it prints the remedy: rename the session on the host whose copy should be kept, which makes that host's next upload later than the held position so it is accepted; the divergence clears when any copy of the session is next accepted or the session is deleted. `recall_status` prints the same hub view under a separate host section: hub reachability, upload queue, backfill progress, last error, and where the hub config came from.

The plugin adds the recall instructions (the tool ladder, how results name their origin host and archived revision, the `source` filter, and that "could not look" is not "nothing found") to the system prompt of every agent request.

`recall_summarize` generates with this host's own OpenCode model credentials and caches each summary in the hub, where any host can reuse it until the session changes. Its default model is `OPENCODE_RECALL_SUMMARY_MODEL` (`provider/model` or `provider/model/variant`), else `summary.model` in `recall.json` (`{ "providerID": ..., "modelID": ..., "variant": ... }`), else `openai/gpt-5.6-luna` at `low`.

Planning happens on the Wayfinder map in this repo's issues (label `wayfinder:map`).
