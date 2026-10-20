# Usage dashboard view-model split

## Files

| File | Lines | Change |
| --- | ---: | --- |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-formatting.ts` | 145 | New pure formatting, day-window, and provider label helpers |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary-fold.ts` | 278 | New accumulation and day-row grouping internals |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.ts` | 295 | View-model types and top-level builder |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.spec.ts` | 382 | Updated helper imports |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.ts` | 127 | Updated imports |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-breakdown-table.component.ts` | 178 | Updated imports |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-cost-quality.component.ts` | 82 | Updated imports |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-cost-summary.component.ts` | 183 | Updated imports |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-kpi-strip.component.ts` | 130 | Updated imports |
| `libs/frontend/dashboard/src/lib/components/usage-dashboard/stacked-area-chart.component.ts` | 384 | Updated formatting import |

## Symbol moves

- `formatUsd`, `formatCompactUsd`, `formatCompactTokens`, `formatPercent`, `formatDayShort`, `enumerateDays`, `daySpanLabel`, `providerDisplayName` -> `usage-formatting.ts`.
- `shareOf`, `finalizeCost`, `finalizeSavings`, `foldUsageSummary`, `buildDayRows`, accumulator types, `KEY_SEPARATOR` -> `usage-summary-fold.ts`. The latter internals were private before the split and are exported solely for the builder's direct import.
- `buildUsageViewModel`, `ProviderUsageRow`, `UsageKpis`, `UsageCostQuality`, `ProviderDailySeries`, `ModelBreakdownRow`, `DayBreakdownRow`, `UsageViewModel` remain in `usage-summary.view-model.ts`.

## Check outputs

Requested folder Jest command, with PowerShell `Select-Object -Last 15` in place of unavailable `tail -15`:

```text
Test Suites: 2 failed, 2 total
Tests:       6 failed, 45 passed, 51 total
Snapshots:   0 total
Time:        5.94 s
Ran all test suites matching libs/frontend/dashboard/src/lib/components/usage-dashboard.
```

The 15-line tail contained stack frames and counts, but no failing assertion messages. No Jest rerun was made under the task's verification limit.

Dashboard typecheck (`$env:NX_NO_CLOUD='true'; npx nx typecheck dashboard --parallel=1`, output filtered to last 20 lines):

```text
NG8107: The left side of this optional chain operation does not include 'null' or 'undefined' in its type
NX   Successfully ran target typecheck for project @ptah-extension/dashboard
Run duration: 24.7s
Cache: 0/1 hit (0%)
```

## Decisions

- Moved UTC day enumeration and provider labels with formatting because they are pure helpers used directly by components and tests.
- Kept the exported view-model types in the view-model file and used direct imports, with no re-export shim or import cycle.
- Left the optional chart split alone because `stacked-area-chart.geometry.ts` already exists in the folder and belongs to the concurrent workspace state.
- Jest remains failing: 6 failures. The mandated output tail did not identify their assertions, so this handoff does not claim they are pre-existing or caused by this split.
