import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { SpaceRecipe } from "@opencode-recall/protocol"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Archive } from "./archive/index.ts"
import { HubConfig } from "./config.ts"
import { EmbedQueue } from "./embed-queue.ts"
import { Embedder, type EmbeddingModel } from "./embedder.ts"
import { HubLock } from "./lock.ts"
import { makeHandler } from "./server.ts"

export const archivePath = (config: HubConfig.Settings) => join(config.dataDir, "archive.db")

export const modelsDir = (config: HubConfig.Settings) => config.modelsDir ?? join(config.dataDir, "models")

/** The vector space the configuration asks for: its embedding model and chunking. */
export const configuredRecipe = (config: HubConfig.Settings) =>
  Archive.recipeFor(Embedder.modelOf(config.embedding), config.chunking)

const archiveWith = (configured: (config: HubConfig.Settings, model: EmbeddingModel) => SpaceRecipe) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* HubConfig.Service
      const { model } = yield* Embedder.Service
      mkdirSync(config.dataDir, { recursive: true })
      return Archive.layer(archivePath(config), configured(config, model))
    }),
  )

/**
 * The archive in the configured data directory, created and migrated if needed, set to build the
 * {@link configuredRecipe}. It embeds with the provided {@link Embedder.Service}.
 */
export const dataArchive = archiveWith(configuredRecipe)

/**
 * The embedder for the active space, so a hub whose configured model differs keeps answering
 * queries and embedding new chunks on the vectors it has until a reindex. The configured model
 * when there is no active space yet, or the active one was made by another runtime than this
 * binary's. Model files live under {@link modelsDir}; nothing loads until used.
 */
export const dataEmbedder = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* HubConfig.Service
    const active = yield* Archive.activeRecipe(archivePath(config))
    const serving = Option.getOrUndefined(
      Option.flatMap(active, (recipe) =>
        Option.filter(Schema.decodeUnknownOption(Embedder.ModelChoice)(recipe), (choice) => {
          const model = Embedder.modelOf(choice)
          return model.runtime === recipe.runtime && model.pooling === recipe.pooling && model.normalize === recipe.normalize
        }),
      ),
    )
    return Embedder.onnx(modelsDir(config), serving ?? config.embedding)
  }),
)

/** The hub's listening HTTP server. */
export class Listening extends Context.Service<Listening, { readonly url: URL }>()("@opencode-recall/hub/Listening") {}

const listen = Layer.effect(
  Listening,
  Effect.gen(function* () {
    const config = yield* HubConfig.Service
    const archive = yield* Archive.Service
    const reclaimed = yield* archive.reclaim()
    const { activeSpace, chunks, embeddedChunks } = yield* archive.status()
    yield* Effect.logInfo("archive opened").pipe(
      Effect.annotateLogs({ path: archivePath(config), schemaFrom: archive.migration.from, schemaTo: archive.migration.to }),
    )
    if (reclaimed)
      yield* Effect.logWarning("reclaimed an interrupted reindex").pipe(Effect.annotateLogs({ chunks: reclaimed }))
    yield* Effect.logInfo("vector space").pipe(Effect.annotateLogs({ recipe: activeSpace.recipe, chunks, embeddedChunks }))
    if (!activeSpace.matchesConfigured)
      yield* Effect.logError(
        "the configured vector space differs from the active one; serving the active one and embedding nothing into the configured one until `reindex` is run",
      ).pipe(Effect.annotateLogs({ active: activeSpace.recipe, configured: configuredRecipe(config) }))

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

/** Holds the data directory for this process until released; see {@link HubLock.hold}. */
export const exclusive = Layer.effectDiscard(Effect.flatMap(HubConfig.Service, (config) => HubLock.hold(config.dataDir)))

type EmbedderLayer = Layer.Layer<Embedder.Service, never, HubConfig.Service>

/**
 * The data directory's archive embedding with `fallback`, set to build the configured recipe; or,
 * given an `embedder`, embedding with it and set to build its model with the configured chunking,
 * which is how tests stand in for a configured model. The embedder is provided alongside it.
 */
export const archive = (embedder: EmbedderLayer | undefined, fallback: EmbedderLayer) =>
  (embedder ? archiveWith((config, model) => Archive.recipeFor(model, config.chunking)) : dataArchive).pipe(
    Layer.provideMerge(embedder ?? fallback),
  )

/**
 * Take the data directory, open and migrate the archive, reclaim an interrupted reindex, resume
 * embedding its queue, then listen. Releasing it stops the server, then the embedding worker,
 * then closes the archive and lets the data directory go. Fails to build if another `serve` or a
 * `reindex` holds the data directory, or the archive cannot be opened.
 */
export const layer = (embedder?: EmbedderLayer) =>
  listen.pipe(
    Layer.provide(EmbedQueue.layer()),
    Layer.provideMerge(archive(embedder, dataEmbedder)),
    Layer.provide(exclusive),
  )

export * as Hub from "./serve.ts"
