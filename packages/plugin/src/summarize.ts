/**
 * The `recall_summarize` tool: whole archived sessions summarized, or asked a focused question, by
 * a model this host has credentials for, with each summary cached in the hub for every host.
 *
 * The transcript always comes from the hub, even for a session this host holds, so the cache key
 * describes the content the hub archived. A summary is cached only if the hub still holds that
 * content when it is done; a session that advanced meanwhile gets its summary back uncached.
 */
import type { Context as PluginContext } from "@opencode/plugin/promise/plugin"
import type { Info, ToolContext } from "@opencode/plugin/promise/tool"
import type { SummaryGet } from "@opencode-recall/protocol"
import { Clock, Effect, Result, Schema } from "effect"
import { PluginConfig } from "./config.ts"
import { Tools } from "./tools.ts"

/** OpenCode's one-shot text generation, which `ctx.generate` provides. */
export type Generate = Pick<PluginContext["generate"], "text">

/** Sessions one call summarizes at most, and at once. */
export const BATCH_MAX = 24
export const CONCURRENCY = 4

/**
 * Version of everything below that decides what a summary says, besides the session and model:
 * the prompts and the transcript budget. Bump it with any change to them, so summaries cached
 * under the old recipe stop matching.
 */
export const RECIPE = 1
const BUDGET = 300_000
const MESSAGE_CHARS = 2_000
const TIMEOUT_MS = 180_000

/**
 * `ctx.generate.text` takes only a prompt and a model: it sends the prompt as the one user message
 * with no system prompt, agent, or tools (OpenCode 2.0.14 `packages/core/src/generate.ts`), so the
 * worker's standing instructions lead the prompt instead.
 */
const WORKER_SYSTEM =
  "You analyze recorded OpenCode agent session transcripts. Follow the task instructions in this message exactly, and answer ONLY from the transcript provided. No preamble."

const TASK_FOCUSED =
  "Answer the question below using only the transcript. Be specific: name files, commands, ids, and decisions. If the transcript does not contain the answer, say so plainly."

const TASK_GENERAL =
  "Produce a tight summary of the transcript structured as: Goal; What was done (bullets); Key decisions & why; Gotchas/discoveries; Final state; Loose ends. Be specific: name files, commands, and ids. At most 350 words."

// The runtime forwards the JSON Schema below to the model without validating against it.
const Args = Schema.Struct({
  session_id: Schema.optionalKey(Schema.String),
  session_ids: Schema.optionalKey(Schema.Array(Schema.String)),
  focus: Schema.optionalKey(Schema.String),
  refresh: Schema.optionalKey(Schema.Boolean),
  providerID: Schema.optionalKey(Schema.String),
  modelID: Schema.optionalKey(Schema.String),
  variant: Schema.optionalKey(Schema.String),
})

const INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    session_id: { type: "string", description: "Session id (ses_...) or slug from recall_search" },
    session_ids: {
      type: "array",
      items: { type: "string" },
      description: `Batch: several session ids/slugs summarized concurrently in one call (max ${BATCH_MAX})`,
    },
    focus: {
      type: "string",
      description:
        "Optional question to answer from each session instead of a general summary, e.g. 'what did we decide about auth?'",
    },
    refresh: { type: "boolean", description: "Bypass the cache and re-summarize (default false)" },
    providerID: { type: "string", description: "Provider override (default from the recall config)" },
    modelID: { type: "string", description: "Model override (default from the recall config)" },
    variant: { type: "string", description: "Reasoning-effort variant override, or 'default' for the provider's own" },
  },
} as const

const DESCRIPTION =
  "ESCALATION rung: summarize entire past OpenCode sessions from any host sharing this recall hub (or answer a focused question about them) with a model this host has credentials for. Defaults to the summary model in the recall config (openai/gpt-5.6-luna at low reasoning unless configured otherwise); providerID, modelID, and variant may override that per call. Each fresh summary takes 10-30s, so try the instant tools first: recall_inspect to search within the session, recall_expand to read around a hit. Reach for this when inspection can't answer cleanly, the session is too large to page, or you genuinely need the whole-session story (results are cached in the hub, so repeats are instant from any host). Batch multiple sessions in one call via session_ids; they run concurrently."

/** What a cached summary is keyed by besides the session. */
type Key = Omit<SummaryGet, "session">

