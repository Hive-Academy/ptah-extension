# Code Logic Review — `console-startup-errors` (round 3)

## Summary

| Metric              | Value        |
| ------------------- | ------------ |
| Overall score       | 8/10         |
| Assessment          | APPROVED     |
| Verdict             | APPROVED     |
| Blocking issues     | 0            |
| Serious issues      | 0            |
| Moderate issues     | 0            |
| Failure modes found | 0            |
| R2 defect fixed     | yes          |

Scope is only the signaled hourly `knownCostUsd` merge. Round 2 said `usage-summary.service.ts` wrote `knownCostUsd: (prior ?? 0) + (fact ?? 0)`, so an all-null slice set became a finite 0 and the welcome cell showed `≥ $0.00`.

The merge is now `...mergeKnownCost(prior.knownCostUsd, fact.knownCostUsd)` at `usage-summary.service.ts:89`. `mergeKnownCost` (`usage-summary.service.ts:249-254`) returns `{}` when both arguments are `undefined`, and `{ knownCostUsd: (prior ?? 0) + (next ?? 0) }` otherwise. Each slice still sets `knownCostUsd` only when `known_cost_micro_usd !== null` (`usage-summary.service.ts:77`).

Score is 8 rather than 9 because the new spec calls `mergeKnownCost` directly (`usage-summary.service.spec.ts:4-13`) and does not run `summarize` with two hourly rows, so the object-spread at `usage-summary.service.ts:82-90` is checked by reading, not by that test. It is not 6 or below: the all-null path no longer invents 0, and the mixed path still keeps the known part.

Skill: the task assigned none. No catalogue skill describes this review. No source was edited. Jest, eslint, and tsc were not re-run; the coordinator’s 43/43, eslint, and tsc report was not treated as proof of the dash.

## Decisions

- Verdict is APPROVED. The alternative was REVISE because `...fact` is spread before `mergeKnownCost`, so a `{}` result does not delete a key already copied from the newest slice. That leak needs `fact.knownCostUsd` to be a number while `mergeKnownCost` returns `{}`. `mergeKnownCost` returns `{}` only when `next` is `undefined`, and `next` is `fact.knownCostUsd`. A number on the newest slice takes the sum branch and overwrites the copied field. Reversible: yes, review only.

## Five logic questions

### 1. How does this fail silently?

No remaining coercion on these lines. Two slices with `known_cost_micro_usd: null` omit the field (`usage-summary.service.ts:77`). The merge returns `{}` (`usage-summary.service.ts:253`) and does not write 0 (`usage-summary.service.ts:89`). `UsageFactSchema` leaves `knownCostUsd` optional (`rpc-analytics.types.ts:23`). `pricedCost` reads `fact.costUsd ?? fact.knownCostUsd ?? null` (`usage-vitals.model.ts:182`) and stays `null`. `formatSpendAmount` returns `text: null` for a non-finite cost (`usage-vitals.model.ts:110-111`). `toSpendCell` returns `state: 'empty'` (`welcome-vitals.view.ts:131-132`). `ptah-stat-cell` paints `—` for `empty` (`stat-cell.component.ts:78-79`).

### 2. What user action produces unexpected behaviour?

None found for this correction. Electron `analytics:spendSummary` still passes a signal, so the hourly loop still runs. A workspace whose turns span two UTC hours and whose stored known costs are all null now gets the dash, including when the scan aborts after those slices. One hour never merged and already omitted the field.

### 3. What input data produces a wrong answer?

None found.

- All null: `mergeKnownCost(undefined, undefined)` is `{}`. `...fact` cannot reintroduce a number, because that fact has no `knownCostUsd`.
- Mixed, same group key (day, provider, model, `claude-ledger`, cost source, `row.source`): `mergeKnownCost(1.5, undefined)` and `mergeKnownCost(undefined, 2)` keep the number (`usage-summary.service.ts:254`, spec at `usage-summary.service.spec.ts:10-11`). That matches one-range `SUM`, which ignores nulls and returns null only when every value is null.
- Known zero stays 0 (`!== null` at `usage-summary.service.ts:77`). Unpriced zero still formats as `≥ $0.00`. That is a stored zero, not the null sum.

