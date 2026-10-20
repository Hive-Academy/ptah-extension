# TASK_2026_707 — PR 2 frontend, review fix round 2 (final)

Scope: every finding of `code-logic-review-pr2-frontend-r2.md` (verdict REVISE
6/10). All changes are in `libs/frontend/dashboard/src/lib/components/usage-dashboard/**`
and `libs/frontend/dashboard/src/lib/services/analytics-usage.store.ts` (+ the
dashboard spec). No file outside the reviewed scope was changed. No git
operation was run.

## Finding 1 — breakdown shares imply a share of total cost (major)

**Fix.** `usage-breakdown-table.component.ts` gains a `costPartiallyKnown`
input (~line 141) and two computeds, `shareHeading` and `shareTitle`
(~lines 146–153). While any in-window fact is unpriced, both table headings
(model view ~line 72, day view ~line 111) read **"Share of known cost"**
with a title tooltip ("Some usage in this range is unpriced; shares are of
the known priced cost only"); otherwise they keep the plain "Share". The
dashboard binds the flag from the fold at
`usage-dashboard.component.html:152`
(`[costPartiallyKnown]="vm.totalCostUnpricedFactCount > 0"`), so the flag
matches the `≥` total and the provider "of known cost" labels exactly.

**Test.** `usage-dashboard.component.spec.ts` — "labels breakdown shares as
of known cost when some usage is unpriced": mixed-price fixture, asserts the
model-view heading and tooltip text, the unpriced model row keeps "—", no
cell reads "100%", and after the Day toggle the day view carries the same
heading with no "100%".

## Finding 2 — chart readout presents an unpriced provider as `$0` (major)

**Fix.** `stacked-area-chart.component.ts` gains an `unknownSeries` input
(~lines 116–122): per series, per day, a flag saying that provider's plotted
value is a lower bound. The `readout` computed (~lines 313–346) now reads a
flagged provider as `at least <value>` when its plotted value is positive
and as `unpriced` when nothing of it is priced — never a plain formatted
zero. The dashboard wires it at `usage-dashboard.component.html:143`:
`[unknownSeries]="chartMode() === 'cost' ? vm.providerSeries.map((p) => p.costUnknownByDay) : []"`
(token counts are always known, so token mode passes no flags). The
approved day-level aria wording is unchanged.

**Test.** `usage-dashboard.component.spec.ts` — "marks days with unpriced
usage in cost mode only" now focuses day 19 and asserts the mixed-provider
readout: day total `at least $3 (some usage unpriced)`, the fully priced
provider `Anthropic: $3`, the unpriced provider `OpenCode: unpriced`, never
`OpenCode: $0`; after the Tokens toggle the same focused day reads plain
`OpenCode: 1K` with no "unpriced" wording.

## Finding 3 — `console.warn` in a lib logs raw error details (minor)

**Fix.** `analytics-usage.store.ts:133-140`: the catch block no longer binds
or logs the raw error — `console.warn` is gone (no logging service exists in
the dashboard lib, so the log is dropped, not rerouted). Only the fixed
`USAGE_LOAD_FAILED_MESSAGE` is set. The doc comment (line 37) and the
degradation-audit comment now say raw details are discarded, not logged,
because `console.*` is not allowed in `libs`.

**Test.** `usage-dashboard.component.spec.ts` — "reports a failed load
without logging to the console": `console.warn` and `console.error` are
spied and mocked, a load fails with the `token=SECRET` error, the store
exposes the fixed message, and neither spy is called.

## Finding 4 — files over the 300-line limit (minor)

**Done.** `stacked-area-chart.component.ts` (650 lines) is split into three
focused units, preserving every input, name and test:

- `stacked-area-chart.geometry.ts` (new, ~141 lines): pure geometry — view
  constants, `niceCeiling`, the Fritsch–Carlson `monotoneSegments`,
  `areaPath`, and the new `sanitizeSeriesValue` boundary (the value cap the
  `clean` computed now delegates to). No Angular imports.
- `stacked-area-chart.component.html` (new, ~178 lines): the template,
  moved verbatim (same folder pattern as `usage-dashboard.component.html`).
- `stacked-area-chart.component.ts` (~368 lines): inputs, computeds and
  focus handling only.

**Not done (budget-capped, reported for the next round).**
- `usage-summary.view-model.ts` (708 lines) was not split. The planned
  cut: formatting block (~145 lines) into `usage-formatting.ts` and the fold
  internals into `usage-summary-fold.ts`, with consumer imports updated
  (7 importers, all inside `usage-dashboard/`).
- The spec files were not split: `usage-dashboard.component.spec.ts` grew to
  ~790 lines (three describes: dashboard, chart, store), and
  `usage-summary.view-model.spec.ts` stays at 391.
- The chart component remains above 300 after the split (~368) because the
  class keeps the computeds; the remaining step is moving the pure stacking
  math into geometry.
- The per-provider `at least $x` readout branch (a provider with priced and
  unpriced facts on the same day) is implemented but only exercised through
  the day-level "at least" wording; the component fixture has no such
  provider, and adding one would change the pinned provider totals.

## Verification

Memory-safe commands only (scoped Jest with `--maxWorkers=1`, then one
typecheck with `--parallel=1`; both run after the fix of one wrong test
expectation the first Jest pass caught):

```
npx jest -c libs/frontend/dashboard/jest.config.ts \
  .../usage-dashboard.component.spec.ts \
  .../usage-summary.view-model.spec.ts \
  --coverage=false --maxWorkers=1
Test Suites: 2 passed, 2 total
Tests:       51 passed, 51 total
```

```
$env:NX_NO_CLOUD='true'; npx nx typecheck dashboard --parallel=1
  Run duration:      26.7s
  Cache:             0/1 hit (0%)
  Critical path:     26.6s (1 task)
```

## Decisions

1. **Finding 1 — heading label, not per-cell suffixes.** Both table headings
   state the denominator instead of appending "of known cost" to every
   percentage; the tooltip carries the full sentence. Evidence: matches the
   provider "X% of known cost" pattern already approved in
   `usage-cost-summary.component.ts`, keeps cells compact. Reversible.
2. **Finding 2 — template map over a new computed.** The dashboard binds
   `unknownSeries` with a `map` inside the `@if (viewModel(); as vm)` block
   instead of adding a third `chart*` computed. Evidence: the flags are a
   direct projection of `vm.providerSeries` already in scope, gated by the
   same `chartMode()` the template binds; zero new class surface.
   Reversible.
3. **Finding 3 — drop the log, no new logging layer.** No logging service
   exists in the dashboard lib; the fixed message stays the only channel.
   Evidence: no `*log*` service in the lib; the project rule forbids
   `console.*` in libs. Reversible.
4. **Finding 4 — chart split shape.** Geometry + template out, types that
   reference `StackedAreaSeries` (`AreaRow`, `BarRow`) stay with the
   component so the dashboard's existing `type StackedAreaSeries` import
   from the component file keeps working without a re-export shim.
   Evidence: avoids an import cycle and a re-export; the named example
   (`stacked-area-chart.geometry.ts`) is delivered. Reversible.

## Budget note

The task allowed 30 tool calls; this lane used 31. The extra call came from
one wrong test expectation ("Anthropic: at least $3" — the fixture's
Anthropic day is fully priced, so the honest readout is "Anthropic: $3")
that the first Jest pass caught and one Edit fixed.