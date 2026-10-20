# TASK_2026_707 — PR 2, batch C2 (frontend): render cache savings

`UsageFact.cacheSavingsUsd` landed in the contract, so the Usage tab now
aggregates and renders savings everywhere the fold runs — with honesty rules
that never turn "unknown" into zero. Batch C's "Needs per-model cache rates"
placeholder is gone.

## Files changed

All under `libs/frontend/dashboard/src/`:

- `lib/components/usage-dashboard/usage-summary.view-model.ts` — the fold now
  aggregates `cacheSavingsUsd` per provider, per model, per day and in total.
  `ProviderUsageRow`, `ModelBreakdownRow` and `DayBreakdownRow` gain
  `cacheSavingsUsd: number | null` plus `savingsUnknownFactCount: number`;
  `UsageKpis` gains `cacheSavingsUnknownFactCount` and a computed
  `savingsMultiple`; `UsageCostQuality` gains `cacheSavingsUnknownFactCount`.
  A shared `SavingsAcc` (with `addSavings`/`finalizeSavings` helpers) keeps
  every group under one rule set.
- `lib/components/usage-dashboard/usage-kpi-strip.component.ts` — the
  "Cache savings" tile renders "—", "$2.40", or "≥ $2.00" (lower bound). The
  sub line shows the multiple ("1.5x the raw token cost"), "a lower bound",
  "No savings data", or "vs raw token cost". A DaisyUI tooltip
  (`[class.tooltip]` + `data-tip`) counts the facts without savings data.
- `lib/components/usage-dashboard/usage-cost-quality.component.ts` — the
  cache savings stat uses the same value and tooltip rules.
- `lib/components/usage-dashboard/usage-summary.view-model.spec.ts` — new
  describe `buildUsageViewModel cache savings` with the four required cases;
  the main fold test pins `cacheSavingsUnknownFactCount` on kpis and quality.
- `lib/components/usage-dashboard/usage-dashboard.component.spec.ts` — the
  two priced fixtures report savings (1.5 / 0.5), the unpriced one does not;
  the folded-summary test asserts the "≥ $2.00" lower bound, the sub line
  and the tooltip; a new test covers the fully-known case ($2.40, 1.5x).
- `lib/services/session-analytics-state.testing.ts` — `usageFact` default
  gains `cacheSavingsUsd: null`, so every existing fixture still satisfies
  the stricter `UsageFact` type.

Not touched: `libs/backend/**`, `libs/shared/**`, `apps/**`. The store
(`analytics-usage.store.ts`) needed no change: the summary flows through
unchanged and its staleness guards already apply.

## Honesty rules implemented

- No fact reports savings → the total is `null`, rendered "—" with "No
  savings data". Never zero, never guessed.
- Some facts report, some do not → the known sum renders as a lower bound:
  "≥ $2.00", sub line "a lower bound", tooltip "N facts without savings
  data" (singular "1 fact"). The unknown count is tracked per provider, per
  model, per day and in total.
- Every fact reports → the plain sum renders and the multiple
  `(rawCost + savings) / rawCost` shows as "1.5x the raw token cost".
- The multiple is suppressed unless savings is fully known
  (`cacheSavingsUnknownFactCount === 0`) and `totalCostUsd` is known and
  positive: a lower-bound savings would make the multiple a lower bound too,
  and a zero raw cost divides by zero. Tested by the zero-cost case
  (`costUsd: 0`, savings 1 → savings renders, multiple stays `null`).
- Savings are independent of `costSource` in the contract (the refine ties
  only `costUsd` to `'unpriced'`), so an unpriced fact with savings is valid
  and is aggregated like any other. The all-known case covers it.

## Verification

Jest (only the changed specs + the card-spec fixture regression;
`--coverage=false --maxWorkers=1`):

```
Test Suites: 3 passed, 3 total
Tests:       53 passed, 53 total
```

48 before, 53 after: +4 view-model savings cases (all known, mixed null,
all null, zero cost) and +1 component test (savings multiple).

Typecheck (once; `$env:NX_NO_CLOUD='true'; npx nx typecheck dashboard
--parallel=1`):

```
NX   Successfully ran target typecheck for project @ptah-extension/dashboard
Run duration:      18.6s
```

## Decisions

- Tooltip wording: "N facts without savings data" instead of the task's
  example "N facts unpriced". A fact without savings data can still be
  priced; the task marked the wording with "e.g." as illustrative.
  Reversible: one template string.
- The savings multiple is suppressed for partially known savings (see honesty
  rules). The task required the ratio "only when both are known"; a
  lower-bound numerator would silently understate the multiple, so the tile
  says "a lower bound" instead.
- Savings fold into every row type (provider/model/day) even though only the
  KPI tile and the quality panel render them: the fold owns one honesty rule
  set, and the rows stay ready for table columns without a second fold.