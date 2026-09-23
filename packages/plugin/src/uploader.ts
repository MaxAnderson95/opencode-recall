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

/** An observed `session.deleted`, recorded when it is observed so every retry sends the same values. */
export const Deletion = Schema.Struct({ revision: Tombstone.fields.revision, timeDeleted: Tombstone.fields.timeDeleted })
export interface Deletion extends Schema.Schema.Type<typeof Deletion> {}

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
   * Sessions the hub holds that this host does not are left alone. Concurrent calls share one run;
   * the first success starts the periodic sweep.
   */
  readonly reconcile: Effect.Effect<void>
  /** Why uploads are held, or `None` while they flow. */
  readonly pausedBy: Effect.Effect<Option.Option<string>>
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
}

const defectMessage = (defect: unknown) => (defect instanceof Error ? defect.message : String(defect))

/** Logs a failure or defect of background work and continues; interruption still stops it. */
const logAndContinue =
  (message: (reason: string) => string) =>
  <A, E extends { readonly message: string }, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.catch((e) => Effect.logWarning(message(describe(e)))),
      Effect.catchDefect((defect) => Effect.logWarning(message(defectMessage(defect)))),
    )

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
 *
 * Its timers and background work belong to the layer's scope: releasing the layer stops them,
 * abandoning any upload in flight, whose work-list entry stays for the next run.
 */
