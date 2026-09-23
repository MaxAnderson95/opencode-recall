import {
  HubError,
  Tombstone,
  makeClient,
  type Client,
  type ErrorCode,
  type Snapshot,
  type TransportError,
} from "@opencode-recall/protocol"
import {
  Clock,
  Context,
  Deferred,
  Effect,
  FiberHandle,
  FiberMap,
  Layer,
  Option,
  Schedule,
  Schema,
  Scope,
  Semaphore,
} from "effect"
import { PluginConfig } from "./config.ts"
import { EXTRACTOR_VERSION, Position, Source } from "./source.ts"
import { Storage } from "./storage.ts"

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
function classify(e: { readonly _tag: string }): "pause" | "terminal" | "retry" {
  if (!(e instanceof HubError)) return "retry"
  if (PAUSING.has(e.code)) return "pause"
  if (TERMINAL.has(e.code)) return "terminal"
  if (RETRYABLE.has(e.code)) return "retry"
  return e.status >= 500 ? "retry" : "terminal"
}

const describe = (e: { readonly message: string }) => (e instanceof HubError ? `${e.code}: ${e.message}` : e.message)

/**
 * Work-list entries live in `ctx.storage` at `dirty/<sessionId>/<lastActivity>-<revision>`, one per
 * observed position. A key names exactly one piece of work, so an acknowledgement can remove the
 * entries its upload covers without ever touching one written after it read the list; that is what
 * makes the rule hold without compare-and-set. Rewriting a removed key only costs a no-op upload.
 *
 * Each tombstone to send, an observed deletion or an exclusion, waits at its own
 * `deleted/<sessionId>/<timeDeleted>` key for the same reason. The last position the hub answered
 * for each session, whether it accepted it or not, is kept at `acked/<sessionId>` so the periodic
 * sweep can find sessions whose change events were lost without asking the hub.
 */
const DIRTY = "dirty/"
const DELETED = "deleted/"
const ACKED = "acked/"
const sessionPrefix = (sessionId: string) => `${DIRTY}${sessionId}/`
const entryKey = (sessionId: string, p: Position) => `${sessionPrefix(sessionId)}${p.lastActivity}-${p.revision}`
const deletedPrefix = (sessionId: string) => `${DELETED}${sessionId}/`

const later = (a: Position, b: Position) => a.lastActivity - b.lastActivity || a.revision - b.revision

/** Sessions in the order a backfill sends them, so their quiet periods also end newest first. */
const newestFirst = (sessions: ReadonlyMap<string, Source.Local>) =>
  [...sessions].sort(([, a], [, b]) => later(b.position, a.position))

/** An observed `session.deleted`. */
export const Deletion = Schema.Struct({ revision: Tombstone.fields.revision, timeDeleted: Tombstone.fields.timeDeleted })
export interface Deletion extends Schema.Schema.Type<typeof Deletion> {}

/** A tombstone waiting to be sent, recorded when it is created so every retry sends the same values. */
const Queued = Schema.Struct({ ...Deletion.fields, reason: Tombstone.fields.reason })
interface Queued extends Schema.Schema.Type<typeof Queued> {}

export interface Interface {
  /**
   * Record that a session changed. The change is written to the work list at once; the upload
   * waits for a quiet period, so a burst of events for one session produces one upload.
   */
  readonly enqueue: (sessionId: string) => Effect.Effect<void>
  /** Record an observed deletion. A tombstone is sent in place of any upload still queued for it. */
  readonly delete: (sessionId: string, deletion: Deletion) => Effect.Effect<void>
  /**
   * Diff the hub's manifest against the local database and queue every session the hub lacks,
   * holds at an earlier position with different content, or extracted with an older extractor.
   * A session in an excluded directory is never queued; if the hub holds it, an exclusion
   * tombstone is queued instead, and a session this host excluded before is queued once its
   * exclusion is lifted. Sessions the hub holds that this host does not are left alone.
   * Concurrent calls share one run; the first success starts the periodic sweep.
   */
  readonly reconcile: Effect.Effect<void>
  /** What `recall_status` reports about this host's uploads, read from the work list and the local database. */
  readonly state: Effect.Effect<State, Storage.Failed>
}

