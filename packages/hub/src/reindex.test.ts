import { afterEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { Archive } from "./archive/index.ts"
import { HubConfig } from "./config.ts"
import { Embedder } from "./embedder.ts"
import { fakeEmbedder, fakeLayer } from "./fake-embedder.ts"
import { Log } from "./log.ts"
import { Reindex } from "./reindex.ts"
import { Hub } from "./serve.ts"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

type Line = { level: string; msg: string } & Record<string, unknown>

const settings = (dataDir: string, chunkChars = 1_200): HubConfig.Settings => ({
  ...HubConfig.DEFAULTS,
  dataDir,
  listen: "127.0.0.1:0",
  chunking: { ...HubConfig.DEFAULTS.chunking, chunkChars, chunkOverlap: Math.min(200, chunkChars - 1) },
})

/** A data directory whose archive holds three embedded sessions in a space of the default chunking. */
async function seeded() {
  const dataDir = mkdtempSync(join(tmpdir(), "recall-reindex-"))
  dirs.push(dataDir)
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const archive = yield* Archive.make(join(dataDir, "archive.db"))
        const { id } = Option.getOrThrow(yield* archive.authenticate(yield* archive.issueToken("laptop")))
        for (const n of [1, 2, 3])
          yield* archive.putSnapshot(
            {
              session: {
                id: `ses_${n}`,
                slug: "s",
                title: "t",
                directory: "/w",
                parentId: null,
                timeCreated: 1,
                timeUpdated: 2,
                messages: [
                  { id: `msg_${n}_u`, type: "user", timeCreated: 10, parts: [{ kind: "text", text: `how is deployment ${n} going` }] },
                  { id: `msg_${n}_a`, type: "assistant", timeCreated: 11, parts: [{ kind: "text", text: "the rollout finished cleanly" }] },
                ],
              },
              revision: 2,
              lastActivity: 11,
              contentHash: `h${n}`,
              extractorVersion: 1,
            },
            id,
          )
        while (yield* archive.embedPending(32));
      }),
    ).pipe(Effect.provide(fakeLayer())),
  )
  return dataDir
}

const reindex = (config: HubConfig.Settings, embedder: Embedder.Interface, lines: Line[]) =>
  Effect.runPromise(
    Reindex.run([]).pipe(
      Effect.provide(Reindex.layer(fakeLayer(embedder)).pipe(Layer.provide(Layer.succeed(HubConfig.Service, config)))),
      Effect.provide(Log.layer("debug", (line) => lines.push(JSON.parse(line)))),
    ),
  )

/** Every vector space's activity and chunk size, and every stored vector's count. */
function spaces(dataDir: string) {
  const db = new Database(join(dataDir, "archive.db"), { readonly: true })
  const rows = db.query("SELECT active, json_extract(recipe, '$.chunkChars') AS chunkChars FROM vector_spaces ORDER BY id").all()
  const { n: vectors } = db.query("SELECT count(*) AS n FROM vectors").get() as { n: number }
  db.close()
  return { spaces: rows, vectors }
}

/** `serve` in-process on `config`, logging into `lines`. */
async function serve(config: HubConfig.Settings, lines: Line[] = []) {
  const runtime = ManagedRuntime.make(
    Hub.layer(fakeLayer()).pipe(
      Layer.provide(Layer.succeed(HubConfig.Service, config)),
      Layer.provide(Log.layer("debug", (line) => lines.push(JSON.parse(line)))),
    ),
  )
  await runtime.runPromise(Hub.Listening)
  return runtime
}

