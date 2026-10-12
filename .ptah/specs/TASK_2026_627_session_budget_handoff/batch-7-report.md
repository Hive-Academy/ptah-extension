# Batch 7 report — budget live feed (Component 1, live part)

Executor: backend-developer. Worktree `fix/session-budget-handoff`, after the 626 merge (`91376becf`). No git
state was changed.

## Task 7.0 — risk A3 re-check (done before any code was written)

**Verdict: A3 holds for token budgets. For cost budgets it holds unless an estimate row is unpriced. In that
case the live figure moves to a different measure, and the planned measure guard handles it. The design does
not change.**

Evidence:

- **Shape.** The live payload carries a plain `SessionStatsEntry` (`libs/shared/src/lib/types/agent-adapter.types.ts:99-110`,
  `sessionStats: SessionStatsEntry`). It has the same fields as the authoritative snapshot plus
  `provisional?: boolean` (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:424-429`). `revision?: number`
  is at `:422`.
- **Same builder.** `SessionStatsOwnerService.publishLive` (`libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:620-636`)
  returns `build(sessionKey, state, true)`. `build` (`:803-858`) runs the authoritative path:
  `aggregateSessionUsage` over the prefix plus every run's `current`. In live mode it adds one more
  contribution per run, `estimateResult(run.provisional)` (`:826-829`), and marks the snapshot
  `provisional: true` (`:855`). The totals have the same meaning: whole-session lifetime, with
  `tokenCount` and `tokens` summed and the estimate added on top. The incomplete-run rule (`:839-850`) also
  applies to both.
- **Tokens measure.** `measureSessionBudget` uses `snapshot.tokenCount` (`session-budget-stage.ts:89-95`), so
  live and authoritative are measured the same way.
- **Cost measure (the deviation A3 anticipated).** `estimateResult` (`session-stats-owner.service.ts:893-908`)
  prices the rows from the rate card (`live-session-stats-publisher.ts:500-523`, `price()` returns `null` when
  the model has no price). Its `totalCost` is `null` when any row is unpriced. The aggregator then makes
  the merged `totalCost` `null` with `pricingCoverage: 'partial'` (`session-usage-aggregator.ts:348-385`), and
  `measureSessionBudget` changes from `cost` to `cost-lower-bound` (or `weighted-fallback`)
  (`session-budget-stage.ts:110-124`). Such a live evaluation is now ignored, with one DEBUG line. If the
  authoritative measure is already the sticky `weighted-fallback`, passing it as `previous` keeps the live
  figure in `weighted-fallback` too (`session-budget-stage.ts:269-272`).
- **Revision.** `publishLive` advances the owner revision when it stores new rows (`touch`, `:631`).
  `clearProvisional` (`:646-655`) advances it again at the result boundary, before the result is offered.
  So every authoritative snapshot after a turn has a strictly higher revision than any live snapshot of that
  turn. A live snapshot without new rows can carry the same revision as the last authoritative one
  (`:633-635`).
- **Authoritative settles on the live channel.** `session:stats-live` also carries authoritative settle
  snapshots, which have no `provisional` field (`agent-adapter.types.ts:101-103`). `observeLive` ignores
  them. They reach the budget through the result path.
- **Wiring today.** `SdkAgentAdapter.setLiveStatsCallback` (`sdk-agent-adapter.ts:1444`) goes straight to
  the stream, and its comment says the budget never sees it (`stream-transformer.ts:220-226`). The only
  consumer is the webview broadcast (`cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:168`). Feeding
  `observeLive` is Batch 8.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts`:
  adds `observeLive` and `onTurnTerminal`, makes `stageFor` include the live figure, adds the wrap-up notice,
  and adds the live-figure lifecycle.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.spec.ts`:
  adds 10 cases in a new `describe('SessionBudgetService.observeLive')`.

No other file was touched.

## Design of each new or changed member

- **`BudgetEntry.liveFigure: SessionBudgetFigure | null` and `liveNoticedRank: number`.** Both are
  initialised in `entryFor`.
- **`observeLive(snapshot): void`**
  - Returns at once unless `snapshot.provisional === true`.
  - Disabled budget: clears any stale `liveFigure` on an existing entry and returns. It never creates an entry.
  - Gets the entry through `trackedEntry(id, 'live')`. This uses the same released-id rule as `observe`: a
    released id with no stats-owner lease is ignored.
  - Caches the workspace (`rememberWorkspace`).
  - Ignores a live snapshot whose revision is older than the authoritative figure's.
  - Evaluates with `evaluateSessionBudget`, using `previous` = the authoritative state and the entry's
    compactions and extensions. A settings change resets the stage and measure, as `applyEvaluation` does.
  - Ignores a measure mismatch with one DEBUG line. Otherwise it stores `entry.liveFigure` and calls
    `noticeLiveStage`.
  - It writes only `liveFigure`, `liveNoticedRank` and `workspacePath`. It never writes `snapshot`, `figure`,
    `revision`, `usageSeq`, `blocked` or `actedRank`, and it schedules no stage action.
  - Wrapped in try/catch. A failure WARNs once with kind `observe-live`.
- **`noticeLiveStage` (private).** The notice rank is `limit` if the live rank is at least `limit`,
  `handoff` if it is at least `handoff`, otherwise nothing. The notice posts only when this rank is above
  `max(liveNoticedRank, actedRank)`. This gives once per rank per turn, and nothing for a stage the
  authoritative path already acted on. When it posts, it logs at INFO
  `[SessionBudget] Live stage <from> -> <to> for <id>` with `{ measure, used, percent }` and calls
  `noticeQueue.post`.
- **`wrapUpNotice` and `budgetAmount` (module functions).** These build the host-authored text (plan :163-167).
  - Handoff stage: "near its budget (about X of Y, N%). Finish the step in progress. Do not start new tasks,
    subagents or CLI lanes. Wait for running subagents to return and for running CLI lanes (ptah_agent_wait /
    ptah_agent_status), then end the turn. Ptah will ask for a handoff and continue in a new session."
  - Limit stage, the firmer variant: "reached its budget limit (…). Stop now: do not start or wait for
    anything new, then end the turn. …"
  - Amounts are `$x.xx` for cost measures and `n,nnn tokens` / `weighted tokens` otherwise.
- **`stageFor(id)`.** Returns `higherSessionBudgetStage(figure.stage, liveFigure.stage)`, or whichever of the
  two exists. `canSend`, `checkStored` and `checkSnapshot` are unchanged and still use only the
  authoritative figure.
- **`onTurnTerminal(id)`.** Clears `liveFigure`, resets `liveNoticedRank`, and calls
  `noticeQueue.clear(id)`. It runs in O(1) and also runs without an entry.
- **`release` / `clearAll`.** They already cleared the session's notices since Batch 3 (`noticeQueue?.clear`).
  That is unchanged and the existing specs still pass.
- **`SessionBudgetNoticeQueue`** is widened from `Pick<…, 'clear'>` to `Pick<…, 'post' | 'clear'>`.
  `MainThreadNoticeQueue` is already injected, so the DI wiring is unchanged.

Each call is O(1). There are no timers and no new dependencies.

## Plan deviations and additions (please review)

1. **A newer authoritative snapshot clears `liveFigure`.** In `acceptOrThrow`, when the accepted snapshot's
   revision is above the live figure's, the live figure is dropped. This follows the 626 contract ("the next
   snapshot with a higher revision replaces it"). Without it, an overestimate would stay in `stageFor` after
   the turn's result. The lifecycle reads `stageFor` at turn end (`session-lifecycle-manager.ts:522,541`),
   before Batch 8's `onTurnTerminal` runs, so it could arm a `budget-auto` handover that the authoritative
   figure does not justify.
2. **A live snapshot older than the authoritative revision is ignored.** A late estimate cannot raise a stage
   that a newer result has already settled.
3. **Stale live figures are cleared in three more places:**
   - when the budget is disabled, on either path;
   - on `extend`;
   - on a settings change (`applyEvaluation` with `resetStage` or a changed config also resets
     `liveNoticedRank`, so the notice can post again against the new limit).
4. **No authoritative figure yet (first turn).** The live snapshot is evaluated with `previous = null`. There
   is nothing to compare the measure against, so the measure check is skipped.
5. **The amount formatter is duplicated in a small form.** `formatAmount` in `session-handoff-builder.ts` is
   not exported. I kept to the two assigned files instead of exporting it there.

## 627-L1 (left unfixed, as instructed)

Once Batch 8 calls `onTurnTerminal`, it clears the session's whole notice queue at turn end. That includes a
subagent-monitor notice that missed the stopped subagent's `Agent` result. So the "drain at turn end" half of
627-L1's remedy is effectively in place: the stale notice no longer leaks into the next turn's first tool
result. It is dropped, though, not delivered. The "post before awaiting the stop" half is untouched.

Until Batch 8 wires the call, `onTurnTerminal` has no caller, so 627-L1's behaviour is unchanged today.

## Spec cases added (`describe('SessionBudgetService.observeLive')`)

1. Live 81%:
   - raises `stageFor` to `handoff`;
   - `canSend` stays ok and there is no handoff write;
   - posts one notice, with the expected text and the INFO line;
   - a live 85% afterwards posts nothing more.
2. Live 105%:
   - never blocks;
   - `stageFor` is `limit` and the firmer "Stop now" notice posts;
   - an authoritative 105% does block.
3. No notice when the authoritative figure already acted on `handoff` (authoritative 85%, then live 90%).
4. `onTurnTerminal` clears the live stage and pending notices. The next turn notifies again.
5. A newer authoritative snapshot replaces the estimate, and an older live snapshot is then ignored.
6. Ignored inputs: a non-provisional snapshot, a released session (no lease), and a disabled budget.
7. Disabling the budget mid-turn drops the live figure.
8. Measure mismatch (A3): a cost budget with authoritative `cost` and a live `cost-lower-bound` is ignored,
   with the DEBUG line and no notice.
9. Never throws. A throwing config read WARNs once as `observe-live`.
10. Workspace cached by `observeLive`: `preview-handoff` after the lifecycle forgot it still builds from
    `/live-ws`. The "never known → `workspace-unknown`" case was already covered by the Batch 3 specs, which
    still pass.

## Verification (each run once in the foreground; formatting applied with prettier and the spec re-run)

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts --coverage=false --maxWorkers=2`
  → **1 suite passed, 83 tests passed** (73 before, plus 10 new). The re-run after prettier gave the same
  result.
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1` → **Successfully ran target typecheck**.
- `npx nx lint @ptah-extension/agent-sdk --parallel=1` → **0 errors, 54 warnings** (baseline 53).
  - `npx eslint` on the two changed files reports exactly one warning: the existing `max-lines` on
    `session-budget.service.ts`, now 867 counted lines against 751 after 6F. The spec has none.
  - So the extra project warning does not come from this batch. It most likely came in with the 626 merge;
    I did not confirm this, because doing so would need a lint of the pre-merge tree.
- `npx prettier --check` on both files passes after `--write`.

## Open points

- `max-lines`: the service grew by 116 counted lines. That is the same treatment as 627-L7 and the 6F note.
  The follow-up is a behaviour-preserving extraction; the live-feed members and `wrapUpNotice` are a natural
  candidate for their own helper file.
- For Batch 8: the lifecycle tests `stageFor(...) === 'handoff'` (`session-lifecycle-manager.ts:522,541`).
  A live `limit` with no authoritative block matches neither the handoff test nor `atBlockingLimit`. In
  practice the turn's result, which is observed before turn end, settles the figure. Batch 8 should still
  confirm the order: result observe → `stageFor` → arm → `onTurnTerminal`.
- `actedRank` is not per turn. Once the authoritative path acted on `handoff` in an earlier turn, later turns
  get only the `limit` live notice. This is per the plan's wording ("authoritative `actedRank` is below it").
