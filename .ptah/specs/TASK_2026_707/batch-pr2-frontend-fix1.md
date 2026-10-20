# TASK_2026_707 — PR 2 frontend, review fix round 1

Scope: fix every numbered defect (1–8) of
`code-logic-review-pr2-frontend.md` (codex verdict REVISE 5/10: 6 major, 2 minor).
All fixes are in `libs/frontend/dashboard/src/lib/components/usage-dashboard/**`
and `libs/frontend/dashboard/src/lib/services/analytics-usage.store.ts`.
No file outside the reviewed scope was changed. No git operation was run.

## Defect 1 — previous workspace/range data shown as current (major)

**Fix.** The store now tags every retained summary with its scope
(`UsageSummaryScope { range, workspace }` in
`analytics-usage.store.ts`, fields beside `load()`). On a scope change,
`load()` clears the old summary before the request runs, so the UI shows the
loading state, never the old window. On success the scope is recorded with the
data. A same-scope refresh keeps the old summary and exposes
`isSummaryStale` (`summary !== null && isLoading`). The component binds it at
`usage-dashboard.component.ts:72` and the template dims the content
(`[class.opacity-60]`, `usage-dashboard.component.html:69`) and shows one of
two notes: `usage-refresh-failed` when the refresh failed, or `usage-updating`
with "Updating usage... (showing the last loaded data)" while it runs
(`usage-dashboard.component.html:72-88`).

**Tests** (`usage-dashboard.component.spec.ts`): "clears the old summary while
a new range is loading", "clears the old summary while a new workspace is
loading", "keeps the old summary, marked stale, during a same-scope refresh",
"switches the range, clears the old summary and renders the new window",
"shows an error and no old data when the new range fails", "keeps the last
data but marks it updating during a refresh", "keeps the last data with a
note when a refresh fails".

## Defect 2 — partial cost shown as a complete total (major)

**Fix.** The fold now counts unpriced facts at every level
(`usage-summary.view-model.ts`, `buildUsageViewModel`): the view model gains
`totalCostUnpricedFactCount`, `totalCostUnpricedTokens`, `dayCostUnknown`;
`ProviderUsageRow` gains `unpricedFactCount`, `unpricedTokens`;
`DayBreakdownRow` gains `unpricedFactCount`. Cost-null facts add tokens to the
unpriced counters instead of pretending a zero cost. Rendering:
`usage-cost-summary.component.ts` shows the total as `≥ $x.xx` with a tooltip
"N facts unpriced, M tokens" while any fact is unpriced, and provider rows do
the same; the share denominator reads "of known cost" while the total is a
lower bound. `usage-breakdown-table.component.ts:143-165` adds
`modelCostLabel`, `dayCostLabel` (both "≥" variants) and the `dayTitle`
tooltip. An unpriced provider keeps `costUsd: null`, so its share stays null
and renders as "—", never 0 or 100%.

**Tests**: view-model fold assertions in "folds tokens, cost, shares, kpis and
quality over the window" (`usage-summary.view-model.spec.ts:127-211`, incl.
`totalCostUnpricedFactCount === 1`, `dayCostUnknown [false,true,false]`);
component test "renders the folded summary" asserts total `≥ $5.00`, tooltip
`1 fact unpriced, 1K tokens` and `100% of known cost`.

## Defect 3 — cost chart turns unknown into zero (major)

**Fix.** The fold exports `dayCostUnknown` (per day) and per-provider
`costUnknownByDay` (`usage-summary.view-model.ts`). The dashboard maps
`dayCostUnknown` into a new generic `unknownDays` chart input
(`usage-dashboard.component.ts:106-110`, bound at
`usage-dashboard.component.html:142`). The chart draws a diagonal SVG `<pattern>`
hatch over each flagged column, adds a legend note "unpriced usage (cost
unknown)", and rewords the aria label and the readout: a flagged day with
plotted value reads "at least $x (some usage unpriced)", and a day with no
priced value reads "unpriced usage, cost unknown" — never "total $0".
Token mode passes `[]` because token counts are always known.

**Tests**: "hatches unknown days and never reads them as zero usage"
(asserts the hatch rect, the legend, both aria wordings and the readout);
"marks days with unpriced usage in cost mode only" (hatch count 1 in cost
mode, 0 in token mode).

## Defect 4 — savings multiple computed from an invalid ratio (major)

**Fix.** `savingsMultiple` in `usage-summary.view-model.ts` is non-null only
when savings AND cost are both fully known: it now also requires
`totalCostUnpricedFactCount === 0` (plus the existing `totalCostUsd !== null
&& totalCostUsd > 0` and `savingsUnknownFactCount === 0`). The invalid ratio
pinned at spec:265-290 cannot render any more.