/** The model failed, timed out, or returned nothing. */
class Failed extends Schema.TaggedError<Failed>()("Summarize.Failed", { message: Schema.String }) {}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export const make = Effect.fnUntraced(function* (generate: Generate) {
  const config = yield* PluginConfig.Service

  const summarize = Effect.fnUntraced(function* (ref: string, key: Key, refresh: boolean, tag: string) {
    const suffix = key.focus ? ` · focus: ${key.focus}` : ""
    let session = ref
    if (!refresh) {
      const cached = yield* Tools.withHub((hub) => hub.summaryGet({ ...key, session: ref }))
      if (cached.kind === "missing") return Tools.notFound(ref)
      if (cached.kind === "cached")
        return `${Tools.header(cached, ref, "summarizing")}\n(cached ${Tools.fmtDateTime(cached.timeCreated)} · ${tag}${suffix})\n\n${cached.summary}`
      // Read the very session the slug named a moment ago.
      session = cached.session.sessionId
    }

    const transcript = yield* Tools.withHub((hub) => hub.transcript({ session, budget: BUDGET, maxChars: MESSAGE_CHARS }))
    if (transcript.kind === "missing") return Tools.notFound(ref)
    if (!transcript.text) return `${Tools.header(transcript, ref, "summarizing")}\nNothing to summarize: the archived session has no transcript content.`
    const s = transcript.session
    const prompt = [
      WORKER_SYSTEM,
      "",
      key.focus ? TASK_FOCUSED : TASK_GENERAL,
      "",
      ...(key.focus ? [`QUESTION: ${key.focus}`, ""] : []),
      `SESSION: ${s.title} (${Tools.shortDir(s.directory)}, ${Tools.fmtDate(s.timeCreated)})`,
      "TRANSCRIPT:",
      transcript.text,
    ].join("\n")

    const started = yield* Clock.currentTimeMillis
    const model = { providerID: key.provider, id: key.model, ...(key.variant !== undefined && { variant: key.variant }) }
    const { text } = yield* Effect.tryPromise({
      try: () => generate.text({ prompt, model }),
      catch: (e) => new Failed({ message: messageOf(e) }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: TIMEOUT_MS,
        orElse: () => Effect.fail(new Failed({ message: `the model did not answer within ${TIMEOUT_MS / 1000}s` })),
      }),
    )
    const summary = text.trim()
    if (!summary) return yield* new Failed({ message: "the model returned no text" })
    const secs = ((yield* Clock.currentTimeMillis) - started) / 1000

    const put = { ...key, sessionId: s.sessionId, contentHash: transcript.contentHash, summary }
    const cachedNote = yield* Tools.withHub((hub) =>
      hub.summaryPut(put).pipe(
        Effect.as(""),
        Effect.catchIf(
          (e) => e._tag === "HubError" && e.code === "stale_revision",
          () => Effect.succeed(" · not cached: the session advanced while it was summarized"),
        ),
      ),
    ).pipe(Effect.catchTag("Tools.CouldNotLook", (e) => Effect.succeed(` · not cached: ${e.message}`)))

    const cut = [
      transcript.omitted ? ` · ${transcript.omitted} messages omitted from the middle to fit ${BUDGET} characters` : "",
      transcript.clipped ? ` · ${transcript.clipped} messages cut to ${MESSAGE_CHARS} characters` : "",
    ].join("")
    const status = `(fresh · ${tag} · ${transcript.messages} messages${cut} · ${secs.toFixed(1)}s${suffix}${cachedNote})`
    return `${Tools.header(transcript, ref, "summarizing")}\n${status}\n\n${summary}`
  })

  const execute = Effect.fn("recall_summarize")(function* (input: unknown, ctx: Pick<ToolContext, "progress">) {
    const args = Schema.decodeUnknownResult(Args)(input)
    if (Result.isFailure(args)) return { content: `Invalid recall_summarize arguments: ${args.failure.message}` }
    const { session_id, session_ids = [], focus = "", refresh = false } = args.success
    const ids = [...new Set([session_id, ...session_ids].flatMap((id) => (id?.trim() ? [id.trim()] : [])))]
    if (!ids.length) return { content: "Provide session_id or session_ids." }
    if (ids.length > BATCH_MAX)
      return { content: `Too many sessions (${ids.length}); max ${BATCH_MAX} per call. Split into batches.` }

    const configured = yield* config.summaryModel.pipe(
      Effect.mapError((e) => new Tools.CouldNotLook({ message: `recall_summarize: the recall config is invalid (${e.message}).` })),
    )
    const provider = args.success.providerID?.trim() || configured.providerID
    const model = args.success.modelID?.trim() || configured.modelID
    const isConfigured = provider === configured.providerID && model === configured.modelID
    const requested = args.success.variant?.trim() || (isConfigured ? configured.variant : undefined)
    const variant = requested && requested.toLowerCase() !== "default" ? requested : undefined
    const key: Key = { provider, model, ...(variant && { variant }), focus: focus.trim(), recipe: RECIPE }
    const tag = `${provider}/${model}${variant ? `/${variant}` : ""}`

    let done = 0
    const blocks = yield* Effect.forEach(
      ids,
      (ref) =>
        summarize(ref, key, refresh, tag).pipe(
          Effect.catchTags({
            "Tools.CouldNotLook": (e) => Effect.succeed(`# ${ref}\n${e.message}`),
            "Summarize.Failed": (e) =>
              Effect.logWarning("summarize failed", ref, e.message).pipe(
                Effect.as(`# ${ref}\nSummarization failed with ${tag}: ${e.message}`),
              ),
          }),
          Effect.tap(() => {
            done++
            return ids.length > 1
              ? Effect.promise(() => ctx.progress({ title: `recall summarize: ${done}/${ids.length}` }).catch(() => {}))
              : Effect.void
          }),
        ),
      { concurrency: CONCURRENCY },
    )
    if (blocks.length === 1) return { content: blocks[0]!, metadata: { title: `recall summary: ${ids[0]}` } }
    return { content: blocks.join("\n\n---\n\n"), metadata: { title: `recall summaries: ${blocks.length} sessions` } }
  }, Effect.catchTag("Tools.CouldNotLook", (e) => Effect.succeed({ content: e.message })))

  const context = yield* Effect.context<PluginConfig.Service>()
  const info: Info<typeof INPUT> = {
    name: "recall_summarize",
    description: DESCRIPTION,
    input: INPUT,
    options: { codemode: false },
    execute: (input, ctx) => Effect.runPromiseWith(context)(execute(input, ctx)),
  }
  return info
})

export * as SummarizeTool from "./summarize.ts"