test("reindex reports the chunk count and an estimate first, then activates the new space and drops the old vectors", async () => {
  const dataDir = await seeded()
  const lines: Line[] = []
  expect(await reindex(settings(dataDir, 20), fakeEmbedder(), lines)).toBe(0)

  const starting = lines.find((l) => l.msg === "reindex starting")!
  const chunks = starting.chunks as number
  expect(chunks).toBeGreaterThan(6)
  expect(starting.estimatedSeconds).toBe(Math.ceil(chunks / 45))
  expect(lines.findIndex((l) => l.msg === "reindex starting")).toBeLessThan(
    lines.findIndex((l) => l.msg === "reindex complete; the new vector space is active"),
  )
  expect(spaces(dataDir)).toEqual({ spaces: [{ active: 1, chunkChars: 20 }], vectors: chunks })

  const again: Line[] = []
  expect(await reindex(settings(dataDir, 20), fakeEmbedder(), again)).toBe(0)
  expect(again.map((l) => l.msg)).toEqual(["the active vector space already has the configured recipe; nothing to reindex"])
})

test("a reindex that stops midway leaves the old space serving, and the next start reclaims its work", async () => {
  const dataDir = await seeded()
  const fake = fakeEmbedder()
  let calls = 0
  const failing: Embedder.Interface = {
    model: fake.model,
    embed: (texts) => {
      fake.down = ++calls > 1
      return fake.embed(texts)
    },
  }
  const lines: Line[] = []
  await expect(reindex(settings(dataDir, 20), failing, lines)).rejects.toThrow("embedding model unavailable")
  expect(lines.at(-1)).toMatchObject({ level: "error", msg: "reindex failed; the active vector space is unchanged" })
  expect(spaces(dataDir).spaces).toEqual([
    { active: 1, chunkChars: 1200 },
    { active: 0, chunkChars: 20 },
  ])

  const served: Line[] = []
  const runtime = await serve(settings(dataDir), served)
  try {
    expect(served.find((l) => l.msg === "reclaimed an interrupted reindex")?.chunks).toBeGreaterThan(6)
    expect(spaces(dataDir)).toEqual({ spaces: [{ active: 1, chunkChars: 1200 }], vectors: 6 })
    const { sessions } = await runtime.runPromise(
      Effect.flatMap(Archive.Service, (archive) => archive.search({ query: "deploying", limit: 8, mode: "semantic" }, 0)),
    )
    expect(sessions.map((s) => s.sessionId).sort()).toEqual(["ses_1", "ses_2", "ses_3"])
  } finally {
    await runtime.dispose()
  }
})

test("serve with a mismatched configured recipe logs the mismatch and serves the existing space without re-embedding", async () => {
  const dataDir = await seeded()
  const lines: Line[] = []
  const runtime = await serve(settings(dataDir, 20), lines)
  try {
    expect(lines.find((l) => l.level === "error")).toMatchObject({
      msg: expect.stringContaining("the configured vector space differs from the active one"),
      active: { chunkChars: 1200 },
      configured: { chunkChars: 20 },
    })
    const { sessions, semanticUnavailable } = await runtime.runPromise(
      Effect.flatMap(Archive.Service, (archive) => archive.search({ query: "deploying", limit: 8, mode: "semantic" }, 0)),
    )
    expect(semanticUnavailable).toBeUndefined()
    expect(sessions).toHaveLength(3)
    expect(spaces(dataDir)).toEqual({ spaces: [{ active: 1, chunkChars: 1200 }], vectors: 6 })
  } finally {
    await runtime.dispose()
  }
})

test("reindex is refused while serve holds the data directory, and serve while reindex does", async () => {
  const dataDir = await seeded()
  const runtime = await serve(settings(dataDir))
  try {
    await expect(reindex(settings(dataDir, 20), fakeEmbedder(), [])).rejects.toThrow(
      "is held by another opencode-recall-hub process (serve or reindex); stop it first",
    )
    expect(spaces(dataDir).spaces).toHaveLength(1)
  } finally {
    await runtime.dispose()
  }
  const held = ManagedRuntime.make(Reindex.layer(fakeLayer()).pipe(Layer.provide(Layer.succeed(HubConfig.Service, settings(dataDir)))))
  await held.runPromise(Effect.void)
  try {
    await expect(serve(settings(dataDir))).rejects.toThrow("is held by another")
  } finally {
    await held.dispose()
  }
})
