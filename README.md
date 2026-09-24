# opencode-recall

**One searchable memory of every OpenCode conversation, shared by every machine you use.**

opencode-recall gives OpenCode's agents a long-term memory. A small hub service keeps an archive of your sessions, and a plugin on each machine uploads its sessions to the hub and gives the agent five `recall_*` tools to search them. Ask about "the migration we did last week" on your laptop and the agent can find the session you ran on your dev box.

## How it works

The **hub** is one Linux container. It holds a SQLite archive of every session from every host, indexes the text for keyword search, and embeds it with a small local model (`bge-small-en-v1.5`, bundled in the image) for semantic search. Nothing leaves the hub for embedding.

The **plugin** runs inside each OpenCode server. Two seconds after a turn finishes, it uploads that session to the hub. On first start it backfills your existing history, newest sessions first, at about two sessions a second. Uploads that fail are kept and retried, including across restarts.

The agent gets these tools, and instructions for using them are added to its system prompt:

| Tool | What it does |
| --- | --- |
| `recall_search` | Hybrid keyword and semantic search across every host's sessions, filterable by directory, date, and host |
| `recall_inspect` | Searches inside one session, or outlines its user turns |
| `recall_expand` | Reads the transcript around a message |
| `recall_summarize` | Summarizes whole sessions with a cheap model from your own OpenCode providers; the hub caches summaries for every host |
| `recall_status` | Shows hub reachability, upload queue, backfill progress, and what the archive holds |

Every result names the host its session came from, so you can tell your laptop's history from your server's.

## Requirements

- OpenCode 2.0.14 or newer on every host.
- A Linux machine with Docker to run the hub, reachable from every host. The image is published for amd64 and arm64.
- About 1 GB of memory for the hub, and disk for the archive, about 1.5 GB for 4,500 sessions.

