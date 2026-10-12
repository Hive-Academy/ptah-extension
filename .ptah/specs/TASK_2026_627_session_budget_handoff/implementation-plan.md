# Implementation Plan - TASK_2026_627

Session budget handoff: wrap the agent up mid-turn at the handoff stage, wait for its subagents and
CLI lanes, write a good handoff (agent-authored merged with the deterministic one), and continue in a
new session automatically or with one click. At the limit the user must always have a working action.

## Inputs and constraints

- Requirements used: the launch brief (user goal, log evidence, reuse list); `CLAUDE.md` (memory-safe
  verification rules); Electron log `C:\Users\abdal\AppData\Roaming\Ptah\logs\Ptah Electron-2026-10-11.log`;
  `C:\Users\abdal\.ptah\handoffs\6e24ecf7-….md` (described in the brief).
- Corrections applied: task number. `TASK_2026_626_7b3e` is taken on the unmerged branch
  `fix-live-session-stats` (worktree `.claude-worktrees/fix-live-session-stats-a1634d3869cb`), so this
  task is `TASK_2026_627`.
- Design handoff used: none (UI change is copy and one fallback path in existing components).
- Missing decision-critical input: none blocks the plan. Two product choices are taken with a
  recommendation and listed at the end ("Decisions taken on the user's behalf").
- Hard dependency: **TASK_2026_626_7b3e must land first** (batches 3-5 still open, see
  `.claude-worktrees/fix-live-session-stats-a1634d3869cb/.ptah/specs/TASK_2026_626_7b3e/batches.md:190-272`).
  It provides the in-turn session-stats estimate this plan feeds into the budget.

## Root causes (confirmed from source and the log)

| # | Root cause | Evidence |
| --- | --- | --- |
| R1 | The budget is fed once per turn, after the turn ended. One orchestration turn spends 20-50M tokens, so every threshold is crossed inside a turn and noticed only at its end. | `sdk-agent-adapter.ts:1785-1801` (only `observe` call, inside the result-stats wrapper); `stream-transformer.ts:945` (`onResultStats` only in the result branch); log: `6e24ecf7` jumped `normal -> limit` at 53.47M (line 4350) without ever passing tighten/handoff. |
| R2 | Terminal arming reads the previous turn's stage. `onTurnEnd` runs first in the result branch, before the stats that would move the stage are computed, so the handover gate sees `normal`/`tighten` on the turn that crossed the threshold. | `stream-transformer.ts:655-658` (turn end first) vs `:945` (stats later); `session-lifecycle-manager.ts:508-524` (`armAtTerminal` uses `sessionBudget.stageFor`); log: `f6862b9b` entered `handoff` at 14:21:13 (line 4311) after the terminal. |
| R3 | A host message pushed into a running query does not reach the model. The repository measured it: the SDK files a mid-turn prompt as a `queued_command` attachment and never materialises it (180 removed, 0 delivered). Anything "injected" mid-turn through the prompt stream or `streamInput` is lost. | `session-registry.service.ts:76-82`; `session-stream-pump.service.ts:14-19`; `subagent-message-dispatcher.ts:219-258` (`pushParentMessage` uses `streamInput` mid-turn). |
| R4 | The handoff stage only writes a deterministic file; it tells the agent nothing. | `session-budget.service.ts:502-531` (`scheduleStageActions`/`runStageActions` = tighten + `writeHandoff` only). |
| R5 | The subagent monitor can never stop a subagent: it looks the task id up in the subagent registry by the `toolu_…` id, but every registry record is keyed by the SubagentStart hook's per-invocation UUID (SDK 0.3.278). `setTaskId(toolu_…)` finds no record and buffers forever. | `subagent-budget-monitor.ts:550-562`; `subagent-hook-handler.ts:259-268` (registers under hook `toolUseId`); `subagent-registry.service.ts:428-439`; log: 34 registrations, all UUID keys (e.g. line 1959 `6a54fc8f-…`), Start and Stop carry different UUIDs (lines 1958, 2065); 7 `stop deferred`, 0 `Subagent stopped`. |
| R6 | At the hard limit the handover parks in `awaiting-confirmation`, and nothing can confirm it: `confirm()` has no caller and no RPC. "New session" calls `begin('successor')`, which returns the stale operation unchanged because it is not restartable. | `session-handover-coordinator.service.ts:256-263` (limit → `awaiting-confirmation`), `:299-316` (`confirm`, no caller anywhere in `libs`), `:214-215` (`request` returns existing op); `session-handover-rpc.handlers.ts:84-106` (no confirm method). |
| R7 | A handover needs a live source record. After the 14:25:34 config-change re-initialisation disposed every session (log lines ~4540-4560), `sourceSnapshot` is `undefined` and the handover fails with `source session unavailable`; "Retry" fails the same way, "Keep working" returns to a refused composer. | `session-lifecycle-manager.ts:465-468`; `session-handover-coordinator.service.ts:395-406`; `session-registry.service.ts:485-487` (workspace also gone, so the handoff preview loses the transcript). |
| R8 | The agent-authored handoff is squeezed out. It is prepended to the seed only, inside a seed cap (8,200) that the deterministic document (cap 8,000) already fills, and it is never written to the file. The deterministic builder reads only the main transcript, so subagent and lane edits are missing ("one changed file"). | `session-handoff-builder.ts:38-60` (caps), `:633-658` (`withAgentHandoff`: `available = seedChars - seed.length - …`, seed only). |
| R9 | The renderer `console.error` after each refusal is the sender's generic failure log, not a crash; the refusal itself is handled (prompt rolled back, budget installed). It is noise that hides real errors. | `message-sender.service.ts:737-768` (`console.error` at `:745` for every failure, budget refusal included). |
| R10 | The handover coordinator logs nothing, so whether `budget-auto` ever ran (e.g. `f6862b9b` at 14:25:33, one second before the re-init) cannot be established from the log. | `session-handover-coordinator.service.ts:149-161` (no logger), `:659-662` (`publish` only notifies listeners). |