export const layer = ({ quietMs = 2_000, retryMs = 30_000, probeIntervalMs = 30_000, sweepIntervalMs = 300_000 }: Timing = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const source = yield* Source.Service
      const storage = yield* Storage.Service
      const config = yield* PluginConfig.Service
      const scope = yield* Effect.scope

      const due = new Set<string>()
      const timers = yield* FiberMap.make<string>()
      const probing = yield* FiberHandle.make()
      const reconcileRetry = yield* FiberHandle.make()
      const sweeping = yield* FiberHandle.make()
      const draining = yield* Semaphore.make(1)
      let pausedBy: string | null = null
      let reconciling: Deferred.Deferred<void> | undefined
      /** A reconciliation was held back by a pause and runs once the hub accepts the config. */
      let reconcileOnResume = false

      const background = <A, E>(effect: Effect.Effect<A, E>) => Effect.asVoid(Effect.forkIn(effect, scope))

      const entries = (sessionId: string) =>
        storage.scan(sessionPrefix(sessionId), Position).pipe(Effect.map((found) => found.map(({ key, value }) => ({ key, position: value }))))

      const acknowledged = Effect.map(
        storage.scan(ACKED, Position),
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
        storage.set(entryKey(sessionId, position), position).pipe(Effect.andThen(schedule(sessionId, quietMs)))

      /** Keep the latest answered position; a racing instance writing an older one costs one no-op upload. */
      const recordAcked = Effect.fnUntraced(function* (sessionId: string, position: Position, held?: Position) {
        const current = held ?? (yield* storage.get(ACKED + sessionId, Position))
        if (!current || later(position, current) > 0) yield* storage.set(ACKED + sessionId, position)
      })

      const pause = (reason: string) =>
        Effect.gen(function* () {
          if (pausedBy === null) yield* Effect.logWarning(`uploads paused until configuration is fixed: ${reason}`)
          pausedBy = reason
          yield* FiberHandle.run(probing, probeUntilResumed, { onlyIfMissing: true })
        })

      /** One probe: whether the hub accepted the current config. */
      const probe = Effect.gen(function* () {
        const hub = yield* config.hub
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

      /** Send one request, turning its failure into what the work list should do next. */
      const attempt = (sessionId: string, request: Effect.Effect<unknown, HubError | TransportError>) =>
        request.pipe(
          Effect.as("done" as const),
          Effect.catch((e) => {
            const kind = classify(e)
            if (kind === "pause")
              return Effect.sync(() => due.add(sessionId)).pipe(Effect.andThen(pause(describe(e))), Effect.as("pause" as const))
            if (kind === "retry")
              return Effect.logWarning(`upload of ${sessionId} failed, retrying: ${describe(e)}`).pipe(
                Effect.andThen(schedule(sessionId, retryMs)),
                Effect.as("retry" as const),
              )
            return Effect.logWarning(`upload of ${sessionId} rejected and dropped: ${describe(e)}`).pipe(Effect.as("done" as const))
          }),
        )

      /**
       * Send the latest queued deletion; the hub keeps the later of two tombstones, so it covers the
       * earlier ones. Only the keys read before sending are removed, so a deletion observed meanwhile stays.
       */
      const sendTombstone = Effect.fnUntraced(function* (
        client: Client,
        sessionId: string,
        deletions: { key: string; value: Deletion }[],
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
        const deletions = yield* storage.scan(deletedPrefix(sessionId), Deletion)
        if (deletions.length > 0) return yield* sendTombstone(client, sessionId, deletions)

        const pending = yield* entries(sessionId)
        if (pending.length === 0) return "done" // Another instance already uploaded it.
        const snapshot = yield* source.snapshot(sessionId)
        // Gone without an observed deletion; absence is never deletion. Only the entries read are removed.
        if (Option.isNone(snapshot)) {
          for (const { key } of pending) yield* storage.remove(key)
          return "done"
        }
        const outcome = yield* attempt(sessionId, client.snapshot(snapshot.value))
        if (outcome === "done") yield* acknowledge(sessionId, snapshot.value)
        return outcome
      })

      /** Visit every due session, stopping at a pause. */
      const pass = Effect.gen(function* () {
        if (pausedBy !== null) return
        const hub = yield* config.hub.pipe(
          Effect.catch((e) => pause(`config could not be read: ${e.message}`).pipe(Effect.as(undefined))),
        )
        if (hub === undefined) return
        if (Option.isNone(hub)) return yield* pause("hub URL or token is not configured")
        const client = makeClient(hub.value)

        // Sessions that come due during the pass are visited too.
        for (let next = first(due); next !== undefined; next = first(due)) {
          const sessionId = next
          due.delete(sessionId)
          const retry = (reason: string) =>
            Effect.logWarning(`upload of ${sessionId} failed, retrying: ${reason}`).pipe(
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

      /** Find work left by a previous run or another instance. */
      const resume = Effect.gen(function* () {
        for (const { key } of yield* storage.scan(DIRTY, Schema.Unknown)) due.add(key.slice(DIRTY.length, key.lastIndexOf("/")))
        for (const { key } of yield* storage.scan(DELETED, Schema.Unknown)) due.add(key.slice(DELETED.length, key.lastIndexOf("/")))
      })

      /** Queue every local session whose position is later than the last one the hub answered. No network. */
      const sweep = Effect.gen(function* () {
        const acked = yield* acknowledged
        for (const [sessionId, position] of yield* source.positions()) {
          const held = acked.get(sessionId)
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
        const manifest = yield* makeClient(hub.value).manifest()
        const held = new Map(manifest.sessions.map((s) => [s.sessionId, s]))
        const tombstones = new Map(manifest.tombstones.map((t) => [t.sessionId, t.timeDeleted]))
        const acked = yield* acknowledged

        for (const [sessionId, local] of yield* source.positions()) {
          const timeDeleted = tombstones.get(sessionId)
          const hubCopy = held.get(sessionId)
          const current =
            timeDeleted !== undefined
              ? local.lastActivity <= timeDeleted // The hub would reject it as `tombstoned`.
              : hubCopy !== undefined &&
                hubCopy.extractorVersion >= EXTRACTOR_VERSION &&
                (later(local, hubCopy) <= 0 ||
                  Option.getOrUndefined(yield* source.snapshot(sessionId))?.contentHash === hubCopy.contentHash)
          if (current) yield* recordAcked(sessionId, local, acked.get(sessionId))
          else yield* markDirty(sessionId, local)
        }

        reconcileOnResume = false
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
        Effect.logWarning(`reconciliation failed, retrying: ${reason}`).pipe(
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
          storage.set(`${deletedPrefix(sessionId)}${deletion.timeDeleted}`, deletion).pipe(
            Effect.andThen(schedule(sessionId, quietMs)),
            logAndContinue((reason) => `could not record ${sessionId} as deleted: ${reason}`),
          ),
        reconcile,
        pausedBy: Effect.sync(() => Option.fromNullishOr(pausedBy)),
      })
    }),
  )

const first = (set: Set<string>): string | undefined => set.values().next().value

export * as Uploader from "./uploader.ts"