export interface State {
  /** Sessions with an upload or a deletion waiting. */
  readonly queued: number
  /** Sessions this host holds outside excluded directories, and how many of them the hub has answered at their current position. */
  readonly local: number
  readonly answered: number
  /** Whether a manifest diff is running, and when one last completed in this process. */
  readonly reconciling: boolean
  readonly lastReconciled: Option.Option<number>
  /** Why uploads are held, or `None` while they flow. */
  readonly pausedBy: Option.Option<string>
  /** The latest failure this process logged, with when it happened. */
  readonly lastError: Option.Option<{ readonly message: string; readonly time: number }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-recall/plugin/Uploader") {}

export type Timing = {
  /** How long a session must stay quiet before its snapshot is built. */
  quietMs?: number
  /** Delay before a retryable failure is sent again. */
  retryMs?: number
  /** How often a paused uploader re-reads config and probes the hub. */
  probeIntervalMs?: number
  /** How often the local database is compared against the acknowledged positions. */
  sweepIntervalMs?: number
  /** How often the config file is re-read for a changed `excludeDirectories`. */
  configPollMs?: number
  /** Least time between the end of one hub request and the start of the next. */
  uploadIntervalMs?: number
}

const defectMessage = (defect: unknown) => (defect instanceof Error ? defect.message : String(defect))

/**
 * Uploads dirty sessions one at a time from a work list in `ctx.storage`, building each snapshot
 * at send time. There is no lease: several instances may upload one session, and the hub turns the
 * duplicate into a no-op. An acknowledgement removes a work-list entry only when the position it
 * uploaded covers the entry's observed position, so a change made mid-upload is sent afterwards.
 *
 * Absence is never deletion: a queued session that has vanished from the database is dropped, and
 * only an observed deletion or an exclusion produces a tombstone.
 *
 * `excludeDirectories` is checked when each snapshot is built and again after it is sent, so a
 * queued upload of a session excluded meanwhile is dropped and one that raced the change is
 * tombstoned. The config file is polled; a changed list reconciles against the manifest, which
 * tombstones every newly excluded session the hub holds and re-uploads every one no longer excluded.
 *
 * Due sessions are sent newest first, by the latest activity recorded with their work, so a
 * backfill of thousands of sessions reaches recent history first and a live turn is never queued
 * behind old ones. Requests are spaced by `uploadIntervalMs`, which bounds this instance to one
 * request in flight and at most two a second by default: about the rate the hub embeds at (45
 * chunks/s over roughly 17 chunks a session), and slow enough that building snapshots does not
 * monopolise OpenCode's event loop.
 *
 * A missing config, `invalid_token`, or `protocol_version` pauses the queue with its work intact;
 * while paused it periodically re-reads config and calls `status`, and resumes once that succeeds.
 *
 * Its timers and background work belong to the layer's scope: releasing the layer stops them,
 * abandoning any upload in flight, whose work-list entry stays for the next run.
 */
export const layer = ({
  quietMs = 2_000,
  retryMs = 30_000,
  probeIntervalMs = 30_000,
  sweepIntervalMs = 300_000,
  configPollMs = 5_000,
  uploadIntervalMs = 500,
}: Timing = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const source = yield* Source.Service
      const storage = yield* Storage.Service
      const config = yield* PluginConfig.Service
      const scope = yield* Effect.scope

      const due = new Set<string>()
      /** The latest activity recorded with each session's work, which orders `due` newest first. One number per session. */
      const activity = new Map<string, number>()
      const noteActivity = (sessionId: string, time: number) =>
        activity.set(sessionId, Math.max(time, activity.get(sessionId) ?? time))
      const newestDue = () => {
        let newest: string | undefined
        let latest = -Infinity
        for (const sessionId of due) {
          const time = activity.get(sessionId) ?? 0
          if (time > latest) [newest, latest] = [sessionId, time]
        }
        return newest
      }
      let nextRequestAt = 0
      const timers = yield* FiberMap.make<string>()
      const probing = yield* FiberHandle.make()
      const reconcileRetry = yield* FiberHandle.make()
      const sweeping = yield* FiberHandle.make()
      const draining = yield* Semaphore.make(1)
      let pausedBy: string | null = null
      let reconciling: Deferred.Deferred<void> | undefined
      /** A reconciliation was held back by a pause and runs once the hub accepts the config. */
      let reconcileOnResume = false
      let lastReconciled: number | null = null
      let lastError: { message: string; time: number } | null = null

      /** Log a failure and keep it as the one `recall_status` reports. */
      const warn = (message: string) =>
        Effect.gen(function* () {
          yield* Effect.logWarning(message)
          lastError = { message, time: yield* Clock.currentTimeMillis }
        })

      /** Logs a failure or defect of background work and continues; interruption still stops it. */
      const logAndContinue =
        (message: (reason: string) => string) =>
        <A, E extends { readonly message: string }, R>(self: Effect.Effect<A, E, R>) =>
          self.pipe(
            Effect.catch((e) => warn(message(describe(e)))),
            Effect.catchDefect((defect) => warn(message(defectMessage(defect)))),
          )

      const background = <A, E>(effect: Effect.Effect<A, E>) => Effect.asVoid(Effect.forkIn(effect, scope))

      /**
       * Every entry under `prefix` that decodes as `schema`. One that does not, such as a shape an
       * earlier build wrote, is removed with a warning: no retry can make it decode, and keeping it
       * would fail every pass that reads its session.
       */
      const scanKept = Effect.fnUntraced(function* <A>(prefix: string, schema: Schema.Codec<A>) {
        const kept: { key: string; value: A }[] = []
        for (const { key, value } of yield* storage.scan(prefix, Schema.Unknown)) {
          const decoded = Schema.decodeUnknownOption(schema)(value)
          if (Option.isSome(decoded)) kept.push({ key, value: decoded.value })
          else {
            yield* warn(`dropped unreadable work-list entry ${key}: ${JSON.stringify(value)}`)
            yield* storage.remove(key)
          }
        }
        return kept
      })

      const entries = (sessionId: string) =>
        scanKept(sessionPrefix(sessionId), Position).pipe(Effect.map((found) => found.map(({ key, value }) => ({ key, position: value }))))

      const acknowledged = Effect.map(
        scanKept(ACKED, Position),
        (found) => new Map(found.map(({ key, value }) => [key.slice(ACKED.length), value])),
      )

      const schedule = (sessionId: string, ms: number) =>
        Effect.asVoid(
          FiberMap.run(
            timers,
            sessionId,
            Effect.sleep(ms).pipe(
              Effect.andThen(Effect.sync(() => due.add(sessionId))),
              Effect.andThen(background(drain)),
            ),
          ),
        )

      const markDirty = (sessionId: string, position: Position) =>
        storage.set(entryKey(sessionId, position), position).pipe(
          Effect.andThen(Effect.sync(() => noteActivity(sessionId, position.lastActivity))),
          Effect.andThen(schedule(sessionId, quietMs)),
        )

      /** Queue a tombstone, which the next pass sends in place of any upload still queued for the session. */
      const markDeleted = (sessionId: string, queued: Queued) =>
        storage.set(`${deletedPrefix(sessionId)}${queued.timeDeleted}`, queued).pipe(
          Effect.andThen(Effect.sync(() => noteActivity(sessionId, queued.timeDeleted))),
          Effect.andThen(schedule(sessionId, quietMs)),
        )

      /** Keep the latest answered position; a racing instance writing an older one costs one no-op upload. */
      const recordAcked = Effect.fnUntraced(function* (sessionId: string, position: Position, held?: Position) {
        const current = held ?? (yield* storage.get(ACKED + sessionId, Position))
        if (!current || later(position, current) > 0) yield* storage.set(ACKED + sessionId, position)
      })

      const pause = (reason: string) =>
        Effect.gen(function* () {
          if (pausedBy === null) yield* warn(`uploads paused until configuration is fixed: ${reason}`)
          pausedBy = reason
          yield* FiberHandle.run(probing, probeUntilResumed, { onlyIfMissing: true })
        })

      /** One probe: whether the hub accepted the current config. */
      const probe = Effect.gen(function* () {
        const hub = yield* config.hub
        yield* config.excludeDirectories
        if (Option.isNone(hub)) return false
        yield* makeClient(hub.value).status()
        return true
      }).pipe(
        Effect.catch((e) =>
          Effect.sync(() => {
            if (e instanceof HubError && PAUSING.has(e.code)) pausedBy = describe(e)
            return false
          }),
        ),
      )

      const probeUntilResumed = Effect.gen(function* () {
        yield* probe.pipe(Effect.delay(probeIntervalMs), Effect.repeat({ until: (accepted) => accepted }))
        yield* Effect.logInfo("configuration accepted by the hub; uploads resumed")
        pausedBy = null
        if (reconcileOnResume) yield* background(reconcile)
        yield* background(drain)
      })

      /** Remove the entries `sent` covers; a later observation stays for the next pass. */
      const acknowledge = Effect.fnUntraced(function* (sessionId: string, sent: Position) {
        for (const { key, position } of yield* entries(sessionId)) if (later(position, sent) <= 0) yield* storage.remove(key)
        yield* recordAcked(sessionId, sent)
      })

      /** Queue a tombstone for a session excluded by configuration, timed by this host's clock. */
      const exclude = Effect.fnUntraced(function* (sessionId: string, revision: number) {
        const timeDeleted = yield* Clock.currentTimeMillis
        yield* markDeleted(sessionId, { revision, timeDeleted, reason: "excluded" })
      })

      /** Hold `request` until `uploadIntervalMs` has passed since the previous one ended. */
      const paced = <A, E>(request: Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          const wait = nextRequestAt - (yield* Clock.currentTimeMillis)
          if (wait > 0) yield* Effect.sleep(wait)
          return yield* request
        }).pipe(
          Effect.ensuring(Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.sync(() => (nextRequestAt = now + uploadIntervalMs)))),
        )

      /** Send one request, turning its failure into what the work list should do next. */
      const attempt = (sessionId: string, request: Effect.Effect<unknown, HubError | TransportError>) =>
        paced(request).pipe(
          Effect.as("done" as const),
          Effect.catch((e) => {
            const kind = classify(e)
            if (kind === "pause")
              return Effect.sync(() => due.add(sessionId)).pipe(Effect.andThen(pause(describe(e))), Effect.as("pause" as const))
            if (kind === "retry")
              return warn(`upload of ${sessionId} failed, retrying: ${describe(e)}`).pipe(
                Effect.andThen(schedule(sessionId, retryMs)),
                Effect.as("retry" as const),
              )
            return warn(`upload of ${sessionId} rejected and dropped: ${describe(e)}`).pipe(Effect.as("done" as const))
          }),
        )

      /**
       * Send the latest queued deletion; the hub keeps the later of two tombstones, so it covers the
       * earlier ones. Only the keys read before sending are removed, so a deletion observed meanwhile stays.
       */
      const sendTombstone = Effect.fnUntraced(function* (
        client: Client,
        sessionId: string,
        deletions: { key: string; value: Queued }[],
      ) {
        const { value: deletion } = deletions.reduce((a, b) => (b.value.timeDeleted > a.value.timeDeleted ? b : a))
        const pending = yield* entries(sessionId)
        const outcome = yield* attempt(sessionId, client.tombstone({ sessionId, ...deletion }))
        if (outcome !== "done") return outcome

        for (const { key } of deletions) yield* storage.remove(key)
        yield* storage.remove(ACKED + sessionId)
        // Work observed after the deletion belongs to a re-import and is uploaded on its own.
        let reimported = false
        for (const { key, position } of pending)
          if (position.lastActivity <= deletion.timeDeleted) yield* storage.remove(key)
          else reimported = true
        if (reimported) yield* schedule(sessionId, quietMs)
        return outcome
      })

      const send = Effect.fnUntraced(function* (client: Client, sessionId: string) {
        const deletions = yield* scanKept(deletedPrefix(sessionId), Queued)
        if (deletions.length > 0) return yield* sendTombstone(client, sessionId, deletions)

        const pending = yield* entries(sessionId)
        if (pending.length === 0) return "done" // Another instance already uploaded it.
        const snapshot = yield* source.snapshot(sessionId)
        const excluded = Effect.map(config.excludeDirectories, (roots) =>
          Option.isSome(snapshot) && PluginConfig.isExcluded(roots, snapshot.value.session.directory),
        )
        // Gone without an observed deletion, or excluded; absence is never deletion. Only the entries read are removed.
        if (Option.isNone(snapshot) || (yield* excluded)) {
          for (const { key } of pending) yield* storage.remove(key)
          // Answered before, so the hub may hold it: the session moved into an excluded directory.
          if (Option.isSome(snapshot) && (yield* storage.get(ACKED + sessionId, Position)))
            yield* exclude(sessionId, snapshot.value.revision)
          return "done"
        }
        const outcome = yield* attempt(sessionId, client.snapshot(snapshot.value))
        if (outcome !== "done") return outcome
        yield* acknowledge(sessionId, snapshot.value)
        // Excluded while the upload was in flight: the hub must not keep what it just accepted.
        if (yield* excluded) yield* exclude(sessionId, snapshot.value.revision)
        return outcome
      })

      /** Visit every due session, stopping at a pause. */
      const pass = Effect.gen(function* () {
        if (pausedBy !== null) return
        // An unreadable exclusion list holds every upload, since any of them might be excluded.
        const hub = yield* config.excludeDirectories.pipe(
          Effect.andThen(config.hub),
          Effect.catch((e) => pause(`config could not be read: ${e.message}`).pipe(Effect.as(undefined))),
        )
        if (hub === undefined) return
        if (Option.isNone(hub)) return yield* pause("hub URL or token is not configured")
        const client = makeClient(hub.value)

        // Sessions that come due during the pass are visited too.
        for (let next = newestDue(); next !== undefined; next = newestDue()) {
          const sessionId = next
          due.delete(sessionId)
          const retry = (reason: string) =>
            warn(`upload of ${sessionId} failed, retrying: ${reason}`).pipe(
              Effect.andThen(schedule(sessionId, retryMs)),
              Effect.as("retry" as const),
            )
          const outcome = yield* send(client, sessionId).pipe(
            Effect.catch((e) => retry(e.message)),
            Effect.catchDefect((defect) => retry(defectMessage(defect))),
          )
          if (outcome === "pause") return
        }
      })

      /** One pass at a time; a session that comes due as a pass finishes starts another. */
      const drain: Effect.Effect<void> = Effect.gen(function* () {
        const ran = yield* pass.pipe(draining.withPermitsIfAvailable(1))
        if (Option.isSome(ran) && due.size > 0 && pausedBy === null) yield* drain
      })

      /** Every session with work in the list, from any instance. */
      const queuedSessions = Effect.gen(function* () {
        const ids = new Set<string>()
        for (const { key } of yield* storage.scan(DIRTY, Schema.Unknown)) ids.add(key.slice(DIRTY.length, key.lastIndexOf("/")))
        for (const { key } of yield* storage.scan(DELETED, Schema.Unknown)) ids.add(key.slice(DELETED.length, key.lastIndexOf("/")))
        return ids
      })

      /** Find work left by a previous run or another instance. */
      const resume = Effect.gen(function* () {
        const found = [
          ...(yield* scanKept(DIRTY, Position)).map(({ key, value }) => ({ key, time: value.lastActivity })),
          ...(yield* scanKept(DELETED, Queued)).map(({ key, value }) => ({ key, time: value.timeDeleted })),
        ]
        for (const { key, time } of found) {
          const sessionId = key.slice(key.indexOf("/") + 1, key.lastIndexOf("/"))
          noteActivity(sessionId, time)
          due.add(sessionId)
        }
      })

      /**
       * Queue every local session whose position is later than the last one the hub answered, and a
       * tombstone for every excluded session the hub answered since its last tombstone, which is how
       * a lost `session.moved` into an excluded directory is caught. No network.
       */
      const sweep = Effect.gen(function* () {
        const acked = yield* acknowledged
        const roots = yield* config.excludeDirectories
        const tombstoning = new Set((yield* storage.scan(DELETED, Schema.Unknown)).map(({ key }) => key.split("/")[1]))
        for (const [sessionId, { position, directory }] of newestFirst(yield* source.positions())) {
          const held = acked.get(sessionId)
          if (PluginConfig.isExcluded(roots, directory)) {
            if (held && !tombstoning.has(sessionId)) yield* exclude(sessionId, position.revision)
            continue
          }
          if (!held || later(position, held) > 0) yield* markDirty(sessionId, position)
        }
      })

      const sweepForever = sweep.pipe(
        logAndContinue((reason) => `sweep failed: ${reason}`),
        Effect.delay(sweepIntervalMs),
        Effect.repeat(Schedule.forever),
      )

      const diffManifest = Effect.gen(function* () {
        const hub = yield* config.hub
        if (Option.isNone(hub) || pausedBy !== null) {
          reconcileOnResume = true
          if (Option.isNone(hub)) yield* pause("hub URL or token is not configured")
          return
        }
        const roots = yield* config.excludeDirectories
        const manifest = yield* makeClient(hub.value).manifest()
        const held = new Map(manifest.sessions.map((s) => [s.sessionId, s]))
        const tombstones = new Map(manifest.tombstones.map((t) => [t.sessionId, t]))
        const acked = yield* acknowledged

        for (const [sessionId, { position: local, directory }] of newestFirst(yield* source.positions())) {
          const tombstone = tombstones.get(sessionId)
          const hubCopy = held.get(sessionId)
          if (PluginConfig.isExcluded(roots, directory)) {
            // Archived before the exclusion: purge it, and the summaries cached for it.
            if (hubCopy !== undefined) yield* exclude(sessionId, local.revision)
            continue
          }
          // A tombstone this host recorded by excluding the session is lifted by its upload.
          const current =
            !tombstone?.excludedByCaller &&
            (tombstone !== undefined
              ? local.lastActivity <= tombstone.timeDeleted // The hub would reject it as `tombstoned`.
              : hubCopy !== undefined &&
                hubCopy.extractorVersion >= EXTRACTOR_VERSION &&
                (later(local, hubCopy) <= 0 ||
                  Option.getOrUndefined(yield* source.snapshot(sessionId))?.contentHash === hubCopy.contentHash))
          if (current) yield* recordAcked(sessionId, local, acked.get(sessionId))
          else yield* markDirty(sessionId, local)
        }

        reconcileOnResume = false
        lastReconciled = yield* Clock.currentTimeMillis
        yield* FiberHandle.run(sweeping, sweepForever, { onlyIfMissing: true })
      }).pipe(
        Effect.catch((e) => {
          if (classify(e) !== "pause") return retryReconcile(describe(e))
          reconcileOnResume = true
          return pause(describe(e))
        }),
        Effect.catchDefect((defect) => retryReconcile(defectMessage(defect))),
      )

      const retryReconcile = (reason: string) =>
        warn(`reconciliation failed, retrying: ${reason}`).pipe(
          Effect.andThen(FiberHandle.run(reconcileRetry, Effect.delay(reconcile, retryMs))),
          Effect.asVoid,
        )

      const reconcile: Effect.Effect<void> = Effect.gen(function* () {
        if (reconciling) return yield* Deferred.await(reconciling)
        const done = yield* Deferred.make<void>()
        reconciling = done
        const run = diffManifest.pipe(
          Effect.ensuring(Effect.sync(() => (reconciling = undefined))),
          Effect.exit,
          Effect.flatMap((exit) => Deferred.done(done, exit)),
        )
        yield* Effect.forkIn(run, scope)
        yield* Deferred.await(done)
      })

      /** Reconcile against the config as it is now, after any run that may have read an older one. */
      const reconcileAgain = Effect.gen(function* () {
        if (reconciling) yield* Deferred.await(reconciling)
        yield* reconcile
      })

      const exclusionsKey = config.excludeDirectories.pipe(Effect.map((roots) => JSON.stringify(roots)), Effect.option)
      let appliedExclusions = yield* exclusionsKey
      /** An unreadable list is not a change: uploads stay paused on it until it reads again. */
      const watchExclusions = Effect.gen(function* () {
        const key = yield* exclusionsKey
        if (Option.isNone(key) || Option.getOrUndefined(appliedExclusions) === key.value) return
        appliedExclusions = key
        yield* Effect.logInfo(`excluded directories changed to ${key.value}; reconciling`)
        yield* reconcileAgain
      }).pipe(Effect.delay(configPollMs), Effect.repeat(Schedule.forever))
      yield* Effect.forkIn(watchExclusions, scope)

      // Read before the layer is ready, so the list is the one left before this instance records anything.
      yield* resume.pipe(logAndContinue((reason) => `work list could not be read: ${reason}`))
      yield* background(drain)

      return Service.of({
        enqueue: (sessionId) =>
          source.position(sessionId).pipe(
            Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (position) => markDirty(sessionId, position) })),
            logAndContinue((reason) => `could not record ${sessionId} as dirty: ${reason}`),
          ),
        delete: (sessionId, deletion) =>
          markDeleted(sessionId, { ...deletion, reason: "deleted" }).pipe(
            logAndContinue((reason) => `could not record ${sessionId} as deleted: ${reason}`),
          ),
        reconcile,
        state: Effect.gen(function* () {
          const queued = yield* queuedSessions
          const acked = yield* acknowledged
          // An unreadable exclusion list holds every upload, and status reports that on its own line.
          const roots = yield* config.excludeDirectories.pipe(Effect.orElseSucceed(() => []))
          let local = 0
          let answered = 0
          for (const [sessionId, { position, directory }] of yield* source.positions()) {
            if (PluginConfig.isExcluded(roots, directory)) continue
            local++
            const held = acked.get(sessionId)
            if (held && later(position, held) <= 0) answered++
          }
          return {
            queued: queued.size,
            local,
            answered,
            reconciling: reconciling !== undefined,
            lastReconciled: Option.fromNullishOr(lastReconciled),
            pausedBy: Option.fromNullishOr(pausedBy),
            lastError: Option.fromNullishOr(lastError),
          }
        }),
      })
    }),
  )

export * as Uploader from "./uploader.ts"
