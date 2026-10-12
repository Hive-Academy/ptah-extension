# Batch 11 report: budget service display-only live stage, wrap-up on request, adapter live wiring

Executor: backend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff`
(branch `fix/session-budget-handoff`, base `41e0aa11c`). Nothing committed.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\shared\src\lib\types\session-budget.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\di\register.ts` (the `SessionBudgetSessionControl` literal only)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts` (live path only)

## Task 11.1: Budget action and error code

- `SessionBudgetAction` gains `'request-wrap-up'` (doc: only ever sent on the user's request).
- `SessionBudgetActionErrorCode` gains `'WRAP_UP_UNAVAILABLE'` (doc lists the refusal reasons).
- `session-budget.types.spec.ts` does not pin either union; not touched.
- The RPC schema (`session-budget-rpc.schema.ts:23`) uses `satisfies readonly SessionBudgetAction[]`, so the
  wider union still compiles there; accepting the action on the RPC is Batch 12.2.

## Task 11.2: `SessionBudgetService`

- `observeLive(snapshot): SessionBudgetLiveStage` (new exported alias `'handoff' | 'limit' | null | undefined`):
  - `undefined`: not provisional, untracked/released (`trackedEntry` null), older than the authoritative
    revision, measure mismatch (A3), any throw. None of these touches the retained `liveFigure`.
  - `null`: budget disabled (stale `liveFigure` cleared, as before); an accepted estimate below `handoff`
    (including a re-staged estimate after a settings change).
  - `'handoff'` / `'limit'`: an accepted estimate at that stage.
  - No `noticeQueue.post`, no stage action, no handover arming.
- `noticeLiveStage` became log-only `logLiveStage`: INFO `Live stage <from> -> <stage>` once per rank per
  turn, skipped when the authoritative stage already acted on that rank (same condition as before). It
  tracks its own `liveLoggedRank` so the log rank and the wrap-up rank are independent.
- `liveNoticedRank` renamed `wrapUpRequestedRank`; reset at `onTurnTerminal`, and on extend / settings
  change (`applyEvaluation` with `resetStage || configChanged`).
- `act('request-wrap-up')` → `requestWrapUp`: refused with `WRAP_UP_UNAVAILABLE` (and the state when one
  exists) when there is no entry, the budget is disabled, the display stage (higher of authoritative and
  live figure, same as `stageFor`) is below `handoff`, no notice queue, or
  `sessionControl.find(id)?.turnInFlight !== true`. Otherwise posts once per rank per turn; a repeat
  returns `success: true` and posts nothing. INFO
  `[SessionBudget] Wrap-up requested by the user for <id> at <stage>`. A throw (e.g. from `find`) is caught by
  `act`'s existing catch: `{ success: false, error }`, never thrown.
- `wrapUpNotice(figure, atLimit, blocking)` rewritten: "The user asked you to wrap up", ends the turn with a
  short summary, "The user will continue in a new session."; at a blocking limit adds that sends are refused
  and the user will click "New session" (627-L19). No "Ptah will ask..." automatic wording remains.
- `SessionBudgetSessionControl` widened with `'find'`.
- The handoff file write at handoff/limit is untouched (kept as preparation).

## Task 11.3: Adapter `wrapLiveStatsForBudget`

- The wrapper stores `observeLive`'s result: `undefined` → the identical payload object goes to `inner`
  without the field; `null` or a stage → `{ ...payload, liveBudgetStage }`. A throw keeps the WARN-once and
  delivers the identical payload (field omitted). `inner` receives the payload in every case; the caller's
  payload is never mutated.
- Imported `SessionStatsLivePayload` type from `@ptah-extension/shared` for the local variable.

## Spec cases

Budget service (`session-budget.service.spec.ts`), `observeLive` block rewritten to the return contract;
every prior case kept with its assertions strengthened (the removed "posts a notice" assertions became
"posts nothing", per D22):

- S5: 81% returns `handoff`, no refusal, no write, no post, one log per rank; 105% returns `limit`, no post,
  never blocks; authoritative 105% blocks.
- Authoritative stage already acted: returns `handoff`, no live log, no post.
- `onTurnTerminal` clears the live stage and pending notices; next turn logs again.
- S21: below handoff → `null`; settings change re-stage below handoff → `null`; older revision → `undefined`
  with the retained estimate kept; non-provisional / released → `undefined`; disabled (fresh and mid-turn)
  → `null`; measure mismatch → `undefined` with the retained estimate kept; throw → `undefined`, estimate
  kept, WARN once.
- Workspace remembered (unchanged).

New `act('request-wrap-up')` block:

- S6: posts once at handoff in a running turn (text, INFO log, `find(SID)`), repeat succeeds and posts
  nothing, posts again at limit, repeat at limit posts nothing.
- S6: after `onTurnTerminal` it may post again.
- S6: idle (no record, `turnInFlight: false`) → `WRAP_UP_UNAVAILABLE`, never posts.
- S6: no entry (exact result), below handoff, budget disabled → `WRAP_UP_UNAVAILABLE`.
- No notice queue → `WRAP_UP_UNAVAILABLE`.
- 627-L19: blocking limit names "New session"; `blockAtLimit: false` limit does not.
- Extend resets the requested rank; a settings change resets it.
- `find` throws → resolves `success: false`, nothing posted.

Adapter (`sdk-agent-adapter.spec.ts`):

- Throw case now also asserts the delivered payload is the same object without `liveBudgetStage`.
- New S21 case: `handoff`, `limit`, `null` set the field; `undefined` delivers the identical payload without
  it; the original payload is not mutated.
- New D17 case: a live `limit` calls neither `parkLimitHandoverIfIdle` nor `observe`.

## Risks and edge cases

- R-P1: `find` added to the DI literal in `di/register.ts` with the same lazy `c.resolve` shape as its two
  siblings. The spec harnesses build the control with casts; the harness now includes a `find` mock.
- R-P3: the new union member and its `act` case land together; agent-sdk typechecks.
- D17: the live path only sets a display field; `observeLive` arms nothing. The terminal limit check
  (`session-lifecycle-manager.ts:582-585`) goes through `canSend`, which reads only the authoritative figure
  or the owner's `snapshot()`; the owner never returns the live snapshot
  (`session-stats-owner.service.ts:608`). So a live `limit` cannot park or start a handover before the
  blocking result. Pinned by the adapter D17 case.
- Idle wrap-up: refused (`turnInFlight` from the lifecycle record), so no notice can land in the next turn.
- 627-L16 display half and 627-L17 left as deferred (no change to the whole-queue clear).
- Grep gate: `noticeQueue.post` appears once in `session-budget.service.ts` (line 924), inside
  `requestWrapUp`.
- `session-budget.service.ts` is now 1287 lines (was 1183); its `max-lines` warning pre-exists (lint
  reports 942 non-blank/comment lines). Count of agent-sdk warnings unchanged.

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts --coverage=false --maxWorkers=2`
  → Test Suites: 2 passed; Tests: 215 passed.
- `npx nx typecheck @ptah-extension/shared --parallel=1 --skip-nx-cache` → success.
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1 --skip-nx-cache` → success.
- `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1 --skip-nx-cache` → success (the action union
  reaches its schema).
- `npx nx lint @ptah-extension/agent-sdk --parallel=1 --skip-nx-cache` → 0 errors, 54 warnings (baseline
  54); none new in the changed files.
- `npx nx lint @ptah-extension/shared --parallel=1 --skip-nx-cache` → 0 errors, 5 warnings, none in
  `session-budget.types.ts` (`npx eslint` on that file alone: clean).
- `session-budget.types.spec.ts` not changed, not run.

## Deviations

- Added `liveLoggedRank` beside the renamed `wrapUpRequestedRank`: the plan renames the notice slot to
  the wrap-up slot but keeps "log once per rank per turn", which needs its own tracker.
- Added a private `displayFigure(entry)` (the figure behind `stageFor`) so the wrap-up text uses the
  figures of the displayed stage.
