# Batches - TASK_2026_627

Total tasks: 21 | Batches: 9 (Batch 0 to Batch 8) | Complete: 5/9

Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff` (branch
`fix/session-budget-handoff`). Every executor works only there, never in the main checkout
`D:\projects\ptah-extension`. No push, no PR, no merge into main.

Batching boundary: everything that does not need TASK_2026_626_7b3e ships first (Phases 1 and 2).
The live feed and the adapter wiring (Phase 3) are BLOCKED until 626 is merged and this branch has
taken it in.

Defaults chosen (the user gave the ordering, so no clarification was needed):

- Every batch is sequential with one sub-agent executor. `di/register.ts` is written by Batches 1, 2
  and 4, so they must not run at the same time. Batch 3 shares no file with Batches 1, 2, 4 or 5 and
  may run beside one of them if the orchestrator wants that, but it is committed on its own.
- Two plan components are split across phases, because part of each does not need 626 (see "Plan
  deviations").

## Verification rules (mandatory for every executor; repeat them in any lane prompt)

- Verify only the projects you changed: `npx nx test <project> --parallel=1`,
  `npx nx typecheck <project> --parallel=1`, `npx nx lint <project> --parallel=1`, or
  `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
- Never run workspace-wide checks, and never `nx run-many` across projects you did not change.
- Never run `build`, `serve`, `dev`, `e2e` or `package` targets.
- One heavy check at a time. Never start a second one while one is running.
- Run once in the foreground with a long timeout, and filter the output (`| tail`, `grep`) instead of
  running it again.
- Run every command from the worktree root. The worktree has no `node_modules` of its own: Node
  resolves the main checkout's `node_modules` by walking up the directories. That is expected. Do not
  run `npm install` in the worktree.
- Executors do not run git. The team-leader owns commits.

Nx project names: `@ptah-extension/agent-sdk`, `@ptah-extension/shared`,
`@ptah-extension/cli-agent-runtime`, `@ptah-extension/chat`, `@ptah-extension/chat-ui`.

## Plan validation

Status: PASSED WITH RISKS

Assumptions (checked against the code in this worktree and the 626 worktree):

