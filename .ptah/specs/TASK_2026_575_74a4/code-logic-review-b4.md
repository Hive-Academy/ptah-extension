# Code Logic Review — TASK_2026_575_74a4, Batch 4 (analytics cost accounting)

Scope: uncommitted changes under `libs/frontend/dashboard/` in worktree
`D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost` (10 modified files,
4 new spec files). Batch 2's concurrent edits in `libs/shared` and `libs/backend` were read
only to verify the `knownCost` wire contract; they are not judged here.

Verification run in this review: `npx jest -c libs/frontend/dashboard/jest.config.ts` —
13 suites, 104 tests, all passed (a worker force-exit warning appears; see finding 5).

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | REVISE         |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Minor issues        | 4              |
| Failure modes found | 2              |

The core accounting is correct: the aggregate sums `totalCost ?? knownCost` per session
exactly once, no double counting, no silent drop. The single serious defect is the "≥"
marker on the **Avg / Session** tile: it fires whenever `totalCostIsLowerBound` is true,
but the flag also becomes true when a fully priced session coexists with an unpriced
session that is excluded from the average's denominator. In that case the shown average is
exact, not a lower bound, so the tile makes a false claim about money on a likely path.

## What the batch got right (verified)

- One estimate rule, one place: `sessionCostEstimate` (`session-analytics-state.service.ts:101-119`)
  returns the full total, else the priced subtotal marked lower-bound, else unknown. Every
  display surface routes through it or through `format.utils` helpers built on it; nothing
  renders `knownCost` without the marker.
- No double counting: `aggregates` adds `estimate.cost` exactly once per session
  (`session-analytics-state.service.ts:340-344`). `knownCost` in `mergeEntry` is a fallback
  (`stats?.knownCost ?? stats?.totalCost ?? null`, `:619`), never a second addend.
- Denominator: `avgCostPerSession` divides by `costContributorCount` — only sessions that
  contribute a figure (`:373`), as Task 4.1 specifies. Unknown sessions never zero an average.
- Older producers: `mergeEntry:619` null-safe fallback; pinned by the A7 test
  (`session-analytics-state.service.spec.ts:444-466`), which also pins
  `sessionCostEstimate` for all three coverage shapes.
- RPC passthrough (A7): the handler spreads the reader entry unchanged
  (`session-rpc.handlers.ts:986-992`); no field mapping can drop `knownCost`.
- CLI lanes (A6): `formatSessionCost` returns "Unknown" for `status 'empty'` with CLI agents
  (`format.utils.ts:52-53`); the aggregator emits `null` costs for empty sessions
  (`session-usage-aggregator.ts:132,150`), so nothing CLI-only is ever summed or rendered $0.
  Pinned at component level (`session-stats-card.component.spec.ts:118-133`) and page level
  (`analytics-card.component.spec.ts:225-243`).
- Neutral colour rule: `costValueClass` gates `text-success` on a known figure only
  (`format.utils.ts:89-91`); applied to the total tile, session card, detail modal and
  per-model rows. The base "green Unknown" from `screenshots/before/analytics-dark.png`
  cannot recur; a test pins the class list (`analytics-card.component.spec.ts:175-190`).
- Fully priced range shows no marker: pinned (`analytics-card.component.spec.ts:200-216`,
  `metrics-cards.component.spec.ts:48-53`). The empty-parts tooltip edge cannot occur
  (`metrics-cards.component.ts:148-163`): any lower-bound total implies at least one of the
  two counted clauses is non-zero.
- Tests are non-tautological: they assert rendered DOM (`data-testid`, class lists, sr-only
  text), not internal return values only. The aggregate test asserts total 5 for a fixture
  whose partial session's knownCost the base drops — it fails on base as required by R8
  (formal failing-assertion evidence from the executor is still owed per batches.md).
- Angular: all three touched components keep `ChangeDetectionStrategy.OnPush`, signals +
  `computed`, `input.required` / `setInput`; no `[innerHTML]` on any data path
  (`session-stats-card.component.ts:46`, `session-detail-modal.component.ts:45`,
  `metrics-cards.component.ts:29`).

## Numbered findings

### 1. SERIOUS — "≥" marker on Avg / Session is false when the lower-bound flag comes only from excluded unpriced sessions

