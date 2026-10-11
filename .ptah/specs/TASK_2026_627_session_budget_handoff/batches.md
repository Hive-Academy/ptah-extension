# Batches - TASK_2026_627

Total tasks: 42 | Batches: 20 (Batch 0 to Batch 17, plus fix Batches 5F and 6F) | Complete: 14/20

Phase 4 (Batches 9-17, the user-authorized handover addendum, D22-D25) was added after the Phase 1-3
completion below; see "Phase 4" at the end of this file.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff` (branch
`fix/session-budget-handoff`). Every executor works only there, never in the main checkout
`D:\projects\ptah-extension`. No push, no PR, no merge into main.

Batching boundary: everything that does not need TASK_2026_626_7b3e ships first (Phases 1 and 2).
The live feed and the adapter wiring (Phase 3) waited for 626. 626 (PR #698) is merged into main
and was merged into this branch at `91376becf` (D12), so Phase 3 is unblocked.

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
- Worktree-only Jest quirk (found in Batch 5): the root `jest.preset.js:31-34` resolves `marked` with
  `path.resolve(__dirname, 'node_modules/...')`, which points at the worktree's missing
  `node_modules`. Any Jest project whose graph reaches `marked` (for example cli-agent-runtime)
  fails with "Could not locate module marked". Do not change any config file. Pass the mapper on the
  command line instead, keeping the project's own `vscode` mock:
  `--moduleNameMapper='{"^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js","^vscode$":"D:/projects/ptah-extension/.claude-worktrees/session-budget-handoff/__mocks__/vscode.ts"}'`.
  agent-sdk specs do not need it.
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

## Batch 5: Lane work provider in cli-agent-runtime (Component 7) — COMPLETE (6cb27e3e4)

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: one service and its spec in another lib; needs `setLaneWorkProvider` from Batch 4.
  Task 5.2 (added at Batch 4 verification, decisions.md D4) is a two-file tightening in agent-sdk;
  the batch stays at 2 libs and 4 files
- Tasks: 2 | Depends on: Batch 4
- Phase: 1 (Backend gates) | Phase review: code-logic + style (new public `setLaneWorkProvider`,
  shared contract change), on the combined diff of Batches 1-5

### Task 5.1: `AgentProcessManager` registers the lane work provider — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
  and `…\agent-process-manager.service.spec.ts`
- Plan reference: implementation-plan.md:319-334
- Pattern to follow: `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:231-253`
- Quality requirements: optional `@inject(SessionHandoverCoordinator, { isOptional: true })` as a
  trailing constructor argument; count `listTrackedAgents()` entries with `status === 'running'` whose
  `parentSessionId` equals the session id or the tab id; keep the disposer and run it in `disposeAll`.
- Validation notes: no coordinator → nothing registered. `'running'` is the only non-terminal
  `AgentStatus` (verified).

### Task 5.2: Make `SessionHandoverRuntime.subagentsInFlight` required — COMPLETE

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

### Batch 5 result

- Verified on disk by the team-leader: `AgentProcessManager` takes a trailing
  `@inject(SessionHandoverCoordinator, { isOptional: true })` argument (imported from
  `@ptah-extension/agent-sdk`, the same edge `session-spawner.service.ts` already uses) and, when
  present, registers `({ sessionId, tabId }) => countRunningLanes(...)`; the disposer is kept and run
  once in `disposeAll`. `countRunningLanes` counts `status === 'running'` lanes with a non-empty
  `parentSessionId` equal to the session id or the tab id. New spec block (4 tests): no coordinator →
  nothing registered; counts only running lanes of the session or tab id; empty tab id does not match
  parentless lanes; disposer runs once. Task 5.2 matches decisions.md D4 exactly (resolved there).
- Accepted deviation: a private loop over `this.agents` instead of
  `listTrackedAgents().filter(...).length` (same result, no per-call copies), plus the non-empty
  parent guard (TASK_2026_295 hazard).
- Carried forward: `session-lifecycle-manager.spec.ts:897, 909` still call `subagentsInFlight?.(`;
  harmless, may be tidied later. Root `jest.preset.js:31-34` `marked` resolution is out of scope (see
  the worktree-only Jest quirk in the verification rules).
- Checks re-run by the team-leader, one at a time: Jest on `agent-process-manager.service.spec.ts`
  plus `register.agent-process-manager.smoke.spec.ts` (with the `--moduleNameMapper` override) — 2
  suites, 186 tests passed. Typecheck `@ptah-extension/cli-agent-runtime` passed. Jest on the
  coordinator, stream-pump and lifecycle specs — 3 suites, 97 tests passed. Typecheck
  `@ptah-extension/agent-sdk` passed. Lint (reported by the executor): cli-agent-runtime 0 errors /
  45 warnings, agent-sdk 0 errors / 52 warnings; no warning on a changed line.
- Phase 1 is now complete (Batches 1-5); its code-logic + style review is due on the combined diff
  `af9ed9112..6cb27e3e4`.
- Phase 1 review: `code-logic-review.md` NEEDS_REVISION 6/10 and `code-style-review.md` APPROVED
  7/10, both in this task folder. One fix round was opened as Batch 5F (decisions.md D5-D8). Phase 1
  closes only when the 5F re-review accepts.

### Batch 5 verification

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`.
- For Task 5.2 (after the above, one at a time):
  `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`.

## Batch 5F: Phase 1 fix round — COMPLETE (44eba9fc3)

- Source: Phase 1 review on `af9ed9112..6cb27e3e4`. `code-logic-review.md` NEEDS_REVISION 6/10
  (0 B, 2 S, 5 M, 4 minor); `code-style-review.md` APPROVED 7/10 (0 B, 0 S, 2 M, 4 minor). Each
  finding was checked against the code; the triage is in decisions.md D5-D8.
- In scope (fix round rule: all Blocking and Serious, and a Moderate only if it can break a lane
  config or lose data): S1, S2, M3 and M4. Everything else is deferred (decisions.md D8, "Deferred
  follow-ups" below).
- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential. There are two file-disjoint tasks in one lib, and they share one
  verification run. That is too few tasks to justify lanes.
- Rationale: Task 5F.1 changes coupled state-machine branches in one file. Task 5F.2 is one helper
  in the builder.
- Tasks: 2 | Depends on: Batch 5
- Files (4, 1 lib): `session-handover-coordinator.service.ts` (+ spec);
  `session-handoff-builder.ts` (+ spec)
- Phase: 1 (Backend gates) | Phase review: one code-logic re-review scoped to the 5F fix commit (no
  new public API except the exported constant `WORK_IN_FLIGHT_WAIT_LIMIT_MS`, so no style review)

### Task 5F.1: Coordinator — blocking limit beats the work gate, bounded wait, safe handoff window — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.ts`
  and `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.spec.ts`
- Findings: S1, S2, M3 (decisions.md D5, D6, D7), plus a length line in the prompt that supports M4
- Plan reference: implementation-plan.md:265-270 ("`budget-limit` is not gated (the user confirms)"),
  :389-396 (limit path), :403-406 (fail open), :421 (no new timers, observers or polls)
- Pattern to follow: `armAtTerminal` `:277-334`; `confirmBudgetOperation` `:440-453`; `workInFlight`
  `:456-471`; `requestAgentHandoff` `:597-627`
- Quality requirements:
  1. S1. In `armAtTerminal`, when `atBlockingLimit` is true and the live operation is `budget-auto`
     in `waiting-for-turn-end`, skip the work gate. Change the operation's reason to `budget-limit`
     (drop `readonly` from `Operation.reason`; keep the same operation id), clear `waitingFor` and
     the wait stamp, and bump the revision. The existing code then moves it to `armed` and on to
     `awaiting-confirmation`, unless `userConfirmed` is set, in which case it starts. Held inputs
     follow the existing `HELD_SOURCE_PHASES` rule. The gate condition must read `atBlockingLimit`,
     not only `live.reason`.
  2. S2. Add `export const WORK_IN_FLIGHT_WAIT_LIMIT_MS = 900_000;`. Its doc comment says it matches
     `MAX_AGENT_WAIT_MS` in cli-agent-runtime `agent-process-manager.service.ts:211`, and that it is
     not imported because agent-sdk must not depend on cli-agent-runtime. Add a private
     `waitingSince?: number` to `Operation`. Stamp it with `Date.now()` the first time the gate finds
     work in flight; later terminals do not reset it. At each gate check (`armAtTerminal`, which
     `armHandoverIfIdle` also reaches), if work is still in flight and
     `Date.now() - waitingSince >= WORK_IN_FLIGHT_WAIT_LIMIT_MS`, do not keep waiting. Instead:
     - Move the operation to `awaiting-confirmation`. The reason stays `budget-auto`.
     - Clear `waitingFor` and `waitingSince`, then bump the revision and publish.
     - Move `queuedInputs` in under the existing held-phase rule.
     - Log one WARN: `[SessionHandover] Work-in-flight wait limit reached; asking the user`, with
       operationId, the last `waitingFor` and `elapsedMs`.
     - Never call `startAutomatic` on this path. Running work is never cut off without a click.
     - Add no timer, interval or poll. The check runs only when a terminal arrives (plan :421).
     - Clear `waitingSince` whenever the operation leaves `waiting-for-turn-end`.
  3. M3. In `requestAgentHandoff`, when `previousId` is defined but missing from `after` (for
     example, a compaction boundary between the two reads trimmed it), use only the last assistant
     message from `after`, not every assistant message. Log one DEBUG line. When `previousId` is
     undefined (no assistant message before the request), keep today's `slice(0)` behaviour.
  4. M4 support. Add one line to `HANDOFF_REQUEST_PROMPT`, before "Do not call tools":
     `'Keep the whole handoff under 5,000 characters.'`. Keep every heading and its order.
- Spec cases (all new, in the coordinator spec):
  - S1: a `budget-auto` op waiting on 1 running subagent. A terminal with `atBlockingLimit = true`
    gives `reason: 'budget-limit'`, `phase: 'awaiting-confirmation'`, no `waitingFor`, the same
    operationId, and does not start automatically. Variant: with `userConfirmed` set, it goes
    straight to `writing-handoff`.
  - S2: mock `Date.now` (jest fake timers or `jest.spyOn(Date, 'now')`). Work in flight at t0 gives
    waiting. At t0 + limit - 1 it is still waiting, and the stamp is not reset. At t0 + limit it is
    `awaiting-confirmation` with `reason: 'budget-auto'`, no `waitingFor`, no `startAutomatic` or
    owned-handoff call, and one WARN. Then `begin('successor')` reaches `writing-handoff` (one
    click). Work that drops to 0 before the limit still starts automatically, which is today's
    behaviour.
  - M3: when `previousId` is absent from the second read, the handoff equals the last assistant
    message only. When `previousId` is undefined, all assistants after the request are used (no
    change).
  - The prompt contains the length line and still contains all seven headings in order.
- Validation notes: do not change `cancel`, `fail` or `sourceEnded`; stale `waitingFor` (M2) is
  deferred (D8). Keep `cancelledAutomaticSources` semantics: a `budget-auto` op escalated by S2 and
  then cancelled is suppressed until the hard limit, as today. Clearing `waitingFor` on these paths
  is required by S1 and S2 only.

### Task 5F.2: Builder — an over-cap agent handoff keeps its last sections — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-handoff-builder.ts`
  and `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-handoff-builder.spec.ts`
- Finding: M4 (decisions.md D7)
- Plan reference: implementation-plan.md:336-348 (caps; a 7,000-character agent handoff is truncated
  with the marker), :416-419 (the successor gets the agent handoff in full, up to 6,000 characters)
- Pattern to follow: `capText` `:212-223`, `quoteWithin` `:659-676`, `withAgentHandoff` `:685-710`
- Quality requirements:
  - Only the agent-handoff path changes. `capText` keeps its head-only behaviour for every other
    caller.
  - Add a head-and-tail cut for the agent text, used by `quoteWithin` in place of `capText`:
    - When the text is at or under the budget, return it unchanged.
    - Otherwise the tail is the text from the last line that starts with `## Still running`, or, if
      that heading is absent, from the last `## Next action` heading. The tail is used only when it
      fits in half the budget. If it does not fit, or neither heading is present, the tail is the
      last `floor(budget / 2)` characters, starting at a line start when one falls inside that
      window.
    - The head fills the rest: `budget - tail - '\n[truncated]\n'.length`.
    - The result is `head.trimEnd() + '\n' + TRUNCATED_MARKER + '\n' + tail`, and `cut: true`.
    - Neither cut point splits a surrogate pair.
  - The final quoted section still fits in `SESSION_HANDOFF_LIMITS.agentHandoffChars` (6,000). The
    existing shrink loop in `quoteWithin` must still terminate.
- Spec cases:
  - A 9,000-character agent handoff with all seven headings, where `## Next action` and
    `## Still running` sit at the end. The section is at most 6,000 characters, contains
    `[truncated]` once, and keeps `## Goal` and the full text of `## Still running` and
    `## Next action`.
  - Over the cap with no headings: the head and the tail both survive, with the marker between
    them.
  - Existing regressions still pass: a 5,000-character handoff is kept in full (R8), and a
    7,000-character handoff is truncated with the marker.
  - A surrogate pair at either cut point is not split.

### Batch 5F verification

Run these one at a time, in the foreground, from the worktree root, with the output filtered:

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`
- `npx nx lint @ptah-extension/agent-sdk --parallel=1`: 0 errors, and no warning on a changed line
- These agent-sdk specs need no `--moduleNameMapper` override. cli-agent-runtime is not touched; if
  an executor touches it anyway, the override in "Verification rules" applies.
- Then one code-logic re-review, scoped to the 5F commit. It checks S1, S2, M3 and M4 only.

### Batch 5F result

- Commit: `44eba9fc3` (`fix(agent-sdk): batch 5F - ...`), 4 files: the coordinator and builder and
  their specs. Report: `batch-5F-report.md`.
- Verified on disk by the team-leader: S1 in-place conversion in `armAtTerminal` (same id, reason
  `budget-limit`, `waitingFor`/`waitingSince` cleared, gate skipped at the blocking limit); S2
  `WORK_IN_FLIGHT_WAIT_LIMIT_MS = 900_000`, `waitingSince ??=` stamp, one WARN and
  `awaiting-confirmation` without `startAutomatic`, no timer; M3 missing-anchor path takes only the
  last assistant text, with one DEBUG line; M4 `capHeadAndTail` used by `quoteWithin` only, `capText`
  unchanged; prompt carries the 5,000-character line. No TODO, stub, `.only` or `.skip` markers.
- Checks re-run by the team-leader, one at a time: Jest on the coordinator and builder specs — 2
  suites, 84 tests passed. Typecheck `@ptah-extension/agent-sdk` passed. Lint
  `@ptah-extension/agent-sdk`: 0 errors, 53 warnings (baseline 52). The one new warning is
  `max-lines` on `session-handover-coordinator.service.ts:811` (726 counted lines, limit 700),
  reported on the file's last line, not a changed line. Accepted for now and scheduled as 627-L7
  (decisions.md D9).
- Accepted deviations (report "Deviations"): M3 picks the last assistant message with text (a
  trailing tool-only entry would otherwise lose the handoff again); one existing coordinator spec
  now includes the anchor so it still covers the normal path; two builder specs updated to the
  head-and-tail shape; R8 (5,000 characters kept in full) unchanged.
- Phase 1 re-review: `code-logic-rereview-5F.md` APPROVED on `6cb27e3e4..44eba9fc3`. S1, S2, M3 and
  M4 FIXED; no new Blocking or Serious. One Minor (the fallback tail cut with no heading can start
  inside a fenced code block; display only) is recorded as 627-L8, not fixed (decisions.md D11).
- Phase 1 (Batches 1-5 and 5F) is CLOSED. Reviews: `code-logic-review.md`, `code-style-review.md`,
  `code-logic-rereview-5F.md`.

## Out-of-scope findings (not tasks of this branch unless the user asks)

- OOS-1 (reported by the user from the running app, 2026-10-11): closing a lane throws
  "Cannot set properties of undefined (setting 'userPicked')".
  `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts:55`
  passes the unbound method `remove` into the template context, so `this.userPicked = true` (`:200`)
  runs with `this` undefined. Not caused by this branch. Awaiting the user's choice (separate task, or
  a batch here). Recorded in decisions.md D10.

## Deferred follow-ups from the Phase 1, 2 and 3 reviews (named later tasks; decisions.md D8, D21)

| Id | Finding | Why deferred | Target |
| --- | --- | --- | --- |
| 627-L1 | M1: the notice can miss the stopped subagent's own `Agent` result and stay in the queue | Advisory text only; the plan accepts "notice not delivered → terminal handover still runs" (implementation-plan.md:403-404); no data or lane config is lost | Batch 7 (it adds the wrap-up notice on the same queue): post before awaiting the stop, or drain at turn end |
| 627-L2 | M2: stale `waitingFor` on cancelled or failed snapshots | Display only. Its one planned consumer, Task 6.2, keys on `waiting-for-turn-end` | Follow-up: clear it in `cancel`, `fail` and `sourceEnded`. **Phase 4: fixed in Task 9.2** (plan v2 B1, spec S9) |
| 627-L3 | M5: `startedTasks` is not pruned during a session | Small entries, released at session end | Follow-up: drop an entry on task terminal |
| 627-L4 | Style M1 and M2: cli-agent-runtime injects the concrete coordinator and registers in its constructor | Allowed boundary; no runtime fault | Follow-up: `Pick<SessionHandoverCoordinator, 'setLaneWorkProvider'>` and registration from `cli-agent-runtime/src/lib/di/register.ts` |
| 627-L5 | INFO publish on every terminal while waiting (logic) and INFO-per-publish noise (style minor) | Noisy but bounded | Follow-up: publish only when `waitingFor` changes; per-event lines at DEBUG |
| 627-L6 | `admitInterrupt` refuses an interrupt while an op is `waiting-for-turn-end` | Existing behaviour (9fe19b56e); the message is queued, not lost; the wait is now bounded by S2 | Follow-up: allow interrupts in `waiting-for-turn-end`. **Phase 4: fixed in Task 9.2** (`holdsSource`, plan v2 Decision 6, spec S10) |
| 627-L7 | `max-lines` warning on `session-handover-coordinator.service.ts` (726 vs 700) after Batch 5F | Lint warning, not an error; extracting now would turn the scoped S1/S2 re-review into a refactor review (decisions.md D9) | Follow-up after the Phase 1 re-review accepts: extract the work-in-flight gate (`workInFlight`, the wait bound, the S1 conversion, `setLaneWorkProvider` slot) into its own helper file in `session-handoff/`; behaviour-preserving, specs unchanged |
| 627-L8 | Re-review 5F minor: the `capHeadAndTail` fallback tail (no `## Still running` or `## Next action` heading) can start inside a fenced code block | Display only (reviewer); the cut is marked with `[truncated]`, and the heading-based tail is unaffected (decisions.md D11) | Follow-up: move the fallback cut point past an unbalanced fence |
| 627-L9 | Phase 2 review M2: the gone-source fallback skips the queued-input transfer, so queued composer text stays in the old tab and the user is not told | Nothing is lost (the text stays in the old composer); not a lane-config or data-loss Moderate, so outside the fix-round rule | Follow-up: carry the queued text to the new tab, or tell the user where it stayed, when the fallback opens the new tab |
| 627-L10 | Re-review 6F moderate: the gone-source seed comes from the persisted handoff file, which can predate a later extend or compact | The file is the newest state written at the handoff or limit stage; the fallback runs only when the live entry is gone | Follow-up: mark a file-sourced seed as such in the new tab, or refresh the file on extend/compact |
| 627-L11 | Re-review 6F minor: `continueFromGoneSource` returns silently while another budget action is in flight | Only for the duration of the in-flight action | Follow-up: show a busy state on the button |
| 627-L12 | Re-review 6F minor: `goneSourceTab` remembers one source only; alternating two ended sources opens duplicate tabs; grid-mode `switchTab` focus has no spec | Rare path; no data lost | Follow-up: key the remembered tab by source session id and add a grid-mode spec |
| 627-L13 | Batch 8 minor (D18): a held input that starts the next turn before the result is processed makes `armHandoverIfIdle` a no-op, and a non-blocking authoritative `limit` is not armed at the next terminal | Arms after the first result that lands with the source idle; the blocking limit is unaffected (`atBlockingLimit`) | Follow-up: let the terminal tell an authoritative from a live `limit` (e.g. a budget accessor for the authoritative stage). **Closed by D22** (no code: no non-blocking stage arms anything) |
| 627-L14 | Phase 3 Moderate 1 (D20 item 2): a live `handoff` at the terminal starts `budget-auto` (`armAtTerminal` moves it to `writing-handoff`, `session-handover-coordinator.service.ts:371-375`); when the result then reaches the blocking limit, S1 converts only `waiting-for-turn-end` (`:309-318`), so the rotation runs without the user's click and without "Allow 20% more" | No data loss and no lane config at risk (fix-round rule); narrow window (estimate 80-99%, result >=100%, last second of a turn). **Touches user decision 1 (limit = one click "New session") and D5: the user chooses whether to fix it now or later** | Coordinator: when a blocking result lands and the op is `budget-auto` not yet past `writing-handoff`, convert it to `budget-limit`; or let the lifecycle defer a live `handoff` at the terminal when `blockAtLimit` is on and the estimate is near the limit. **Closed by D22** (no code: `budget-auto` and the S1 conversion are removed) |
| 627-L15 | Phase 3 Moderate 2: Stop (`session-control.service.ts:125`) at a live `handoff` stage arms `budget-auto` off an estimate that no result confirms | User can Cancel; the handoff doc is written first; no lane config at risk | Do not arm from the live figure on the interrupt path (authoritative stage only). **Closed by D22** (no code: a terminal arms nothing below the blocking limit) |
| 627-L16 | Phase 3 Moderate 3: a throttled provisional flush after an interrupt-driven terminal re-sets `liveFigure` (`session-budget.service.ts:313`) and can re-post a wrap-up notice (`:1162`); the non-provisional settle payload is ignored by `observeLive` (`:273`), so after an abnormal stream end the live stage stays elevated | Stale advisory stage and at most one stale notice; no data or lane config lost | Ignore live payloads for a session after its terminal until the next turn starts; route the settle payload to `accept` or clear the live figure on it. **Notice re-post half closed by D22** (no code: `observeLive` posts nothing). The display half stays, narrowed by the streaming-only display rule (Task 15.3) |
| 627-L17 | Phase 3 Minor 1: `onTurnTerminal` clears the whole session queue (`session-budget.service.ts:337`), dropping a pending subagent-monitor notice (`register.ts:511`) | Advisory text only | Clear only the budget's own notices (tag them by source) |
| 627-L18 | Phase 3 Minor 3: if the host `inner(...)` throws in `wrapResultStatsForActivity`, `armHandoverIfIdle` (`sdk-agent-adapter.ts:1825`) is skipped for that result | Arms at the next terminal | Run the arm in its own try before `inner`, or guard `inner` |
| 627-L19 | Phase 3 Minor 4: the limit notice says Ptah "will ask for a handoff and continue in a new session" (`session-budget.service.ts:205`), but at a blocking limit the user clicks "New session" | Wording only | Name the click at a blocking limit in the notice. **Phase 4: fixed in Task 11.2** (the rewritten `wrapUpNotice`, plan v2 Decision 1) |
| 627-L20 | Phase 3 Minor 5: the wrapper makes `onLiveStats` always defined (`sdk-agent-adapter.ts:1844`), so `LiveSessionStatsPublisher` runs a timer and owner watcher per stream on every host; a failed first terminal handover is retried once by the post-result arm in the same turn | Intended (plan: wrapper installed without a host callback); cost only | Measure the per-stream cost; document the single retry. **Single-retry half closed by D22** (no code: the post-result path only parks the blocking limit). The cost half stays |

## Batch 6: Frontend — never stuck at the limit (Component 9) — COMPLETE (0917b8074)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer, fresh session
- Execution mode: sequential
- Rationale: three chat services/components with their specs, one lib
- Tasks: 3 | Depends on: Batch 4 (contract types)
- Phase: 2 (Frontend) | Phase review: code-logic + visual (rendered banner copy), on the Batch 0 and
  Batch 6 commits. Completion needs dark and light before/after screenshots of the budget banner and
  the compaction card (no prototype; no new surface).

### Task 6.1: `continueInNewSession` falls back to `rotateSession()` when the source is gone — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\session-budget-actions.service.ts`
  and its spec
- Plan reference: implementation-plan.md:354-376
- Pattern to follow: `continueInNewSession` `:190-227`, `rotateSession` `:256-266`
- Quality requirements: `{ accepted: false, error: 'source-unavailable' }` → `rotateSession()`; same
  on Retry when the handover state is `failed` with `source session unavailable`.

### Task 6.2: Banner waiting copy with counts — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-banner.component.ts`
  and its spec
- Plan reference: implementation-plan.md:362-365
- Pattern to follow: copy block `:541-553`, stage computation `:427-442`
- Quality requirements: handoff stage with a `waiting-for-turn-end` handover and `waitingFor` → "Waiting
  for N subagents and M CLI lanes before continuing in a new session." with the existing "Continue
  now"; limit `awaiting-confirmation` keeps "New session"; aria labels unchanged.
- Validation notes: `waitingFor` is not validated by the webview guard; show the copy only for finite
  non-negative integers, else the existing copy. Show the counts only while the phase is
  `waiting-for-turn-end`, because cancelled or failed states can carry a stale `waitingFor`
  (627-L2). After the wait limit (Batch 5F, S2) a `budget-auto` op can sit in
  `awaiting-confirmation` at the handoff stage. That state must still offer "Continue now" and
  "Cancel".

### Task 6.3: `MessageSender` logs budget refusals and handover holds at `console.info` (R9) — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\message-sender.service.ts`
  and `message-sender.service.spec.ts`
- Plan reference: implementation-plan.md:366-367
- Pattern to follow: `:737-768`
- Quality requirements: other failures still `console.error`.

### Batch 6 verification

- `npx jest -c libs/frontend/chat/jest.config.ts <the three changed specs> --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/chat --parallel=1`.

Result (team-leader re-run before commit): Jest 3 suites, 129 tests passed; typecheck passed.
Executor lint: 0 errors (35 existing project warnings). Report: `batch-6-report.md`. One addition
beyond the plan text, accepted: a dismissed handoff stays visible while a handover is
`awaiting-confirmation`, so the 6.2 validation note (Continue now and Cancel must stay reachable)
holds. Code commit `0917b8074`.

Phase 2 review: code-logic `code-logic-review-phase2.md` NEEDS_REVISION 6/10 (0 B, 2 S, 3 M, 2 minor)
on the Batch 0 commit `f0882e60d` and the Batch 6 commit `0917b8074`; fix Batch 6F below. Visual
review still owed: dark and light before/after screenshots of the budget banner and the compaction
card (before = base commit, no prototype), now also covering the 6F limit-stage "Cancel handover"
button and the no-budget handoff copy.

## Batch 6F: Phase 2 fix round — COMPLETE (98852ac81)

- Source: `code-logic-review-phase2.md`. In scope: S1, S2, M1, M3 (verified reachable), m1, m2.
  M2 deferred as 627-L9 (fix-round rule: no lane config or data lost).
- Recommended executor: frontend-developer (with a minimal backend read path)
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 6
- Files (9, 2 libs): agent-sdk `session-handoff-writer.ts` (+ spec), `session-handoff-builder.ts`,
  `session-budget.service.ts` (+ spec); chat `session-budget-actions.service.ts` (+ spec),
  `session-budget-banner.component.ts` (+ spec)
- Phase: 2 (Frontend) | Phase review: one code-logic re-review scoped to the 6F commit, plus the
  owed Phase 2 visual review
- Review result: code-logic re-review APPROVED 8/10 (`code-logic-rereview-6F.md`). Visual review:
  the user chose (2026-10-11) to check the budget banner and compaction card manually in Electron;
  no screenshot review is run. Phase 2 is closed. Batches 7–8 wait for TASK_2026_626 to merge
  into main (user decision, 2026-10-11).

### Task 6F.1: Fix the Phase 2 code-logic findings — COMPLETE

- S1: `SessionHandoffWriter.read(sessionId)` returns the persisted `~/.ptah/handoffs/<id>.md`;
  `previewHandoff` with no budget entry answers from it (`persistedHandoff`, seed via the new
  exported `sessionHandoffSeed`). The webview fallback `continueFromGoneSource` asks by session id,
  always opens a new tab, and shows a notice in it when no seed exists.
- S2: the banner shows a pending handover (`awaiting-confirmation` or `waiting-for-turn-end`)
  whatever the budget stage, dismissal or a missing budget.
- M1: a repeated Continue or Retry for the same gone source switches to the tab it opened.
- M3: the limit stage offers "Cancel handover" while a handover is pending.
- m1, m2: comments only.

### Batch 6F verification

Result (team-leader re-run before commit): agent-sdk Jest 3 suites, 126 tests passed; chat Jest 2
suites, 90 tests passed; `npx nx typecheck` passed for `@ptah-extension/agent-sdk` and
`@ptah-extension/chat` (`--parallel=1`). Executor lint: 0 errors, warnings at baseline (agent-sdk 53,
chat 35). Report: `batch-6F-report.md`. Code commit `98852ac81`.

- Path safety of `read()` checked: `resolveSessionHandoffPath` rejects any id that fails the anchored
  `UUID_REGEX` (hex and `-` only, so no `..` or separators) before a path is built, then requires the
  resolved target to be a single segment directly under the handoffs directory. The RPC handler also
  validates the id as a UUID.
- `max-lines` growth: `session-budget.service.ts` was already over the 700-line limit before 6F and
  grows by 27 lines to 751 counted lines (lint warning, not an error). Same treatment as 627-L7:
  accepted now so the re-review stays scoped to the fixes; follow-up is a behaviour-preserving
  extraction (for example the handoff preview and persisted-handoff path) into its own helper file.
- Behaviour change accepted: a `waiting-for-turn-end` handover at the handoff stage now also offers
  "Cancel (keep working)" (both phases are in the coordinator's `CANCELLABLE_PHASES`).

## Batch 7: Budget live feed (Component 1, live part) — COMPLETE (af073e5a2)

Unblocked: 626 merged into the branch at `91376becf` (D12). Report: `batch-7-report.md`. Executor
additions beyond the plan accepted in D13-D16.

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: one service and its spec; needs `SessionStatsEntry.provisional` from 626
- Tasks: 2 | Depends on: 626 merge, Batches 1 and 3
- Phase: 3 (Live feed) | Phase review: after Batch 8

### Task 7.0: Re-check A3 against the merged 626 types — COMPLETE

- Result: A3 holds for token budgets; for cost budgets it holds unless an estimate row is unpriced,
  in which case the measure guard (Task 7.1) ignores the live figure. No design change.

- Read the merged `libs/shared/src/lib/types/rpc/rpc-session.types.ts` (`provisional`, `revision`) and
  `session-stats-owner.service.ts` `build`/`estimateResult`; record any change in the report before
  coding Task 7.1.

### Task 7.1: `observeLive`, live `stageFor`, wrap-up notice, `onTurnTerminal` — COMPLETE

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
- Result (team-leader re-run): spec 83/83 passed; agent-sdk typecheck passed. Verified on disk:
  `observeLive` writes only `liveFigure`, `liveNoticedRank` and `workspacePath` (via
  `rememberWorkspace`); it never writes `snapshot`, `figure`, `revision`, `usageSeq` or `blocked`,
  and schedules no stage action. `canSend`/`checkStored`/`checkSnapshot` still read only the
  authoritative figure. Lint: no new warning from this batch (`session-budget.service.ts` already
  had its `max-lines` warning before the batch); the 53 -> 54 agent-sdk count comes from the 626
  merge (`session-stats-owner.service.ts`, 709 lines, new `max-lines`) — see D12.

## Batch 8: Adapter and lifecycle live wiring (Component 3, adapter part) — COMPLETE (e6788c558)

Unblocked: 626 merged into the branch at `91376becf` (provides `setLiveStatsCallback` and the four
`transform()` call sites) and Batch 7 is COMPLETE (`af073e5a2`).

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: the adapter and the lifecycle are wired together and tested together
- Tasks: 2 | Depends on: 626 merge, Batches 4 and 7
- Phase: 3 (Live feed) | Phase review: code-logic on the combined diff of Batches 7-8

Result (first return, `batch-8-report.md`): NOT ACCEPTED, not committed. Task 8.1 verified on
disk. Task 8.2 carries an unplanned predicate (`atHandoffStage`: `limit` counts as `handoff` in both
arming paths) that lets a live `limit` estimate start an automatic rotation on a blocking budget
before the result arrives, bypassing the user's click at the limit (D17). The Batch 7 regression it
targets is real and must stay fixed (D18). Prettier reformat accepted (D19); turn-end order finding
accepted and sent to the Phase 3 review (D20). Scoped checks not re-run: nothing to commit until the
fix lands.

Required fix (Task 8.2, inside `session-lifecycle-manager.ts` and its spec):

1. `onTurnTerminal` passes `stageFor(budgetSessionId) === 'handoff'` as `atHandoffStage` again (the
   live figure is still present here; a `limit` stage at the terminal defers to the result, and the
   authoritative blocking limit is still handled by `atBlockingLimit`).
2. `armHandoverIfIdle` keeps `handoff || limit` (it runs after the result; the live figure is already
   cleared, so `limit` here is authoritative: blocking arms `budget-limit`, non-blocking arms
   `budget-auto`).
3. Split `atHandoffStage` accordingly (or inline both), with a doc comment saying why the two paths
   differ.
4. Spec: replace "treats a limit stage that does not block as the handoff stage" with (a) terminal at
   `stageFor` = `limit`, not blocking → `armAtTerminal(..., false, ..., false)`; (b)
   `armHandoverIfIdle` at `limit`, not blocking → `atHandoffStage` true; (c) authoritative `handoff`
   + live `limit` (stage `limit` at the terminal) → nothing auto-armed at the terminal, then
   `armHandoverIfIdle` after the result arms (pins the D18 recovery).
5. Re-run the Batch 8 verification commands; update `batch-8-report.md` Deviations.

### Task 8.1: `wrapLiveStatsForBudget` and post-result `armHandoverIfIdle` in `SdkAgentAdapter` — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
  and `…\sdk-agent-adapter.spec.ts`
- Plan reference: implementation-plan.md:194-202, 211-216
- Quality requirements: the wrapper is installed even with no host live callback; it calls
  `observeLive` (never `observe`) in try/catch with one WARN, then the inner callback; after
  `observeBudget`, a `handoff`/`limit` state calls `sessionLifecycle.armHandoverIfIdle(sessionId)`
  (R2).

### Task 8.2: Lifecycle `onTurnTerminal` calls `sessionBudget.onTurnTerminal` after arming — COMPLETE (D17 fix applied)

- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
  and `…\session-lifecycle-manager.spec.ts`
- Plan reference: implementation-plan.md:207-208, 216-218

### Batch 8 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts <sdk-agent-adapter.spec.ts> <session-lifecycle-manager.spec.ts> --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`, then
  `npx nx lint @ptah-extension/agent-sdk --parallel=1`.
- A1 live check (only if the user asks for a run): plan Verification points.
- Second pass (team-leader re-run, after the D17 fix): fix verified on disk against items 1-4 —
  `onTurnTerminal` passes `stageFor(...) === 'handoff'`; `armHandoverIfIdle` uses the private
  `atHandoffOrLimitStage` (handoff || limit) with a doc comment on why the paths differ; the old
  spec case is replaced by (a) terminal at non-blocking `limit` → `false`, (b) post-result
  non-blocking `limit` → `true`, (c) live `limit` over authoritative `handoff` → nothing at the
  terminal, armed after the result (D18 recovery). `sessionBudget.onTurnTerminal` runs after
  `armAtTerminal` and before `markTurnEnded` (spec pins the order). Task 8.1 files unchanged since
  the first verified pass (last modified before the fix). Jest 2 suites 161/161 passed; agent-sdk
  typecheck passed; lint 0 errors / 54 warnings (baseline, no new warning). Committed `e6788c558`.
- Phase 3 review due: code-logic on the combined Batches 7-8 diff, `91376becf..HEAD` (code commits
  `af073e5a2`, `e6788c558`), including the D20 items.
- Phase 3 review: `code-logic-review-phase3.md` APPROVED 7/10 on `91376becf..e6788c558` (3 suites,
  244 tests passed in the reviewer's run). 0 Blocking, 0 Serious, 3 Moderate, 5 Minor. No Moderate
  can break a lane config or lose data, so no fix round (fix-round rule). Moderates deferred as
  627-L14..L16, Minors 1, 3, 4, 5 as 627-L17..L20; Minor 2 is the accepted D15 residual. D20 item 1
  is accepted plan behaviour. 627-L14 (D20 item 2) touches user decision 1 and is left to the
  user (decisions.md D21).
- Phase 3 (Batches 7-8) is CLOSED.

## Completion (Mode 3)

- All 11 batches COMPLETE, each with a commit that resolves on the branch: `f0882e60d` (0),
  `28e3ddc05` (1), `221537118` (2), `306ee2732` (3), `833e5dadd` (4), `6cb27e3e4` (5), `44eba9fc3`
  (5F), `0917b8074` (6), `98852ac81` (6F), `af073e5a2` (7), `e6788c558` (8).
- Phase reviews accepted: Phase 1 (`code-logic-review.md`, `code-style-review.md`,
  `code-logic-rereview-5F.md`), Phase 2 (`code-logic-review-phase2.md`,
  `code-logic-rereview-6F.md`), Phase 3 (`code-logic-review-phase3.md`).
- Parity: N/A. A BUGFIX; no surface is replaced, consolidated, rebuilt or redesigned.
- Rendered visual evidence: replaced by user decision 3 (the user checks the budget banner and the
  compaction card manually in Electron; no screenshot review). Still open, so `task.md` is
  `in_review`, not `done`.
- Write-path trace: no persisted setting or configuration key changes. The one storage write is the
  existing handoff file from `buildHandoff`; its reader, the gone-source fallback (Batch 6F), reads
  the same file (627-L10 records its staleness after extend or compact).
- Open for the user: (1) the Phase 2 manual Electron check (decision 3); (2) optional A1 live run
  (`additionalContext` reaches the main model mid-turn); (3) the choice on 627-L14; (4) the deferred
  rows 627-L1..L20.
- Superseded for the task as a whole by Phase 4 (D22): the task is open again until Batches 9-17 and
  the Phase 4 review close.

---

# Phase 4 - Every session handover is user-authorized (D22-D25)

Source: `implementation-plan-v2-user-authorized.md` (Gate 2 passed: `-review.md` REVISE 5/10,
`-rereview.md` REVISE 6/10, `-rereview-2.md` APPROVED 8/10; commit `f680288dd`). Where it and
`implementation-plan.md` disagree, v2 wins. Spec cases S1-S23 below are the v2 "Spec cases" table
(`implementation-plan-v2-user-authorized.md:416-442`), not the S1/S2 of Batch 5F.

Batching boundary: one invariant per commit that still compiles. The shared reason union, the
`armAtTerminal` signature and the lifecycle rename cannot compile apart, so they land together
(Batch 9); every other shared change lands with its first consumer. Backend first (9-13), then the
frontend (14-17), because the webview needs the backend's new fields to have anything to show.

Defaults chosen (the plan's handoff gives the ordering, so no clarification was needed):

- Every batch is sequential with one in-process sub-agent executor (backend-developer for 9-13,
  frontend-developer for 14-17). File-disjoint pairs that may run beside each other if the
  orchestrator wants: 9 with 10; and after 11, any of 12, 13, 14. Each is committed on its own, and
  the heavy checks still run one at a time across all executors.
- Batch 9 has 7 files, one over the 6-file cap, on purpose: splitting it leaves a commit in which
  agent-sdk does not typecheck (the reason union, the 4-argument `armAtTerminal` call in the
  lifecycle, and the adapter's call to the renamed lifecycle method all break together).
- The verification rules at the top of this file apply unchanged to every Phase 4 executor
  (worktree only, scoped checks, one heavy check at a time, no `npm install`, no git, the `marked`
  mapper). Nx project names added in Phase 4: `@ptah-extension/rpc-handlers`,
  `@ptah-extension/vscode-lm-tools`, `@ptah-extension/chat-state`, `@ptah-extension/chat-types`.

## Phase 4 plan validation

Status: PASSED WITH RISKS

Checked against the worktree at `f680288dd`. Every file the plan names exists; every plan line
reference read was found at or within a few lines of the cited place.

Assumptions:

- A1 (plan): lane and background-subagent completions reach the source as turns that end in
  `onTurnTerminal`, not through `refuseIfBudgetReached`. UNVERIFIED here; Task 9.3 traces it
  (`agent-process-manager.service.ts` → `session-stream-pump.service.ts:100, 255`) and records the
  answer in its report. Its failure mode is covered by design ("Continue now anyway").
- A2 (plan): background subagents that finish without a parent turn leave `getBackgroundAgents`
  before the next terminal. UNVERIFIED; Task 9.3 checks `subagent-registry.service.ts:481, 574`.
- A3 (plan): vscode-lm-tools Jest may reach `marked`. Task 13.2 runs the spec once bare, then with
  the mapper if it fails.
- A4: the live payload reaches the aggregator unchanged. VERIFIED: `sdk-callbacks.ts:168-170`
  (cli-agent-runtime) broadcasts the whole payload; `chat-message-handler.service.ts:719-731` passes
  the parsed wire to `ChatStore.handleSessionStatsLive` → `handleLiveSessionStats` (`:212`). The only
  field filter is the shared parser (Task 10.1). Neither file needs editing.
- A5: the only production callers of `coordinator.begin` are `session-handover-rpc.handlers.ts:92`
  and `session-spawner.service.ts:301`; `armAtTerminal` is called only from
  `session-lifecycle-manager.ts:521, 543`; `armHandoverIfIdle` only from `sdk-agent-adapter.ts:1827`;
  `budget-auto` appears only in the coordinator, its spec, `session-handover.types.ts:2` and the
  banner spec. VERIFIED by grep over `libs` and `apps`.
- A6: `admitOrHold` has two more production callers the plan does not list:
  `chat-session.service.ts:503` (rpc-handlers) and `session-spawner.service.ts:645` (steer). Both
  keep their code; their behaviour follows `holdsSource` (Decision 6). VERIFIED; S23 and the steer
  specs pin it (Tasks 9.2, 13.1).

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R-P1: widening `SessionBudgetSessionControl` with `'find'` (Decision 1) breaks agent-sdk typecheck: the DI factory builds it as an object literal at `di/register.ts:808-821`, a file the plan does not list | HIGH | Task 11.2 adds `find` to that literal (lazy resolve, same shape as its two siblings). The specs construct it with casts (`session-budget.service.spec.ts:153-156`, `chat-session-budget.spec.ts:133-136`) and need no change |
| R-P2: `TabState` is declared in `libs/frontend/chat-types/src/lib/chat-types.ts:652`, not in `tab-manager.service.ts` as the plan says | MEDIUM | Task 14.1 adds the optional field in chat-types and the setter in tab-manager; the batch typechecks both projects |
| R-P3: adding `'request-wrap-up'` to `SessionBudgetAction` makes `act`'s switch (`session-budget.service.ts:397-408`) non-exhaustive, so agent-sdk stops typechecking | MEDIUM | `session-budget.types.ts` ships in Batch 11 with the new `act` case, not with the other shared changes |
| R-P4: `SessionBudgetActionsService.displayStage` does not exist yet (the plan's F1 reads as if it did) | LOW | Task 15.3 creates it as a computed beside the existing stage reads; the banner's `stage` input binds to it |
| R-P5: `resolvedHandover` is documented "rendered only after this tab is idle" (`chat-view.component.ts:935`) and `showSessionBudgetBanner` requires `status === 'loaded'` (`:946`); an agent request arrives mid-turn | MEDIUM | Task 17.1 implements Decision 7 (render while `streaming` at display stage ≥ handoff or with a pending snapshot) and updates that comment; spec S13 |
| R-P6: the handover client's guard (`session-handover-client.service.ts:10-20`) does not validate `draftText` | MEDIUM | Task 15.2: `peekDraft` returns a draft only when `draftText` is a non-empty string |
| R-P7: the cancel RPC result carries `state` with `draftText`; if the client does not `record` it, a cancel whose broadcast is dropped loses the draft | MEDIUM | Task 15.3: `cancelHandover` records the returned `state` through `SessionHandoverClientService.record` (revision-guarded) before the draft effect reads it |
| R-P8: spec churn (plan R4): many coordinator, lifecycle and adapter cases assert `budget-auto`, the D6 bound and the S1 conversion | MEDIUM | Tasks 9.2-9.3 rewrite them to S1-S23; the team-leader checks no assertion was merely deleted without a replacing case |
| R-P9: the coordinator is 837 lines (`max-lines` 700, 627-L7) | LOW | Task 9.2 records the new count; a warning only. 627-L7 stays deferred |
| R-P10: the spawner injects the concrete coordinator (`session-spawner.service.ts:232`), so only the spec `Pick` and a grep keep the agent path off `begin` | LOW | Task 13.1 narrows the spec `Pick`; grep gate G2 after Batch 13 |
| R-P11 (plan Q2, R5-R7): extend leaves a parked limit op; the queued message rides to the successor; a converted agent request shows the limit copy; an agent can re-request | LOW | Accepted in the plan; copy in Tasks 16.2 and 15.3 |

Edge cases:

- Double-click on "Continue in new session" — repeat `begin` returns the snapshot unchanged except a
  refreshed `waitingFor` (Task 9.2, S7).
- Agent request, then a blocking-limit terminal or a blocking result — the same op becomes the
  holding limit park (Tasks 9.2, 9.3; S16).
- Lane provider throws — `lanes: null`, wait never ends on its own, "lane status unknown" (Tasks 9.2,
  16.2; S22).
- Stop during a user-started wait or an agent request — not held (Task 9.2; S10).
- Draft with no mounted composer (compact view), a throwing write, two views — peek + acknowledge
  (Tasks 15.2, 17.1; S20).
- Live payload older revision, measure mismatch, untracked, throw — `undefined`, no change (Task
  11.2; S21).
- Wrap-up clicked at the turn edge — backend `WRAP_UP_UNAVAILABLE`, UI shows the refusal (Tasks 11.2,
  15.3; S6).
- A non-empty composer when a draft returns — appended after a blank line, never overwritten (Task
  16.1; S20).

Deferred rows under D22 (table above): closed by D22 with no code — 627-L13, L14, L15, the notice
re-post half of L16, the single-retry half of L20. Fixed here — L6 and L19, and L2, which the
approved plan folds into B1 and spec S9 asserts (`waitingFor` cleared on cancel). Shrink without a
task — L7 (re-measured in Task 9.2), L18 (a skipped park after a throwing `inner` is harmless). All
other rows stay as recorded.

## Batch 9: Coordinator user-only start, lifecycle and adapter result path (S1-part, B1, B2-part) — COMPLETE (907d9f405)

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: one invariant across three tightly coupled files that cannot compile apart; needs
  judgement in the spec rewrites
- Tasks: 3 | Depends on: none (may run beside Batch 10)
- Phase: 4 (User-authorized handover) | Phase review: code-logic (cross-side CLI lane) plus style on
  the new public API, on the combined Batch 9-17 diff

### Task 9.1: Shared handover contract — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\shared\src\lib\types\session-handover.types.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:178-191 (Decision 3), :308-313 (S1)
- Pattern to follow: the existing optional fields and doc comments in the same file (`:16-58`)
- Quality requirements: `SessionHandoverReason` drops `'budget-auto'`; `SessionHandoverState` gains
  `requestedBy?: 'agent'` and `draftText?: string` (doc: the user's own composer text, published only
  in `cancelled`/`failed`); `waitingFor.lanes: number | null` (`null` = lane status unknown; doc names
  the user-started wait); `BeginSessionHandoverParams.continueNow?: boolean`; `queuedInput` keeps its
  name and now becomes the draft. Header comment notes the draft exception to "never exposes queued
  inputs". `BeginSessionHandoverResult`, `CancelSessionHandoverResult` and the
  `'source session unavailable'` literal unchanged.
- Validation notes: R-P8; the banner spec still names `budget-auto` — it is fixed in Task 16.2, and
  the chat project is not checked in this batch.
- Implementation details: type-only edits.

### Task 9.2: `SessionHandoverCoordinator` — one setter, one gate, the draft slot — COMPLETE

- Depends on: Task 9.1
- File: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.ts`
  and `session-handover-coordinator.service.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:27-58, :79-158, :162-228 (Decisions
  1-8), :242-274 (B1), :416-442 (S1, S2, S7-S10, S15, S16, S19, S22, S23 coordinator parts)
- Pattern to follow: existing `begin` guards (`:240-247`), `publish`/`snapshot` (`:809-836`),
  `restore` (`:759-775`), `complete` (`:527-633`)
- Quality requirements: `begin(source, reason, turnInFlight, agentHandoff?, options?: { continueNow?;
  queuedInput? })` folds in `request()`, is the only place that sets `userConfirmed`, stores
  `queuedInput` as `draftText` (appended after a blank line on a second capture, never in `inputs`),
  clears `requestedBy` and keeps `agentHandoff` on a parked op, gates unless `continueNow`, sets
  `forced` with `continueNow` mid-turn. New `requestFromAgent(source, agentHandoff?)`: same guards,
  parks `successor` in `awaiting-confirmation` with `requestedBy: 'agent'`, never sets
  `userConfirmed`, never gates, never starts; a live op returns its snapshot unchanged; INFO
  `[SessionHandover] Agent requested a successor for <id>`. `armAtTerminal(source, atBlockingLimit,
  queuedInputs)`: parks `budget-limit` at the blocking limit when no live op; converts a parked agent
  op at the blocking limit (reason `budget-limit`, marker cleared, `agentHandoff` kept); re-gates a
  `userConfirmed` op in `waiting-for-turn-end` unless `forced`; moves queued inputs only when
  `holdsSource(op)`; creates nothing else. `workInFlight` returns `lanes: null` on a provider throw
  (WARN once per op) and treats `null` as work. `startConfirmed(op)` replaces `startAutomatic`,
  `confirmSuccessor`, `confirmBudgetOperation`, acts only on `userConfirmed`, and is the only caller
  of `complete()`. `complete()` delivers the draft as one `require-idle` input after the held inputs
  in the first transfer batch and clears it only at `closing`. `snapshot()` publishes `requestedBy`
  when set and `draftText` only in `cancelled`/`failed`. `holdsSource(op)` is used by `admitOrHold`,
  the queue move and `admitInterrupt` (627-L6). Clear `waitingFor` in `cancel`/`fail`/`sourceEnded`
  (627-L2). Delete `budget-auto` handling, the S1 conversion, `WORK_IN_FLIGHT_WAIT_LIMIT_MS`,
  `waitingSince`, `cancelledAutomaticSources`, `request()` as public, `confirm()`. Spec cases rewritten
  to S1, S2, S7-S10, S15, S16, S19, S22, S23 (coordinator parts), not loosened.
- Validation notes: R-P8, R-P9 (record the new line count in the report); A6 (`admitOrHold` callers
  outside the plan follow `holdsSource`); the `restoreInputs` mock in every draft case asserts it
  never receives the draft text.
- Implementation details: `Operation` gains `draftText?`, `requestedBy?`, `forced?`; `agentHandoff`
  stays readonly (the parked op keeps it).

### Task 9.3: Lifecycle arms nothing; adapter parks only the blocking limit after a result — COMPLETE

- Depends on: Task 9.2
- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
  and `session-lifecycle-manager.spec.ts`;
  `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
  and `sdk-agent-adapter.spec.ts` (the result path only; the live path is Task 11.3)
- Plan reference: implementation-plan-v2-user-authorized.md:276-291 (B2), :416-442 (S1-S4, S16)
- Pattern to follow: current `onTurnTerminal` (`session-lifecycle-manager.ts:514-532`),
  `armHandoverIfIdle` (`:539-549`), `wrapResultStatsForActivity` (`sdk-agent-adapter.ts:1808-1836`)
- Quality requirements: `onTurnTerminal` calls `armAtTerminal(key, atBlockingLimit, queue)` with no
  stage argument, then `sessionBudget.onTurnTerminal`, then `markTurnEnded` (order kept and pinned).
  `armHandoverIfIdle` renamed `parkLimitHandoverIfIdle`: no-op unless the record is idle and
  `isAtBlockingLimit`; otherwise `armAtTerminal(key, true, rec.messageQueue)` (one conversion path for
  terminal and post-result). Delete `atHandoffOrLimitStage`. The adapter calls it only when
  `budget?.blocked === true` (WARN on a throw kept). Specs: S1-S4 lifecycle parts, S3 adapter part,
  S16 post-result case (terminal saw non-blocking, result blocking → conversion, `complete` not
  called).
- Validation notes: A1 and A2 — trace both and put the answer, with file:line, in the report. 627-L18
  shrinks (a skipped park after a throwing `inner` is harmless); no fix.
- Implementation details: the D17/D18 comments on the old predicates go with them.

### Batch 9 verification

- Every listed file contains the work; no `budget-auto`, `startAutomatic`, `confirmSuccessor`,
  `confirmBudgetOperation`, `WORK_IN_FLIGHT_WAIT_LIMIT_MS`, `cancelledAutomaticSources`,
  `atHandoffOrLimitStage`, `armHandoverIfIdle` left in `libs/backend/agent-sdk` or `libs/shared`.
- One heavy check at a time, from the worktree root:
  `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts --coverage=false --maxWorkers=2`;
  then `npx nx typecheck @ptah-extension/shared --parallel=1`; then
  `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`; then
  `npx nx lint @ptah-extension/agent-sdk --parallel=1` and `npx nx lint @ptah-extension/shared --parallel=1`
  (0 errors; no new warning on a changed line; record the coordinator `max-lines` figure).
- No per-batch review; the Phase 4 review covers it.

## Batch 10: Shared live-stage wire field (S1-part) — COMPLETE (f4291b91f)

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: small, additive, one lib; may run beside Batch 9 (file-disjoint)
- Tasks: 1 | Depends on: none
- Phase: 4 | Phase review: as Batch 9

### Task 10.1: `liveBudgetStage` on the live payload and the parser — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\shared\src\lib\types\agent-adapter.types.ts`;
  `...\libs\shared\src\lib\types\messages\session-stats-live.ts` and `session-stats-live.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:187-189 (Decision 3), :315-318 (S1), S14
- Pattern to follow: the `budget` convention (`agent-adapter.types.ts:82-87`) and the `context` rule
  in the parser (`session-stats-live.ts:68-98`)
- Quality requirements: `SessionStatsLivePayload` and `SessionStatsLiveWire` gain
  `liveBudgetStage?: 'handoff' | 'limit' | null` (absent = no change, `null` = clear, value = set).
  The parser keeps `'handoff'`, `'limit'` or `null` only on a provisional payload; any other value, or
  a non-provisional payload, drops only the field. Spec S14.
- Validation notes: A4 (no change needed in `sdk-callbacks.ts` or `chat-message-handler.service.ts`).
- Implementation details: additive; nothing reads the field until Batches 11 and 15.

### Batch 10 verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/messages/session-stats-live.spec.ts --coverage=false --maxWorkers=2`;
  then `npx nx typecheck @ptah-extension/shared --parallel=1`; then
  `npx nx lint @ptah-extension/shared --parallel=1`.

## Batch 11: Budget service display-only live stage, wrap-up on request, adapter live wiring (S1-part, B3, B2-part) — COMPLETE (a465ac77f)

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: the action union, its `act` case, the DI literal and the adapter's use of the new
  `observeLive` return type compile only together
- Tasks: 3 | Depends on: Batches 9 and 10
- Phase: 4 | Phase review: as Batch 9

### Task 11.1: Budget action and error code — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\shared\src\lib\types\session-budget.types.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:186, :314
- Quality requirements: `SessionBudgetAction` gains `'request-wrap-up'`;
  `SessionBudgetActionErrorCode` gains `'WRAP_UP_UNAVAILABLE'`. If `session-budget.types.spec.ts`
  pins the union, update it in this task.
- Validation notes: R-P3 (lands with Task 11.2 so `act` stays exhaustive).

### Task 11.2: `SessionBudgetService` — `observeLive` returns a display stage; `request-wrap-up` — COMPLETE

- Depends on: Task 11.1
- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts`
  and `session-budget.service.spec.ts`;
  `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\di\register.ts`
  (the `SessionBudgetSessionControl` literal at `:808-821` only)
- Plan reference: implementation-plan-v2-user-authorized.md:162-171 (Decision 1), :293-306 (B3),
  S5, S6, S21
- Pattern to follow: existing `act` cases (`:397-408`), `noticeLiveStage` (`:1144-1166`), the DI
  literal's lazy `c.resolve` siblings
- Quality requirements: `observeLive(snapshot): 'handoff' | 'limit' | null | undefined` per D25 —
  `undefined` on not provisional, untracked/released, older revision, measure mismatch and throw
  (retained `liveFigure` untouched); `null` when disabled or an accepted figure below handoff; the
  stage at `handoff`/`limit`. No `noticeQueue.post` from the live path; `noticeLiveStage` becomes
  log-only `logLiveStage` (once per rank per turn). `liveNoticedRank` renamed `wrapUpRequestedRank`,
  reset at `onTurnTerminal`, extend and a settings change. `act('request-wrap-up')` succeeds only with
  a budget entry, a display stage of `handoff`/`limit` and `sessionControl.find(id)?.turnInFlight`;
  posts once per rank per turn (a repeat succeeds and posts nothing); otherwise
  `WRAP_UP_UNAVAILABLE`; no `noticeQueue` → `WRAP_UP_UNAVAILABLE`; never throws. INFO
  `[SessionBudget] Wrap-up requested by the user for <id> at <stage>`. `wrapUpNotice` rewritten: says
  the user will continue in a new session and, at a blocking limit, names the "New session" click
  (627-L19). `SessionBudgetSessionControl` widened with `'find'`; the DI literal adds `find`.
- Validation notes: R-P1 (the DI literal); D25 return contract exactly as S21; 627-L16's display
  half stays (frontend rule, Task 15.3); 627-L17 stays (whole-queue clear unchanged).
- Implementation details: the stage file write at handoff/limit (`:653-682`) is kept as preparation.

### Task 11.3: Adapter `wrapLiveStatsForBudget` sets `liveBudgetStage` — COMPLETE

- Depends on: Task 11.2
- File: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
  and `sdk-agent-adapter.spec.ts` (the live path only)
- Plan reference: implementation-plan-v2-user-authorized.md:287-289 (B2), S21
- Pattern to follow: `wrapLiveStatsForBudget` (`:1844-1862`)
- Quality requirements: `undefined` → payload to `inner` without the field; `null` or a stage → field
  set; a throw keeps the WARN-once and omits the field; the payload still reaches `inner` in every
  case.

### Batch 11 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts --coverage=false --maxWorkers=2`
  (add `libs/shared/src/lib/types/session-budget.types.spec.ts` under `-c libs/shared/jest.config.ts`
  as a separate run if Task 11.1 touched it); then `npx nx typecheck @ptah-extension/shared --parallel=1`;
  then `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`; then lint both with `--parallel=1`.
- Grep: `noticeQueue?.post` in `session-budget.service.ts` appears only on the `request-wrap-up` path.

## Batch 12: RPC handlers (R1) — PENDING

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: one lib, two small handler pairs
- Tasks: 2 | Depends on: Batches 9 and 11
- Phase: 4 | Phase review: as Batch 9

### Task 12.1: `session:beginHandover` passes `continueNow` and the draft; no `admitOrHold` — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\rpc-handlers\src\lib\handlers\session-handover-rpc.schema.ts`;
  `session-handover-rpc.handlers.ts` and `session-handover-rpc.handlers.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:320-327 (R1), S8, S9, S19
- Pattern to follow: the begin handler (`session-handover-rpc.handlers.ts:85-106`)
- Quality requirements: schema `continueNow: z.boolean().optional()`; the handler calls
  `begin(source, 'successor', turnInFlight, params.handoff, { continueNow, queuedInput })`; the
  `admitOrHold` call (`:98-103`) is removed; one INFO line `{ sourceSessionId, continueNow }`. Cancel
  handler unchanged (its `state` carries `draftText`). Specs: S8 (`continueNow` passed), S9/S19 (no
  `admitOrHold`; cancel result carries `draftText`).

### Task 12.2: `request-wrap-up` in the budget RPC — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\rpc-handlers\src\lib\handlers\session-budget-rpc.schema.ts`
  and `session-budget-rpc.handlers.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:326, S6, S11
- Quality requirements: `'request-wrap-up'` in `SESSION_BUDGET_ACTIONS`; spec: the action is parsed
  and forwarded; `WRAP_UP_UNAVAILABLE` returned as-is. `chat-session-budget.spec.ts` stays green
  unchanged (S11).

### Batch 12 verification

- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-session-budget.spec.ts --coverage=false --maxWorkers=2`;
  then `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1`; then
  `npx nx lint @ptah-extension/rpc-handlers --parallel=1`.

## Batch 13: Agent successor tool asks the user (C1, D23) — PENDING

- Recommended executor: backend-developer
- Fallback executor: backend-developer, fresh session
- Execution mode: sequential
- Rationale: one behaviour across two libs (spawner and its tool reply); small
- Tasks: 2 | Depends on: Batch 9
- Phase: 4 | Phase review: as Batch 9

### Task 13.1: `startSuccessor` calls `requestFromAgent` — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\cli-agent-runtime\src\lib\session-children\session-spawner.service.ts`
  and `session-spawner.service.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:329-339 (C1), :217-228 (Decision 8), S17
- Pattern to follow: `startSuccessor` (`:289-311`)
- Quality requirements: `handoverCoordinator.requestFromAgent(activeId, request.handoff)` replaces
  `begin`; the local `turnInFlight` read goes (the injected `turnState` stays, used at `:1328-1329`);
  refusals unchanged; returns `{ ok: true, successor: true }`. The spec harness `Pick`
  (`:70`, `:185`) drops `'begin'` for `'requestFromAgent'`; the case at `:407-424` asserts
  `requestFromAgent(child.childSessionId, 'continue')` and that no `begin` exists on the fake.
- Validation notes: R-P10; A6 (the steer path `admitOrHold` at `:645` keeps its code; a steer during
  an agent request or a user-started wait is not held).

### Task 13.2: Tool reply and description say successor mode asks the user — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\session-tool-handlers.ts`,
  `session-tools.ts`, `session-tools.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:225-228, :336-337, S17
- Quality requirements: `sessionStartReply` successor text exactly: "Successor handover requested. It
  waits for the user to approve it in the session banner; nothing changes until then. Keep working
  normally. If the user cancels, this session continues." The `session-tools.ts:61-66` description
  says successor mode asks the user to approve. Spec `:323` matches the new text.
- Validation notes: A3 — run the spec bare first; on "Could not locate module marked" re-run with the
  mapper.

### Batch 13 verification

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{"^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js","^vscode$":"D:/projects/ptah-extension/.claude-worktrees/session-budget-handoff/__mocks__/vscode.ts"}'`;
  then `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts --coverage=false --maxWorkers=2`
  (mapper if A3 fails); then typecheck and lint `@ptah-extension/cli-agent-runtime` and
  `@ptah-extension/vscode-lm-tools` with `--parallel=1`, one at a time.
- Backend grep gates (team-leader, after this batch; plan :498-505):
  - G1: no `budget-auto`, `startAutomatic`, `WORK_IN_FLIGHT_WAIT_LIMIT_MS`, `cancelledAutomaticSources`
    in `libs` (frontend banner spec excepted until Task 16.2).
  - G2: `userConfirmed = true` only inside `begin`; `.begin(` on the coordinator only from
    `session-handover-rpc.handlers.ts`.
  - G3: `complete(` only from `startConfirmed`.
  - G4: `noticeQueue?.post` only on the `request-wrap-up` path.
  - G5: `draftText` never reaches `restoreInputs` or `admitOrHold`.

## Batch 14: Frontend tab state carries the live stage (F1-part) — COMPLETE (a106621bf)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer, fresh session
- Execution mode: sequential
- Rationale: the type home and its setter, two small libs
- Tasks: 1 | Depends on: Batch 10
- Phase: 4 | Phase review: as Batch 9

### Task 14.1: `TabState.liveBudgetStage` and its setter — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-types\src\lib\chat-types.ts`;
  `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-state\src\lib\tab-manager.service.ts`
  and `tab-manager.service.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:348-349 (F1)
- Pattern to follow: `sessionBudget` on `TabState` (`chat-types.ts:646-652`) and its setters
  (`tab-manager.service.ts:2267-2293`)
- Quality requirements: optional `liveBudgetStage?: 'handoff' | 'limit' | null` with a doc comment
  (advisory, display only, counted only while streaming); a setter beside the budget setters; cleared
  wherever `sessionBudget` is reset for a new or rebound session (`:1253`, `:2426`, `:2524`).
- Validation notes: R-P2.

### Batch 14 verification

- `npx jest -c libs/frontend/chat-state/jest.config.ts libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts --coverage=false --maxWorkers=2`;
  then `npx nx typecheck @ptah-extension/chat-types --parallel=1`; then
  `npx nx typecheck @ptah-extension/chat-state --parallel=1`; then lint both with `--parallel=1`.
- Result (team-leader): jest 60/60; typecheck both OK; lint chat-types 0 problems, chat-state 0 errors
  and 2 pre-existing warnings (baseline). Report: `batch-14-report.md`.
- Accepted deviation: D25 "clear on budget disabled" and the persisted stage were left out (files not
  owned); both moved to Task 15.4.

## Batch 15: Frontend services — live stage, draft bookkeeping, actions (F1) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer, fresh session
- Execution mode: sequential
- Rationale: three services in one lib that the view reads together
- Tasks: 4 | Depends on: Batches 9, 10, 11, 14
- Phase: 4 | Phase review: as Batch 9

### Task 15.1: Aggregator applies and clears `liveBudgetStage` — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.ts`
  and `session-stats-aggregator.service.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:350-351, S21
- Quality requirements: `handleLiveSessionStats` — field absent: no change; `null`: clear; a value:
  set, only for a payload the revision floor accepted. `handleSessionStats` clears it on a result, not
  on a snapshot-only broadcast.

### Task 15.2: `SessionHandoverClientService.peekDraft` and `acknowledgeDraft` — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\session-handover-client.service.ts`
  and `session-handover-client.service.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:357-368, S20
- Quality requirements: `peekDraft(sessionId)` returns `{ operationId, text }` only for a
  `cancelled`/`failed` state with a non-empty string `draftText` whose `operationId` is not
  acknowledged; it changes nothing. `acknowledgeDraft(operationId)` adds to a root-scoped `Set`.
- Validation notes: R-P6.

### Task 15.3: `SessionBudgetActionsService` — display stage, wrap-up, continue now, Approve — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\session-budget-actions.service.ts`
  and `session-budget-actions.service.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:352-356, :232-238, :383-386, S12, S13,
  S18, S21
- Quality requirements: a new `displayStage` (higher of the authoritative and the live stage; the live
  stage counts only while the tab is `streaming` and `sessionBudget` is non-null).
  `requestWrapUp()` → `runAction('request-wrap-up')` with a local `${sessionId}|${stage}` requested
  flag reset when the tab leaves `streaming`; a `WRAP_UP_UNAVAILABLE` refusal shows "The agent is not
  working on a turn right now." `continueNowAnyway()` → begin with `continueNow: true`.
  `continueInNewSession` still clears `queuedContent` only when `accepted`, is also the Approve path,
  and sets a per-`operationId` "queued message sent with the handover" flag when it sent a non-empty
  `queuedInput` (R5 copy). `cancelHandover` records the returned `state` through the client. S12
  (`source-unavailable` fallback) stays green.
- Validation notes: R-P4, R-P7; 627-L16 display half (the streaming-only rule).

### Task 15.4: Clear `liveBudgetStage` on disable and on persist/restore (Batch 14 follow-ups) — PENDING

- Added by team-leader at Batch 14 acceptance. Adds chat-state files to Batch 15 (above the 6-file
  cap; accepted because each change is one line).
- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-state\src\lib\tab-manager.service.ts`,
  `tab-manager.intent-mutators.spec.ts`, `tab-persistence.ts` (and its spec if one asserts the shape)
- Quality requirements: (a) D25 — `clearSessionBudgets()` and `clearSessionBudget()` patch
  `{ sessionBudget: null, liveBudgetStage: null }`; update the exact-payload assertion at
  `tab-manager.intent-mutators.spec.ts:1339-1342`. (b) `projectTabForPersist` and
  `sanitizeRestoredTab` set `liveBudgetStage: null`, so a stale stage cannot flash at the start of
  the next turn after a reload.
- Verification: also run the chat-state specs touched, then `npx nx typecheck` and `npx nx lint`
  for `@ptah-extension/chat-state` with `--parallel=1` (lint baseline 0 errors, 2 warnings).

### Batch 15 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts libs/frontend/chat/src/lib/services/session-handover-client.service.spec.ts libs/frontend/chat/src/lib/services/session-budget-actions.service.spec.ts --coverage=false --maxWorkers=2`
  (if it fails with "Could not locate module marked", re-run with the mapper from the Verification
  rules); then `npx nx typecheck @ptah-extension/chat --parallel=1`; then
  `npx nx lint @ptah-extension/chat --parallel=1`.

## Batch 16: Banner copy and buttons; composer draft write (F2-part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer, fresh session
- Execution mode: sequential
- Rationale: two presentational components, each with its spec; independent of each other but
  both consumed by the view in Batch 17
- Tasks: 2 | Depends on: Batch 15
- Phase: 4 | Phase review: as Batch 9

### Task 16.1: `ChatInputComponent.restoreDraftToInput` — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts`
  and `chat-input.component.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:387-388, S20
- Quality requirements: empty composer → the text; non-empty → `current + '\n\n' + text`; never
  sends, never touches `queuedContent`; focuses the composer (R3: only on the user's Cancel/failure).

### Task 16.2: `SessionBudgetBannerComponent` — display stage, wrap-up, continue now, agent request — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-banner.component.ts`
  and `session-budget-banner.component.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:127-143 (state table), :370-377 (F2),
  S13, S18, S22
- Quality requirements: inputs `turnRunning`, `liveStage`; outputs `requestWrapUp`,
  `continueNowAnyway`, `approveAgentRequest`. `stage` uses the display stage (a live stage marked
  "estimate"). Copy per the state table: "This session is near its budget" replaces "Preparing to
  continue…"; "Waiting for handover to start at …" removed; agent copy "The agent asks to continue in
  a new session" with Approve/Cancel; waiting copy with counts, "lane status unknown" when
  `lanes === null`, "Messages you send now go to this session", "Continue now anyway" and Cancel always
  shown; "Your queued message will be sent in the new session." when flagged; "Ask agent to wrap up"
  only while `turnRunning` at display stage ≥ handoff, disabled after one click per stage. New
  buttons have `aria-label`s. Spec cases asserting `budget-auto` are rewritten, not deleted.
- Validation notes: no timers or observers (no countdown).

### Batch 16 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts --coverage=false --maxWorkers=2`
  (mapper if needed); then `npx nx typecheck @ptah-extension/chat --parallel=1`; then
  `npx nx lint @ptah-extension/chat --parallel=1`.

## Batch 17: Chat view — banner while streaming, bindings, draft effect (F2-part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer, fresh session
- Execution mode: sequential
- Rationale: one component triple; the integration point of Batches 15-16
- Tasks: 1 | Depends on: Batches 15 and 16
- Phase: 4 (last batch) | Phase review: as Batch 9

### Task 17.1: Visibility, bindings and the draft effect — PENDING

- Files: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`,
  `chat-view.component.html`, `chat-view.component.spec.ts`
- Plan reference: implementation-plan-v2-user-authorized.md:213-216 (Decision 7), :378-386 (F2),
  S13, S20, S23
- Pattern to follow: `showSessionBudgetBanner` (`chat-view.component.ts:939-950`), the banner
  bindings (`chat-view.component.html:139-155`), the signal `viewChild` `chatInputRef` (`:638`)
- Quality requirements: the banner also renders while `streaming` when the display stage is
  `handoff`/`limit` or a handover snapshot is pending (including an agent request); update the
  "rendered only after this tab is idle" comment (`:935`). Bind `turnRunning`, `liveStage` and the
  three new outputs. One effect reads `resolvedHandover()` and `chatInputRef()`: no input → nothing;
  with an input → `peekDraft` → `restoreDraftToInput` → `acknowledgeDraft`; a throw skips the
  acknowledgement. Specs: S13 (streaming at a live handoff shows the banner), S20 (compact → full
  recovery, second view does not re-apply, throwing write leaves it unacknowledged), S23 (a send
  during a wait goes through the normal send path).
- Validation notes: R-P5; R3 (no focus steal and no composer shift while streaming — covered by the
  user's manual Electron check, not a screenshot review).

### Batch 17 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts --coverage=false --maxWorkers=2`
  (mapper if needed); then `npx nx typecheck @ptah-extension/chat --parallel=1`; then
  `npx nx lint @ptah-extension/chat --parallel=1`.
- Final grep G1 over `libs` with no exception.

## Phase 4 review (after Batch 17 commits)

- Code-logic review on the combined diff from the parent of Batch 9's commit to `HEAD`, by a CLI
  lane (cross-side: the implementers are in-process sub-agents). Scope: D22 items 1-3 and D23-D25 by
  construction, S1-S23, grep gates G1-G5, the risks R-P1..R-P11, and the D17/D18 history (no path
  may start a handover without the user's click).
- Style review (code-style-reviewer) limited to the new public API: the shared contract additions
  (`requestedBy`, `draftText`, `continueNow`, `lanes: null`, `liveBudgetStage`, `'request-wrap-up'`,
  `'WRAP_UP_UNAVAILABLE'`), `SessionHandoverCoordinator.requestFromAgent`,
  `SessionLifecycleManager.parkLimitHandoverIfIdle`, `SessionHandoverClientService.peekDraft` /
  `acknowledgeDraft`, `ChatInputComponent.restoreDraftToInput`, and the banner's new inputs and
  outputs.
- No visual review: per user decision 3 the user does the manual Electron check (banner while
  streaming, the new buttons and copy). No prototype is required (no new surface).
- Fix round: at most one, per the lean rules at the top of the run.