Out of scope, recorded as follow-ups (not fixed here): the MCP OAuth secret change that re-initialises
the adapter and disposes every live session (log 14:25:34 `Config change detected, re-initializing…
Disposing all active sessions`); the registry keying defect in R5 also breaks `subagent:stop`,
steering and resume by `toolu_…` id across the app — this plan only removes the monitor's dependency
on it.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| In-turn estimate exists on the 626 branch: `LiveSessionStatsPublisher` publishes the owner's provisional `SessionStatsEntry` at most once per `LIVE_STATS_INTERVAL_MS = 1000`. | worktree `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts:1-24, 48, 395-426` | Reuse as the mid-turn figure; it is the displayed chat figure, already throttled. No second counter. |
| 626 decided "the budget must never see an estimate" and wires `onLiveStats` at four `transform()` call sites, not wrapped by `wrapResultStatsForActivity`. | worktree `TASK_2026_626_7b3e/implementation-plan.md:69, 78`; `batches.md:216-243` | This plan feeds the estimate through a separate `observeLive` that can never block or replace the authoritative figure. 626's invariant "`observe` is never called by the live callback" still holds. |
| Budget state is keyed by the real SDK id; `stageFor` and `canSend` are the gates the lifecycle reads. | `session-budget.service.ts:16-17, 233-251` | Live stage must surface through `stageFor`; `canSend` stays authoritative-only. |
| SDK `PostToolUse` hook output carries `additionalContext`; `BaseHookInput.agent_id` is present only inside a subagent. | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2569-2571, 181-183` (SDK 0.3.278) | The in-process, per-tool-result channel that reaches the main loop mid-turn (R3 rules out the prompt stream). |
| Ptah already owns a `PostToolUse` hook for the main session and returns `hookSpecificOutput`. | `post-tool-use-hook-handler.ts:69-105`; merged at `sdk-query-options-builder.ts:1974-2027` | Extend that hook; no new hook registration. |
| Hook handlers must read the payload `session_id` first. | `hook-session-resolver.ts:1-15` | Key notices by the payload id (= budget key). |
| `task_started` carries `task_id` and the spawning `tool_use_id`. | `sdk.d.ts:5703-5707`; consumed at `system-message.transformer.ts:195-197` | Monitor can learn task ids itself. |
| The executor feeds the monitor only subagent messages and main-loop tool_use; system messages go elsewhere. | `session-query-executor.service.ts:237-268, 276-292` | Add one `task_started` branch. |
| Monitor's dispatcher port is bound in DI with `stopSubagent`/`pushParentMessage` closures. | `di/register.ts:485-503`; port type `subagent-budget-monitor.ts:249-252` | Re-bind `pushParentMessage` to the notice queue without changing the monitor's port. |
| Handover coordinator: `budget-auto` at terminal, owned handoff turn, deterministic+agent build, successor start, input transfer, token-safe close. | `session-handover-coordinator.service.ts:232-276, 383-490, 492-539` | Reuse wholesale; fix gates (R6, R7), add the work-in-flight gate and logging. |
| Coordinator wiring from another lib uses a provider setter with a disposer. | `session-handover-coordinator.service.ts:167-175`; used at `session-spawner.service.ts:241-253` | Same pattern for the lane-work provider from cli-agent-runtime. |
| Lifecycle supplies the coordinator runtime and has the subagent registry. | `session-lifecycle-manager.ts:450-502` | Add `subagentsInFlight` to `SessionHandoverRuntime`. |
| Running subagents by parent session; SubagentStop marks completion by agentId fallback even with UUID keys. | `subagent-registry.service.ts:481, 574-597`; log lines 2066-2067 | Subagent in-flight count is reliable despite R5. |
| Lanes: `listTrackedAgents()` returns `AgentProcessInfo` with `status` and `parentSessionId`; tab ids are re-parented to the real id. | `agent-process-manager.service.ts:1465, 1625`; `agent-process.types.ts:126, 136` | Lane in-flight count from cli-agent-runtime. |
| Lane completion arrives as a new turn via `sendMessageToSession`, not via `chat:continue`. | `lane-completion-notifier.service.ts:1-34, 322-356` | Not refused by the `chat:continue` budget gate (`chat-session.service.ts:946-960`); while a handover holds inputs it is transferred to the successor. |
| Banner: handoff stage shows "Continue now"; limit shows "New session", "Preview handoff", "Allow 20% more"; `awaiting-confirmation`/`waiting-for-turn-end` fall through to the budget stage. | `session-budget-banner.component.ts:291-340, 427-442` | No new buttons; fix what the existing ones do. |
| "Rotate session" works without a live source: preview seed into a new tab's composer. | `session-budget-actions.service.ts:256-266` | One-click fallback when the source is gone (R7). |
| Begin result contract has a single error. | `libs/shared/src/lib/types/session-handover.types.ts:61-63` | Add `'source-unavailable'`. |

## Architecture decision

- Chosen approach: keep the existing budget stage machine and handover coordinator as the only
  owners, and add three narrow capabilities: (1) a live, estimate-only budget feed that can raise the
  stage for gating and notices but can never block; (2) a main-thread notice queue drained by the
  existing `PostToolUse` hook as `additionalContext`, used by the budget (wrap-up) and by the subagent
  monitor (its handoff); (3) a work-in-flight gate on the automatic handover (running subagents and
  CLI lanes). Fix the gates that strand the user (R6, R7), the monitor's task-id source (R5) and the
  handoff assembly (R8).
- Rationale: R3 proves the prompt stream cannot steer a running turn; a hook result is processed
  in-process as part of the tool result the model reads next. The coordinator already performs
  the rest of the requested flow (owned agent handoff turn, merged build, successor, transfer, close);
  it fails only at its gates. The live feed reuses 626's throttled estimate, which is the figure the
  user sees.
- Rejected alternatives:
  - Push the wrap-up through `pushParentMessage`/`streamInput` (the subagent monitor's current path):
    lost mid-turn per R3.
  - Interrupt the turn at the handoff stage and send a new user turn: kills running subagents
    (`subagent-message-dispatcher.ts:9-10`, `interrupt` aborts all), the opposite of "wait for them".
  - Use the `Stop` hook's `additionalContext` to obtain the agent handoff without a new turn: changes
    turn semantics for every session and still needs the terminal path; the owned-handoff turn already
    exists (`session-handover-coordinator.service.ts:492-525`).
  - Build a separate in-turn usage counter in the budget: duplicates 626 and diverges from the
    displayed figure.
  - Gate rotation inside the budget service: the coordinator is the single-flight authority
    (`session-handover-coordinator.service.ts:137`); a second gate would race it.
- Assumptions (each with its check):
  - A1: `PostToolUse` `additionalContext` reaches the main model with that tool's result in the bundled
    CLI. Check: live run (see Verification points) — the transcript JSONL of the session shows the
    notice text attached to the tool result (`hook_additional_context` attachment or equivalent) and
    the next assistant message acknowledges it.
  - A2: `sendMessageToSession` (lane completion) does not pass through `canSend`. Check: read
    `SdkAgentAdapter.sendMessageToSession` → `SessionLifecycleManager.sendMessage` before coding
    Component 5; if it does, the work-in-flight wait at the limit must allow lane completions.
  - A3: the 626 live snapshot's `revision`/totals evaluate with `evaluateSessionBudget` exactly like
    the authoritative one (same `SessionStatsEntry` shape plus `provisional`). Check: read 626's final
    `SessionStatsEntry` diff in `libs/shared/src/lib/types/agent-adapter.types.ts` after it merges.
- Effect on existing code: no file is replaced. `observe`/`canSend`/`act` semantics are unchanged.
  `pushParentMessage` stays on the dispatcher (the RPC steer still uses its sibling `sendToSubagent`);
  only the monitor's binding moves. The deterministic handoff format gains one section.

## Component specifications

### 1. SessionBudgetService — live feed, terminal hook, workspace memory

- Purpose: evaluate the in-turn estimate against the budget and run the wrap-up action once per stage,
  without ever refusing a send on an estimate.
- Responsibilities:
  - `observeLive(snapshot: SessionStatsEntry): void` — ignore when disabled, released, or
    `snapshot.provisional !== true`. Evaluate with `evaluateSessionBudget` (`session-budget-stage.ts`)
    using the entry's compactions/extensions and `previous` = authoritative state; store the result
    on a new `entry.liveFigure`; do not touch `entry.snapshot`, `entry.figure`, `usageSeq` or
    `blocked`. When the live rank first reaches `handoff` (and again at `limit`) and the authoritative
    `actedRank` is below it, post the wrap-up notice (Component 2) once per rank per turn
    (`entry.liveNoticedRank`) and log `[SessionBudget] Live stage … -> …` at INFO with used/percent.
  - `stageFor(id)` returns the higher of `figure.stage` and `liveFigure.stage` (by
    `sessionBudgetStageRank`). `canSend`, `checkStored`, `checkSnapshot` stay authoritative-only.
  - `onTurnTerminal(id): void` — clear `liveFigure`, `liveNoticedRank`, and the session's pending
    notices (Component 2). Called by the lifecycle (Component 3) after it armed the coordinator.
  - Remember the session workspace on the entry the first time
    `sessionControl.getSessionWorkspace` answers (in `acceptOrThrow` and `observeLive`); `buildHandoff`
    falls back to it when the live lookup returns `undefined` (R7: preview after disposal keeps the
    transcript).
  - `release` and `clearAll` also clear the session's notices.
- Verified contracts and entry points: `observe`/`observeLoaded` (`session-budget.service.ts:192-209`),
  `stageFor` (`:249-251`), `release` (`:290-299`), `applyEvaluation` (`:380-421`), `buildHandoff`
  (`:625-669`), `BudgetEntry` (`:123-150`).
- Dependencies: adds `@inject(MainThreadNoticeQueue)`; existing deps unchanged. Direction stays inside
  agent-sdk.
- Integration points: called by `SdkAgentAdapter` (Component 3) and `SessionLifecycleManager`.
- Failure behaviour: `observeLive` never throws (same `warnOnce` pattern as `accept`, `:314-331`,
  kind `observe-live`); a failure leaves the authoritative path untouched. Fail-open as today.
- Quality requirements: O(1) per call; called at most once per second per stream (publisher
  throttle); no timers.
- Verification seam: `session-budget.service.spec.ts` — new cases:
  - live estimate at 81% raises `stageFor` to `handoff`, `canSend` stays ok, no handoff write, one
    notice posted; a second live estimate at 85% posts nothing more;
  - live estimate at 105% never sets `blocked`; authoritative 105% does;
  - `onTurnTerminal` clears the live stage and pending notices;
  - live estimate after `release` is ignored; disabled budget ignores live;
  - `preview-handoff` after the lifecycle forgets the workspace still reads the transcript (cached
    workspace), and reports `workspace-unknown` when it was never known.
- Files: MODIFY `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts`,
  MODIFY `…\session-budget\session-budget.service.spec.ts`.

### 2. MainThreadNoticeQueue + PostToolUse delivery

- Purpose: deliver short host notices to the main agent mid-turn, on its next tool result.
- Responsibilities:
  - New dependency-free injectable singleton `MainThreadNoticeQueue`: `post(sessionId, text)`,
    `take(sessionId): string | undefined` (joins and removes all pending notices), `clear(sessionId)`.
    Bounds: at most 4 pending notices per session (oldest dropped with one DEBUG line), each capped
    at 2,000 chars; entries exist only while a notice is pending (map entry deleted on `take`/`clear`).
  - `PostToolUseHookHandler.createHooks`: when the input has no `agent_id` (main thread), resolve the
    session id payload-first (`resolveHookSessionId`) and `take()`; return `additionalContext` in the
    same `hookSpecificOutput` as `updatedToolOutput` when both apply. Subagent tool results never
    drain the queue.
  - Wrap-up text (owned by Component 1, rendered here as data): one paragraph naming used/limit/percent
    and the instructions: finish the step in progress; do not start new tasks, subagents or CLI lanes;
    wait for running subagents to return and for running CLI lanes (`ptah_agent_wait` /
    `ptah_agent_status`); then end the turn — Ptah will ask for a handoff and continue in a new session.
    At `limit` the firmer variant: stop now, do not wait for anything new.
- Verified contracts: `PostToolUseHookSpecificOutput.additionalContext` (`sdk.d.ts:2569-2571`);
  `agent_id` semantics (`sdk.d.ts:181-183`); current hook body (`post-tool-use-hook-handler.ts:74-105`);
  DI registration (`di/register.ts:275-279`).
- Dependencies: the hook handler gains `@inject(MainThreadNoticeQueue)`; the queue depends on nothing.
  Registered with `container.registerSingleton(MainThreadNoticeQueue)` next to
  `SessionRotationAdvisor` (`di/register.ts:784`).
- Integration points: producers are SessionBudgetService (Component 1) and SubagentBudgetMonitor
  (Component 4, through its DI binding).
- Failure behaviour: `take` never throws; a failure to attach falls back to `{ continue: true }` and
  the notice is lost for that tool call only (logged DEBUG). The capper's fail-open path is
  unchanged.
- Quality requirements: notice text is host-authored only; never copies tool output or transcript
  text (security note on hook context, `sdk.d.ts:2573`).
- Verification seam: `post-tool-use-hook-handler.spec.ts` — main-thread call returns
  `additionalContext` once then not again; subagent call (`agent_id` set) leaves the notice pending;
  capped output and notice in one response; no queue → behaviour identical to today. New
  `main-thread-notice-queue.spec.ts` for bounds and take-once.
- Files: CREATE `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\main-thread-notice-queue.ts`
  and `…\helpers\main-thread-notice-queue.spec.ts`; MODIFY `…\helpers\post-tool-use-hook-handler.ts`,
  `…\helpers\post-tool-use-hook-handler.spec.ts`, `…\lib\di\register.ts`.

### 3. Adapter and lifecycle wiring (live feed, post-result arming)

- Purpose: route the live estimate into the budget and arm the handover even when the stage moved
  after the terminal (R2).
- Responsibilities:
  - `SdkAgentAdapter`: wrap the live callback that 626 threads into the four `transform()` call sites
    (626 Task 4.2) with `wrapLiveStatsForBudget(inner)`: call `sessionBudget.observeLive(payload.sessionStats)`
    inside try/catch (WARN once, like `observeBudget`, `sdk-agent-adapter.ts:1808-1824`), then `inner`
    when present. The wrapper is installed even when the host set no live callback, so the budget is
    fed in every host (the publisher is inert only when `onLiveStats` is absent — 626 publisher
    header `:22-24`).
  - `SdkAgentAdapter.wrapResultStatsForActivity` (`:1785-1801`): after `observeBudget`, when the
    returned state's stage is `handoff` or `limit`, call `sessionLifecycle.armHandoverIfIdle(sessionId)`.
  - `SessionLifecycleManager.armHandoverIfIdle(id)`: when the record exists and `!rec.turnInFlight`,
    call `handoverCoordinator.armAtTerminal(...)` with the same arguments `onTurnTerminal` builds
    (`session-lifecycle-manager.ts:513-521`); no `markTurnEnded`. Idempotent: the coordinator returns
    the existing operation (`session-handover-coordinator.service.ts:238-276`).
  - `SessionLifecycleManager.onTurnTerminal`: after `armAtTerminal`, call
    `sessionBudget?.onTurnTerminal(budgetSessionId)`.
  - `attachRuntime` gains `subagentsInFlight(sourceSessionId)`: `getRunningBySession` plus
    `getBackgroundAgents(sourceSessionId)` filtered to non-terminal status, for both the real id and
    the tab id.
- Verified contracts: `onTurnTerminal` (`session-lifecycle-manager.ts:508-524`), `attachRuntime`
  (`:464-502`), `SessionHandoverRuntime` (`session-handover-coordinator.service.ts:78-84`),
  `getRunningBySession`/`getBackgroundAgents` (`subagent-registry.service.ts:481, 574`).
  `setLiveStatsCallback`/`getLiveStats` are 626 deliverables — Assumption until 626 merges
  (`batches.md:224-237`).
- Dependencies: none new in DI.
- Failure behaviour: any throw in the live wrapper is swallowed and WARNed once; the inner callback
  still runs. `armHandoverIfIdle` with no coordinator or no record is a no-op.
- Verification seam: `sdk-agent-adapter.spec.ts` — the live callback calls `observeLive` and the
  inner callback, never `observe`; a throwing `observeLive` still delivers the inner payload; a result
  whose state is `handoff` calls `armHandoverIfIdle`. `session-lifecycle-manager.spec.ts` (or the
  existing lifecycle handover spec) — `armHandoverIfIdle` arms when idle, does nothing mid-turn;
  `onTurnTerminal` calls `sessionBudget.onTurnTerminal` after arming.
- Files: MODIFY `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`,
  `…\sdk-agent-adapter.spec.ts`, `…\helpers\session-lifecycle-manager.ts` and its spec.

### 4. SubagentBudgetMonitor — task id from `task_started`, handoff via notice queue

- Purpose: make the existing per-subagent stop actually fire (R5) and make its handoff reach the
  parent (R3).
- Responsibilities:
  - New `recordTaskStarted(sessionId, toolUseId, taskId, subagentType?)` storing
    `toolUseId → { taskId, subagentType }` on the session state (alias-aware like `sessionState`,
    released with the session).
  - `stop()` takes the task id from that map first, then from `registry.get(toolCallId)?.taskId`;
    defers only when neither has it (log stays once per subagent). The handoff text uses
    `record?.agentType ?? subagentType ?? 'subagent'` and `record?.teammateName` when present;
    the registry `update(...completed)` runs only when a record exists.
  - `SessionQueryExecutor.handle`: in the `system` branch, for `subtype === 'task_started'` with a
    `tool_use_id`, call `monitor.recordTaskStarted(...)` under the same session id rule as
    `feedSubagentMonitor` (`session-query-executor.service.ts:276-284`).
  - DI binding: the monitor's `pushParentMessage` closure (`di/register.ts:497-500`) posts to
    `MainThreadNoticeQueue` instead of the dispatcher. The stopped subagent's own `Agent` tool result
    is the next main-thread `PostToolUse`, so the handoff lands with it.
- Verified contracts: `stop` (`subagent-budget-monitor.ts:540-635`), `handoffMessage` (`:682-705`),
  port (`:249-252`), executor routing (`session-query-executor.service.ts:237-268`), `stopSubagent`
  needs only the task id (`subagent-message-dispatcher.ts:298-328`), `SDKTaskStartedMessage`
  (`sdk.d.ts:5703-5707`).
- Dependencies: unchanged in the monitor; the executor already holds the monitor.
- Failure behaviour: unchanged retry/give-up policy (`MAX_STOP_ATTEMPTS`, `:117`, `:643-674`).
- Verification seam: `subagent-budget-monitor.spec.ts` — regression for R5: no registry record,
  `task_started` recorded, over-budget message stops with the recorded task id and posts the handoff;
  registry record without task id + recorded id → stops; nothing recorded → one deferred WARN, no
  stop. `session-query-executor.service.spec.ts` — `task_started` reaches `recordTaskStarted`;
  non-agent task types still go through (the monitor ignores unknown ids).
- Files: MODIFY `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.ts`
  and spec; `…\helpers\session-lifecycle\session-query-executor.service.ts` and spec;
  `…\lib\di\register.ts` (shared with Component 2).

### 5. SessionHandoverCoordinator — work-in-flight gate, one-click confirm, source check, logging

- Purpose: the single owner of rotation; it must wait for running work, accept one click at any
  waiting phase, refuse fast when the source is gone, and say what it does.
- Responsibilities:
  - Work-in-flight gate for `budget-auto`: in `armAtTerminal`, before moving `waiting-for-turn-end`
    → `armed` (`:256-259`) or creating-and-starting a `budget-auto` operation (`:250-255, 272-274`),
    read `runtime.subagentsInFlight(id)` and the lane provider. When work is in flight, keep (or create)
    the operation in `waiting-for-turn-end` with `waitingFor: { subagents, lanes }` and return; inputs
    are not held in that phase (`HELD_SOURCE_PHASES`, `:113-120`), so lane-completion turns run on the
    source and re-arm at their terminal. `budget-limit` is not gated (the user confirms).
  - `setLaneWorkProvider(provider: (ids: { sessionId; tabId }) => number): () => void` — same shape and
    disposer contract as `setResourceLeaseProvider` (`:167-175`).
  - One click: `request(…, 'successor', …)` when the existing operation is a budget operation in
    `waiting-for-turn-end` (not mid-turn) or `awaiting-confirmation` → proceed (`confirm` path /
    `startAutomatic`), skipping the work gate (the user chose to go now). Mid-turn: set
    `userConfirmed` so the next terminal starts without the gate. This removes the dead end in R6
    without a new RPC.
  - Source check in `begin()` (`:188-206`): when `runtime.sourceSnapshot(id)` is `undefined`, return
    `{ accepted: false, error: 'source-unavailable' }` without creating an operation.
  - Agent handoff request text (`HANDOFF_REQUEST_PROMPT`, `:123`): require the headings Goal, Decisions,
    Task folders, Changed files (including files changed by subagents and CLI lanes), Open items,
    Still running (subagents/lanes with ids, if any), Next action; keep "Do not call tools".
  - Observability: inject `TOKENS.LOGGER` (optional, like the other optional deps at `:149-161`); log
    INFO on every `publish` with operationId, reason, phase, heldInputCount, waitingFor, error.
- Verified contracts: `armAtTerminal` (`:232-276`), `request` (`:208-230`), `begin` (`:188-206`),
  `confirm` (`:299-316`), `complete` (`:383-490`), `isRestartable` (`:651-657`), DI factory
  (`di/register.ts:760-781`).
- Dependencies: runtime (lifecycle) and the optional lane provider; no new lib edge.
- Failure behaviour: provider throws → treated as 0 lanes with one WARN (fail-open toward rotating,
  because the successor receives transferred inputs). `cancelledAutomaticSources` semantics unchanged
  (`:141-142, 553-555`).
- Verification seam: `session-handover-coordinator.service.spec.ts` —
  - `budget-auto` with 1 running subagent stays `waiting-for-turn-end`, publishes `waitingFor`, holds
    no input; next terminal with 0 in flight starts the owned handoff;
  - lane provider count > 0 blocks the same way; provider throw does not block;
  - `begin('successor')` on `awaiting-confirmation` moves to `writing-handoff` (R6 regression);
  - `begin('successor')` on `budget-auto` `waiting-for-turn-end` while idle starts at once;
  - `begin` with no source snapshot returns `source-unavailable` and creates nothing (R7 regression);
  - every phase change logs one INFO line.
- Files: MODIFY `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.ts`
  and spec; `…\lib\di\register.ts` (pass the logger).

### 6. Shared contract changes

- Purpose: carry the new waiting state and begin error to the webview.
- Responsibilities:
  - `SessionHandoverState`: add optional `waitingFor?: { readonly subagents: number; readonly lanes: number }`.
  - `BeginSessionHandoverResult` error union: `'unavailable' | 'source-unavailable'`.
  - Any hand-written parser for these payloads accepts the new optional field (check the handover
    state parser used by the frontend handover client).
- Verified contracts: `session-handover.types.ts:16-32, 61-63`.
- Failure behaviour: optional field; older webviews ignore it.
- Verification seam: existing shared spec for handover types (if present) gains the optional field
  case; `npx nx typecheck @ptah-extension/shared`.
- Files: MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\session-handover.types.ts`
  (and its parser/spec if one exists — Assumption: locate with `ptah_code_search_symbols
  "parse session handover state"`).