The hub speaks plain HTTP with bearer tokens. Run it on a private network, a Tailscale tailnet, or behind a TLS reverse proxy (see [HTTPS with a pinned certificate](#https-with-a-pinned-certificate)). Never expose it to the internet.

## Install the hub

Create a directory for the hub and its data, and a `compose.yaml` in it:

```yaml
services:
  hub:
    image: ghcr.io/maxanderson95/opencode-recall-hub:v0.1.1
    container_name: opencode-recall-hub
    restart: unless-stopped
    user: "1000:1000"
    ports:
      - "7438:7438"
    volumes:
      - ./data:/data
```

The `data` directory must be writable by the `user` you run the container as. Start it and check that it is ready:

```sh
mkdir data
docker compose up -d
curl http://localhost:7438/readyz
```

`/readyz` answers `{"ready":true,...}` once the embedding model has loaded, usually within a few seconds. With Docker enabled at boot, `restart: unless-stopped` brings the hub back after a reboot.

A Linux binary is also attached to each [release](https://github.com/MaxAnderson95/opencode-recall/releases) if you would rather not use Docker. See [docs/operations.md](docs/operations.md).

### HTTPS with a pinned certificate

To encrypt traffic without a certificate authority, put a TLS proxy with a long-lived self-signed certificate in front of the hub and pin that certificate on every host. The plugin then trusts exactly that certificate, so no one else's certificate is accepted in its place and there is nothing to renew.

Generate a ten-year certificate beside `compose.yaml` and print its fingerprint:

```sh
mkdir tls
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 3650 \
  -subj "/CN=recall-hub" -addext "subjectAltName=DNS:recall-hub.example" \
  -keyout tls/hub.key -out tls/hub.crt
openssl x509 -in tls/hub.crt -noout -fingerprint -sha256
```

Then serve the hub only through [Caddy](https://caddyserver.com):

```yaml
services:
  hub:
    image: ghcr.io/maxanderson95/opencode-recall-hub:v0.1.1
    container_name: opencode-recall-hub
    restart: unless-stopped
    user: "1000:1000"
    volumes:
      - ./data:/data
  tls:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "7438:7438"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./tls:/tls:ro
```

with this `Caddyfile`:

```
{
	auto_https off
}

:7438 {
	tls /tls/hub.crt /tls/hub.key
	reverse_proxy hub:7438
}
```

On each host, use `https://` in `hub.url` and set `hub.certSha256` to the fingerprint. Admin commands still run in the `opencode-recall-hub` container.

## Connect a host

Issue one token per host. The name you give it is how that host's sessions are labeled in results:

```sh
docker exec opencode-recall-hub opencode-recall-hub token issue laptop
```

The token is printed once. Put it and the hub's address in `~/.config/opencode/recall.json` on that host:

```json
{
  "hub": {
    "url": "http://recall-hub.example:7438",
    "token": "<the token>"
  }
}
```

Then install the plugin and restart OpenCode:

```sh
opencode plugin add github:MaxAnderson95/opencode-recall#plugin
```

The `plugin` branch always holds the latest release. Ask the agent to run `recall_status` to confirm the host reached the hub and to watch the backfill.

If you used the older single-machine recall plugin, remove it from your OpenCode config first. Both register the same tool names, and only one of them can win.

## Configuration

### Plugin

The plugin reads `~/.config/opencode/recall.json` (under `$XDG_CONFIG_HOME` when set). It reads the file fresh each time it needs a value, so edits take effect without a restart. Environment variables override the file.

| `recall.json` | Environment | Purpose |
| --- | --- | --- |
| `hub.url` | `OPENCODE_RECALL_HUB_URL` | Hub address |
| `hub.token` | `OPENCODE_RECALL_TOKEN` | This host's token |
| `hub.certSha256` | `OPENCODE_RECALL_HUB_CERT_SHA256` | SHA-256 fingerprint of the hub's TLS certificate, hex with or without colons. With it set, an `https` hub must present exactly that certificate. Requires an `https` URL. |
| `summary.model` | `OPENCODE_RECALL_SUMMARY_MODEL` | Model `recall_summarize` uses when a call names none, default `openai/gpt-5.6-luna` at `low`. In the file, `{ "providerID": ..., "modelID": ..., "variant": ... }`; in the environment, `provider/model` or `provider/model/variant`. |
| `index.excludeDirectories` | | Absolute or `~/` paths whose sessions never leave this host. Adding a directory also deletes its sessions from the hub. |
| | `OPENCODE_RECALL_SOURCE_DB` | OpenCode's database, default `$XDG_DATA_HOME/opencode/opencode.db` |

With no hub configured, a rejected token, or a hub running a different protocol version, the plugin pauses uploads and keeps them queued until the hub accepts it.

### Hub

The hub reads `OPENCODE_RECALL_*` environment variables, or the JSON file named by `OPENCODE_RECALL_CONFIG`; the environment wins. The image's defaults suit most setups.

| Environment | Default | Purpose |
| --- | --- | --- |
| `OPENCODE_RECALL_DATA_DIR` | `/data` in the image | Holds `archive.db` |
| `OPENCODE_RECALL_LISTEN` | `0.0.0.0:7438` in the image | Listen address |
| `OPENCODE_RECALL_LOG_LEVEL` | `info` | Log level for the JSON logs on stdout |
| `OPENCODE_RECALL_MODELS_DIR` | bundled model in the image | Where embedding models are read from or downloaded to |

The embedding model and chunking are configurable too; changing them requires a reindex. Both are covered in [docs/operations.md](docs/operations.md).

## Managing the hub

Every admin command runs inside the container:

```sh
docker exec opencode-recall-hub opencode-recall-hub status             # sessions per host, embedding backlog, divergent sessions
docker exec opencode-recall-hub opencode-recall-hub token list         # token ids by host
docker exec opencode-recall-hub opencode-recall-hub token revoke <id>  # stops working on the next request
```

A host can hold several tokens, so to rotate one, issue a new token under the same name, update the host's `recall.json`, then revoke the old id.

Backups, restores, upgrades, and reindexing are in [docs/operations.md](docs/operations.md).

## Development

The repo is a Bun workspace: `packages/protocol` holds the wire schemas and typed client, `packages/hub` the hub, and `packages/plugin` the plugin.

```sh
bun install
bun test
bun run typecheck
bun packages/hub/src/main.ts serve
```

The design is in [docs/SPEC.md](docs/SPEC.md) and decisions are in [docs/adr](docs/adr). Pushing a `v*` tag builds and tests the images, publishes them to GHCR, pushes the bundled plugin to the `plugin` branch, and creates the GitHub release with the Linux binaries.
