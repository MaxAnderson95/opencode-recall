import { afterEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SCHEMA_VERSION } from "./archive/index.ts"

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