### 7. Lane work provider (cli-agent-runtime)

- Purpose: tell the coordinator how many CLI lanes a source session still has running.
- Responsibilities: `AgentProcessManager` injects `@inject(SessionHandoverCoordinator, { isOptional: true })`
  and in its constructor registers `setLaneWorkProvider(({ sessionId, tabId }) =>
  listTrackedAgents().filter(a => a.status === 'running' && (a.parentSessionId === sessionId ||
  a.parentSessionId === tabId)).length)`, keeping the disposer for `disposeAll`.
- Verified contracts: precedent `session-spawner.service.ts:231-253`; `listTrackedAgents`
  (`agent-process-manager.service.ts:1465`); re-parenting (`:1625`); `AgentProcessInfo.status`/
  `parentSessionId` (`agent-process.types.ts:126, 136`). Assumption: the exact running status literal
  of `AgentStatus` — read `agent-process.types.ts` and use every non-terminal value.
- Failure behaviour: no coordinator → nothing registered (fail-open).
- Verification seam: `agent-process-manager.service.spec.ts` — provider counts only running lanes of
  that parent (real or tab id); disposer runs on `disposeAll`.
- Files: MODIFY `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
  and spec.

### 8. Handoff builder — agent handoff first, in the file and the seed

- Purpose: the handoff a successor starts from must carry the agent's own summary in full (R8).
- Responsibilities:
  - Render the agent text as a `## Agent handoff` section at the top of `document.content`
    (sanitised, block-quoted like other free text) as well as in the seed.
  - Caps: `agentHandoffChars` 2,000 → 6,000; `seedChars` = `totalChars + agentHandoffChars + 200`
    (14,200) so the deterministic part can no longer squeeze the agent part out; `totalChars` stays
    8,000 for the deterministic part. Document the new caps in the constant's comments.
