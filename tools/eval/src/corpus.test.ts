import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeEmbedder } from "../../../packages/hub/src/fake-embedder.ts"
import { sourceDb } from "../../../packages/plugin/src/fixture.ts"
import { freezeCorpus } from "./corpus.ts"
import type { Label } from "./score.ts"

let tmp: string
let opts: Omit<Parameters<typeof freezeCorpus>[0], "embedder">

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "eval-corpus-"))
  const source = sourceDb()
  source.addSession("ses_a", { time: 100 })
  source.addMessage("ses_a", "user", { text: "how do I deploy the hub?" }, 101)
  source.addMessage("ses_a", "assistant", { content: [{ type: "text", text: "Build the image and run serve." }] }, 102)
  source.db.run("VACUUM INTO ?", [join(tmp, "opencode.db")])
  source.close()
  const labels: Label[] = [{ query: "deploy hub", filters: {}, relevant: ["ses_a"], from_session: "ses_b", time: 200 }]
  await Bun.write(join(tmp, "labels.json"), JSON.stringify(labels))
  opts = {
    dir: join(tmp, "corpus"),
    opencodeDb: join(tmp, "opencode.db"),
    labelsPath: join(tmp, "labels.json"),
    excludeDirectories: [],
  }
})

afterEach(() => rmSync(tmp, { recursive: true, force: true }))

test("an interrupted freeze resumed with another embedding model is not sealed and stays resumable", async () => {
  const original = fakeEmbedder()
  original.down = true
  await expect(freezeCorpus({ ...opts, embedder: original })).rejects.toThrow("unavailable")

  await expect(freezeCorpus({ ...opts, embedder: fakeEmbedder({ revision: "2" }) })).rejects.toThrow("0/2 chunks embedded")
  expect(existsSync(join(opts.dir, "freeze.json"))).toBe(false)
  expect(existsSync(join(opts.dir, "ingested.json"))).toBe(true)

  original.down = false
  await freezeCorpus({ ...opts, embedder: original })
  expect(existsSync(join(opts.dir, "freeze.json"))).toBe(true)
  expect(existsSync(join(opts.dir, "ingested.json"))).toBe(false)
})