- A1: `PostToolUse` `additionalContext` reaches the main model with that tool's result. Typed in SDK
  0.3.278: `PostToolUseHookSpecificOutput.additionalContext` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2569-2571`);
  `agent_id` is "present only when the hook fires from within a subagent... absent for the main
  thread" (`sdk.d.ts:181-183`). Runtime delivery is UNVERIFIED and can only be confirmed by the live
  run in the plan's Verification points. The design fails open: if the notice is not delivered, the
  turn-end handover still runs (Batch 4). No task depends on A1 to pass its checks.
- A2: lane completions do not go through `canSend`. HOLDS. `SdkAgentAdapter.sendMessageToSession`
  (`sdk-agent-adapter.ts:1447-1465`) forwards to `SessionLifecycleManager.sendMessage`, which only
  reaches the handover hold (`session-stream-pump.service.ts:100, 255`, `admitOrHold`). The only
  `canSend` callers are `chat:continue` (`chat-session.service.ts:475-495, 959`) and the lifecycle's
  `isAtBlockingLimit` (`session-lifecycle-manager.ts:527-532`). `waiting-for-turn-end` is not in
  `HELD_SOURCE_PHASES` (`session-handover-coordinator.service.ts:113-120`), so lane completions run on
  the source while the work gate waits. At the limit (`awaiting-confirmation` is held) they are held
  and moved to the successor, as the plan intends.
- A3: the 626 live snapshot is evaluated like the authoritative one. HOLDS FOR THE SHAPE, WITH ONE
  RISK. On the 626 branch, `SessionStatsEntry.provisional?: boolean` is added
  (`fix-live-session-stats-…/libs/shared/src/lib/types/rpc/rpc-session.types.ts:423-429`). The live
  snapshot is built by the same `build()` and `aggregateSessionUsage` as the authoritative one, plus
  the estimate rows, and carries `revision: state.revision` (`session-stats-owner.service.ts:795-847`).
  `evaluateSessionBudget` reads `tokenCount`, `tokens`, `totalCost`, `knownCost`, `pricingCoverage`,
  `coverage` and `revision` (`session-budget-stage.ts:81-125, 273-311`); all of them are present.
  Risk: `estimateResult` sets `totalCost: null` when any estimate row has `costUSD === null`
  (`session-stats-owner.service.ts:883-898`). With the budget unit set to `usd`, the live figure then
  changes measure (`cost` → `cost-lower-bound` or `weighted-fallback`) while the authoritative figure
  stays `cost`, so the two stages would not be comparable. Mitigated in Task 7.1. Second note: the
  live snapshot advances the same owner revision counter, so `observeLive` must never write the
  entry's `revision` (the plan already says it does not touch `entry.snapshot`). Re-read the merged
  626 types before starting Phase 3 (Task 7.0).
- The handover state guard in the webview (`session-handover-client.service.ts:10-20`) checks only
  `operationId`, `sourceSessionId`, `phase`, `revision`. A new `waitingFor` field passes through
  unchecked. Verified; Task 6.2 reads it defensively.
- `BeginSessionHandoverResult` is passed through unchanged by the RPC handler
  (`session-handover-rpc.handlers.ts:84-106`); the coordinator is the only producer of its error
  (`session-handover-coordinator.service.ts:195`). Verified.
- `AgentStatus` = `'running' | 'completed' | 'failed' | 'timeout' | 'stopped'`
  (`libs/shared/src/lib/types/agent-process.types.ts:43-44`). Only `'running'` is non-terminal.
  Verified.
- `SDKTaskStartedMessage` has `task_id`, an optional `tool_use_id`, `subagent_type`, and no
  `parent_tool_use_id` (`sdk.d.ts:5703-5725`). It therefore reaches the executor's main-loop
  `system` branch (`session-query-executor.service.ts:237-268`). Verified.
- R6 confirmed: `request` returns any non-restartable existing operation unchanged
  (`session-handover-coordinator.service.ts:208-230`), and `confirm()` has no caller in `libs`.
- The coordinator is built by a positional factory (`di/register.ts:760-781`). The logger is added as
  an optional trailing argument there. Verified.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| `di/register.ts` is written by three batches (1, 2, 4) | MEDIUM | Batches are sequential; each edits only its own registration block |
| TASK_2026_626 also changes `sdk-agent-adapter.ts` (+14) and its spec (+234) | MEDIUM | No ready batch touches either file. Every adapter change, including the post-result `armHandoverIfIdle` call, is in Batch 8 (after 626 merges) |
| Component 5's work gate needs `runtime.subagentsInFlight`, which the plan puts in Component 3 (blocked) | HIGH | The lifecycle part of Component 3 (`subagentsInFlight`, `armHandoverIfIdle`) moves to Batch 4 (Task 4.3); only the adapter and live parts stay in Batch 8 |
| Live figure changes measure when an estimate row is unpriced (A3) | MEDIUM | Task 7.1: when the live measure differs from the authoritative measure, keep the authoritative stage and log once at DEBUG |
| `additionalContext` not delivered at runtime (A1) | MEDIUM | Fail-open by design; the turn-end handover with the work gate (Batch 4) works without the notice. A live run is needed only to prove the mid-turn wrap-up |
| A wrap-up notice arrives only on the next main-thread tool result; a long foreground `Agent` call delays it | LOW | Accepted by the plan; the stopped subagent's own `Agent` result is the carrier (Task 2.3) |
| `waitingFor` is not validated by the webview guard | LOW | Task 6.2 shows the waiting copy only for finite non-negative integers |
| `task.md` `description` is a single-quoted string, not a `>-` block scalar (carrier rule: the task can vanish from the board) | LOW | Not edited here (team-leader may only edit the `status:` line). Reported to the orchestrator |

Edge cases:

- Notice posted for a session that ends before the next tool result: `release`/`clearAll` clear the
  queue (Task 3.2; Task 7.1 keeps it).
- Subagent tool results must never drain the main-thread queue (`agent_id` set): Task 1.2.
- Capper rewrite and notice in the same hook result: Task 1.2.
- `task_started` for a non-agent task type (bash, workflow): the monitor ignores unknown ids, Task 2.2.
- Subagent with no registry record and no `task_started`: one deferred WARN, no stop, Task 2.1.
- Lane provider throws: counted as 0 lanes with one WARN, Task 4.2.
- `begin('successor')` when the source record is gone: `source-unavailable`, no operation, Task 4.2;
  webview falls back to a new tab with the seed, Task 6.1.
- `begin('successor')` on a budget operation mid-turn: sets `userConfirmed`; the next terminal starts
  without the work gate, Task 4.2.
- Preview handoff after the lifecycle forgot the workspace: cached workspace, or `workspace-unknown`
  when never known, Task 3.2.
- Agent handoff larger than the new cap: truncated with the marker, Task 3.1.
- Live estimate after `release`, when disabled, or not `provisional`: ignored, Task 7.1.
- Live estimate at or above 100%: never sets `blocked`, Task 7.1.

## Plan deviations (decomposition only, no redesign)

- Component 1 is split. Workspace memory for `buildHandoff` (R7 preview) does not need 626 and is in
  Task 3.2. `observeLive`, `stageFor` taking the live stage, the wrap-up notice and
  `onTurnTerminal` stay in Batch 7 (blocked).
- Component 3 is split. `SessionHandoverRuntime.subagentsInFlight` and
  `SessionLifecycleManager.armHandoverIfIdle` are in Task 4.3, because Component 5 needs them. The
  adapter changes (`wrapLiveStatsForBudget`, the post-result `armHandoverIfIdle` call) and the
  lifecycle's call to `sessionBudget.onTurnTerminal` stay in Batch 8 (blocked). So the R2 fix
  (arming after the result moved the stage) is only live once Batch 8 lands.

## Batch 0: Compaction card only while compacting — COMPLETE (f0882e60d)

- Recommended executor: frontend-developer (already done before decomposition)
- Fallback executor: none
- Execution mode: sequential
- Rationale: earlier UI fix found uncommitted in the worktree; recorded and committed as its own commit
- Tasks: 1 | Depends on: none
- Phase: 2 (Frontend) | Phase review: covered by the Phase 2 review (code-logic + visual)

### Task 0.1: Show the compaction card only while compacting; hide the chip after the next user message — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-ui\src\lib\molecules\notifications\compaction-notification.component.ts` (+ `.spec.ts`),
  `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` (+ `.html`)
