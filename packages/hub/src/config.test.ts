import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "./config.ts"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

test("environment variables win over the JSON file, which wins over defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-config-"))
  dirs.push(dir)
  const file = join(dir, "hub.json")
  writeFileSync(file, JSON.stringify({ dataDir: "/from/file", logLevel: "debug" }))

  expect(await loadConfig({ OPENCODE_RECALL_CONFIG: file, OPENCODE_RECALL_DATA_DIR: "/from/env" })).toEqual({
    dataDir: "/from/env",
    listen: "127.0.0.1:7438",
    logLevel: "debug",
  })
})

test("an invalid value is rejected", async () => {
  await expect(loadConfig({ OPENCODE_RECALL_LOG_LEVEL: "loud" })).rejects.toThrow()
})
