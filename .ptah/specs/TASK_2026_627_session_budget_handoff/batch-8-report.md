# Batch 8 report: adapter and lifecycle live wiring (Component 3, adapter part)

Executor: backend-developer. Worktree `fix/session-budget-handoff`, on top of `3d9c4f831`. I ran no
state-changing git command. Only the four assigned files were changed.

## Files modified

- `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
- `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.spec.ts`

## Task 8.1: `wrapLiveStatsForBudget` and post-result `armHandoverIfIdle` (sdk-agent-adapter.ts)

- **Injected budget.** The `Pick` now includes `'observeLive'` (`:270`). No DI change: it is the same
  `SDK_TOKENS.SDK_SESSION_BUDGET` instance.
- **New flag `budgetObserveLiveWarned`** (`:194`). It sits beside `budgetObserveWarned` so the live
  path warns once per adapter, on its own.
- **`wrapLiveStatsForBudget(inner)`** (`:1844`). It calls `this.sessionBudget.observeLive(payload.sessionStats)`
  inside try/catch. On a throw it logs one WARN per adapter ("Session budget live observe failed; the
  estimate is published without it"). It then runs `return inner?.(payload)`.
  - The inner callback's return value is passed back. This keeps the 626 publisher's async-failure
    handling for a host callback that returns a promise (`live-session-stats-publisher.ts:560-565`).
  - It never calls `observe`.
- **All four `transform()` call sites** now pass `onLiveStats: this.wrapLiveStatsForBudget(this.callbacks.getLiveStats())`:
  - new session `:924`
  - active reuse `:1083`
  - cold resume `:1230`
  - slash command `:1592`

  The wrapper is installed even when the host set no live callback, so the publisher is never
  inert for lack of `onLiveStats` (`live-session-stats-publisher.ts:158`).
- **The `setLiveStatsCallback` doc comment** (`:1447-1452`) now describes the wrapping. The old text
  said "never feed the session budget".
- **`wrapResultStatsForActivity`** (`:1823-1834`). After `observeBudget` and after the inner broadcast,
  a returned state at stage `handoff` or `limit` calls `this.sessionLifecycle.armHandoverIfIdle(sessionId)`
  (R2).
  - The call is in try/catch and WARNs on failure. A throw from the coordinator can never escape into
    the stream transformer's result branch.
  - It runs after `inner`, so the stats broadcast is never gated by arming.
  - `sessionId` is the wrapper's tracking id. `armHandoverIfIdle` resolves it through `_registry.find`,
    which handles both the tab id and the real id.

## Task 8.2: lifecycle `onTurnTerminal` calls `sessionBudget.onTurnTerminal` (session-lifecycle-manager.ts)

- `onTurnTerminal` (`:514-532`) now works out `budgetSessionId` (`rec?.realSessionId ?? sessionId`)
  before the coordinator branch.
- After `armAtTerminal` it calls `this.sessionBudget?.onTurnTerminal(budgetSessionId)` (`:530`). That
  call comes before `markTurnEnded` (`:531`), so the live figure and pending notices are cleared before
  a held follow-up can start the next turn.
- The call also runs when there is no coordinator or no record. The live figure must not outlive the
  turn in either case.
- `SessionBudgetService.onTurnTerminal` cannot throw. It does a Map get and two field writes, then
  `MainThreadNoticeQueue.clear`, which is a `Map.delete` (`main-thread-notice-queue.ts:81-83`). So it
  cannot skip `markTurnEnded`.

## Turn-end order: finding (the open point from Batch 7)

**The order Batch 7 assumed (result observed, then `stageFor`, then arm, then clear) is not the real
order.** The terminal runs first and the authoritative result arrives after it. Evidence, from the
`isResultMessage` branch in `stream-transformer.ts`:

1. `:698` `onTurnEnd?.()` runs first, "BEFORE any stats work" (contract at `:227-235`). It goes to
   `SdkAgentAdapter.releaseTurnOnResult` (`sdk-agent-adapter.ts:1891-1895`), then
   `SessionLifecycleManager.onTurnTerminal`. That method:
   - reads `stageFor`, which is the previous turn's authoritative figure plus this turn's live figure;
   - calls `armAtTerminal`;
   - (new) calls `sessionBudget.onTurnTerminal`, which clears the live figure and notices;
   - calls `markTurnEnded`.
2. `:701` `livePublisher.onResult()` cancels the pending flush and clears the owner's estimate. No
   live emission happens between steps 1 and 2: they are synchronous.
3. `:911-999` builds the authoritative snapshot, possibly after an await, and calls `onResultStats`.
   That runs `observeBudget` → `observe` → (new) `armHandoverIfIdle` when the stage is `handoff` or
   `limit`. The turn is no longer in flight, so this arms when needed.
4. `:1005` `livePublisher.settle()` emits the authoritative snapshot (not provisional) only when an
   estimate was shown. `observeLive` returns at once for it (`session-budget.service.ts:273`).

This matches the plan's own data flow (implementation-plan.md:387-394). Step 3 there arms at the
terminal from the live `handoff` stage. Step 4 has the result arrive afterwards, with
`armHandoverIfIdle` catching a stage that moved. It is also why R2 exists.

Consequences:

- **The live figure decides the terminal arming.** That is by design (plan :387). D13's "a newer
  authoritative revision drops the live figure" does not stop a live overestimate from arming
  `budget-auto` at the terminal, because the result has not arrived yet. This is the plan's intended
  trade-off. I note it for the Phase 3 code-logic review; I did not change it.
- **The post-result path sees only the authoritative figure.** The live figure was already cleared at
  step 1. `acceptOrThrow` would drop it anyway (D13).

## Live-only `limit` stage: mishandling found and minimal fix

Before this batch, the lifecycle armed with `stageFor(...) === 'handoff'`. Batch 7 made `stageFor`
return the higher of the authoritative and live stages, which led to two problems:

- **(a) Regression from Batch 7.** Say the authoritative stage is `handoff` and the live estimate
  reaches `limit` in the same turn. `stageFor` now returns `limit`. `=== 'handoff'` is false and
  `canSend` is still ok, because it reads only the authoritative figure. So the terminal arms
  **nothing**, where before Batch 7 it armed `budget-auto`. A higher stage arms less than a lower
  one.
- **(b) Live jump straight to `limit`** (authoritative below `handoff`). Nothing arms at the terminal.
  - With `blockAtLimit` on, the post-result path recovers. The authoritative `limit` blocks, so
    `armHandoverIfIdle` arms `budget-limit`.
  - With `blockAtLimit` off, nothing ever arms. Yet the "Stop now" wrap-up notice told the agent
    "Ptah will ask for a handoff and continue in a new session".

**Fix (inside my files).** A private `atHandoffStage(budgetSessionId)` (`session-lifecycle-manager.ts:551-558`)
returns `stage === 'handoff' || stage === 'limit'`. Both `onTurnTerminal` (`:525`) and
`armHandoverIfIdle` (`:547`) use it. It matches the adapter's own `handoff`/`limit` trigger in
Task 8.1.

Behaviour changes to review:

- **A non-blocking authoritative `limit` now arms `budget-auto`.** It used to arm nothing. This is
  consistent with the `limit` notice text and the Task 8.1 trigger.
- **A live `limit` at the terminal on a blocking budget now arms `budget-auto`,** where it previously
  waited for the result's blocking `budget-limit` (awaiting confirmation). A live `handoff` stage
  already auto-arms the same way under the plan. The coordinator turns a waiting `budget-auto` into
  `budget-limit` in place when the blocking result arrives
  (`session-handover-coordinator.service.ts:309-318`).
- **No change for a user who cancelled the automatic handover.** `armAtTerminal` still returns early
  for `cancelledAutomaticSources` when not blocking (`:296-302`).

If the reviewer prefers the narrower behaviour, the alternative is to keep `=== 'handoff'` and accept
(a) and (b). That is a one-line revert in `atHandoffStage`.

## Spec cases

`sdk-agent-adapter.spec.ts`:

- Replaced the 626 case "passes no live-stats callback when none is registered (publisher inert)"
  with **"installs the budget live wrapper when no live-stats callback is registered"** (`:2316`). The
  wrapper is a function, does not throw without a host callback, and feeds `observeLive`.
- Replaced "threads the registered live-stats callback, unwrapped, into all four streams" with **"…
  wrapped for the budget, into all four streams"** (`:2344`). For all four call sites:
  - the host callback gets each payload;
  - `observeLive` is called 4 times with `payload.sessionStats`;
  - `observe` is never called.
- New: **"still delivers the live payload when observeLive throws, and warns once"** (`:2425`).
- New: **`it.each(['handoff','limit'])` "arms an idle handover after a result at the %s stage, after
  the broadcast"** (`:2595`). It checks the call `armHandoverIfIdle('tab_1')` and that it comes after
  the inner callback (`invocationCallOrder`).
- New: **"does not arm below the handoff stage or without a budget state"** (`:2618`).
- New: **"never lets a throwing arm escape the result callback"** (`:2631`). The stats are still
  delivered and a WARN is logged.
- Updated the 533 case "settles an open live estimate exactly once when Stop releases the owner". It
  asserted `onLiveStats` was the host callback by identity. It now asserts a function, and adds that
  `observeLive` received the provisional snapshot (`:2080`, `:2115`).

`session-lifecycle-manager.spec.ts`:

- Both budget doubles gained `onTurnTerminal: jest.fn()`.
- New: **"onTurnTerminal clears the budget turn state after arming and before the turn ends"**
  (`:963`). It checks call order `armAtTerminal` < `sessionBudget.onTurnTerminal` < `markTurnEnded`,
  keyed by the real id.
- New: **"onTurnTerminal clears the budget turn state without a coordinator"** (`:981`).
- New: **"treats a limit stage that does not block as the handoff stage"** (`:998`), through both
  `onTurnTerminal` and `armHandoverIfIdle`.
- New: **"arms no budget handover below the handoff stage"** (`:1014`), with `tighten` giving `false`.

## Verification (each run once in the foreground; filtered output)

1. `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts --coverage=false --maxWorkers=2`
   - First run: 158 passed, 1 failed. The failure was the 533 Stop-settle case's identity assertion
     on the unwrapped callback, which was updated as described above.
   - Final run: **Test Suites: 2 passed, 2 total; Tests: 159 passed, 159 total.**
2. `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`: **Successfully ran target typecheck.**
3. `npx nx lint @ptah-extension/agent-sdk --parallel=1`: **0 errors, 54 warnings.** That equals the
   post-626 baseline of 54, so this batch adds no warning.
   - `npx eslint` on the four files gives 9 warnings, all pre-existing:
     - `sdk-agent-adapter.ts`: `max-lines` (1341 counted lines, limit 700) and `no-useless-assignment`
       at `:325`;
     - `session-lifecycle-manager.spec.ts`: non-null assertions and one unused `rec`, all in older
       tests (`:1195-1468`).
   - `session-lifecycle-manager.ts` has no warning.
- `npx prettier --check` passes on all four files after `--write`.

## Risks and how each was handled

- **A live throw must not withhold the host payload:** try/catch, one WARN, then `inner` always
  runs. Covered by a spec.
- **Never `observe` for an estimate:** asserted across all four streams.
- **No host callback:** the wrapper is still installed. Covered by a spec. The 626 publisher is now
  active in every host that prepares a stats owner, which is the plan's intent (plan :197-199).
- **A throwing arm in the result path:** guarded. The broadcast goes first.
- **`sessionBudget.onTurnTerminal` must not skip `markTurnEnded`:** it cannot throw (evidence above),
  and its order relative to `markTurnEnded` is pinned by a spec.
- **`max-lines`:** the adapter grew by about 40 lines, inside an existing `max-lines` warning. No new
  warning.

## Deviations

- **Superseded by the required fix (D17/D18).** The first return used a shared `atHandoffStage`
  predicate, which counted `limit` as `handoff` on both arming paths. At the terminal, a live `limit`
  with `isAtBlockingLimit` false could arm `budget-auto` and start it before the blocking result
  converted it to `budget-limit`. That skipped the user's click at the limit. The fix, in
  `session-lifecycle-manager.ts` only:
  - `onTurnTerminal` passes `this.sessionBudget?.stageFor(budgetSessionId) === 'handoff'` again. A
    live `limit` at the terminal waits for the result, and `atBlockingLimit` still handles the
    authoritative blocking limit.
  - `armHandoverIfIdle` uses the renamed private `atHandoffOrLimitStage` (`handoff || limit`). It runs
    after the result, when the live figure has been cleared, so `limit` is authoritative there. Its doc
    comment explains why the two paths differ.
  - Spec: the case "treats a limit stage that does not block as the handoff stage" is replaced by
    three cases:
    - "defers a non-blocking limit stage at the terminal to the result": terminal call is
      `(…, false, …, false)`.
    - "treats a non-blocking limit stage after the result as the handoff stage": `armHandoverIfIdle`
      call is `(…, false, …, true)`.
    - "arms nothing at a live limit over an authoritative handoff, then arms after the result": stage
      is `limit` at the terminal and then `handoff`. Calls are `[false, false]` then `[false, true]`,
      which pins the D18 recovery.
  - Verification after the fix, run one at a time in the worktree:
    - `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts --coverage=false --maxWorkers=2`
      reported "Test Suites: 2 passed, 2 total; Tests: 161 passed, 161 total".
    - `npx nx typecheck @ptah-extension/agent-sdk --parallel=1` reported "Successfully ran target
      typecheck". Nx Cloud printed its usual connectivity notice.
    - `npx nx lint @ptah-extension/agent-sdk --parallel=1` reported "54 problems (0 errors, 54
      warnings)", the same as the baseline, and "Successfully ran target lint".
    - `npx prettier --check` on the two changed files reported "All matched files use Prettier code
      style!".
- Prettier reformatted four pre-existing, unformatted blocks in `session-lifecycle-manager.ts`, from
  Batch 4: the `admitInterrupt` lambda, `queueOwnedHandoff`, `isOwnedHandoffPendingOrRunning`, and the
  two `subagentsInFlight` loops. The changes are formatting only and do not change behaviour.
- 627-L1..L12 were not touched. As Batch 7 noted, the `onTurnTerminal` call now drops (does not
  deliver) a subagent-monitor notice that is still pending at turn end (627-L1).

## Out-of-scope observations

- `stream-transformer.ts:227-235`: `onTurnEnd` deliberately runs before the stats work. Any future
  design that needs the authoritative figure at the terminal must go through the post-result
  `armHandoverIfIdle` path, not `onTurnTerminal`.
