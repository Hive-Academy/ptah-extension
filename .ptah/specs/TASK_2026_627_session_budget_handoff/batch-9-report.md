# Batch 9 report — coordinator user-only start, lifecycle and adapter result path

Status: IMPLEMENTED (not committed; the team-leader owns git).

## Files changed (worktree `fix/session-budget-handoff`)

| File | Lines now | Change |
| --- | --- | --- |
| `libs/shared/src/lib/types/session-handover.types.ts` | 111 | Task 9.1: `'budget-auto'` dropped; `requestedBy?: 'agent'`, `draftText?`; `waitingFor.lanes: number \| null`; `BeginSessionHandoverParams.continueNow?`; `queuedInput` doc says it becomes the draft; header notes the draft exception. Result types and the `'source session unavailable'` literal unchanged. |
| `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts` | 837 (max-lines counts 701 of 700) | Task 9.2: see below. |
| `.../session-handoff/session-handover-coordinator.service.spec.ts` | 1184 | Cases rewritten to S1, S2, S7-S11, S15, S16, S19, S22, S23. |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` | 1002 | Task 9.3: `onTurnTerminal` passes 3 args; `armHandoverIfIdle` renamed to `parkLimitHandoverIfIdle`; `atHandoffOrLimitStage` deleted. |
| `.../helpers/session-lifecycle-manager.spec.ts` | 1640 | S1-S4 lifecycle parts, S16 post-result conversion, terminal order pinned. |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` | 1913 | Result path calls `parkLimitHandoverIfIdle` only when `budget?.blocked === true`; WARN on throw kept. |
| `.../sdk-agent-adapter.spec.ts` | 3635 | S3 adapter part, S16 (park after a blocking result, after the broadcast), nothing below blocking, throw contained. |

## Coordinator (Task 9.2)

- `begin(source, reason, turnInFlight, agentHandoff?, { continueNow?, queuedInput? })` is the only setter of
  `userConfirmed`. It folds in the old `request()`, stores `queuedInput` as `draftText` (a second capture is appended
  after a blank line, never put in `inputs`), clears `requestedBy` and keeps `agentHandoff` on a parked op. It gates
  unless `continueNow`. With `continueNow` it starts at once when idle, or sets `forced` mid-turn. A repeat begin on a
  waiting op returns the snapshot unchanged except a refreshed `waitingFor`.
- `requestFromAgent(source, agentHandoff?)` uses the same guards (`refusal()`). It parks `successor` in
  `awaiting-confirmation` with `requestedBy: 'agent'`, logs INFO `[SessionHandover] Agent requested a successor for
  <id>`, and never confirms, gates or starts. A live op is returned unchanged.
- `armAtTerminal(source, atBlockingLimit, queuedInputs)` parks `budget-limit` only at the blocking limit with no live
  op. At the blocking limit it converts a parked agent op in place (reason `budget-limit`, marker cleared,
  `agentHandoff` kept). It re-gates a `userConfirmed` op in `waiting-for-turn-end` unless `forced`, and moves queued
  inputs only when `holdsSource(op)`. It creates nothing else.
- `workInFlight` returns `lanes: null` when the provider throws (WARN once per op via `laneStatusWarned`) and treats
  `null` as work.
- `startConfirmed(op)` replaces `startAutomatic`, `confirmSuccessor` and `confirmBudgetOperation`. It does nothing
  unless `userConfirmed` and is the only caller of `complete()`.
- `complete()` sends the draft as one `require-idle` input after the held inputs in the first transfer batch. A draft
  captured during delivery goes in the next batch. `draftText` is cleared only on the move to `closing`.
- `snapshot()` publishes `requestedBy` when it is set, and `draftText` only in `cancelled`/`failed`.
- `holdsSource(op)` is used by `admitOrHold`, the queue move and `admitInterrupt` (627-L6).
- `waitingFor` is cleared in `cancel`, `fail` and `sourceEnded` (627-L2).
- Deleted: `budget-auto` handling, the S1 conversion, `WORK_IN_FLIGHT_WAIT_LIMIT_MS`, `waitingSince`,
  `cancelledAutomaticSources`, public `request()`, `confirm()`.
- `Operation` gains `draftText?`, `requestedBy?`, `forced?` and `laneStatusWarned?`. `agentHandoff` stays readonly.

D17: nothing is started or armed on a stage any more. A live `limit` at the terminal passes `atBlockingLimit=false`,
so nothing is created until the blocking result parks the limit (lifecycle `it.each(['handoff','limit','tighten'])`
case and adapter S3/S16 cases).

## Decisions and deviations