- File: `libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.ts:112,123-127`
  (marker condition), together with `session-analytics-state.service.ts:345-348,362` (the flag's second source).
- Failure scenario: a range with one fully priced session ($2.00) and one `pricingCoverage: 'none'`
  session. `totalCostIsLowerBound` is true because the unpriced session is excluded
  (`session-analytics-state.service.ts:347`). The avg tile then renders "≥ $2.00" with the
  tooltip "Lower bound: 1 session with no price (left out)." The average's denominator is
  `costContributorCount` (`:373`), which excludes the unpriced session, so the shown average
  is exact for the sessions it covers — the true per-session average over the range can be
  *lower* ($2.00 + $0 unpriced) or higher. "At least $2.00" is a claim the code cannot back.
  The batch requirement is "a lower-bound figure is always labeled"; this labels a
  non-lower-bound as one, on a likely range shape.
- Fix: mark the avg only when the contributing figures are themselves lower bounds, i.e.
  `avgIsLowerBound = totalCost !== null && partiallyPricedSessionCount > 0` (a computed in
  `MetricsCardsComponent`), and use it at `metrics-cards.component.ts:112` and `:123`. Keep
  the total tile on the aggregate flag. Add a test with
  `{totalCostIsLowerBound: true, partiallyPricedSessionCount: 0, unknownCostSessionCount: 1}`
  asserting no marker on `metrics-avg-cost`.

### 2. MINOR — Status line claims "the total is a lower bound" when no total exists

- File: `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.html:114-120`.
- Failure scenario: every session in range is unpriced (`totalCost` null,
  `unknownCostSessionCount` = N). `totalCost` is null (`session-analytics-state.service.ts:361`)
  and the tile reads "Unknown", yet the status line still says "the total leaves them out,
  so it is a lower bound" — there is no total figure to be a lower bound.
- Fix: guard the "so it is a lower bound" clause on `totalCost !== null`, e.g. render
  "the total is unknown" when no session has a price. The service side is already correct
  (`totalCostIsLowerBound` false when no contributor, `:362`); only the copy needs the guard.

### 3. MINOR — CLI-lane-only sessions read "Unknown" on the card but are invisible in the aggregate explanation

- File: `format.utils.ts:52-53` vs `session-analytics-state.service.ts:345-348`.
- Failure scenario: a CLI-only session shows "Unknown" and a coverage note naming the CLI
  agent (`format.utils.ts:124-128`), but it is not counted in `unknownCostSessionCount`
  (which requires `status === 'ok'`) and the total tooltip does not mention it. The user
  sees an unknown-cost card next to a total whose tooltip claims to name everything it
  leaves out.
- Fix (if desired, still consistent with scope decision 3): either count CLI-only sessions
  into `unknownCostSessionCount`, or leave as-is and record that CLI-only sessions are
  explained per-card only. The sums are correct either way; this is an explanation gap, not
  an accounting gap.

### 4. MINOR — `sessionCostEstimate` trusts `totalCost` unmarked for any non-'partial' coverage value

- File: `session-analytics-state.service.ts:107-111`.
- Failure scenario: only reachable with a hypothetical producer that sends a non-null
  `totalCost` with `pricingCoverage` `null` or `'none'` while pricing is actually partial;
  the shown figure would be displayed unmarked. The current wire contract makes
  `totalCost` non-null imply full coverage (`session-usage-aggregator.ts:292`), so no live
  producer can trigger it.
- Fix: none required now. If defence is wanted, treat a missing/`'none'` coverage value with
  a non-null total as lower-bound, or document the assumption at `:107`. Note that
  `format.utils.ts:70-78` already handles the inverse case (`'partial'` with a total).

### 5. MINOR (observation, likely pre-existing) — Jest worker force-exit warning

- File: test run, not a file.
- Failure scenario: `npx jest -c libs/frontend/dashboard/jest.config.ts` ends with
  "A worker process has failed to exit gracefully … Active timers can also cause this."
  The touched components create no timers, subscriptions or intervals, so the batch is an
  unlikely cause; the suite predates the batch.
- Fix: out of Batch 4 scope; worth a `--detectOpenHandles` run in a later batch or a
  separate cleanup.

## Executor-declared deviations — judgment

- (a) `totalCostIsLowerBound` also true when a readable session with usage has no price at
  all and is excluded from the sum (`session-analytics-state.service.ts:345-348`) — **accepted**.
  The total then genuinely understates spend; the status line copy was updated to match
  (`analytics-card.component.html:115-117`), and a test pins the flag with
  `partiallyPricedSessionCount: 0` (`session-analytics-state.service.spec.ts:496-511`).
- (b) `partiallyPricedSessionCount` counts sessions whose shown figure is a lower bound
  (`:349-351`) — **accepted**. It aligns the count with the tooltip's first clause, keeps
  unpriced sessions in their own counter, and cannot double-count a session (a session with
  a non-null cost and `'partial'` coverage is counted once). Finding 1 is a consequence of
  reusing this flag for the average, not of the deviation itself.

## Five logic questions (compact)

1. **Silent failure**: none found in the changed code. The one silent wrongness is the false
   "≥" claim (finding 1) — visible, not silent, but misleading.
2. **User action**: open the analytics page for a range mixing priced and unpriced sessions —
   the avg tile mislabels (finding 1); a fully unpriced range shows the odd copy (finding 2).
3. **Wrong-answer input**: an older producer omitting `knownCost` is handled (`mergeEntry:619`,
   pinned by the A7 test). A producer sending both fields with `knownCost < totalCost` would
   display the unmarked total — excluded by the wire contract (finding 4).
4. **Dependency failure**: per-session RPC errors degrade to `unreadableStats`
   (`session-analytics-state.service.ts:665-679`) with `knownCost: null`, counted as error
   sessions, never summed. The handler keeps the reader's error entry unchanged
   (`session-rpc.handlers.ts:986-992`). No new failure path introduced.
5. **Missing from requirements**: the avg-marker precision (finding 1); the no-total copy
   guard (finding 2); nothing else observed against Task 4.1/4.2, R8, A6, A7 and context
   scope decisions 3, 4, 7.

## Requirements fulfilment

| Requirement (batches.md / context.md)                        | Status   | Gap                                   |
| ------------------------------------------------------------ | -------- | ------------------------------------- |
| Total adds `totalCost ?? knownCost`, no silent drop          | COMPLETE | —                                     |
| Lower-bound figures always labeled (marker + tooltip + sr-only) | PARTIAL | Finding 1: avg marker can be false    |
| Fully priced range shows no marker                           | COMPLETE | Pinned by tests                       |
| Unknown never $0; CLI-only never $0, never summed            | COMPLETE | Finding 3 is an explanation gap only  |
| `knownCost` passes through RPC unchanged (A7)                | COMPLETE | Spread at `session-rpc.handlers.ts:986-992`; pinned by test |
| Neutral muted colour for unknown/unavailable                 | COMPLETE | Pinned by class-list tests            |
| Status-line copy says partials ARE included as a lower bound | COMPLETE | Finding 2 wording when no total exists |

Implicit requirements not addressed: none beyond the findings above.

## Verification evidence

- Full diffs of all 14 dashboard files read; `session-analytics-state.service.ts`,
  `format.utils.ts`, `metrics-cards.component.ts` and all four new specs read in full.
- Grep for `totalCost|knownCost` across `libs/frontend/dashboard/src` found no display path
  that bypasses `sessionCostEstimate` / the format helpers.
- Jest: 13/13 suites, 104/104 tests passed. The dashboard suite type-checks the new
  `knownCost` field against Batch 2's `SessionStatsEntry` (`rpc-session.types.ts:199-209`),
  so the wire contract is compile-pinned, not just runtime-pinned.
- Not verified here: the executor's failing-on-base demonstration (batches.md gate) and the
  visual-reviewer "after" screenshots — both are Batch 4 verification items the orchestrator
  still owes.

## Verdict

- Recommendation: **REVISE** — fix finding 1 (small, one component + one test) and optionally
  finding 2; findings 3-5 are minor and can ride along or be recorded.
- Confidence: HIGH on the accounting arithmetic and labeling coverage; the single defect is
  pinned to two template bindings with a concrete counter-example.
- Top risk: the avg tile's "≥" marker is false whenever the lower-bound flag comes only from
  unpriced sessions, which is exactly the mixed range this task targets.
- What a robust implementation would add: an `avgIsLowerBound` computed keyed on
  `partiallyPricedSessionCount` (finding 1); a `totalCost !== null` guard on the status-line
  copy (finding 2); the executor's failing-on-base evidence for the aggregate test.