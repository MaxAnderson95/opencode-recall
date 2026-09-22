#!/usr/bin/env bun
import { loadConfig } from "./config.ts"
import { createLog } from "./log.ts"
import { serve } from "./serve.ts"

const [command] = process.argv.slice(2)
if (command !== "serve") {
  console.error("usage: opencode-recall-hub serve")
  process.exit(2)
}

const config = await loadConfig()
const log = createLog(config.logLevel)

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