- No deviation from the batch spec.
- Added the `restoreInputs` assertion to the two draft cases that lacked it ("appends a second capture", "source
  ends"), so every draft case checks that `restoreInputs` never receives the draft.
- The extra `laneStatusWarned` field on `Operation` implements "WARN once per op" (not named in the plan).
- R-P8: no assertion was removed without a replacing case. The `budget-auto`, D6-bound and S1-conversion cases became
  S1/S2 "creates nothing", "waits across terminals without a bound or escalation (D6 removed)", "never restarts a failed
  user handover at a terminal", and the S15/S16 agent cases.
- R-P9: the coordinator is 837 raw lines; `max-lines` counts 701 (limit 700, warning only; 627-L7 stays deferred).

## Assumption traces

- **A1 — VERIFIED.** A lane completion reaches the source through
  `LaneCompletionNotifier` → `agentAdapter.sendMessageToSession`
  (`cli-agent-runtime/.../lane-completion-notifier.service.ts:329, 447`; reports via
  `agent-report-router.service.ts:341, 502`) → `SdkAgentAdapter.sendMessageToSession` (`sdk-agent-adapter.ts:1469`) →
  stream pump `sendMessage` (`session-lifecycle/session-stream-pump.service.ts:227`; `admitOrHold` at `:255`, which
  holds nothing during a user-started wait or an agent request) → dequeued and sent by the pump loop (`:91-110`). The
  turn's result calls `onTurnTerminal` (`sdk-agent-adapter.ts:1910`). `refuseIfBudgetReached` exists only on the
  `chat:continue` RPC path (`rpc-handlers/.../chat-session.service.ts:475, 959`), so this path never goes through it.
- **A2 — VERIFIED, with one caveat.** `getBackgroundAgents` counts only `status === 'background'` records that have
  not expired (`vscode-core/.../subagent-registry.service.ts:481-500`). When a background subagent finishes, the
  SubagentStop hook sets `status: 'background_completed'` (`agent-sdk/.../subagent-hook-handler.ts:474-487`), which
  removes it from the count without waiting for a parent turn. Caveat: the hook is delivered through the source's SDK
  query. If that query is no longer running, the record leaves the count only when the store expires it
  (`isExpired`). "Continue now anyway" covers that case.

## Verification (worktree root, one check at a time)

- `npx jest -c libs/backend/agent-sdk/jest.config.ts <coordinator spec> <lifecycle spec> <adapter spec> --coverage=false --maxWorkers=2 --moduleNameMapper=<marked, vscode>`
  → Test Suites: 3 passed, 3 total; Tests: 230 passed, 230 total.
- `npx nx typecheck @ptah-extension/shared --parallel=1 --skip-nx-cache` → Successfully ran target typecheck.
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1 --skip-nx-cache` → Successfully ran target typecheck.
- `npx nx lint @ptah-extension/agent-sdk --parallel=1 --skip-nx-cache` → 0 errors, 54 warnings (baseline 54). Changed
  files show only existing warnings: coordinator `:729` `no-useless-assignment` (the `let delivered = false`, unchanged
  since HEAD), coordinator `max-lines` 701, and lifecycle spec warnings at `:1292-1361` (outside the changed hunks).
- `npx nx lint @ptah-extension/shared --parallel=1 --skip-nx-cache` → 0 errors, 5 warnings, none in
  `session-handover.types.ts`.
- `--skip-nx-cache` was used because Nx Cloud returned 401 (organization disabled). Without it, the run printed no
  result line.
- Grep gate: no `budget-auto`, `startAutomatic`, `confirmSuccessor`, `confirmBudgetOperation`,
  `WORK_IN_FLIGHT_WAIT_LIMIT_MS`, `cancelledAutomaticSources`, `atHandoffOrLimitStage`, `armHandoverIfIdle` or
  `waitingSince` in `libs/backend/agent-sdk` or `libs/shared`. The only hit under `libs` is the frontend banner spec
  (`session-budget-banner.component.spec.ts:195`), which Task 16.2 fixes.
- The chat project was not checked (as instructed).

## Out of scope (not touched)

- Callers in other projects still follow the old flow: `session-handover-rpc.handlers.ts:92` calls `begin` and
  `admitOrHold` for the composer text, and `session-spawner.service.ts:301` calls `begin` directly for the agent.
  Batches 12 and 13 update them. `begin` keeps its leading parameters, so they probably still compile, but rpc-handlers
  and cli-agent-runtime were not typechecked in this batch. Until Batch 12 lands, the RPC still holds composer text
  as an input instead of passing `queuedInput`.
