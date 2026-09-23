import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { configFilePath, loadHubConfig } from "./config.ts"
import { searchTool } from "./search.ts"
import { compactionBoundary, readPosition, readPositions, readSnapshot } from "./source.ts"
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
    const loadConfig = () => loadHubConfig(env, configFilePath(env))
    const uploader = createUploader({
      source: {
        position: (id) => readPosition(db, id),
        positions: () => readPositions(db),
        snapshot: (id) => readSnapshot(db, id),
      },
      storage: ctx.storage,
      loadConfig,
    })
    await ctx.tool.transform((tools) => {
      tools.add(searchTool({ loadConfig, compactionBoundary: (id) => compactionBoundary(db, id) }))
    })
    const abort = new AbortController()
    void uploader.reconcile()

    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        // Sent at the start of every (re)connection; events may have been missed while it was down.
        if (event.type === "server.connected") void uploader.reconcile()
        if (event.type === "session.deleted")
          uploader.delete(event.data.sessionID, { revision: event.durable.seq, timeDeleted: Math.ceil(event.created) })
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