`costUsd` is still null when either slice is null (`usage-summary.service.ts:88`). Slices only share a key when `costSource` matches, and line 76 sets `costUsd` null for every `unpriced` row, so the refine `(costUsd === null) === (costSource === 'unpriced')` still holds (`rpc-analytics.types.ts:26-27`).

### 4. What happens when a dependency fails?

Unchanged for these lines. An abort keeps facts already merged (`usage-summary.service.ts:64`, `usage-summary.service.ts:94`). Those facts no longer carry a fabricated 0. `UsageSummarySchema.parse` (`usage-summary.service.ts:240`) still rejects a non-finite `knownCostUsd` (`rpc-analytics.types.ts:10`). SQLite null versus number does not produce that value; the `?? 0` inside `mergeKnownCost` runs only after one side is defined.

### 5. What is missing that the requirements never mentioned?

Nothing that changes the result. A `summarize` spec with a live signal and two null hourly rows would lock the spread. The pure-function spec does not.

## Failure modes

None in the reviewed lines. Scope: `usage-summary.service.ts:71-90` and `usage-summary.service.ts:245-255`, then the read path `usage-vitals.model.ts:177-184`, `usage-vitals.model.ts:232-247`, `usage-vitals.model.ts:106-116`, `welcome-vitals.view.ts:127-132`, `stat-cell.component.ts:78-79`. The rest of the branch was not re-reviewed.

## Blocking issues

None.

## Serious issues

None. R2 “merged null ledger cost shown as a known zero” is fixed at `usage-summary.service.ts:89` and `usage-summary.service.ts:249-254`.

## Moderate and minor issues

None.

## Data flow

1. Slice row, `known_cost_micro_usd === null` → fact has no `knownCostUsd` (`usage-summary.service.ts:77`). OK.
2. Second slice, same key, also null → `mergeKnownCost(undefined, undefined)` returns `{}` (`usage-summary.service.ts:253`). OK.
3. `{ ...fact, …sums, ...{} }` does not add `knownCostUsd` (`usage-summary.service.ts:82-90`). OK.
4. Parse keeps the optional field absent (`rpc-analytics.types.ts:23`, `usage-summary.service.ts:240`). OK.
5. `pricedCost` / `totals` leave `costUsd` null and set `unpriced` (`usage-vitals.model.ts:181-184`, `usage-vitals.model.ts:242-247`). OK.
6. `formatSpendAmount` → `text: null` → spend cell `state: 'empty'` → `—` (`usage-vitals.model.ts:110-111`, `welcome-vitals.view.ts:131-132`, `stat-cell.component.ts:78-79`). OK.
7. One numeric slice and one null slice → `knownCostUsd` is the numeric side (`usage-summary.service.ts:254`). `pricedCost` adds that finite value (`usage-vitals.model.ts:244`). OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| All-null hourly slices show a dash, not `≥ $0.00` | COMPLETE | |
| `...fact` cannot leak `knownCostUsd` when the merge returns `{}` | COMPLETE | Both undefined implies the newest fact omitted the field (`usage-summary.service.ts:77`) |
| One priced slice plus one null slice keeps the known part, like the unsliced `SUM` | COMPLETE | |
| No new defect in these lines | COMPLETE | |

Implicit requirements not addressed: none in this scope.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Both slices null | YES | `{}` at `usage-summary.service.ts:253` | |
| First number, second null | YES | `(prior ?? 0) + 0` overwrites any copied key | |
| First null, second number | YES | sum spread last, so `...fact` cannot win | |
| Both numbers | YES | sum | |
| Stored 0 | YES | `0` is not `undefined`; stays `≥ $0.00` when unpriced | |
| Single slice, no `prior` | YES | the raw fact is stored (`usage-summary.service.ts:90`) and already omits the field | |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a later edit that sets `knownCostUsd: undefined` on the fact would survive `...fact` when the merge returns `{}`. The current row builder does not do that.
- What a robust implementation would add: one `summarize` test with a live signal and two null-cost rows for one day, expecting `knownCostUsd` absent, plus one mixed row expecting the known sum.