- Evidence: `npx jest -c libs/frontend/chat-ui/jest.config.ts …/compaction-notification.component.spec.ts --coverage=false --maxWorkers=2`
  re-run by the team-leader: 2/2 passed. `nx typecheck @ptah-extension/chat` passed (reported by the
  author). The only consumer of the component is `chat-view.component.html:68`.

## Batch 1: Main-thread notice queue and PostToolUse delivery — COMPLETE (28e3ddc05)

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session with this section and the plan
- Execution mode: sequential
- Rationale: one new class plus the hook that drains it and its DI registration; the hook test needs
  the queue, so the tasks are ordered
- Tasks: 3 | Depends on: none
- Phase: 1 (Backend gates) | Phase review: after Batch 5

### Task 1.1: Create `MainThreadNoticeQueue` — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\main-thread-notice-queue.ts`
  and `…\helpers\main-thread-notice-queue.spec.ts`
- Plan reference: implementation-plan.md:151-187 (Component 2)
- Pattern to follow: a dependency-free `@injectable()` singleton such as `SessionRotationAdvisor`
  (registered at `libs/backend/agent-sdk/src/lib/di/register.ts:784`)
- Quality requirements: `post(sessionId, text)`, `take(sessionId): string | undefined` (joins and
  removes all pending), `clear(sessionId)`; at most 4 pending per session (oldest dropped, one DEBUG
  line); each notice capped at 2,000 chars; the map entry is deleted on `take`/`clear`; `take` never
  throws.
- Validation notes: no timers; host-authored text only.
- Implementation details: plain `Map<string, string[]>`; spec covers bounds, cap, take-once, clear.

### Task 1.2: Drain the queue in `PostToolUseHookHandler` on main-thread tool results — COMPLETE

- Depends on: Task 1.1
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.ts`
  and `…\post-tool-use-hook-handler.spec.ts`
- Plan reference: implementation-plan.md:157-160, 166-183
- Pattern to follow: current hook body `post-tool-use-hook-handler.ts:69-105`; payload-first session id
  `hook-session-resolver.ts:1-15` (`resolveHookSessionId`)
- Quality requirements: only when `input.agent_id` is absent; return `additionalContext` in the same
  `hookSpecificOutput` as `updatedToolOutput` when both apply; a failure falls back to
  `{ continue: true }` (DEBUG log); the capper's fail-open path is unchanged.
- Validation notes: inject the queue as an optional dependency so existing specs constructing the
  handler keep working; behaviour without a queue is identical to today.
- Implementation details: spec cases: main-thread call returns the notice once then not again;
  subagent call leaves it pending; capped output plus notice in one response; no queue → unchanged.

### Task 1.3: Register the queue in DI — COMPLETE

- Depends on: Task 1.1
- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\di\register.ts`
- Plan reference: implementation-plan.md:171-172
- Pattern to follow: `container.registerSingleton(SessionRotationAdvisor)` at `register.ts:784`
- Quality requirements: registered before the PostToolUse hook handler is resolved.
- Implementation details: `container.registerSingleton(MainThreadNoticeQueue)`.

### Batch 1 result

