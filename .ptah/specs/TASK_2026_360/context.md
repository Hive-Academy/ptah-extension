# TASK_2026_360 — Context

## User intent (verbatim, two messages)

1. "our streaming status is not being properly updated why is that? the backend already
   finished working but the ui still shows as if its already sending, also in latest claude
   agent sdk changes claude do wait for some background subagents or scripts to run but we
   don't reflect that in the ui, basically we have a very bad and buggy syncing between the
   backend streaming and frontend streaming statuses, specially after those sleep and wake up
   features claude is doing"
2. "this need to be working across switching between different workspaces and different
   sessions running, and frontend should read the backend as its single source of truth"

Screenshot evidence: final assistant message rendered with merged stats
(2.2k tokens, $0.79, 1m 4s) — so `tab.status` was `loaded` and SESSION_STATS had merged —
while the red stop button (driven by `_streamingTabIds`) was still lit.

## Decisions already made

- **Backend owns the truth.** One per-session turn state, derived in the backend, delivered to
  the webview. The frontend derives spinner, stop button, input enablement and the workspace
  liveness dot from it. No frontend heuristic may re-derive "streaming" from event flow.
- **Ordering is a contract.** The turn-state event travels on the same ordered channel as the
  chunks (`StreamBatchBuffer`) so it can neither overtake nor trail them.
- **Multi-workspace + multi-session are first-class.** State is keyed by canonical session id,
  works for a tab in a background workspace partition, and for N concurrent sessions.
- Strategy: BUGFIX, Full depth (architect → team-leader → developers → reviewers → tester).
  Research phase is already done by the orchestrator — see `research-report.md`.
- `cli_delegation: disabled` (orchestrator default; sub-agents implement). Available CLI
  agents recorded for reference: codex (installed), antigravity (installed), copilot
  (disabled), ptah-cli lanes: "claude cli", "ollama cloud".

## Constraints from CLAUDE.md that bind this task

- Hexagonal rule: `agent-sdk` / `rpc-handlers` emit; no adapter imports in backend libs.
- New wire message type → append-only `MESSAGE_TYPES` + `payload-map.ts` + Zod schema in
  `libs/shared`. New RPC namespace (if any) → dual registration (`rpc.types.ts` +
  `ALLOWED_METHOD_PREFIXES`).
- `''` is never a session id; use `SessionId.safeParse`, never `from`, off the wire.
- Angular: signals + `inject()`, OnPush, no `[innerHTML]`.
- File-size soft ceiling 700; facade rule when splitting.
- `nx run-many -t test -p a b c` — never `nx test a b c`.
