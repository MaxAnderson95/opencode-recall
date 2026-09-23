import type { StorageDomain } from "@opencode/plugin/promise/storage"
import { HubError, createClient, type Client, type ErrorCode, type Snapshot, type Tombstone } from "@opencode-recall/protocol"
import type { HubConfig } from "./config.ts"
import { EXTRACTOR_VERSION, type Position } from "./source.ts"

/** Rejections that only a configuration change can fix, so the work is kept rather than dropped. */
const PAUSING: ReadonlySet<ErrorCode> = new Set(["invalid_token", "protocol_version"])
/** Rejections of this exact request that sending it again cannot change. */
const TERMINAL: ReadonlySet<ErrorCode> = new Set([
  "stale_revision",
  "hash_divergence",
  "tombstoned",
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
 *
 * Each observed deletion waits at its own `deleted/<sessionId>/<timeDeleted>` key for the same
 * reason. The last position the hub answered for each session, whether it accepted it or not, is
 * kept at `acked/<sessionId>` so the periodic sweep can find sessions whose change events were lost
 * without asking the hub.
 */
const DIRTY = "dirty/"
const DELETED = "deleted/"
const ACKED = "acked/"
const sessionPrefix = (sessionId: string) => `${DIRTY}${sessionId}/`
const entryKey = (sessionId: string, p: Position) => `${sessionPrefix(sessionId)}${p.lastActivity}-${p.revision}`
const deletedPrefix = (sessionId: string) => `${DELETED}${sessionId}/`

const later = (a: Position, b: Position) => a.lastActivity - b.lastActivity || a.revision - b.revision

export type Storage = Pick<StorageDomain, "get" | "set" | "remove" | "scan">

/** An observed `session.deleted`, recorded when it is observed so every retry sends the same values. */
export type Deletion = Pick<Tombstone, "revision" | "timeDeleted">

/** The host's OpenCode database, as the uploader needs it. */
export type Source = {
  position(sessionId: string): Position | null
  /** Every session the database holds. */
  positions(): Map<string, Position>
  snapshot(sessionId: string): Snapshot | null
}

export type Uploader = {
  /**
   * Record that a session changed. The change is written to the work list at once; the upload
   * waits for a quiet period, so a burst of events for one session produces one upload.
   */
  enqueue(sessionId: string): void
  /** Record an observed deletion. A tombstone is sent in place of any upload still queued for it. */
  delete(sessionId: string, deletion: Deletion): void
  /**
   * Diff the hub's manifest against the local database and queue every session the hub lacks,
   * holds at an earlier position with different content, or extracted with an older extractor.
   * Sessions the hub holds that this host does not are left alone. Concurrent calls share one run;
   * the first success starts the periodic sweep.
   */
  reconcile(): Promise<void>
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
  /** How often the local database is compared against the acknowledged positions. */
  sweepIntervalMs?: number
  log?: (message: string) => void
}

/**
 * Uploads dirty sessions one at a time from a work list in `ctx.storage`, building each snapshot
 * at send time. There is no lease: several instances may upload one session, and the hub turns the
 * duplicate into a no-op. An acknowledgement removes a work-list entry only when the position it
 * uploaded covers the entry's observed position, so a change made mid-upload is sent afterwards.
 *
 * Absence is never deletion: a queued session that has vanished from the database is dropped, and
 * only an observed deletion produces a tombstone.
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
  sweepIntervalMs = 300_000,
  log = (message) => console.error(`opencode-recall: ${message}`),
}: Options): Uploader {
  const due = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let pausedBy: string | null = null
  let draining = false
  let stopped = false
  let probeTimer: ReturnType<typeof setTimeout> | undefined
  let reconcileTimer: ReturnType<typeof setTimeout> | undefined
  let sweepTimer: ReturnType<typeof setInterval> | undefined
  let reconciling: Promise<void> | undefined
  /** A reconciliation was held back by a pause and runs once the hub accepts the config. */
  let reconcileOnResume = false

  async function scanAll(prefix: string) {
    const found: { key: string; value: unknown }[] = []
    let after: string | undefined
    do {
      const page = await storage.scan({ prefix, after })
      found.push(...page.entries)
      after = page.next
    } while (after !== undefined)
    return found
  }

  const entries = async (sessionId: string) =>
    (await scanAll(sessionPrefix(sessionId))).map(({ key, value }) => ({ key, position: value as Position }))

  async function acknowledged() {
    const acked = new Map<string, Position>()
    for (const { key, value } of await scanAll(ACKED)) acked.set(key.slice(ACKED.length), value as Position)
    return acked
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

  async function markDirty(sessionId: string, position: Position) {
    await storage.set(entryKey(sessionId, position), position)
    schedule(sessionId, quietMs)
  }

  /** Keep the latest answered position; a racing instance writing an older one costs one no-op upload. */
  async function recordAcked(sessionId: string, position: Position, held?: Position) {
    const current = held ?? ((await storage.get(ACKED + sessionId)) as Position | undefined)
    if (!current || later(position, current) > 0) await storage.set(ACKED + sessionId, position)
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
    if (reconcileOnResume) void reconcile()
    void drain()
  }

  /** Remove the entries `sent` covers; a later observation stays for the next pass. */
  async function acknowledge(sessionId: string, sent: Position) {
    for (const { key, position } of await entries(sessionId))
      if (later(position, sent) <= 0) await storage.remove(key)
    await recordAcked(sessionId, sent)
  }

  /** Send one request, turning its failure into what the work list should do next. */
  async function attempt(sessionId: string, request: () => Promise<unknown>): Promise<"done" | "pause" | "retry"> {
    try {
      await request()
      return "done"
    } catch (e) {
      const kind = classify(e)
      if (kind === "pause") {
        due.add(sessionId)
        pause(e instanceof HubError ? `${e.code}: ${e.message}` : describe(e))
        return "pause"
      }
      if (kind === "retry") {
        log(`upload of ${sessionId} failed, retrying: ${describe(e)}`)
        schedule(sessionId, retryMs)
        return "retry"
      }
      log(`upload of ${sessionId} rejected and dropped: ${describe(e)}`)
      return "done"
    }
  }

  /**
   * Send the latest queued deletion; the hub keeps the later of two tombstones, so it covers the
   * earlier ones. Only the keys read before sending are removed, so a deletion observed meanwhile stays.
   */
  async function sendTombstone(
    client: Client,
    sessionId: string,
    deletions: { key: string; deletion: Deletion }[],
  ): Promise<"pause" | void> {
    const { deletion } = deletions.reduce((a, b) => (b.deletion.timeDeleted > a.deletion.timeDeleted ? b : a))
    const pending = await entries(sessionId)
    const outcome = await attempt(sessionId, () => client.tombstone({ sessionId, ...deletion }))
    if (outcome !== "done") return outcome === "pause" ? "pause" : undefined

    for (const { key } of deletions) await storage.remove(key)
    await storage.remove(ACKED + sessionId)
    // Work observed after the deletion belongs to a re-import and is uploaded on its own.
    let reimported = false
    for (const { key, position } of pending)
      if (position.lastActivity <= deletion.timeDeleted) await storage.remove(key)
      else reimported = true
    if (reimported) schedule(sessionId, quietMs)
  }

  async function send(client: Client, sessionId: string): Promise<"pause" | void> {
    const deletions = (await scanAll(deletedPrefix(sessionId))).map(({ key, value }) => ({
      key,
      deletion: value as Deletion,
    }))
    if (deletions.length > 0) return sendTombstone(client, sessionId, deletions)

    const pending = await entries(sessionId)
    if (pending.length === 0) return // Another instance already uploaded it.
    const snapshot = source.snapshot(sessionId)
    // Gone without an observed deletion; absence is never deletion. Only the entries read are removed.
    if (!snapshot) {
      for (const { key } of pending) await storage.remove(key)
      return
    }
    const outcome = await attempt(sessionId, () => client.snapshot(snapshot))
    if (outcome === "pause") return "pause"
    if (outcome === "done") await acknowledge(sessionId, snapshot)
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

  /** Pick up work left by a previous run or another instance. */
  async function resume() {
    for (const { key } of await scanAll(DIRTY)) due.add(key.slice(DIRTY.length, key.lastIndexOf("/")))
    for (const { key } of await scanAll(DELETED)) due.add(key.slice(DELETED.length, key.lastIndexOf("/")))
    void drain()
  }

  /** Queue every local session whose position is later than the last one the hub answered. No network. */
  async function sweep() {
    const acked = await acknowledged()
    for (const [sessionId, position] of source.positions()) {
      const held = acked.get(sessionId)
      if (!held || later(position, held) > 0) await markDirty(sessionId, position)
    }
  }

  async function diffManifest() {
    const config = await loadConfig()
    if (!config || pausedBy !== null) {
      reconcileOnResume = true
      if (!config) pause("hub URL or token is not configured")
      return
    }
    const manifest = await createClient(config).manifest()
    const held = new Map(manifest.sessions.map((s) => [s.sessionId, s]))
    const tombstones = new Map(manifest.tombstones.map((t) => [t.sessionId, t.timeDeleted]))
    const acked = await acknowledged()

    for (const [sessionId, local] of source.positions()) {
      if (stopped) return
      const timeDeleted = tombstones.get(sessionId)
      const hub = held.get(sessionId)
      const current =
        timeDeleted !== undefined
          ? local.lastActivity <= timeDeleted // The hub would reject it as `tombstoned`.
          : hub !== undefined &&
            hub.extractorVersion >= EXTRACTOR_VERSION &&
            (later(local, hub) <= 0 || source.snapshot(sessionId)?.contentHash === hub.contentHash)
      if (current) await recordAcked(sessionId, local, acked.get(sessionId))
      else await markDirty(sessionId, local)
    }

    reconcileOnResume = false
    if (sweepTimer === undefined && !stopped)
      sweepTimer = setInterval(
        () => void sweep().catch((e) => log(`sweep failed: ${describe(e)}`)),
        sweepIntervalMs,
      )
  }

  function reconcile(): Promise<void> {
    reconciling ??= diffManifest()
      .catch((e) => {
        if (classify(e) === "pause") {
          reconcileOnResume = true
          return pause(e instanceof HubError ? `${e.code}: ${e.message}` : describe(e))
        }
        log(`reconciliation failed, retrying: ${describe(e)}`)
        clearTimeout(reconcileTimer)
        if (!stopped) reconcileTimer = setTimeout(() => void reconcile(), retryMs)
      })
      .finally(() => (reconciling = undefined))
    return reconciling
  }

  void resume().catch((e) => log(`work list could not be read: ${describe(e)}`))

  return {
    enqueue(sessionId) {
      const position = source.position(sessionId)
      if (!position) return
      void markDirty(sessionId, position).catch((e) => log(`could not record ${sessionId} as dirty: ${describe(e)}`))
    },
    delete(sessionId, deletion) {
      void storage
        .set(`${deletedPrefix(sessionId)}${deletion.timeDeleted}`, deletion)
        .then(() => schedule(sessionId, quietMs))
        .catch((e) => log(`could not record ${sessionId} as deleted: ${describe(e)}`))
    },
    reconcile,
    get pausedBy() {
      return pausedBy
    },
    stop() {
      stopped = true
      clearTimeout(probeTimer)
      clearTimeout(reconcileTimer)
      clearInterval(sweepTimer)
      for (const timer of timers.values()) clearTimeout(timer)
    },
  }
}
