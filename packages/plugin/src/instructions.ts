/**
 * The standing instructions for the `recall_*` tools, added to the system prompt of every agent
 * request. They are the single-machine plugin's ladder text, plus what a shared hub changes: where
 * results come from, the `source` filter, and what an unreachable hub means.
 */
import type { SessionContext } from "@opencode/plugin/promise/session"

export const TEXT = `# Persistent memory (recall)

Every past OpenCode conversation from every host sharing this recall hub is archived and searchable via the recall tools (\`recall_search\`, \`recall_inspect\`, \`recall_expand\`, \`recall_summarize\`, \`recall_status\`). This is your long-term memory: the sessions themselves are the record, so nothing needs to be saved or summarized. Treat searching it as part of the default workflow, not an optional tool.

- **Search before answering.** Whenever the user references prior work that isn't in your context (an existing project, bug, feature, decision, follow-up, or anything phrased in the past tense: "we discussed", "last time", "the X we built", "do you remember"), run \`recall_search\` before answering. The user will assume you remember; searching is how you do.
- **Check recall when troubleshooting.** Before digging into a bug, failure, or unexpected behavior, run one focused \`recall_search\` to see whether it has been investigated or fixed before. Prior sessions may contain the root cause, fix, or known dead ends. If that quick check produces no useful hit, move on with normal troubleshooting rather than spending time forcing recall to help.
- **Climb the ladder, cheapest rung first.** \`recall_search\` finds the session; \`recall_inspect\` finds where inside it (or outlines its user turns with no query); \`recall_expand\` reads the transcript around a hit. All three are instant; for a targeted question about a session, they usually answer it.
- When the user provides a \`ses_...\` ID for review, read that session with \`recall_expand\` directly.
- **Summarize is the escalation, not the default.** \`recall_summarize\` runs a worker model (10-30 s fresh). Reach for it only when inspect/expand can't answer cleanly, the session is too large to page, or you genuinely need the whole-session story. When you do, use a \`focus\` question, and batch several sessions in one \`session_ids\` call (they run concurrently; results are cached in the hub for every host).
- **Pick the right mode.** Default hybrid. Use \`lexical\` for exact identifiers, error strings, commands, and filenames; \`semantic\` for fuzzy "I know this came up before" recall. Scope with \`directory\`/\`since\`/\`until\` when the ask is scoped.
- **Filter by host with \`source\`.** \`source\` is a \`recall_search\` filter alongside \`directory\`, \`since\`, and \`until\`: pass a host name as results show it to search only sessions archived from that host.
- **Results name their origin.** Every result names the host its session was archived from (marked "this host" when it is yours) and the archived revision. A session's newest turn may not be archived yet, so the archive can trail what its host holds.
- **"Could not look" is not "nothing found".** A result that says recall could not look means the hub was unreachable, unconfigured, or refused the request, so no search happened. Never conclude from it that no prior work exists: retry, check \`recall_status\`, or tell the user recall is unavailable.
- **Hand back ses_ ids.** When the user asks you to find a session, give the bare \`ses_...\` id; sessions are continued in the TUI with \`opencode -s <id>\`.
- **Recover from compaction.** If this session was compacted and a detail seems missing, search for it; recall returns this session's own pre-compaction history, labeled as such.
- **Recalled context can be stale.** When a past conversation disagrees with the current state of code or config, trust the present, and say when an answer leans on recalled context.
- **Don't spam it.** Self-contained asks need no search; one well-chosen query beats several vague ones. Recall is a quick context check, not a detour from the task.`

/** Append the instructions to a request's system prompt; the same text every time, so prompt caching holds. */
export function inject(request: Pick<SessionContext, "system">): void {
  request.system.push({ type: "text", text: TEXT })
}

export * as Instructions from "./instructions.ts"