- Verified contracts: `SESSION_HANDOFF_LIMITS` (`session-handoff-builder.ts:38-60`),
  `withAgentHandoff` (`:633-658`), `SessionHandoffBuildRequest.agentHandoff` (`:139-148`).
- Failure behaviour: no agent text → document identical to today.
- Verification seam: `session-handoff-builder.spec.ts` — full-size deterministic document plus a
  5,000-char agent handoff keeps all 5,000 chars in seed and content (regression for R8); a 7,000-char
  agent handoff is truncated with the marker; no agent text → unchanged output.
- Files: MODIFY `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-handoff-builder.ts`
  and spec.

### 9. Frontend — never stuck at the limit

- Purpose: every banner action works, including when the source is gone.
- Responsibilities:
  - `SessionBudgetActionsService.continueInNewSession` (`session-budget-actions.service.ts:190-227`):
    when the result is `{ accepted: false, error: 'source-unavailable' }`, call `rotateSession()`
    (new tab with the handoff seed in the composer; the user sends it). Same fallback when the handover
    state arrives `failed` with `source session unavailable` and the user presses Retry.
  - Banner copy (`session-budget-banner.component.ts:541-553`): handoff stage with a
    `waiting-for-turn-end` handover shows "Waiting for N subagents and M CLI lanes before continuing in
    a new session." with the existing "Continue now" button; `awaiting-confirmation` at the limit keeps
    "New session" (which now confirms).
  - `MessageSender` (`message-sender.service.ts:744-748`): log a budget refusal or a handover hold at
    `console.info`, not `console.error` (R9).
