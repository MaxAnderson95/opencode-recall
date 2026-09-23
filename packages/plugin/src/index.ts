import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import type { Client } from "@opencode-recall/protocol"
import { configFilePath, loadHubConfig } from "./config.ts"
import { readSession } from "./source.ts"
import { createUploader } from "./uploader.ts"

function sourceDbPath(env: Record<string, string | undefined>): string {
  if (env.OPENCODE_RECALL_SOURCE_DB) return env.OPENCODE_RECALL_SOURCE_DB
  const data = env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(data, "opencode", "opencode.db")
}

/** Read one session from OpenCode's database and send it to the hub as a snapshot. */
export async function uploadSession(db: Database, client: Client, sessionId: string): Promise<boolean> {
  const session = readSession(db, sessionId)
  if (!session) return false
  await client.snapshot(session)
  return true
}

export default Plugin.define({
  id: "opencode-recall",
  setup: async (ctx) => {
    const env = process.env
    const db = new Database(sourceDbPath(env), { readonly: true })
    const uploader = createUploader({
      upload: (client, sessionId) => uploadSession(db, client, sessionId),
      loadConfig: () => loadHubConfig(env, configFilePath(env)),
    })
    const abort = new AbortController()

    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        const turnEnded =
          event.type === "session.execution.succeeded" ||
          event.type === "session.execution.failed" ||
          (event.type === "session.execution.interrupted" && event.data.reason !== "shutdown")
        if (turnEnded) uploader.enqueue(event.data.sessionID)
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
