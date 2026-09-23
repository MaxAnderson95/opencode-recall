/**
 * Wire-level retrieval parity: build a small archive through a real `serve` process of the checkout
 * at <repo> from a sample of an OpenCode database copy, embed it with the real model, and record the
 * ranked sessions and hits of a fixed label sample in every mode. It talks to the hub only through
 * its CLI and HTTP API, and reads sessions with that checkout's own extraction, so two checkouts'
 * outputs compare directly: `cmp <(jq -S .results a.json) <(jq -S .results b.json)`.
 *
 * bun src/parity.ts <repo> <opencode.db copy> <labels.json> <models dir> <work dir> <out.json>
 */
import { Database } from "bun:sqlite"
import { cpSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const [repo, sourcePath, labelsPath, modelsDir, work, out] = process.argv.slice(2) as [string, string, string, string, string, string]
const { readSnapshot } = await import(join(repo, "packages/plugin/src/source.ts"))
const { PROTOCOL_VERSION } = await import(join(repo, "packages/protocol/src/index.ts"))

type Label = { query: string; filters: Record<string, string | undefined>; relevant: string[]; from_session: string; time: number }
const labels: Label[] = await Bun.file(labelsPath).json()
const source = new Database(sourcePath, { readonly: true })

const MAX_MESSAGES = 60
const SESSIONS = 200
const LABELS = 40
const sizes = new Map(
  (source.query("SELECT session_id AS id, count(*) AS n FROM session_message GROUP BY session_id").all() as { id: string; n: number }[]).map(
    (r) => [r.id, r.n],
  ),
)
const small = (id: string) => (sizes.get(id) ?? Infinity) <= MAX_MESSAGES
const chosenLabels = labels.filter((l) => l.relevant.every(small)).slice(0, LABELS)
const sessions = new Set(chosenLabels.flatMap((l) => l.relevant))
for (const l of chosenLabels) if (small(l.from_session)) sessions.add(l.from_session)
const fillers = source
  .query("SELECT id FROM session_v2 ORDER BY time_created DESC")
  .all()
  .map((r) => (r as { id: string }).id)
  .filter(small)
for (const id of fillers) {
  if (sessions.size >= SESSIONS) break
  sessions.add(id)
}

const dataDir = join(work, "hub")
mkdirSync(dataDir, { recursive: true })
cpSync(modelsDir, join(dataDir, "models"), { recursive: true })
const env = { ...process.env, OPENCODE_RECALL_DATA_DIR: dataDir, OPENCODE_RECALL_LISTEN: "127.0.0.1:0", OPENCODE_RECALL_LOG_LEVEL: "info" }
const main = join(repo, "packages/hub/src/main.ts")

const issue = Bun.spawnSync(["bun", main, "token", "issue", "parity"], { env })
if (issue.exitCode !== 0) throw new Error(`token issue failed: ${issue.stderr}`)
const token = issue.stdout.toString().trim()

const hub = Bun.spawn(["bun", main, "serve"], { env, stdout: "pipe", stderr: "inherit" })
const reader = hub.stdout.getReader()
let url = ""
let buffered = ""
while (!url) {
  const { value, done } = await reader.read()
  if (done) throw new Error("hub exited before listening")
  buffered += new TextDecoder().decode(value)
  for (const line of buffered.split("\n")) if (line.includes('"listening"')) url = JSON.parse(line).url
}
void (async () => {
  while (!(await reader.read()).done);
})()

async function call(verb: string, body: object) {
  const res = await fetch(new URL(`v1/${verb}`, url), {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "gzip", authorization: `Bearer ${token}` },
    body: Bun.gzipSync(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...body })),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${verb}: ${JSON.stringify(json)}`)
  return json
}

try {
  let uploaded = 0
  for (const id of sessions) {
    const snapshot = readSnapshot(source, id)
    if (!snapshot) continue
    await call("snapshot", snapshot)
    uploaded++
  }
  const started = Date.now()
  for (;;) {
    const status = await call("status", {})
    process.stderr.write(`\r  ${status.embeddedChunks}/${status.chunks} chunks embedded   `)
    if (status.embeddedChunks === status.chunks) break
    await Bun.sleep(2000)
  }
  process.stderr.write(`\n  embedded in ${Math.round((Date.now() - started) / 1000)}s\n`)
  const status = await call("status", {})

  const results: Record<string, unknown> = {}
  for (const [i, l] of chosenLabels.entries())
    for (const mode of ["lexical", "semantic", "hybrid"]) {
      const { since, until, directory, scope } = l.filters
      const search = {
        query: l.query,
        mode,
        scope: scope === "user-messages" ? "user-messages" : "all",
        ...(since && { since: Date.parse(since) }),
        ...(until && { until: Date.parse(until) + 86_400_000 }),
        ...(directory && { directory }),
        limit: 10,
        exclude: { sessionId: l.from_session, before: 0 },
      }
      const res = await call("search", search)
      results[`${i}:${mode}`] = {
        sessions: res.sessions.map((s: { sessionId: string }) => s.sessionId),
        hits: res.sessions.map((s: { hits: { messageId: string }[] }) => s.hits.map((h) => h.messageId)),
        semanticUnavailable: res.semanticUnavailable ?? null,
      }
    }
  await Bun.write(
    out,
    JSON.stringify({ sessions: uploaded, labels: chosenLabels.length, chunks: status.chunks, results }, null, 1),
  )
  console.log(`sessions=${uploaded} labels=${chosenLabels.length} chunks=${status.chunks} -> ${out}`)
} finally {
  hub.kill("SIGTERM")
  await hub.exited
  source.close()
}
