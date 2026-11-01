# Task 10d.L4 revision 1 — busy-race review minors (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md (HARD RULES).
- Never strip MCP. Write LF only; do not convert line endings. UTF-8 without BOM. Touch ONLY the files in Scope.

## Input

Your batch: T\task-10d-L4-busy-race.md, T\batch-10d-L4-report.md (uncommitted diff in W).
Review: T\code-logic-review-10d-L4.md (APPROVED 7.5/10, minors only).

## Fix

1. Minor 1: honor `admission: 'require-idle'` for a peer send like Claude
   (W\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.ts:236-316): refuse with the
   same coded refusal when the session is busy or has queued items; do not queue it.
2. Minor 2: a queued entry that loses the start race to a non-queue turn (codex-chat-peer-queue.ts:~92-96) must stay
   at the head of the queue and start after that turn releases, not be rejected with `busy`. No reorder, no duplicate.
3. Minor 3: decide, with Claude evidence (what Claude does with its `session.messageQueue` on a user Stop / interrupt;
   cite file:line), whether a peer message queued or arriving during a Stop must survive. Match Claude. Record it
   under `## Decisions`.
4. Minor 4: pin `source: 'complete'` and `role: 'user'` with `inboundPeer` in the busy-turn peer spec.
5. Specs for 1-3 in codex-chat-adapter.spec.ts (or a codex-chat-peer-queue.spec.ts).

## Scope (only these files)

- W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-peer-queue.ts (+ a new codex-chat-peer-queue.spec.ts)
- W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts, codex-chat-turn-stream.ts and codex-chat-adapter.spec.ts

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L4-revision-1-report.md
(write a skeleton early): per minor: what changed (file:line) or why no change; specs. Reply `WROTE: <path>` plus one
headline line.
