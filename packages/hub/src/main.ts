#!/usr/bin/env bun
import type { Archive } from "./archive/index.ts"
import { loadConfig } from "./config.ts"
import { createLog } from "./log.ts"
import { openDataArchive, serve } from "./serve.ts"
import { TOKEN_USAGE, runToken } from "./token.ts"

const [command, ...args] = process.argv.slice(2)
if (command !== "serve" && command !== "token") {
  console.error(`usage: opencode-recall-hub serve\n       ${TOKEN_USAGE}`)
  process.exit(2)
}

const config = await loadConfig()
const log = createLog(config.logLevel)

if (command === "token") {
  let archive: Archive
  try {
    archive = openDataArchive(config).archive
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
  const code = runToken(archive, args, { stdout: console.log, stderr: console.error })
  archive.close()
  process.exit(code)
}

let hub: ReturnType<typeof serve>
try {
  hub = serve(config, log)
} catch (e) {
  log("error", "startup failed", { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
}

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    log("info", "shutting down", { signal })
    await hub.stop()
    process.exit(0)
  })