**Tests**: "computes the savings multiple only when cost and savings are both
fully known" (total $6.00, multiple ≈ 1.4x); "aggregates savings..." now pins
`null` with a comment; "renders the folded summary" hides the multiple in the
mixed case, and "shows the savings multiple when cost and savings are both
fully known" shows `1.4x the raw token cost` on a fully priced fixture.

## Defect 5 — malformed or overflowing chart numbers break the SVG (major)

**Fix.** `stacked-area-chart.component.ts` sanitises at one boundary: a
`clean` computed maps every series value to a finite, non-negative number,
capped at `MAX_SERIES_VALUE = 1e15`; every geometry, gridline, label, column
and readout reads from `clean`, never from the raw `series` input. NaN and
negatives become 0 (counted as no usage), absurd values clamp instead of
overflowing the cumulative stack.

**Tests**: "drops NaN and negative values instead of corrupting the chart"
(the NaN day renders "no usage", no NaN/Infinity text, path count 2);
"scales very large values without invalid geometry or labels" (values 1e12 /
2e12; no NaN/Infinity, one area path, the full 2000000000000 gridline label
still renders).

## Defect 6 — raw dependency errors reach the UI (major)

**Fix.** `analytics-usage.store.ts` exports
`USAGE_LOAD_FAILED_MESSAGE = 'Could not load usage data.'`. The error branch
logs the details with `console.warn` (the diagnostic channel the repo already
uses, e.g. builders-card, skill-selection-card) and sets only the fixed
message. The error alert and the refresh-failed note interpolate that message,
so raw RPC text never reaches the DOM.

**Tests**: "surfaces a failed load as a fixed user message, never the raw
error" (RPC error carries `token=SECRET`; the DOM shows the fixed message and
contains neither "RPC timeout" nor "SECRET"); "keeps the last data with a
note when a refresh fails" asserts the same for the refresh path.

## Defect 7 — one-day range has no plotted shape (minor)

**Fix.** `stacked-area-chart.component.ts` adds a `singleDayBars` computed:
a one-day range draws a centered 48 px stacked bar
(`data-testid="usage-chart-single-day-bar"`, zero-size segments skipped), the
x label centers on the plot, and the focus marker x is `PAD_L + PLOT_W / 2`
instead of null.

**Test**: "draws a centered bar, x label and focus marker for one day"
(0 area paths, 2 bar rects, centered x, marker at the plot center, readout
"Oct 18 — 5").

## Defect 8 — tests miss the failure paths (minor)

**Fix.** The specs named above cover every gap the review listed: pending and
failed scope changes (defect 1 group), mixed cost labels at total, provider
and day level (defects 2 and 4 groups), unpriced chart days in both cost and
token mode (defect 3 group), invalid and very large chart values (defect 5
group), and the one-day case (defect 7). Two expectations were corrected
during verification: DOM text assertions compare trimmed/joined content (SVG
interpolation adds whitespace), and the zero-cost unknown-day wording needed a
series whose first day is actually zero.

## Verification

Memory-safe commands only (scoped Jest, then one typecheck):

```
npx jest -c libs/frontend/dashboard/jest.config.ts \
  libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.spec.ts \
  libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.spec.ts \
  libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.spec.ts \
  --coverage=false --maxWorkers=1
Test Suites: 3 passed, 3 total
Tests:       65 passed, 65 total
```

```
$env:NX_NO_CLOUD='true'; npx nx typecheck dashboard --parallel=1
NX   Successfully ran target typecheck for project @ptah-extension/dashboard
Run duration:      16.9s
```

## Decisions

1. **Defect 4 — suppress, do not narrow.** Option A (suppress the multiple
   while any in-window cost is unknown) over computing it over only the
   fully-priced subset. Evidence: the review pinned the ratio as invalid; a
   subset multiple invites the same denominator ambiguity the review rejected
   in defect 2. Reversible.
2. **Defect 1 — clear on scope change, keep on refresh.** Matches the
   review's stated fix. A scope change clears the summary (loading state);
   a same-scope refresh keeps it dimmed with the "Updating…" note; a failed
   refresh keeps the last data with a warning note. Reversible.
3. **Defect 6 — fixed message + console.warn.** The repo already uses
   console.warn as the diagnostic channel (builders-card, skill-selection-card
   precedents). No new logging layer was introduced. Reversible.
4. **Defect 3 — generic `unknownDays` chart input.** The chart takes a
   boolean per day, not a cost-specific type, so token mode can flag days
   later without a new input. Token mode currently passes `[]`. Reversible.
5. **Defect 5 — single sanitize boundary, cap 1e15.** One `clean` computed
   keeps every consumer honest; the cap prevents cumulative-stack overflow
   while staying far above any real usage number. Reversible.