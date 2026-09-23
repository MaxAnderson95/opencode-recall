import { afterEach, expect, test } from "bun:test"
import type { Snapshot } from "@opencode-recall/protocol"
import { openArchive, type Archive } from "./archive/index.ts"
import { embedInBackground } from "./embed-queue.ts"
import { fakeEmbedder } from "./fake-embedder.ts"
import { createLog } from "./log.ts"

const archives: Archive[] = []
afterEach(() => {
  for (const a of archives.splice(0)) a.close()
})

function setup() {
  const embedder = fakeEmbedder()
  const archive = openArchive(":memory:", embedder)
  archives.push(archive)
  const source = archive.authenticate(archive.issueToken("laptop"))!.id
  const lines: { msg: string; retryInMs?: number; chunks?: number }[] = []
  const log = createLog("debug", (line) => lines.push(JSON.parse(line)))
  return { embedder, archive, source, lines, log }
}

const snapshot = (id: string, text: string): Snapshot => ({
  session: {
    id,
    slug: "s",
    title: "t",
    directory: "/w",
    parentId: null,
    timeCreated: 1,
    timeUpdated: 1,
    messages: [{ id: `${id}_m`, type: "user", timeCreated: 1, parts: [{ kind: "text", text }] }],
  },
  revision: 1,
  lastActivity: 1,
  contentHash: text,
  extractorVersion: 1,
})

const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await Bun.sleep(5)
  expect(done()).toBe(true)
}

test("a kick drains the whole queue, including chunks queued while it runs", async () => {
  const { archive, source, lines, log } = setup()
  for (let i = 0; i < 20; i++) archive.putSnapshot(snapshot(`ses_${i}`, `text ${i}`), source)
  const queue = embedInBackground(archive, log)
  queue.kick()
  archive.putSnapshot(snapshot("ses_late", "late"), source)
  queue.kick()
  await until(() => archive.status().embeddedChunks === 42)
  await queue.stop()
  expect(lines.filter((l) => l.msg === "chunks embedded").reduce((n, l) => n + l.chunks!, 0)).toBe(42)
})

test("a failing embedder is retried on a doubling timer, ignoring kicks meanwhile, until it recovers", async () => {
  const { embedder, archive, source, lines, log } = setup()
  embedder.down = true
  archive.putSnapshot(snapshot("ses_a", "needle"), source)
  const queue = embedInBackground(archive, log, { firstMs: 20, maxMs: 40 })
  queue.kick()
  await until(() => lines.filter((l) => l.msg === "embedding failed").length === 3)
  expect(lines.filter((l) => l.msg === "embedding failed").map((l) => l.retryInMs)).toEqual([20, 40, 40])

  const calls = embedder.calls.length
  queue.kick()
  expect(embedder.calls.length).toBe(calls)

  embedder.down = false
  await until(() => archive.status().embeddedChunks === 2)
  await queue.stop()
})
