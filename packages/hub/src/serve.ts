import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { openArchive } from "./archive/index.ts"
import type { Config } from "./config.ts"
import { embedInBackground } from "./embed-queue.ts"
import { onnxEmbedder, type Embedder } from "./embedder.ts"
import type { Log } from "./log.ts"
import { createHandler } from "./server.ts"

/**
 * Open and migrate the archive in the configured data directory, creating both if needed. The
 * default embedder keeps its model files under `<dataDir>/models` and loads nothing until used.
 */
export function openDataArchive(config: Config, embedder: Embedder = onnxEmbedder(join(config.dataDir, "models"))) {
  mkdirSync(config.dataDir, { recursive: true })
  const path = join(config.dataDir, "archive.db")
  return { path, archive: openArchive(path, embedder) }
}

/** Open and migrate the archive, resume embedding its queue, then listen. Throws if the archive cannot be opened. */
export function serve(config: Config, log: Log, embedder?: Embedder) {
  const { path, archive } = openDataArchive(config, embedder)
  const { activeSpace, chunks, embeddedChunks } = archive.status()
  log("info", "archive opened", { path, schemaFrom: archive.migration.from, schemaTo: archive.migration.to })
  log("info", "vector space", { recipe: activeSpace.recipe, chunks, embeddedChunks })
  if (!activeSpace.matchesConfigured)
    log("warn", "this hub would build a different vector space than the active one; serving the active one until a reindex", {
      active: activeSpace.recipe,
    })

  const embedding = embedInBackground(archive, log)
  embedding.kick()

  const separator = config.listen.lastIndexOf(":")
  const server = Bun.serve({
    hostname: config.listen.slice(0, separator),
    port: Number(config.listen.slice(separator + 1)),
    fetch: createHandler({ archive, log, onArchived: embedding.kick }),
  })
  log("info", "listening", { url: server.url.href })

  return {
    url: server.url,
    stop: async () => {
      await server.stop()
      await embedding.stop()
      archive.close()
    },
  }
}
