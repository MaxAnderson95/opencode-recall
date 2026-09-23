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
import { Effect, Option, Schema } from "effect"
import { Archive, SCHEMA_VERSION } from "../../../packages/hub/src/archive/index.ts"
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

/** A corpus that must not be frozen or scored as it stands; `message` says why and what to do. */
export class Refused extends Schema.TaggedError<Refused>()("Corpus.Refused", { message: Schema.String }) {}

const files = (dir: string) => ({
  archive: path.join(dir, "archive.db"),
  labels: path.join(dir, "labels.json"),
  record: path.join(dir, "freeze.json"),
  /** Present only between the end of ingest and the end of embedding. */
  ingested: path.join(dir, "ingested.json"),
})

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex")

const fingerprint = (archive: Archive.Interface) =>
  Effect.all({ manifest: archive.manifest(0), status: archive.status() }).pipe(Effect.map((state) => sha256(JSON.stringify(state))))

const under = (roots: string[], directory: string) =>
  roots.some((root) => directory === root || directory.startsWith(root.endsWith("/") ? root : `${root}/`))

const readBytes = (file: string) => Effect.promise(() => Bun.file(file).bytes())
const readJson = <A>(file: string) => Effect.promise((): Promise<A> => Bun.file(file).json())
const write = (file: string, data: string | Uint8Array) => Effect.promise(() => Bun.write(file, data))

/**
 * Build a corpus in `dir` from every session in `opencodeDb` and the labels at `labelsPath`, then
 * embed all of it with the provided embedder. Slow: every chunk goes through the model. Rerunning
 * after an interruption during embedding resumes it; any other existing `dir` is refused. A corpus
 * is sealed only once every chunk is embedded in a space the embedder matches, so resuming with a
 * different model fails and stays resumable with the original one.
 */
export const freezeCorpus = Effect.fn("Corpus.freeze")(function* (opts: {
  dir: string
  opencodeDb: string
  labelsPath: string
  excludeDirectories: string[]
}) {
  const f = files(opts.dir)
  if (existsSync(f.record))
    return yield* new Refused({ message: `${opts.dir} is already frozen; a frozen corpus is never rebuilt in place` })
  const resuming = existsSync(f.ingested)
  if (existsSync(opts.dir) && !resuming)
    return yield* new Refused({ message: `${opts.dir} exists but was not interrupted after ingest; delete it and freeze again` })

  if (!resuming) {
    const labelBytes = yield* readBytes(opts.labelsPath)
    const labels: Label[] = JSON.parse(new TextDecoder().decode(labelBytes))
    mkdirSync(opts.dir, { recursive: true })
    yield* write(f.labels, labelBytes)
    const ingested: Ingested = {
      cutoff: Math.max(...labels.map((l) => l.time)),
      excludeDirectories: opts.excludeDirectories,
      labelsSha256: sha256(labelBytes),
    }
    yield* Effect.scoped(ingest(f.archive, opts.opencodeDb, ingested))
    yield* write(f.ingested, JSON.stringify(ingested, null, 2) + "\n")
  }
  const ingested = yield* readJson<Ingested>(f.ingested)

  yield* Effect.scoped(
    Effect.gen(function* () {
      const archive = yield* Archive.make(f.archive)
      const { chunks, embeddedChunks } = yield* archive.status()
      const started = Date.now()
      let embedded = 0
      for (let n; (n = yield* archive.embedPending(512)); ) {
        embedded += n
        const rate = embedded / ((Date.now() - started) / 1000)
        process.stdout.write(`\r  embedded ${embeddedChunks + embedded}/${chunks} chunks, ${rate.toFixed(0)}/s   `)
      }
      console.log()
      // `embedPending` also returns 0 when the embedder cannot embed into the active space.
      const done = yield* archive.status()
      if (!done.activeSpace.matchesConfigured || done.embeddedChunks !== done.chunks)
        return yield* new Refused({
          message:
            `${done.embeddedChunks}/${done.chunks} chunks embedded, and this embedder ` +
            `${done.activeSpace.matchesConfigured ? "matches" : "does not match"} the corpus's vector space; ` +
            "rerun freeze with the embedder it was started with",
        })
      const record: Frozen = { ...ingested, fingerprint: yield* fingerprint(archive), frozenAt: new Date().toISOString() }
      yield* write(f.record, JSON.stringify(record, null, 2) + "\n")
      unlinkSync(f.ingested)
    }),
  )
})

/** Archive every session the cutoff and exclusions keep, leaving their chunks queued for embedding. */
const ingest = Effect.fnUntraced(function* (archivePath: string, opencodeDb: string, { cutoff, excludeDirectories }: Ingested) {
  const archive = yield* Archive.make(archivePath)
  const source = yield* Effect.acquireRelease(
    Effect.sync(() => new Database(opencodeDb, { readonly: true })),
    (db) => Effect.sync(() => db.close()),
  )
  const { id: sourceId } = Option.getOrThrow(yield* archive.authenticate(yield* archive.issueToken("eval")))
  const ids = [...readPositions(source).keys()]
  let archived = 0
  for (const id of ids) {
    const snapshot = readSnapshot(source, id)
    if (!snapshot || snapshot.session.timeCreated > cutoff) continue
    if (under(excludeDirectories, snapshot.session.directory)) continue
    const session = { ...snapshot.session, messages: snapshot.session.messages.filter((m) => m.timeCreated <= cutoff) }
    const contentHash = sha256(JSON.stringify(session))
    yield* archive.putSnapshot({ ...snapshot, session, contentHash, lastActivity: Math.min(snapshot.lastActivity, cutoff) }, sourceId)
    if (++archived % 250 === 0) process.stdout.write(`\r  archived ${archived} sessions`)
  }
  console.log(`\r  archived ${archived} of ${ids.length} sessions`)
})

/**
 * Open a frozen corpus for scoring with the provided embedder, closing it with the scope. Fails
 * with {@link Refused} if it has changed since it was frozen.
 */
export const openCorpus = Effect.fn("Corpus.open")(function* (dir: string) {
  const f = files(dir)
  if (!existsSync(f.record)) return yield* new Refused({ message: `${dir} is not a frozen corpus: run \`bun run freeze\`` })
  const record = yield* readJson<Frozen>(f.record)
  const labelBytes = yield* readBytes(f.labels)
  if (sha256(labelBytes) !== record.labelsSha256)
    return yield* new Refused({ message: `${f.labels} changed since the corpus was frozen` })

  // Opening migrates, which would rewrite a corpus frozen by another schema before refusing it.
  const peek = new Database(f.archive, { readonly: true })
  const { user_version } = peek.query("PRAGMA user_version").get() as { user_version: number }
  peek.close()
  if (user_version !== SCHEMA_VERSION)
    return yield* new Refused({
      message: `corpus was frozen at archive schema ${user_version}, this hub is at ${SCHEMA_VERSION}; freeze a new one`,
    })

  const archive = yield* Archive.make(f.archive)
  if ((yield* fingerprint(archive)) !== record.fingerprint)
    return yield* new Refused({ message: `${f.archive} no longer matches the corpus frozen at ${record.frozenAt}` })
  const labels: Label[] = JSON.parse(new TextDecoder().decode(labelBytes))
  return { archive, labels }
})
