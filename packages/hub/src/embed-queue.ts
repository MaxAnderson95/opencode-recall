import type { Archive } from "./archive/index.ts"
import type { Log } from "./log.ts"

/**
 * Chunks embedded per archive call. Query embeddings queue behind an in-flight batch, so this is
 * one inference batch: a search waits for at most eight chunks.
 */
const BATCH = 8

export type RetryDelays = { firstMs: number; maxMs: number }
const DEFAULT_RETRY: RetryDelays = { firstMs: 30_000, maxMs: 10 * 60_000 }

/**
 * Drains the archive's embedding queue in the background whenever `kick`ed. When the embedder
 * fails, retries on a timer, doubling the delay each time it fails again, and ignores kicks until
 * then so a burst of uploads does not hammer a broken model. The queue itself is in the archive,
 * so kick once at startup to resume whatever a previous run left.
 */
export function embedInBackground(archive: Archive, log: Log, retry: RetryDelays = DEFAULT_RETRY) {
  let draining: Promise<void> | null = null
  let again = false
  let failures = 0
  let backoff: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  async function drain() {
    let embedded = 0
    try {
      do {
        again = false
        while (!stopped) {
          const n = await archive.embedPending(BATCH)
          if (!n) break
          embedded += n
        }
      } while (again && !stopped)
      failures = 0
    } catch (e) {
      if (stopped) return
      const delay = Math.min(retry.firstMs * 2 ** failures++, retry.maxMs)
      log("warn", "embedding failed", { error: e instanceof Error ? e.message : String(e), retryInMs: delay })
      backoff = setTimeout(() => {
        backoff = undefined
        kick()
      }, delay)
    } finally {
      if (embedded) log("info", "chunks embedded", { chunks: embedded })
      draining = null
    }
  }

  function kick() {
    if (stopped || backoff) return
    if (draining) again = true
    else draining = drain()
  }

  return {
    kick,
    /** Stop retrying and wait for an in-flight batch, so the archive can be closed. */
    async stop() {
      stopped = true
      clearTimeout(backoff)
      await draining
    },
  }
}
