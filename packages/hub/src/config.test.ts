import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigProvider, Effect } from "effect"
import { HubConfig } from "./config.ts"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const load = (env: Record<string, string>) =>
  Effect.runPromise(HubConfig.load.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))))

test("environment variables win over the JSON file, which wins over defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-config-"))
  dirs.push(dir)
  const file = join(dir, "hub.json")
  writeFileSync(file, JSON.stringify({ dataDir: "/from/file", logLevel: "debug" }))

  expect(await load({ OPENCODE_RECALL_CONFIG: file, OPENCODE_RECALL_DATA_DIR: "/from/env" })).toEqual({
    ...HubConfig.DEFAULTS,
    dataDir: "/from/env",
    logLevel: "debug",
  })
  expect(await load({ OPENCODE_RECALL_MODELS_DIR: "/opt/models" })).toEqual({ ...HubConfig.DEFAULTS, modelsDir: "/opt/models" })
})

test("the embedding recipe merges field by field, the environment over the file over the defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-config-"))
  dirs.push(dir)
  const file = join(dir, "hub.json")
  writeFileSync(file, JSON.stringify({ embedding: { model: "org/other", dims: 768 }, chunking: { chunkChars: 800 } }))

  const settings = await load({ OPENCODE_RECALL_CONFIG: file, OPENCODE_RECALL_EMBEDDING_DIMS: "512", OPENCODE_RECALL_CHUNK_OVERLAP: "100" })
  expect(settings.embedding).toEqual({ ...HubConfig.DEFAULTS.embedding, model: "org/other", dims: 512 })
  expect(settings.chunking).toEqual({ chunkChars: 800, chunkOverlap: 100, turnChars: 60_000 })
})

test("an invalid value is rejected", async () => {
  await expect(load({ OPENCODE_RECALL_LOG_LEVEL: "loud" })).rejects.toThrow()
  await expect(load({ OPENCODE_RECALL_EMBEDDING_DTYPE: "auto" })).rejects.toThrow()
  // A branch or tag can move to other weights under an unchanged recipe.
  for (const revision of ["main", "v1.0", "ea104dac"])
    await expect(load({ OPENCODE_RECALL_EMBEDDING_REVISION: revision })).rejects.toThrow("full 40-character commit hash")
  await expect(load({ OPENCODE_RECALL_CHUNK_OVERLAP: "1200" })).rejects.toThrow("chunkChars")
})

test("an unknown key in the JSON file is rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-config-"))
  dirs.push(dir)
  const file = join(dir, "hub.json")
  writeFileSync(file, JSON.stringify({ dataDir: "/from/file", port: 1 }))
  await expect(load({ OPENCODE_RECALL_CONFIG: file })).rejects.toThrow()
})
