# Task 10d.L3 revision 1 — batch N review fixes (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md (HARD RULES).
- Never strip MCP. Do NOT convert line endings: these files are LF. Your previous run converted
  codex-chat-adapter.ts, codex-chat-adapter.spec.ts and codex-chat-turn-stream.ts to CRLF; the coordinator converted
  them back. Write LF only. UTF-8 without BOM.
- Another codex lane edits W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts
  and its spec at the same time. Do not touch anything under ...\cli-adapters\codex\.

## Input

Your earlier batch: T\task-10d-L3-lane-completion.md and T\batch-10d-L3-report.md (current uncommitted diff in W).
Review: T\code-logic-review-10d-L.md, section for batch N (REVISE 6/10).

Coordinator notes (checked): the Claude user-message transformer also emits `source: 'complete'`
(W\libs\backend\agent-sdk\src\lib\message-transform\user-message.transformer.ts:132-170), so the Codex peer events
match on `source`; keep them. A Claude main chat also spawns lanes with `parentSessionId: request._callerSessionId`
(W\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts:1273), so the retained
tab->session remap serves both runtimes.

## Fix

1. MAJOR: `resolvedParentSessions` in agent-process-manager.service.ts is unbounded and only cleared on dispose.
   Bound it (a small fixed cap, for example 256, insertion-order eviction; on a new resolve for a tab, delete then set
   so the newest mapping is kept and refreshed). A later resolve of the same tab id to a new session must replace the
   old mapping (tab reuse). Document the remaining window (a lane spawned in a reused tab before the new session
   resolves) under `## Decisions`, with why it cannot happen in practice for Codex (the thread id resolves during
   open, before any model turn can call ptah_agent_spawn) and for Claude (check where the SDK id resolves; cite
   file:line). If there is an existing tab-closed / session-ended hook the manager already receives, also delete the
   entry there.
2. MINOR: lane-completion-outcome.ts persists any UUID as `parent_session_id`, including an unresolved tab id.
   Persist the parent only when it is a resolved session id (for example, when the notifier delivered to it or the
   adapter reports it active); otherwise persist null. Keep the record shape.
3. MINOR: the native Codex peer-origin option schema is `.strict()`, so an extra key fails the whole send. Make the
   Codex adapter accept exactly what the Claude adapter accepts for the same `sendMessageToSession` options (read the
   Claude adapter's option handling and cite it). No frontend change.
4. Specs: map cap eviction; tab reuse replaces the mapping; outcome persists null for an unresolved tab id and the id
   for a delivered parent; the peer-origin option case that Claude accepts is accepted by Codex.

## Scope (only these files)

- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts and .spec.ts
- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-outcome.ts
- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.ts and .spec.ts (only if item 2 needs it)
- W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts and codex-chat-adapter.spec.ts
- W\libs\backend\lane-outcomes\src\lib\lane-outcome-recorder.service.ts and .spec.ts

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L3-revision-1-report.md
(write a skeleton early): per finding: what changed (file:line) or why no change; specs added. Reply `WROTE: <path>`
plus one headline line.