- Verified on disk by the team-leader. Jest on both specs: 2 suites, 31 tests passed. Typecheck
  `@ptah-extension/agent-sdk` passed. Lint `@ptah-extension/agent-sdk`: 0 errors, 52 warnings, none
  in the batch files.
- Deviation accepted: the queue is registered just before `SDK_POST_TOOL_USE_HOOK_HANDLER`, not next
  to `SessionRotationAdvisor`. It is not exported from `helpers/index.ts` (producers in the same lib
  import it directly).
- Open item: the queue's `clear(sessionId)` has no caller yet. Moved to Task 3.2 (budget
  `release`/`clearAll`), so cleanup on session end does not wait for the 626 merge.

### Batch 1 verification

- The files above exist with real code.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/main-thread-notice-queue.spec.ts libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.spec.ts --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1` (one at a time, output tailed).
- No per-batch review.

## Batch 2: Subagent monitor learns task ids from `task_started` and hands off via the queue — COMPLETE (221537118)

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: the monitor, its feeder in the executor and its DI binding change together
- Tasks: 3 | Depends on: Batch 1
- Phase: 1 (Backend gates) | Phase review: after Batch 5

### Task 2.1: `SubagentBudgetMonitor.recordTaskStarted` and task-id lookup in `stop()` — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.ts`
  and `…\subagent-budget-monitor.spec.ts`
- Plan reference: implementation-plan.md:226-259 (Component 4)
- Pattern to follow: alias-aware `sessionState` in the same file; `stop` at `:540-635`
- Quality requirements: `recordTaskStarted(sessionId, toolUseId, taskId, subagentType?)` stored on the
  session state and released with it; `stop()` takes the recorded task id first, then
  `registry.get(toolCallId)?.taskId`; defers only when neither (one WARN per subagent); handoff text
  uses `record?.agentType ?? subagentType ?? 'subagent'`; `registry.update(...)` only when a record
  exists. Retry policy unchanged.
- Validation notes: R5 regression — no registry record + recorded task id → stop and handoff posted.
- Implementation details: spec cases listed in plan :251-254.

### Task 2.2: Feed `task_started` to the monitor from `SessionQueryExecutor` — COMPLETE

- Depends on: Task 2.1
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts`
  and its spec
- Plan reference: implementation-plan.md:237-239
- Pattern to follow: `feedSubagentMonitor` session-id rule, `session-query-executor.service.ts:276-292`;
  the `system` branch at `:248-259`
- Quality requirements: only `subtype === 'task_started'` with a `tool_use_id`; guarded like the
  existing monitor feed (a throw becomes one WARN).
- Validation notes: non-agent task types go through; the monitor ignores unknown ids.

### Task 2.3: Re-bind the monitor's `pushParentMessage` to `MainThreadNoticeQueue` — COMPLETE

- Depends on: Batch 1
- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\di\register.ts`
- Plan reference: implementation-plan.md:240-242
- Pattern to follow: the factory at `register.ts:486-503`
- Quality requirements: only the monitor's closure changes; the dispatcher's `pushParentMessage` stays
  (RPC steering uses its sibling). The monitor's port type is unchanged.

### Batch 2 result

- Verified on disk by the team-leader: `recordTaskStarted` stores `toolUseId -> { taskId, subagentType }`
  on the alias-aware session state (merged on rekey, released with the session); `stop()` uses the
  recorded id first, then the registry; `registry.update` runs only with a record; the executor
  routes `task_started` with a `tool_use_id` through a guarded `recordTaskStarted`; the monitor's
  `pushParentMessage` posts to `MainThreadNoticeQueue`, `stopSubagent` still uses the dispatcher.
- Jest on both specs: 2 suites, 93 tests passed. Typecheck `@ptah-extension/agent-sdk` passed. Lint:
  0 errors, 52 warnings; the 2 in `session-query-executor.service.spec.ts` (`:436`, `:662`) exist
  before this batch too.
- Accepted: recorded `task_started` entries live until session release (bounded by the number of
  tasks started in the session).

### Batch 2 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts <subagent-budget-monitor.spec.ts> <session-query-executor.service.spec.ts> --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`.

## Batch 3: Agent handoff kept in full; budget remembers the workspace — COMPLETE (306ee2732)

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: two small, independent changes in `helpers/session-budget/`; shares no file with any
  other ready batch
- Tasks: 2 | Depends on: none
- Phase: 1 (Backend gates) | Phase review: after Batch 5

### Task 3.1: Handoff builder puts the agent handoff first, in the file and the seed (R8) — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-handoff-builder.ts`
  and `…\session-handoff-builder.spec.ts`
