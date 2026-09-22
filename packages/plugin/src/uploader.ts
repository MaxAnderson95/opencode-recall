import type { StorageDomain } from "@opencode/plugin/promise/storage"
import { HubError, createClient, type Client, type ErrorCode, type Snapshot } from "@opencode-recall/protocol"
import type { HubConfig } from "./config.ts"
import type { Position } from "./source.ts"

/** Rejections that only a configuration change can fix, so the work is kept rather than dropped. */
const PAUSING: ReadonlySet<ErrorCode> = new Set(["invalid_token", "protocol_version"])
/** Rejections of this exact snapshot that sending it again cannot change. */
const TERMINAL: ReadonlySet<ErrorCode> = new Set([
  "stale_revision",
  "hash_divergence",
  "payload_too_large",
  "invalid_request",
  "unknown_verb",
])
const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["rate_limited", "request_timeout"])

/** Codes first, HTTP status as the fallback; anything that is not a hub answer is a transport failure. */
function classify(e: unknown): "pause" | "terminal" | "retry" {
  if (!(e instanceof HubError)) return "retry"
  if (PAUSING.has(e.code)) return "pause"
  if (TERMINAL.has(e.code)) return "terminal"
  if (RETRYABLE.has(e.code)) return "retry"
  return e.status >= 500 ? "retry" : "terminal"
}

/**
 * Work-list entries live in `ctx.storage` at `dirty/<sessionId>/<lastActivity>-<revision>`, one per
 * observed position. A key names exactly one piece of work, so an acknowledgement can remove the
 * entries its upload covers without ever touching one written after it read the list; that is what
 * makes the rule hold without compare-and-set. Rewriting a removed key only costs a no-op upload.
 */
const DIRTY = "dirty/"
const sessionPrefix = (sessionId: string) => `${DIRTY}${sessionId}/`
const entryKey = (sessionId: string, p: Position) => `${sessionPrefix(sessionId)}${p.lastActivity}-${p.revision}`

const later = (a: Position, b: Position) => a.lastActivity - b.lastActivity || a.revision - b.revision

export type Storage = Pick<StorageDomain, "set" | "remove" | "scan">

/** The host's OpenCode database, as the uploader needs it. */
export type Source = {
  position(sessionId: string): Position | null
  snapshot(sessionId: string): Snapshot | null
}

export type Uploader = {
  /**
   * Record that a session changed. The change is written to the work list at once; the upload
   * waits for a quiet period, so a burst of events for one session produces one upload.
   */
  enqueue(sessionId: string): void
  /** Why uploads are held, or `null` while they flow. */
  readonly pausedBy: string | null
  stop(): void
}

type Options = {
  source: Source
  /** Shared by every plugin instance on the host, so any of them may upload any entry. */
  storage: Storage
  /** Re-read on every pass and every probe, so a fixed config is picked up without a restart. */
  loadConfig: () => Promise<HubConfig | null>
  /** How long a session must stay quiet before its snapshot is built. */
  quietMs?: number
  /** Delay before a retryable failure is sent again. */
  retryMs?: number
  /** How often a paused uploader re-reads config and probes the hub. */
  probeIntervalMs?: number
  log?: (message: string) => void
}

/**
 * Uploads dirty sessions one at a time from a work list in `ctx.storage`, building each snapshot
 * at send time. There is no lease: several instances may upload one session, and the hub turns the
 * duplicate into a no-op. An acknowledgement removes a work-list entry only when the position it
 * uploaded covers the entry's observed position, so a change made mid-upload is sent afterwards.
 *
 * A missing config, `invalid_token`, or `protocol_version` pauses the queue with its work intact;
 * while paused it periodically re-reads config and calls `status`, and resumes once that succeeds.
 */
export function createUploader({
  source,
  storage,
  loadConfig,
  quietMs = 2_000,
  retryMs = 30_000,
  probeIntervalMs = 30_000,
  log = (message) => console.error(`opencode-recall: ${message}`),
}: Options): Uploader {
  const due = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let pausedBy: string | null = null
  let draining = false
  let stopped = false
  let probeTimer: ReturnType<typeof setTimeout> | undefined

  async function entries(sessionId: string) {
    const found: { key: string; position: Position }[] = []
    let after: string | undefined
    do {
      const page = await storage.scan({ prefix: sessionPrefix(sessionId), after })
      for (const { key, value } of page.entries) found.push({ key, position: value as Position })
      after = page.next
    } while (after !== undefined)
    return found
  }

  const describe = (e: unknown) => (e instanceof Error ? e.message : String(e))

  function schedule(sessionId: string, ms: number) {
    if (stopped) return
    clearTimeout(timers.get(sessionId))
    timers.set(
      sessionId,
      setTimeout(() => {
        timers.delete(sessionId)
        due.add(sessionId)
        void drain()
      }, ms),
    )
  }

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

  /** Remove the entries `sent` covers; a later observation stays for the next pass. */
  async function acknowledge(sessionId: string, sent: Position) {
    for (const { key, position } of await entries(sessionId))
      if (later(position, sent) <= 0) await storage.remove(key)
  }

  async function send(client: Client, sessionId: string): Promise<"pause" | void> {
    const pending = await entries(sessionId)
    if (pending.length === 0) return // Another instance already uploaded it.
    const snapshot = source.snapshot(sessionId)
    // Deleted since it was queued; tombstones are not sent yet. Only the entries read are removed.
    if (!snapshot) {
      for (const { key } of pending) await storage.remove(key)
      return
    }
    try {
      await client.snapshot(snapshot)
    } catch (e) {
      const kind = classify(e)
      if (kind === "pause") {
        due.add(sessionId)
        pause(e instanceof HubError ? `${e.code}: ${e.message}` : describe(e))
        return "pause"
      }
      if (kind === "retry") {
        log(`upload of ${sessionId} failed, retrying: ${describe(e)}`)
        return schedule(sessionId, retryMs)
      }
      log(`upload of ${sessionId} rejected and dropped: ${describe(e)}`)
    }
    await acknowledge(sessionId, snapshot)
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

      // Set iteration is live, so sessions that come due during the pass are visited too.
      for (const sessionId of due) {
        if (stopped) return
        due.delete(sessionId)
        try {
          if ((await send(client, sessionId)) === "pause") return
        } catch (e) {
          log(`upload of ${sessionId} failed, retrying: ${describe(e)}`)
          schedule(sessionId, retryMs)
        }
      }
    } finally {
      draining = false
    }
  }

  /** Pick up entries left by a previous run or another instance. */
  async function resume() {
    let after: string | undefined
    do {
      const page = await storage.scan({ prefix: DIRTY, after })
      for (const { key } of page.entries) due.add(key.slice(DIRTY.length, key.lastIndexOf("/")))
      after = page.next
    } while (after !== undefined)
    void drain()
  }

  void resume().catch((e) => log(`work list could not be read: ${describe(e)}`))

  return {
    enqueue(sessionId) {
      const position = source.position(sessionId)
      if (!position) return
      void storage
        .set(entryKey(sessionId, position), position)
        .then(() => schedule(sessionId, quietMs))
        .catch((e) => log(`could not record ${sessionId} as dirty: ${describe(e)}`))
    },
    get pausedBy() {
      return pausedBy
    },
    stop() {
      stopped = true
      clearTimeout(probeTimer)
      for (const timer of timers.values()) clearTimeout(timer)
    },
  }
}
