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

The plugin loads from the `packages/plugin` directory. It uploads a session to `OPENCODE_RECALL_HUB_URL` whenever one of its turns ends, reading OpenCode's database from `OPENCODE_RECALL_SOURCE_DB` or `$XDG_DATA_HOME/opencode/opencode.db`.

Planning happens on the Wayfinder map in this repo's issues (label `wayfinder:map`).
