# Task 10d.L4 — corrective batch: peer message to a busy native Codex main chat (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md (HARD RULES).
- Never strip MCP. Do NOT convert line endings: these files are LF; write LF only. UTF-8 without BOM.
- Native UI contracts must match Claude's exactly. Fix the gap in the backend; no frontend Codex special case.

## Defect (second live run, T\live-test-p10dP-r2.md scenario B, gap G2)

A lane calls `ptah_agent_report`; the report is delivered to the native Codex main chat and starts a main-chat turn.
The lane then ends while that turn still runs. The completion notifier calls `sendMessageToSession(parent, ...,
{ origin: peer })` and native Codex refuses: app.log `Completion signal not delivered ... delivery-failed ...
"Codex chat turn: busy"` (thrown at W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts:537,
`if (session.busy) throw new CodexChatAdapterError('busy', 'turn')`). The signal is lost. A Claude main chat accepts a
message during an active turn (find how: the Claude adapter's `sendMessageToSession` / streaming input queue; cite
file:line) and runs it after or within the current turn.

## Fix

1. Trace the Claude behavior for `sendMessageToSession` while a turn is active, and how
   `publishUntilAdmitted` / `CodexChatAdmission` work in the Codex adapter today. Record both under `## Decisions`.
2. Make native Codex `sendMessageToSession` match Claude for a busy session: accept the message and deliver it as the
   next turn when the active turn ends (a per-session FIFO queue in the backend adapter), with the same peer row
   (`inboundPeer`) when that turn starts. Do not drop, reorder or duplicate messages; a closed/blocked session
   rejects the queued messages with a coded error (no silent loss: log with the injected logger). Bound the queue
   and refuse with a coded error when full. If Codex App Server natively supports steering/queueing input into an
   active turn (check the protocol schema in W\libs\backend\codex-runtime\src\lib\protocol\ for `turn/steer` or
   similar) and that matches Claude better, prefer it and justify under `## Decisions`.
3. User-typed messages during a busy turn: keep today's UI behavior unless Claude's differs; state it.
4. Specs in codex-chat-adapter.spec.ts: (a) peer message during an active turn is queued and runs after it, with the
   peer row; (b) two queued messages keep order; (c) session closes with a queued message -> coded rejection, logged;
   (d) queue full -> coded refusal. Plus one notifier-level spec in
   W\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.spec.ts if needed.

## Scope

- W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts, codex-chat-turn-stream.ts and their specs
- New helper files under W\libs\backend\agent-sdk\src\lib\codex-app-server\ only if the adapter file would grow too large
- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.spec.ts (spec only)

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L4-report.md
(write a skeleton early): what changed (file:line), `## Decisions`, specs added, anything not done.
Reply `WROTE: <path>` plus one headline line.
