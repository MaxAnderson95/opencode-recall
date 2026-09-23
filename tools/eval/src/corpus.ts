/**
 * A frozen corpus: a hub archive built once from OpenCode's database, the labels it is scored
 * against, and a record of both. Scoring opens the archive through the hub's own Archive module,
 * so the eval measures production retrieval rather than a copy of it.
 *
 * The record pins everything that decides a score: the labels' bytes, every archived session's
 * content hash, the chunk and vector counts, and the vector space recipe. Opening refuses a corpus
 * that no longer matches it, so one corpus scored twice gives identical numbers.
 */
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, unlinkSync } from "node:fs"
import path from "node:path"
import { SCHEMA_VERSION, openArchive, type Archive } from "../../../packages/hub/src/archive/index.ts"
import { onnxEmbedder } from "../../../packages/hub/src/embedder.ts"
import { readPositions, readSnapshot } from "../../../packages/plugin/src/source.ts"
import type { Label } from "./score.ts"

type Ingested = {
  /** Messages created after this are left out: the time of the newest labelled search. */
  cutoff: number
  /** Sessions under these directories are left out, as the host's `index.excludeDirectories` would. */
  excludeDirectories: string[]
  labelsSha256: string
}

type Frozen = Ingested & { fingerprint: string; frozenAt: string }

const files = (dir: string) => ({
  archive: path.join(dir, "archive.db"),
  labels: path.join(dir, "labels.json"),
  record: path.join(dir, "freeze.json"),
  /** Present only between the end of ingest and the end of embedding. */
  ingested: path.join(dir, "ingested.json"),
})

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex")

const fingerprint = (archive: Archive) => sha256(JSON.stringify({ manifest: archive.manifest(), status: archive.status() }))

const under = (roots: string[], directory: string) =>
  roots.some((root) => directory === root || directory.startsWith(root.endsWith("/") ? root : `${root}/`))

/**
 * Build a corpus in `dir` from every session in `opencodeDb` and the labels at `labelsPath`, then
 * embed all of it. Slow: every chunk goes through the model. Rerunning after an interruption
 * during embedding resumes it; any other existing `dir` is refused.
 */
export async function freezeCorpus(opts: {
  dir: string
  opencodeDb: string
  labelsPath: string
  modelDir: string
  excludeDirectories: string[]
}): Promise<void> {
  const f = files(opts.dir)
  if (existsSync(f.record)) throw new Error(`${opts.dir} is already frozen; a frozen corpus is never rebuilt in place`)
  const resuming = existsSync(f.ingested)
  if (existsSync(opts.dir) && !resuming)
    throw new Error(`${opts.dir} exists but was not interrupted after ingest; delete it and freeze again`)

  if (!resuming) {
    const labelBytes = await Bun.file(opts.labelsPath).bytes()
    const labels: Label[] = JSON.parse(new TextDecoder().decode(labelBytes))
    mkdirSync(opts.dir, { recursive: true })
    await Bun.write(f.labels, labelBytes)
    const ingested: Ingested = {
      cutoff: Math.max(...labels.map((l) => l.time)),
      excludeDirectories: opts.excludeDirectories,
      labelsSha256: sha256(labelBytes),
    }
    ingest(f.archive, opts, ingested)
    await Bun.write(f.ingested, JSON.stringify(ingested, null, 2) + "\n")
  }
  const ingested: Ingested = await Bun.file(f.ingested).json()

  const archive = openArchive(f.archive, onnxEmbedder(opts.modelDir))
  try {
    const { chunks, embeddedChunks } = archive.status()
    const started = Date.now()
    let embedded = 0
    for (let n; (n = await archive.embedPending(512)); ) {
      embedded += n
      const rate = embedded / ((Date.now() - started) / 1000)
      process.stdout.write(`\r  embedded ${embeddedChunks + embedded}/${chunks} chunks, ${rate.toFixed(0)}/s   `)
    }
    console.log()
    const record: Frozen = { ...ingested, fingerprint: fingerprint(archive), frozenAt: new Date().toISOString() }
    await Bun.write(f.record, JSON.stringify(record, null, 2) + "\n")
    unlinkSync(f.ingested)
  } finally {
    archive.close()
  }
}

/** Archive every session the cutoff and exclusions keep, leaving their chunks queued for embedding. */
function ingest(path: string, opts: { opencodeDb: string; modelDir: string }, { cutoff, excludeDirectories }: Ingested) {
  const archive = openArchive(path, onnxEmbedder(opts.modelDir))
  const source = new Database(opts.opencodeDb, { readonly: true })
  try {
    const sourceId = archive.authenticate(archive.issueToken("eval"))!.id
    const ids = [...readPositions(source).keys()]
    let archived = 0
    for (const id of ids) {
      const snapshot = readSnapshot(source, id)
      if (!snapshot || snapshot.session.timeCreated > cutoff) continue
      if (under(excludeDirectories, snapshot.session.directory)) continue
      const session = { ...snapshot.session, messages: snapshot.session.messages.filter((m) => m.timeCreated <= cutoff) }
      const contentHash = sha256(JSON.stringify(session))
      archive.putSnapshot({ ...snapshot, session, contentHash, lastActivity: Math.min(snapshot.lastActivity, cutoff) }, sourceId)
      if (++archived % 250 === 0) process.stdout.write(`\r  archived ${archived} sessions`)
    }
    console.log(`\r  archived ${archived} of ${ids.length} sessions`)
  } finally {
    source.close()
    archive.close()
  }
}

/** Open a frozen corpus for scoring. Throws if it has changed since it was frozen. */
export async function openCorpus(dir: string, modelDir: string): Promise<{ archive: Archive; labels: Label[] }> {
  const f = files(dir)
  if (!existsSync(f.record)) throw new Error(`${dir} is not a frozen corpus: run \`bun run freeze\``)
  const record: Frozen = await Bun.file(f.record).json()
  const labelBytes = await Bun.file(f.labels).bytes()
  if (sha256(labelBytes) !== record.labelsSha256) throw new Error(`${f.labels} changed since the corpus was frozen`)

  // Opening migrates, which would rewrite a corpus frozen by another schema before refusing it.
  const peek = new Database(f.archive, { readonly: true })
  const { user_version } = peek.query("PRAGMA user_version").get() as { user_version: number }
  peek.close()
  if (user_version !== SCHEMA_VERSION)
    throw new Error(`corpus was frozen at archive schema ${user_version}, this hub is at ${SCHEMA_VERSION}; freeze a new one`)

  const archive = openArchive(f.archive, onnxEmbedder(modelDir))
  if (fingerprint(archive) !== record.fingerprint) {
    archive.close()
    throw new Error(`${f.archive} no longer matches the corpus frozen at ${record.frozenAt}`)
  }
  return { archive, labels: JSON.parse(new TextDecoder().decode(labelBytes)) }
}