- Plan reference: implementation-plan.md:336-352 (Component 8)
- Pattern to follow: `SESSION_HANDOFF_LIMITS` `:38-60`, `withAgentHandoff` `:633-658`
- Quality requirements: `## Agent handoff` section at the top of `document.content`, sanitised and
  block-quoted; `agentHandoffChars` 6,000; `seedChars = totalChars + agentHandoffChars + 200`
  (14,200); `totalChars` stays 8,000; comments updated; no agent text → output identical to today.
- Validation notes: regression for R8 — full deterministic document plus a 5,000-char agent handoff
  keeps all 5,000 chars in seed and content; 7,000 chars → truncated with the marker.

### Task 3.2: `SessionBudgetService` caches the session workspace for `buildHandoff` (R7 preview) — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts`
  and `…\session-budget.service.spec.ts`
- Plan reference: implementation-plan.md:117-120, 145-147 (the workspace part of Component 1 only)
- Pattern to follow: `acceptOrThrow` `:333`, `buildHandoff` `:625-669`, `BudgetEntry` `:123-150`
- Quality requirements: remember the workspace on the entry the first time
  `sessionControl.getSessionWorkspace` answers (in `acceptOrThrow`); `buildHandoff` falls back to it
  when the live lookup returns `undefined`; never known → `workspace-unknown` as today.
- Also (from the Batch 1 result): inject `MainThreadNoticeQueue` into `SessionBudgetService` as an
  optional dependency and call `clear(sessionId)` in `release` and for every session in `clearAll`,
  so pending notices (posted by the subagent monitor since Batch 2) are dropped when a session ends.
  Spec: a notice posted before `release` is gone after it.
- Validation notes: do NOT add `observeLive`, `liveFigure`, notices or `onTurnTerminal` here — those
  are Batch 7. Batch 7 adds the same caching call in `observeLive`.

### Batch 3 result

- Verified on disk by the team-leader: `agentHandoffChars` 6,000, `seedChars` 14,200, `totalChars`
  8,000; `withAgentHandoff` renders a sanitised, block-quoted `## Agent handoff` section directly
  under the `# Session handoff` title in `content`, rebuilds the seed from the content, and returns
  the document unchanged without agent text; `quoteWithin` caps the quoted form (marker included)
  and its loop strictly shrinks. `BudgetEntry.workspacePath` is set once in `acceptOrThrow`;
  `buildHandoff` falls back to it; `release`/`clearAll` call the optional `noticeQueue?.clear`.
- In scope (accepted deviation): `di/register.ts` +1 line passes `c.resolve(MainThreadNoticeQueue)`
  to the `SessionBudgetService` factory; without it the queue never reaches the service in
  production. The queue is registered earlier in the same file.
- Accepted placement: the agent section sits under the title line, not before it. The plan
  (implementation-plan.md:340) says "at the top of `document.content`"; the document keeps its title
  as the first line and the agent section is its first section. See decisions.md D1.
- Stale comment `libs/shared/src/lib/types/session-budget.types.ts:319` (seed "8,200" → 14,200) is
  moved to Task 4.1. See decisions.md D2.
- Jest on both specs: 2 suites, 107 tests passed. Typecheck `@ptah-extension/agent-sdk` passed. Lint
  (reported by the executor): 0 errors, 52 warnings, same as the Batch 1-2 baseline.

### Batch 3 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts <session-handoff-builder.spec.ts> <session-budget.service.spec.ts> --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`.

## Batch 4: Handover coordinator gates, shared contract, lifecycle runtime — COMPLETE (833e5dadd)

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: the coordinator's new gate needs the new contract fields and a new runtime method from the
  lifecycle; all three must land together to type-check
- Tasks: 3 | Depends on: Batch 1 (register.ts ordering only); Batch 2 for the same reason
- Phase: 1 (Backend gates) | Phase review: after Batch 5
- Files (7, 2 libs; the 7th is a comment-only line): `libs/shared/src/lib/types/session-handover.types.ts`;
  `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts` (+ spec);
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (+ `session-lifecycle-manager.spec.ts`);
  `libs/backend/agent-sdk/src/lib/di/register.ts`; plus one doc-comment line in
  `libs/shared/src/lib/types/session-budget.types.ts` (comment only, carried from Batch 3; decisions.md D2)

### Task 4.1: Shared contract — `waitingFor` and `source-unavailable` (Component 6) — COMPLETE

