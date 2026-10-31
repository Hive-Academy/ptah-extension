# Task 10d.L3 — corrective batch N: lane completion signal for a Codex main chat (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md (HARD RULES).
- Never strip, revert or comment out MCP. Do not convert line endings. UTF-8 without BOM.
- Native UI contracts must match Claude's exactly. Fix the gap in the backend; no frontend Codex special case.
- Two other codex lanes edit other files in W at the same time. Do NOT touch: anything under
  W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\ ,
  W\libs\backend\codex-runtime\src\lib\codex-lane-thread-config.ts, or the three host lane compositions
  (W\apps\ptah-electron\src\di\codex-lane-composition.ts, W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.ts,
  W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.ts).

## Defect (live run gap G2)

Main chat runs on Codex (Electron). A lane spawned from that chat ends, and every lane end logs
`[LaneCompletionNotifier] Completion signal not delivered: reason parent-session-not-active,
parentSessionId 3cd27680-...`. That id is the frontend TAB id; the active Codex session is `01a19341-816c-...`.
`parent_session_id` in `lane_outcome_records` is NULL as well. So `<agent-lane-completed>` never reaches the chat,
and `ptah_agent_report` routing has the same parent problem.

Known code:
- Refusal: W\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.ts:370-435
  (`SessionId.safeParse`, then `this.agentAdapter.isSessionActive(...)`, `TOKENS.AGENT_ADAPTER` injected at :322).
- Remap from tab id to real id: `AgentProcessManager.resolveParentSessionId` (agent-process-manager.service.ts:1950)
  and the session-id remap near :1970-2030; called from W\libs\backend\cli-agent-runtime\src\lib\wiring\sdk-callbacks.ts
  (Claude SDK session-id-resolved callback) via the `agent-events.ts` port.
- Report router uses the same rule: agent-report-router.service.ts:~298.

## Investigate, then fix

1. Trace where a Claude main chat resolves the real session id and fires the remap, and where a Codex main chat
   resolves its session id (search the chat runtime router / `sessionIdResolvedEvents` in
   W\libs\backend\rpc-handlers\src\lib\chat\ and the Codex chat runtime in W\libs\backend\agent-sdk or
   W\libs\backend\codex-runtime). Find why the remap does not run for Codex (the event is not emitted, or not
   wired to the remap). Record the chain with file:line under `## Decisions`.
2. Trace what `TOKENS.AGENT_ADAPTER.isSessionActive` and `sendMessageToSession` do for a Codex session id. If the
   adapter bound to that token only knows Claude sessions, the notifier must reach the session runtime router that
   owns both runtimes (find the existing host-neutral router/port; do not add a second proxy, do not import
   vscode/electron into libs).
3. Fix both links in the backend so a Codex main chat behaves like a Claude main chat: the lane parent becomes the
   real Codex session id, `isSessionActive` is true while that chat lives, and the signal is delivered as the
   same native message Claude gets. Also confirm the lane outcome record gets `parent_session_id`.
4. If DI registration changes, update the DI guards (Electron container.smoke.spec.ts, expected-resolvable.ts,
   VS Code equivalents, CLI container) and list them.
5. Specs: (a) Codex main chat: spawn with tab id, Codex session id resolves, lane completes -> signal delivered to the
   Codex session id; (b) the Claude path is unchanged (existing specs still hold; add one if none covers it);
   (c) no parent -> the existing `no-parent-recorded` refusal is unchanged.

## Scope

- Any backend file needed for the chain above EXCEPT the forbidden files in HARD RULES. Keep the change minimal and
  list every file you touched in the report. Prefer W\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.ts,
  W\libs\backend\cli-agent-runtime\src\lib\wiring\*, W\libs\backend\rpc-handlers\src\lib\chat\** and the DI
  registration files, with their specs.

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L3-report.md
(write a skeleton early): the traced chain (file:line), the cause, what changed (file:line), `## Decisions`,
specs added, anything not done. Reply `WROTE: <path>` plus one headline line.
