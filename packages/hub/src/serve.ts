import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { openArchive } from "./archive/index.ts"
import type { Config } from "./config.ts"
import type { Log } from "./log.ts"
import { createHandler } from "./server.ts"

/** Open and migrate the archive, then listen. Throws if the archive cannot be opened. */
export function serve(config: Config, log: Log) {
  mkdirSync(config.dataDir, { recursive: true })
  const path = join(config.dataDir, "archive.db")
  const archive = openArchive(path)
  log("info", "archive opened", { path, schemaFrom: archive.migration.from, schemaTo: archive.migration.to })

  const separator = config.listen.lastIndexOf(":")
  const server = Bun.serve({
    hostname: config.listen.slice(0, separator),
    port: Number(config.listen.slice(separator + 1)),
    fetch: createHandler({ archive, log }),
  })
  log("info", "listening", { url: server.url.href })

  return {
    url: server.url,
    stop: async () => {
      await server.stop()
      archive.close()
    },
  }
}
