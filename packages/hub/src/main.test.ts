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