- Verified contracts: banner inputs (`:382-400`), stage computation (`:427-442`), `rotateSession`
  (`:256-266`).
- Quality requirements: accessibility unchanged (existing aria labels kept); no new timers.
- Verification seam: `session-budget-actions.service.spec.ts` — `source-unavailable` opens a new tab
  with the seed; `session-budget-banner.component.spec.ts` — waiting copy with counts;
  `message-sender.service.spec.ts` — refusal does not call `console.error`.
- Files: MODIFY `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\session-budget-actions.service.ts`,
  `…\components\molecules\notifications\session-budget-banner.component.ts`,
  `…\services\message-sender.service.ts`, and their specs.

## Integration architecture

- Data flow (happy path, 50M budget, handoff at 80%):
  1. Assistant frames → 626 publisher → owner `publishLive` → live payload (≤1/s) →
     `wrapLiveStatsForBudget` → `SessionBudgetService.observeLive` → live stage `handoff` at ~40M →
     wrap-up notice posted.
  2. Next main-thread tool result → `PostToolUse` hook → `additionalContext` = wrap-up notice → the
     agent finishes the step, starts nothing new, waits for subagents (Agent results) and lanes
     (`ptah_agent_wait`), ends its turn.
  3. Result → `onTurnEnd` → `onTurnTerminal` → `stageFor` = `handoff` (live) → `armAtTerminal`
     (`budget-auto`) → work gate: 0 in flight → `startAutomatic` → owned handoff turn
     (`HANDOFF_REQUEST_PROMPT`) → agent handoff text → builder merges (Component 8) → file written →
     successor started with the seed → held inputs transferred → source closed. If work is still in
     flight: `waiting-for-turn-end` + `waitingFor`, lane completions run on the source, re-check at
     each terminal; the user can click "Continue now" at any time.
  4. Result stats → `observe` (authoritative) → `onTurnTerminal` on the budget clears live state; if
     the authoritative stage moved after the terminal, `armHandoverIfIdle` arms it.
