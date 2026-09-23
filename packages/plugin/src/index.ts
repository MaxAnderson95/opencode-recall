import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { configFilePath, loadHubConfig } from "./config.ts"
import { readPosition, readSnapshot } from "./source.ts"
import { createUploader } from "./uploader.ts"

function sourceDbPath(env: Record<string, string | undefined>): string {
  if (env.OPENCODE_RECALL_SOURCE_DB) return env.OPENCODE_RECALL_SOURCE_DB
  const data = env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(data, "opencode", "opencode.db")
}

export default Plugin.define({
  id: "opencode-recall",
  setup: async (ctx) => {
    const env = process.env
    const db = new Database(sourceDbPath(env), { readonly: true })
    const uploader = createUploader({
      source: { position: (id) => readPosition(db, id), snapshot: (id) => readSnapshot(db, id) },
      storage: ctx.storage,
      loadConfig: () => loadHubConfig(env, configFilePath(env)),
    })
    const abort = new AbortController()

    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        const changed =
          event.type === "session.execution.succeeded" ||
          event.type === "session.execution.failed" ||
          (event.type === "session.execution.interrupted" && event.data.reason !== "shutdown") ||
          event.type === "session.renamed" ||
          event.type === "session.moved"
        if (changed) uploader.enqueue(event.data.sessionID)
      }
    })().catch((e) => {
      if (!abort.signal.aborted) console.error("opencode-recall: event stream failed:", e)
    })

    return () => {
      abort.abort()
      uploader.stop()
      db.close()
    }
  },
})
