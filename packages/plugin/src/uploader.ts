import { HubError, createClient, type Client, type ErrorCode } from "@opencode-recall/protocol"
import type { HubConfig } from "./config.ts"

/** Rejections that only a configuration change can fix, so the work is kept rather than dropped. */
const PAUSING: ReadonlySet<ErrorCode> = new Set(["invalid_token", "protocol_version"])

export type Uploader = {
  /** Mark a session as needing upload. Repeats before the upload starts collapse into one. */
  enqueue(sessionId: string): void
  /** Why uploads are held, or `null` while they flow. */
  readonly pausedBy: string | null
  stop(): void
}

type Options = {
  upload: (client: Client, sessionId: string) => Promise<unknown>
  /** Re-read on every pass and every probe, so a fixed config is picked up without a restart. */
  loadConfig: () => Promise<HubConfig | null>
  /** How often a paused uploader re-reads config and probes the hub. */
  probeIntervalMs?: number
  log?: (message: string) => void
}

/**
 * Uploads queued sessions one at a time. A missing config, `invalid_token`, or
 * `protocol_version` pauses the queue with its work intact; while paused it
 * periodically re-reads config and calls `status`, and resumes once that succeeds.
 */
export function createUploader({
  upload,
  loadConfig,
  probeIntervalMs = 30_000,
  log = (message) => console.error(`opencode-recall: ${message}`),
}: Options): Uploader {
  const pending = new Set<string>()
  let pausedBy: string | null = null
  let draining = false
  let stopped = false
  let probeTimer: ReturnType<typeof setTimeout> | undefined

  const describe = (e: unknown) => (e instanceof Error ? e.message : String(e))

  function pause(reason: string) {
    if (pausedBy === null) log(`uploads paused until configuration is fixed: ${reason}`)
    pausedBy = reason
    scheduleProbe()
  }

  function scheduleProbe() {
    if (stopped) return
    clearTimeout(probeTimer)
    probeTimer = setTimeout(probe, probeIntervalMs)
  }

  async function probe() {
    try {
      const config = await loadConfig()
      if (!config) return scheduleProbe()
      await createClient(config).status()
    } catch (e) {
      if (e instanceof HubError && PAUSING.has(e.code)) pausedBy = `${e.code}: ${e.message}`
      return scheduleProbe()
    }
    log("configuration accepted by the hub; uploads resumed")
    pausedBy = null
    void drain()
  }

  async function drain() {
    if (draining || pausedBy !== null || stopped) return
    draining = true
    try {
      let config: HubConfig | null
      try {
        config = await loadConfig()
      } catch (e) {
        return pause(`config could not be read: ${describe(e)}`)
      }
      if (!config) return pause("hub URL or token is not configured")
      const client = createClient(config)

      // Set iteration is live, so sessions enqueued during the pass are visited too.
      for (const sessionId of pending) {
        if (stopped) return
        // Taken before sending, so a change that arrives mid-upload re-queues the session.
        pending.delete(sessionId)
        try {
          await upload(client, sessionId)
        } catch (e) {
          if (e instanceof HubError && PAUSING.has(e.code)) {
            pending.add(sessionId)
            return pause(`${e.code}: ${e.message}`)
          }
          log(`upload of ${sessionId} failed: ${describe(e)}`)
        }
      }
    } finally {
      draining = false
    }
  }

  return {
    enqueue(sessionId) {
      pending.add(sessionId)
      void drain()
    },
    get pausedBy() {
      return pausedBy
    },
    stop() {
      stopped = true
      clearTimeout(probeTimer)
    },
  }
}