- File: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\shared\src\lib\types\session-handover.types.ts`
- Also (from Batch 3, comment only): in `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\shared\src\lib\types\session-budget.types.ts:319`
  the `SessionBudgetActionResult.handoff.seed` doc comment says "at most 8,200 characters"; change it
  to 14,200 (`SESSION_HANDOFF_LIMITS.seedChars` since Batch 3). No code change.
- Plan reference: implementation-plan.md:303-317
- Quality requirements: `SessionHandoverState.waitingFor?: { readonly subagents: number; readonly lanes: number }`;
  `BeginSessionHandoverResult` error `'unavailable' | 'source-unavailable'`.
- Validation notes: no shared parser exists for this state; the webview guard
  (`libs/frontend/chat/src/lib/services/session-handover-client.service.ts:10-20`) needs no change.

### Task 4.2: Coordinator — work-in-flight gate, one-click confirm, source check, prompt, logging (Component 5) — COMPLETE

- Depends on: Task 4.1
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.ts`
  and `…\session-handover-coordinator.service.spec.ts`; `…\lib\di\register.ts` (pass the logger)
- Plan reference: implementation-plan.md:261-301
- Pattern to follow: `setResourceLeaseProvider` `:167-175` for `setLaneWorkProvider`; `armAtTerminal`
  `:232-276`; `request` `:208-230`; `begin` `:188-206`; `confirm` `:299-316`
- Quality requirements: gate only `budget-auto` (not `budget-limit`); in-flight work keeps or creates
  `waiting-for-turn-end` with `waitingFor` and holds no input; `begin('successor')` on a budget
  operation in `waiting-for-turn-end` (idle) or `awaiting-confirmation` proceeds and skips the gate;
  mid-turn it sets `userConfirmed`; `begin` with no `sourceSnapshot` returns `source-unavailable` and
  creates nothing; `HANDOFF_REQUEST_PROMPT` requires the headings Goal, Decisions, Task folders,
  Changed files (incl. subagent and lane edits), Open items, Still running, Next action, and keeps
  "Do not call tools"; optional `TOKENS.LOGGER` as a trailing constructor argument, INFO on every
  `publish` (operationId, reason, phase, heldInputCount, waitingFor, error).
- Validation notes: lane provider throw → 0 lanes, one WARN. `cancelledAutomaticSources` unchanged.
  Spec cases listed in plan :290-297, including the R6 and R7 regressions.

### Task 4.3: Lifecycle runtime — `subagentsInFlight` and `armHandoverIfIdle` (lifecycle part of Component 3) — COMPLETE

- Depends on: Task 4.2 (the runtime interface gains the method)
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
  and `…\session-lifecycle-manager.spec.ts`
- Plan reference: implementation-plan.md:203-210, 216-218
- Pattern to follow: `attachRuntime` `session-lifecycle-manager.ts:464-502`; `onTurnTerminal` `:508-524`;
  `getRunningBySession` / `getBackgroundAgents` in
  `libs/backend/vscode-core/src/services/subagent-registry.service.ts:481, 574`
- Quality requirements: `subagentsInFlight(sourceSessionId)` counts running plus non-terminal
  background agents for both the real id and the tab id, without double counting;
  `armHandoverIfIdle(id)` arms only when the record exists and `!rec.turnInFlight`, with the same
  arguments `onTurnTerminal` builds, and never calls `markTurnEnded`; no coordinator or record → no-op.
- Validation notes: do NOT add the `sessionBudget.onTurnTerminal` call (Batch 8) and do NOT touch
  `sdk-agent-adapter.ts` (626 also changes it; its caller is Batch 8).

### Batch 4 result

- Verified on disk by the team-leader: `SessionHandoverState.waitingFor?` and the
  `'unavailable' | 'source-unavailable'` begin error; seed comment says 14,200 (D2 closed).
  Coordinator: `armAtTerminal` gates only `budget-auto` (created or in `waiting-for-turn-end`, not
  user-confirmed) on `workInFlight` and publishes `waiting-for-turn-end` with `waitingFor` without
  holding inputs; `waitingFor` is cleared when armed; `budget-limit` is never gated.
  `setLaneWorkProvider` mirrors `setResourceLeaseProvider` (disposer only clears its own provider);
  a throwing provider counts 0 lanes with one WARN. `request('successor')` on a live budget
  operation calls `confirmBudgetOperation` (awaiting-confirmation or idle waiting → writing-handoff
  + `complete`; mid-turn → `userConfirmed`, which skips the gate and `awaiting-confirmation` at the
  next terminal). `begin` returns `source-unavailable` before creating anything. New structured
  `HANDOFF_REQUEST_PROMPT` keeps "Do not call tools". Optional `TOKENS.LOGGER`, INFO on every
  `publish`. Lifecycle: `attachRuntime` supplies `subagentsInFlight` (unique `toolCallId`s over
  source id, `realSessionId`, `tabId`, running + live background); `armHandoverIfIdle` is a no-op
  without record/coordinator or mid-turn and never calls `markTurnEnded`.
