# opencode-recall

Shared, multi-host conversation memory for OpenCode: a central recall service with its own archive, plus a thin per-host OpenCode plugin that uploads idle sessions and serves the `recall_*` tool ladder against the service.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
