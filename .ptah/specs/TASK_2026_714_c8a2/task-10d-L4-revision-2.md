# Task 10d.L4 revision 2 — admission refusal error type (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md (HARD RULES).
- Never strip MCP. Write LF only; do not convert line endings. UTF-8 without BOM. Touch ONLY the files in Scope.

## Input

T\code-logic-review-10d-L4-r1.md (REVISE 7.5/10): MAJOR at
W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts:~588-590. The `require-idle` refusal throws
`CodexChatAdapterError('busy','turn')`, but Claude throws `SessionAdmissionRefusedError` (find its definition and the
Claude throw sites in session-stream-pump.service.ts:236-316). Callers branch on that type:
W\libs\backend\cli-agent-runtime\src\lib\session-children\session-spawner.service.ts:~1519 and
surface-submit-turn.service.ts:~386 (find it).

## Fix

1. In the native Codex adapter, refuse an admission exactly as Claude does: throw `SessionAdmissionRefusedError`
   with the same reason values (`'busy'` when a turn runs or a peer turn is queued/reserved, `'session-ended'` when the
   session is closing/closed or blocked-closed, matching Claude's mapping). Import it from the agent-sdk location
   Claude uses (no deep cross-lib path). Do not change the callers.
2. Check every other place where native Codex `sendMessageToSession` with an admission option refuses today (the
   L4 queue `busy`/full refusals for require-idle, a closed session). Where Claude would throw
   `SessionAdmissionRefusedError` for the same state, throw it too. Peer messages WITHOUT require-idle keep the L4
   queue behavior. Record the mapping table under `## Decisions`.
3. Specs: `instanceof SessionAdmissionRefusedError` and the reason value for busy and for session-ended.
4. Fix any reviewer MINOR in the r1 review that is in Scope and cheap; list the others as not done.

## Scope (only these files)

- W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts, codex-chat-peer-queue.ts and their specs

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L4-revision-2-report.md
(write a skeleton early). Reply `WROTE: <path>` plus one headline line.