- In scope: `di/register.ts` +1 line passes `c.resolve<Logger>(TOKENS.LOGGER)` to the coordinator
  factory; without it the coordinator never logs in production.
- Accepted deviation, tightened in Task 5.2: `SessionHandoverRuntime.subagentsInFlight` was made
  optional to avoid editing `session-stream-pump.service.spec.ts`. Safe at runtime (missing → 0,
  i.e. pre-batch behaviour; the only production runtime supplies it), but it lets a future runtime
  silently disable the gate. See decisions.md D4.
- Accepted: `agentHandoff` is ignored when `begin` confirms an existing budget operation
  (`Operation.agentHandoff` is readonly; the coordinator still asks the agent for its handoff).
  The lane provider's `tabId` falls back to the source id when there is no snapshot.
- Carried forward: frontend copy for `source-unavailable`
  (`libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:216`) is Task 6.1;
  nothing re-arms a gated `budget-auto` after the last background subagent ends with no later
  parent turn until Batch 8 wires `armHandoverIfIdle`.
- Checks re-run by the team-leader: Jest on the coordinator, lifecycle and stream-pump specs — 3
  suites, 97 tests passed. Typecheck `@ptah-extension/agent-sdk` passed. Typecheck
  `@ptah-extension/shared` passed. Lint (reported by the executor): 0 errors, 52 warnings, equal to
  the baseline (the coordinator stays under `max-lines`).

### Batch 4 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts <session-handover-coordinator.service.spec.ts> <session-lifecycle-manager.spec.ts> --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`, then
  `npx nx typecheck @ptah-extension/shared --parallel=1` (one at a time).

## Batch 5: Lane work provider in cli-agent-runtime (Component 7) — IN_PROGRESS

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: one service and its spec in another lib; needs `setLaneWorkProvider` from Batch 4.
  Task 5.2 (added at Batch 4 verification, decisions.md D4) is a two-file tightening in agent-sdk;
  the batch stays at 2 libs and 4 files
- Tasks: 2 | Depends on: Batch 4
- Phase: 1 (Backend gates) | Phase review: code-logic + style (new public `setLaneWorkProvider`,
  shared contract change), on the combined diff of Batches 1-5

### Task 5.1: `AgentProcessManager` registers the lane work provider — IN_PROGRESS

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
  and `…\agent-process-manager.service.spec.ts`
- Plan reference: implementation-plan.md:319-334
- Pattern to follow: `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:231-253`
- Quality requirements: optional `@inject(SessionHandoverCoordinator, { isOptional: true })` as a
  trailing constructor argument; count `listTrackedAgents()` entries with `status === 'running'` whose
  `parentSessionId` equals the session id or the tab id; keep the disposer and run it in `disposeAll`.
- Validation notes: no coordinator → nothing registered. `'running'` is the only non-terminal
  `AgentStatus` (verified).