- Limit path: authoritative `limit` + `blockAtLimit` → sends refused → coordinator `budget-limit` in
  `awaiting-confirmation` → "New session" confirms (Component 5) → same build/successor flow.
  "Allow 20% more" unchanged. Source gone → `source-unavailable` → new tab prefilled with the seed.
- State or persistence: all new state is in memory, per session, released on session end
  (`SessionBudgetService.release`, monitor `release`, queue `clear`). Handoff files unchanged
  (`~/.ptah/handoffs/<id>.md`).
- External boundaries: hook payload `session_id`/`agent_id` read through the existing resolver; notice
  text is host-authored only; transcript text in the handoff stays sanitised (`session-handoff-builder.ts:16-20`).
- Failure and rollback: every new step fails open toward the existing behaviour — no live figure →
  the budget acts at turn end as today; notice not delivered → terminal handover still runs; owned
  handoff times out (`HANDOFF_REQUEST_TIMEOUT_MS`, `:122`) → deterministic handoff only; successor
  start fails → `failed`, inputs restored (`:551-560`), banner offers Retry/Keep working; source gone →
  one-click new tab.
- Observability: INFO `[SessionBudget] Live stage …`, INFO coordinator phase lines (Component 5),
  existing `[SubagentBudgetMonitor] Subagent stopped`. A live check of this task is "the log shows
  `Live stage normal -> handoff`, a coordinator `waiting-for-turn-end`/`writing-handoff` line, and no
  `stop deferred` for a subagent whose `task_started` was seen".

