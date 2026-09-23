import { afterEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { divergenceRemedy, type Snapshot } from "@opencode-recall/protocol"
import { Effect, Option } from "effect"
import { Archive, SCHEMA_VERSION } from "./archive/index.ts"
import { migrations } from "./archive/migrations.ts"
import { fakeLayer } from "./fake-embedder.ts"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

test("serve refuses to start against an archive migrated by a newer binary", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "recall-hub-"))
  dirs.push(dataDir)
  const db = new Database(join(dataDir, "archive.db"), { create: true })
  db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
  db.close()

  const proc = Bun.spawn(["bun", join(import.meta.dir, "main.ts"), "serve"], {
    env: { ...process.env, OPENCODE_RECALL_DATA_DIR: dataDir, OPENCODE_RECALL_LISTEN: "127.0.0.1:0" },
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(await proc.exited).toBe(1)
  const lines = (await new Response(proc.stdout).text()).trim().split("\n").map((l) => JSON.parse(l))
  expect(lines.at(-1)).toMatchObject({ level: "error", msg: "startup failed" })
  expect(lines.at(-1).error).toContain(`archive schema version ${SCHEMA_VERSION + 1} is newer`)
})

test("a migration that fails leaves the archive at its old version with everything it held, and serve exits", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "recall-hub-"))
  dirs.push(dataDir)
  const path = join(dataDir, "archive.db")
  const failing = migrations.findIndex((sql) => sql.includes("CREATE INDEX chunks_session_set_idx"))
  const upgraded = failing - 1
  // An archive holding a token, two migrations behind one whose index already exists: the first
  // pending migration applies, then that one fails, so the failure comes partway through.
  const before = new Database(path, { create: true })
  for (const sql of migrations.slice(0, upgraded)) before.run(sql)
  before.run(`PRAGMA user_version = ${upgraded}`)
  before.run("INSERT INTO sources (id, name, time_created) VALUES (1, 'laptop', 1)")
  before.run("INSERT INTO tokens (source_id, hash, time_created) VALUES (1, x'00', 1)")
  before.run("CREATE INDEX chunks_session_set_idx ON chunks(session_id)")
  before.close()

  const proc = Bun.spawn(["bun", join(import.meta.dir, "main.ts"), "serve"], {
    env: { ...process.env, OPENCODE_RECALL_DATA_DIR: dataDir, OPENCODE_RECALL_LISTEN: "127.0.0.1:0" },
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(await proc.exited).toBe(1)
  const last = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1)!)
  expect(last).toMatchObject({ level: "error", msg: "startup failed" })
  expect(last.error).toContain("already exists")

  const after = new Database(path, { readonly: true })
  expect(after.query("PRAGMA user_version").get()).toEqual({ user_version: upgraded })
  expect(after.query("SELECT count(*) AS n FROM tokens").get()).toEqual({ n: 1 })
  expect(after.query("SELECT name FROM sqlite_master WHERE name = 'divergences'").get()).toBeNull()
  after.close()
})

async function hub(dataDir: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "main.ts"), ...args], {
    env: { ...process.env, OPENCODE_RECALL_DATA_DIR: dataDir },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, stdout: stdout.trim(), stderr: stderr.trim() }
}

test("token issue prints the token once, list shows it by source without its value, and revoke removes it", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "recall-hub-"))
  dirs.push(dataDir)

  const issued = await hub(dataDir, "token", "issue", "laptop")
  expect(issued.code).toBe(0)
  expect(issued.stdout).toMatch(/^opencode-recall_[A-Za-z0-9_-]{43}$/)
  expect((await hub(dataDir, "token", "issue", "laptop")).code).toBe(0)

  const listed = await hub(dataDir, "token", "list")
  expect(listed.code).toBe(0)
  const rows = listed.stdout.split("\n").slice(1).map((l) => l.split("\t"))
  expect(rows.map(([id, source]) => [id, source])).toEqual([
    ["1", "laptop"],
    ["2", "laptop"],
  ])
  expect(listed.stdout).not.toContain(issued.stdout.slice("opencode-recall_".length, 24))

  expect((await hub(dataDir, "token", "revoke", "1")).code).toBe(0)
  expect((await hub(dataDir, "token", "list")).stdout.split("\n").slice(1).map((l) => l.split("\t")[0])).toEqual(["2"])
  expect((await hub(dataDir, "token", "revoke", "1")).code).toBe(1)
  expect((await hub(dataDir, "token", "bogus")).code).toBe(2)
})

test("reindex exits with a clear error while serve runs, and runs once serve has stopped", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "recall-hub-"))
  dirs.push(dataDir)
  const serve = Bun.spawn(["bun", join(import.meta.dir, "main.ts"), "serve"], {
    env: { ...process.env, OPENCODE_RECALL_DATA_DIR: dataDir, OPENCODE_RECALL_LISTEN: "127.0.0.1:0" },
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const reader = serve.stdout.getReader()
    for (let out = ""; !out.includes('"msg":"listening"'); ) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`serve exited before listening: ${out}`)
      out += new TextDecoder().decode(value)
    }
    const refused = await hub(dataDir, "reindex")
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain(`${dataDir} is held by another opencode-recall-hub process (serve or reindex); stop it first`)
  } finally {
    serve.kill("SIGTERM")
    await serve.exited
  }

  const ran = await hub(dataDir, "reindex")
  expect(ran.code).toBe(0)
  expect(ran.stdout).toContain("nothing to reindex")
  expect((await hub(dataDir, "reindex", "extra")).code).toBe(2)
})

test("status prints the hub's view, naming a divergent session with its remedy", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "recall-hub-"))
  dirs.push(dataDir)
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const archive = yield* Archive.make(join(dataDir, "archive.db"))
        const sourceId = (name: string) =>
          Effect.map(Effect.flatMap(archive.issueToken(name), archive.authenticate), (s) => Option.getOrThrow(s).id)
        const snapshot = (contentHash: string): Snapshot => ({
          session: { id: "ses_a", slug: "s", title: "Shared work", directory: "/w", parentId: null, timeCreated: 1, timeUpdated: 2, messages: [] },
          revision: 1,
          lastActivity: 2,
          contentHash,
          extractorVersion: 1,
        })
        yield* archive.putSnapshot(snapshot("one"), yield* sourceId("laptop"))
        yield* archive.putSnapshot(snapshot("two"), yield* sourceId("desktop"))
      }),
    ).pipe(Effect.provide(fakeLayer())),
  )

  const status = await hub(dataDir, "status")
  expect(status.code).toBe(0)
  expect(status.stdout).toContain("sessions archived: 1\n  from laptop: 1 archived, 0 searchable, 0 embedded")
  expect(status.stdout).toContain('hash_divergence: 1 session where two hosts hold different copies\n  ses_a "Shared work": archived copy from laptop; desktop\'s copy refused')
  expect(status.stdout).toContain(`remedy: ${divergenceRemedy({ heldFrom: "laptop", refusedFrom: "desktop" })}`)
  expect((await hub(dataDir, "status", "extra")).code).toBe(2)
})