### Task 5.2: Make `SessionHandoverRuntime.subagentsInFlight` required — IN_PROGRESS

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.ts`
  and `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.spec.ts`
- Source: decisions.md D4 (Batch 4 verification)
- Quality requirements: in the interface, `subagentsInFlight(sourceSessionId: string): number;`
  (drop the `?` and the "Optional so test runtimes…" sentence; keep "Running plus background
  subagents of the source"); in `workInFlight`, call `this.runtime?.subagentsInFlight(sourceSessionId) ?? 0`
  (the runtime itself may still be null). In the stream-pump spec's `coordinator.attachRuntime({...})`
  literal (near line 290), add `subagentsInFlight: jest.fn().mockReturnValue(0),`. Update any
  `runtime.subagentsInFlight?.(` call in `session-lifecycle-manager.spec.ts` and the coordinator spec
  only if the typecheck requires it.
- Validation notes: no behaviour change; the production lifecycle runtime already supplies the method.

### Batch 5 verification

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`.
- For Task 5.2 (after the above, one at a time):
  `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`.

## Batch 6: Frontend — never stuck at the limit (Component 9) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer, fresh session
- Execution mode: sequential
- Rationale: three chat services/components with their specs, one lib
- Tasks: 3 | Depends on: Batch 4 (contract types)
- Phase: 2 (Frontend) | Phase review: code-logic + visual (rendered banner copy), on the Batch 0 and
  Batch 6 commits. Completion needs dark and light before/after screenshots of the budget banner and
  the compaction card (no prototype; no new surface).

### Task 6.1: `continueInNewSession` falls back to `rotateSession()` when the source is gone — PENDING

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\session-budget-actions.service.ts`
  and its spec
- Plan reference: implementation-plan.md:354-376
- Pattern to follow: `continueInNewSession` `:190-227`, `rotateSession` `:256-266`
- Quality requirements: `{ accepted: false, error: 'source-unavailable' }` → `rotateSession()`; same
  on Retry when the handover state is `failed` with `source session unavailable`.

### Task 6.2: Banner waiting copy with counts — PENDING

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-banner.component.ts`
  and its spec
- Plan reference: implementation-plan.md:362-365
- Pattern to follow: copy block `:541-553`, stage computation `:427-442`
- Quality requirements: handoff stage with a `waiting-for-turn-end` handover and `waitingFor` → "Waiting
  for N subagents and M CLI lanes before continuing in a new session." with the existing "Continue
  now"; limit `awaiting-confirmation` keeps "New session"; aria labels unchanged.
- Validation notes: `waitingFor` is not validated by the webview guard; show the copy only for finite
  non-negative integers, else the existing copy.

### Task 6.3: `MessageSender` logs budget refusals and handover holds at `console.info` (R9) — PENDING

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\message-sender.service.ts`
  and `message-sender.service.spec.ts`
- Plan reference: implementation-plan.md:366-367
- Pattern to follow: `:737-768`
- Quality requirements: other failures still `console.error`.

### Batch 6 verification

- `npx jest -c libs/frontend/chat/jest.config.ts <the three changed specs> --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/chat --parallel=1`.

## Batch 7: Budget live feed (Component 1, live part) — BLOCKED

Blocked on: TASK_2026_626_7b3e merged into main and merged or rebased into `fix/session-budget-handoff`.
Status word stays PENDING in the task lines until unblocked.

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: one service and its spec; needs `SessionStatsEntry.provisional` from 626
- Tasks: 2 | Depends on: 626 merge, Batches 1 and 3
- Phase: 3 (Live feed, blocked) | Phase review: after Batch 8

### Task 7.0: Re-check A3 against the merged 626 types — PENDING

- Read the merged `libs/shared/src/lib/types/rpc/rpc-session.types.ts` (`provisional`, `revision`) and
  `session-stats-owner.service.ts` `build`/`estimateResult`; record any change in the report before
  coding Task 7.1.

### Task 7.1: `observeLive`, live `stageFor`, wrap-up notice, `onTurnTerminal` — PENDING

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts`
  and `…\session-budget.service.spec.ts`
- Plan reference: implementation-plan.md:94-149, 162-166 (notice text)
- Quality requirements: as the plan, plus: ignore a live evaluation whose measure differs from the
  authoritative measure (A3 risk; one DEBUG line); never write `entry.snapshot`, `figure`, `revision`,
  `usageSeq` or `blocked`; one notice per rank per turn; cache the workspace in `observeLive` too;
  `release`/`clearAll` clear the session's notices.
- Validation notes: spec cases plan :140-147 plus the measure-mismatch case.

### Batch 7 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts <session-budget.service.spec.ts> --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`.

## Batch 8: Adapter and lifecycle live wiring (Component 3, adapter part) — BLOCKED

Blocked on: TASK_2026_626_7b3e merged (needs its `setLiveStatsCallback` and the four `transform()`
call sites) and Batch 7.

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: the adapter and the lifecycle are wired together and tested together
- Tasks: 2 | Depends on: 626 merge, Batches 4 and 7
- Phase: 3 (Live feed, blocked) | Phase review: code-logic on the combined diff of Batches 7-8

### Task 8.1: `wrapLiveStatsForBudget` and post-result `armHandoverIfIdle` in `SdkAgentAdapter` — PENDING

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
  and `…\sdk-agent-adapter.spec.ts`
- Plan reference: implementation-plan.md:194-202, 211-216
- Quality requirements: the wrapper is installed even with no host live callback; it calls
  `observeLive` (never `observe`) in try/catch with one WARN, then the inner callback; after
  `observeBudget`, a `handoff`/`limit` state calls `sessionLifecycle.armHandoverIfIdle(sessionId)`
  (R2).

### Task 8.2: Lifecycle `onTurnTerminal` calls `sessionBudget.onTurnTerminal` after arming — PENDING

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
  and `…\session-lifecycle-manager.spec.ts`
- Plan reference: implementation-plan.md:207-208, 216-218

### Batch 8 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts <sdk-agent-adapter.spec.ts> <session-lifecycle-manager.spec.ts> --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`, then
  `npx nx lint @ptah-extension/agent-sdk --parallel=1`.
- A1 live check (only if the user asks for a run): plan Verification points.