## Architecture-level quality requirements

- Functional: at 80% of the budget mid-turn, the agent receives one wrap-up notice before its next
  tool result; the session rotates after the turn ends and no subagent/lane of the source is running,
  or immediately on "Continue now"; the successor's first prompt contains the agent-authored handoff
  in full (≤6,000 chars) plus the deterministic facts; at the limit "New session" always produces a
  new session (live source) or a prefilled new tab (gone source).
- Performance: live evaluation ≤ 1/s per stream; no new timers, observers or polls (the existing
  100 ms owned-handoff wait, `:527-539`, is unchanged and bounded).
- Security: no transcript or tool text in hook context; sanitisation rules unchanged.
- Maintainability: the coordinator remains the only rotation authority; the budget stays the only
  stage authority; agent-sdk gains no dependency on cli-agent-runtime (provider setter).
- Testability: every root cause R1-R9 has one regression test named in its component.

## Team-leader handoff

- Recommended executors: backend-developer for Components 1-8 (agent-sdk, shared, cli-agent-runtime);
  frontend-developer for Component 9.
- Complexity: HIGH — crosses four libs, touches the hot result path and the handover state machine,
  and depends on an unmerged task.
- Dependencies and ordering: TASK_2026_626_7b3e merged first (Component 3's live wrapper needs its
  `setLiveStatsCallback`). Component 2 (queue) before Components 1, 4. Component 6 (shared) before 5
  and 9. Component 5 before 7 and 9. Component 8 is independent.
