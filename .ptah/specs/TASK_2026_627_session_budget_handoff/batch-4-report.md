# Batch 4 report: Handover coordinator gates, shared contract, lifecycle runtime

Executor: backend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff`
(branch `fix/session-budget-handoff`). I ran no git write commands and did not edit `batches.md`.

## Files changed (7 files, 2 libs, as the batch planned)

| File | Change |
| --- | --- |
| `libs/shared/src/lib/types/session-handover.types.ts` | `SessionHandoverState.waitingFor?`; `BeginSessionHandoverResult` error is now `'unavailable' \| 'source-unavailable'` |
| `libs/shared/src/lib/types/session-budget.types.ts` | Comment only: the seed doc comment now says 14,200 characters instead of 8,200 (decisions.md D2) |
| `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts` | Work-in-flight gate, `setLaneWorkProvider`, one-click confirm, source check in `begin`, new handoff prompt, optional logger with an INFO line on each publish |
| `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts` | Harness gains `subagentsInFlight` and a logger; 12 new cases |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` | Runtime `subagentsInFlight`; public `armHandoverIfIdle` |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts` | Mock registry gains `getRunningBySession` and `getBackgroundAgents`; 5 new cases |
| `libs/backend/agent-sdk/src/lib/di/register.ts` | +1 line: passes `c.resolve<Logger>(TOKENS.LOGGER)` as the coordinator's last factory argument |

## Task 4.1: Shared contract

- `SessionHandoverState.waitingFor?: { readonly subagents: number; readonly lanes: number }`. It has a doc
  comment and is optional, so older webviews ignore it.
- `BeginSessionHandoverResult` failure: `error: 'unavailable' | 'source-unavailable'`.
- Comment fix at `session-budget.types.ts:319`: the seed is "at most 14,200 characters".
- Typed consumers: I checked them with Grep and none of them breaks.
  - `session-handover-rpc.handlers.ts:85` passes the result through unchanged.
  - `rpc.types.ts:857` is a type reference only.
  - The frontend `session-budget-actions.service.ts:216` compares `data?.error === 'unavailable'`. That
    still compiles, but a `source-unavailable` result now shows the generic "Could not start the
    session handover" message. Task 6.1 replaces it with the `rotateSession()` fallback.
  - The webview guard (`session-handover-client.service.ts`) needs no change.

## Task 4.2: Coordinator

- **Work-in-flight gate.** In `armAtTerminal`, a `budget-auto` operation is gated when it is being
  created or is in `waiting-for-turn-end`, and the user has not confirmed. "Gated" means: read
  `runtime.subagentsInFlight?.(id)` and the lane provider. If either count is above 0, the operation
  stays in (or is created in) `waiting-for-turn-end` with `waitingFor`, the coordinator publishes and
  returns, and queued inputs are left in place, so no input is held.
  - `budget-limit` is never gated.
  - When nothing is in flight the old path runs, and `waitingFor` is cleared when the operation is armed.
- **`setLaneWorkProvider(provider)`.** The provider type is
  `LaneWorkProvider = (ids: { sessionId; tabId }) => number`, exported for Batch 5. The disposer works
  the same way as `setResourceLeaseProvider`.
  - `tabId` comes from `runtime.sourceSnapshot(id)?.tabId` and falls back to the session id.
  - If the provider throws, the coordinator counts 0 lanes and logs one WARN.
- **One click.** When `request` is called with reason `'successor'` (this is what `begin` does) and a
  live budget operation already exists, it calls the new `confirmBudgetOperation`:
  - `awaiting-confirmation`: goes to `writing-handoff` and runs `complete`.
  - `waiting-for-turn-end` while idle: clears `waitingFor`, goes to `writing-handoff` and runs
    `complete`, without the gate.
  - `waiting-for-turn-end` mid-turn: sets `userConfirmed`. At the next terminal the gate is skipped,
    and a `budget-limit` operation also skips `awaiting-confirmation` and starts.
  - Every other phase is returned unchanged, as before.
- **Source check.** `begin` checks the host first (`unavailable`). It then returns
  `source-unavailable` without creating an operation when `runtime.sourceSnapshot(id)` is `undefined`.
- **Prompt.** `HANDOFF_REQUEST_PROMPT` now requires these headings in order: Goal, Decisions, Task
  folders, Changed files (including files changed by subagents and CLI agent lanes), Open items, Still
  running (subagents and lanes with their ids, or "None"), Next action. It keeps "Do not call tools;
  respond only with the handoff."
- **Logging.** The coordinator takes an optional trailing `@inject(TOKENS.LOGGER, { isOptional: true })
  logger` argument. Every `publish` logs one INFO line, `[SessionHandover] State published`, with
  operationId, reason, phase, heldInputCount, waitingFor and error.
- **Unchanged.** `cancelledAutomaticSources`. Cancelling an operation in `waiting-for-turn-end` still
  suppresses it, because that phase is already in `CANCELLABLE_PHASES`.

## Task 4.3: Lifecycle runtime

- **`subagentsInFlight` in `attachRuntime`.** The private `subagentsInFlight(sourceSessionId)` looks
  up the record and queries `getRunningBySession` and `getBackgroundAgents` for each distinct id
  among {source id, `realSessionId`, `tabId`}. It counts unique `toolCallId`s, so no subagent is
  counted twice. `getBackgroundAgents` already returns only live (`status === 'background'`,
  unexpired) records, so I added no extra filter.
- **`armHandoverIfIdle(sessionId)`.** It does nothing when there is no record, when
  `rec.turnInFlight` is true, or when there is no coordinator. Otherwise it calls `armAtTerminal` with
  the same arguments `onTurnTerminal` builds: `handoverKey`, `isAtBlockingLimit`, `rec.messageQueue`,
  and whether `stageFor(realSessionId ?? id)` is `'handoff'`. It never calls `markTurnEnded`.
- I did not add the `sessionBudget.onTurnTerminal` call (Batch 8) and did not touch
  `sdk-agent-adapter.ts`.

## Verification (run one at a time from the worktree root)

1. `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts --coverage=false --maxWorkers=2`
   → `Test Suites: 2 passed, 2 total`, `Tests: 75 passed, 75 total`. PASS. I ran it again after the
   max-lines fix below, with the same result.
2. `npx nx typecheck @ptah-extension/agent-sdk --parallel=1` → `Successfully ran target typecheck`.
   PASS (also run again after the fix).
3. `npx nx typecheck @ptah-extension/shared --parallel=1` → `Successfully ran target typecheck`. PASS.
4. `npx nx lint @ptah-extension/agent-sdk --parallel=1` → `✖ 52 problems (0 errors, 52 warnings)`.
   PASS, equal to the baseline.
   - The first lint run gave 53 warnings: the new code pushed the coordinator to 718 counted lines,
     over the `max-lines` limit of 700 (blank lines and comments skipped).
   - I shortened the new code (one-line type alias, the WARN and INFO calls, the waiting-op creation).
     The coordinator now has no new warning; its only warning is the existing `delivered`
     no-useless-assignment.

Nx printed "Nx Cloud encountered some problems" (the organisation's cloud plan is disabled). That
message is about Nx Cloud only; every target ran locally.

## Deviations

- **`SessionHandoverRuntime.subagentsInFlight` is optional (`subagentsInFlight?(id): number`)**, not
  required. ts-jest type-checks specs (`diagnostics` is on in the agent-sdk jest config).
  `session-lifecycle/session-stream-pump.service.spec.ts:290` builds a runtime object literal and is
  outside this batch. A required method would break that spec, so the coordinator treats a missing
  method as 0 subagents. The production lifecycle always provides it.
- **The lane provider's `tabId` falls back to the source session id** when no source snapshot exists.
  The plan does not say what happens in that case. A missing source fails `complete` anyway.
- **`agentHandoff` is ignored when `begin` confirms an existing budget operation.** That operation was
  already created without agent text, and `Operation.agentHandoff` is readonly. The coordinator still
  asks the agent for the owned handoff.
- **`createBudgetOperation`** now takes the reason as a required `SessionHandoverReason` and accepts an
  optional starting phase (`'armed' | 'waiting-for-turn-end'`, default `'armed'`).

## Out-of-scope observations

- Batch 6 needs to handle the frontend copy for `source-unavailable` at
  `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:216`. Until then it shows the
  generic message.
- Batch 5 can import `LaneWorkProvider` and call `coordinator.setLaneWorkProvider`. The provider
  receives `{ sessionId, tabId }` and must return a count.
- Until Batch 8 wires `armHandoverIfIdle` into the adapter, nothing re-arms a gated `budget-auto`
  operation when its last background subagent finishes without a later parent turn.
