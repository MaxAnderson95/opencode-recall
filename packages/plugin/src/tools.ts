/**
 * What the `recall_*` tools share: the call to the configured hub, and the formatting of what the
 * hub answers, in the single-machine recall plugin's output format.
 */
import { homedir } from "node:os"
import {
  makeClient,
  type Client,
  type HubError,
  type Responses,
  type Search,
  type SearchHit,
  type TransportError,
} from "@opencode-recall/protocol"
import { Effect, Option, Schema } from "effect"
import { PluginConfig } from "./config.ts"

/** The hub was not asked or did not answer; `message` tells the model this is not an empty result. */
export class CouldNotLook extends Schema.TaggedError<CouldNotLook>()("Tools.CouldNotLook", { message: Schema.String }) {}

/** Run `call` against the hub as configured right now. */
export const withHub = Effect.fnUntraced(function* <A>(call: (client: Client) => Effect.Effect<A, HubError | TransportError>) {
  const hub = yield* (yield* PluginConfig.Service).hub.pipe(
    Effect.mapError(
      (e) => new CouldNotLook({ message: `recall could not look: the recall config is invalid (${e.message}). This is not an empty result.` }),
    ),
  )
  if (Option.isNone(hub))
    return yield* new CouldNotLook({
      message:
        "recall could not look: no hub is configured. Set OPENCODE_RECALL_HUB_URL and OPENCODE_RECALL_TOKEN, or hub.url and hub.token in recall.json. This is not an empty result.",
    })
  return yield* call(makeClient(hub.value)).pipe(
    Effect.mapError(
      (e) =>
        new CouldNotLook({
          message: `recall could not look: the hub request failed (${e._tag === "HubError" ? `${e.code}: ${e.message}` : e.message}). This is not an empty result.`,
        }),
    ),
  )
})

export const parseWhen = (s: string | undefined): number | undefined => {
  const ms = s ? Date.parse(s) : NaN
  return Number.isNaN(ms) ? undefined : ms
}

export const clampInt = (v: number | undefined, lo: number, hi: number, dflt: number): number =>
  v === undefined || !Number.isFinite(v) ? dflt : Math.max(lo, Math.min(Math.round(v), hi))

const pad = (n: number) => String(n).padStart(2, "0")

export function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms)
  return `${fmtDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const home = homedir()
export const shortDir = (dir: string) => (home && dir.startsWith(home) ? "~" + dir.slice(home.length) : dir)

/** Where the archived copy came from, as search results and session headers name it. */
export const origin = (s: { source: string; ownSource: boolean; revision: number }) =>
  `from ${s.source || "an unknown host"}${s.ownSource ? " (this host)" : ""}, archived revision ${s.revision}`

/** How a hit matched, and what kind of message it came from. */
export function via(hit: SearchHit, parentId: string | null, scope: Search["scope"]): string {
  if (hit.branch === "semantic")
    return `semantic ${hit.score.toFixed(2)} · ${scope === "user-messages" ? "Top-level user message" : "Conversation context (mixed origins)"}`
  const kind =
    hit.kind === "tool"
      ? "Tool output"
      : hit.messageType === "user"
        ? parentId
          ? "Child user message"
          : "Top-level user message"
        : hit.messageType === "synthetic"
          ? "Synthetic context"
          : `${hit.messageType} text`
  return `lexical/${hit.kind} · ${kind}`
}

type Resolved = Pick<Extract<Responses["expand"], { kind: "window" }>, "session" | "sameSlug">

/** The heading of a one-session answer, with a note when `ref` was a slug several sessions share. */
export function header({ session: s, sameSlug }: Resolved, ref: string, verb: string): string {
  const note = sameSlug.length
    ? `NOTE: ${sameSlug.length + 1}+ sessions share slug '${ref}'; ${verb} the most recent. Others: ${sameSlug
        .map((o) => `${o.sessionId} (${o.title.slice(0, 40)}, ${fmtDate(o.timeUpdated)})`)
        .join("; ")}\n`
    : ""
  return `${note}# ${s.title || "(untitled)"}\nsession_id=${s.sessionId} slug=${s.slug} · ${shortDir(s.directory)} · ${fmtDate(s.timeCreated)} → ${fmtDate(s.timeUpdated)} · ${origin(s)}`
}

export const notFound = (ref: string) =>
  `No archived session found for '${ref}'. A session appears once its host uploads a finished turn.`

export * as Tools from "./tools.ts"