- Parallel-safe work: Component 8 (builder) and Component 4's monitor/executor files are disjoint
  from Components 1/3/5; `di/register.ts` is shared by Components 2, 4, 5 — one owner.
- Files affected:
  - CREATE: `libs/backend/agent-sdk/src/lib/helpers/main-thread-notice-queue.ts`, `…/main-thread-notice-queue.spec.ts`.
  - MODIFY (agent-sdk): `helpers/session-budget/session-budget.service.ts` (+spec),
    `helpers/session-budget/session-handoff-builder.ts` (+spec),
    `helpers/post-tool-use-hook-handler.ts` (+spec), `helpers/compaction/subagent-budget-monitor.ts` (+spec),
    `helpers/session-lifecycle/session-query-executor.service.ts` (+spec),
    `helpers/session-lifecycle-manager.ts` (+spec),
    `helpers/session-handoff/session-handover-coordinator.service.ts` (+spec),
    `sdk-agent-adapter.ts` (+spec), `di/register.ts`.
  - MODIFY (shared): `libs/shared/src/lib/types/session-handover.types.ts` (+parser/spec if present).
  - MODIFY (cli-agent-runtime): `cli-agents/agent-process-manager.service.ts` (+spec).
  - MODIFY (frontend chat): `services/session-budget-actions.service.ts`,
    `components/molecules/notifications/session-budget-banner.component.ts`,
    `services/message-sender.service.ts` (+specs).
  - No change: `session-rotation-advisor.ts` (context advisory, rides the budget state as today),
    `lane-resume-gate.ts` (resume sizing, unrelated to waiting), `session-handover-rpc.handlers.ts`
    (passes the coordinator result through, `:92-104`).
- Verification points:
  - Confirm A1 with one live Electron run (only if the user asks for a run): budget 2M, handoff 80%,
    orchestrate a task with one subagent and one lane; expect the log lines in Observability and a
    successor tab whose first message contains "Agent handoff".
  - Confirm A2 and A3 by reading the cited methods before coding Components 5 and 1.
  - Commands (one at a time, memory-safe): `npx jest -c libs/backend/agent-sdk/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`;
    `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`; `npx nx lint @ptah-extension/agent-sdk --parallel=1`;
    `npx nx typecheck @ptah-extension/shared --parallel=1`;
    `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts <spec> --coverage=false --maxWorkers=2`;
    `npx jest -c libs/frontend/chat/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`;
    `npx nx typecheck @ptah-extension/chat --parallel=1`. No workspace-wide runs, no build/serve/e2e.

## Decisions (confirmed by the user, 2026-10-11)

Both recommendations below were confirmed: automatic rotation at the handoff stage, and the mid-turn
figure from TASK_2026_626_7b3e (627 Components 1 and 3 wait for 626 to merge).

## Decisions taken on the user's behalf (confirm or override)

1. Rotation at the handoff stage stays automatic (existing `budget-auto`, `session-handover-coordinator.service.ts:272-274`)
   after the agent wraps up and its work finishes, with "Cancel (keep working)" / "Continue now" in the
   banner. At the hard limit it is one click ("New session"). Alternative: one click at both stages.
2. Mid-turn measurement reuses TASK_2026_626_7b3e's live estimate and therefore ships after it.
   Alternative: a budget-only usage tap in this task (duplicates 626, may diverge from the displayed
   figure).
