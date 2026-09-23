import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { Archive } from "./archive/index.ts"
import { HubConfig } from "./config.ts"
import { EmbedQueue } from "./embed-queue.ts"
import { Embedder } from "./embedder.ts"
import { makeHandler } from "./server.ts"

const archivePath = (config: HubConfig.Settings) => join(config.dataDir, "archive.db")

/**
 * The archive in the configured data directory, created and migrated if needed. It embeds with
 * the provided {@link Embedder.Service}.
 */
export const dataArchive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* HubConfig.Service
    mkdirSync(config.dataDir, { recursive: true })
    return Archive.layer(archivePath(config))
  }),
)

/** The default embedder, keeping its model files under `<dataDir>/models`; it loads nothing until used. */
export const dataEmbedder = Layer.unwrap(
  Effect.map(HubConfig.Service, (config) => Embedder.onnx(join(config.dataDir, "models"))),
)

/** The hub's listening HTTP server. */
export class Listening extends Context.Service<Listening, { readonly url: URL }>()("@opencode-recall/hub/Listening") {}

const listen = Layer.effect(
  Listening,
  Effect.gen(function* () {
    const config = yield* HubConfig.Service
    const archive = yield* Archive.Service
    const { activeSpace, chunks, embeddedChunks } = yield* archive.status()
    yield* Effect.logInfo("archive opened").pipe(
      Effect.annotateLogs({ path: archivePath(config), schemaFrom: archive.migration.from, schemaTo: archive.migration.to }),
    )
    yield* Effect.logInfo("vector space").pipe(Effect.annotateLogs({ recipe: activeSpace.recipe, chunks, embeddedChunks }))
    if (!activeSpace.matchesConfigured)
      yield* Effect.logWarning(
        "this hub would build a different vector space than the active one; serving the active one until a reindex",
      ).pipe(Effect.annotateLogs({ active: activeSpace.recipe }))

    const embedding = yield* EmbedQueue.Service
    const fetch = yield* makeHandler({ onArchived: embedding.kick })
    const separator = config.listen.lastIndexOf(":")
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({ hostname: config.listen.slice(0, separator), port: Number(config.listen.slice(separator + 1)), fetch }),
      ),
      (server) => Effect.promise(() => server.stop()),
    )
    yield* Effect.logInfo("listening").pipe(Effect.annotateLogs({ url: server.url.href }))
    return { url: server.url }
  }),
)

/**
 * Open and migrate the archive, resume embedding its queue, then listen. Releasing it stops the
 * server, then the embedding worker, then closes the archive. Fails to build if the archive cannot
 * be opened.
 */
export const layer = (embedder: Layer.Layer<Embedder.Service, never, HubConfig.Service> = dataEmbedder) =>
  listen.pipe(Layer.provide(EmbedQueue.layer()), Layer.provideMerge(dataArchive), Layer.provide(embedder))

export * as Hub from "./serve.ts"
