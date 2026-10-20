# TASK_2026_707 — PR 2, batch C (frontend): Usage tab in the analytics card

T3-Code-style usage dashboard behind a [Usage | Sessions] tab switch in
`AnalyticsCardComponent`. Usage is the default tab. The dashboard reads
`analytics:usageSummary` through `ClaudeRpcService` only, folds it in a pure
view model, and renders: raw token cost total with provider share rows, daily
stacked area chart (cost/tokens toggle), five KPI tiles, model/day breakdown
table, cost-quality panel, and empty/loading/error states.

## Files changed

Created — `libs/frontend/dashboard/src/lib/components/usage-dashboard/`:

- `usage-summary.view-model.ts` + `usage-summary.view-model.spec.ts` — pure
  fold (days, providers, models, KPIs, quality, chart series) and shared
  formatters; correctness lives in the spec.
- `usage-dashboard.component.ts` + `.html` + `.spec.ts` — smart container:
  header (Usage, date span, 7d/30d/90d, refresh), state branches, layout.
- `stacked-area-chart.component.ts` — presentational in-house SVG chart
  (monotone cubic stacking, thinned labels, focusable day columns).
- `usage-cost-summary.component.ts` — big total, "partial" mark with source
  tooltip, quiet source notes, per-provider accent share bars.
- `usage-kpi-strip.component.ts` — processed/cached/uncached/output/savings.
- `usage-breakdown-table.component.ts` — model/day toggle tables.
- `usage-cost-quality.component.ts` — token shares by cost source.

Created — services:

- `libs/frontend/dashboard/src/lib/services/analytics-usage.store.ts` —
  signals for range/summary/loading/error; one request in flight; generation
  counter + `AbortController` so a stale response is never applied.

Modified:

- `.../analytics-card/analytics-card.component.ts` and `.html` — tab switch
  (default `usage`), `UsageDashboardComponent` import; the whole Sessions
  markup stays in the `@else` branch, unchanged.
- `.../analytics-card/analytics-card.component.spec.ts` — `showSessions()`
  helper keeps every legacy Sessions assertion on the Sessions tab; two new
  tests (opens on Usage with default 30-day request; tab swap).
- `.../services/session-analytics-state.testing.ts` — spec-only usage
  fixtures (`usageFact`, `usageSummary`, `answerUsage`, `analytics:usageSummary`
  in the fake RPC).
- `libs/frontend/dashboard/src/index.ts` — exports `AnalyticsUsageStore`,
  `USAGE_RANGE_OPTIONS`, `UsageDashboardComponent`.

Not touched: `libs/backend/**`, `libs/shared/**`, `apps/**` (other lanes own
them; their working-tree changes in this worktree are not mine).

## Preserve-list check (Sessions tab)

All preserved and covered by the existing card spec, which still passes:

- Date range selection — "keeps the range selector mounted while a new range
  loads" passes.
- Progressive load — "renders the first page of cards before the last page
  arrives" passes.
- `MetricsCardsComponent` — total-cost assertions (`metrics-total-cost`) pass.
- `SessionStatsCardComponent` grid — per-card cost/partial/lower-bound
  assertions pass.
- `SessionDetailModalComponent` — stays mounted outside the tab conditional;
  open/close handlers unchanged.
- Session loading still starts on mount (independent of the active tab), so
  the Sessions tab opens warm.

## Verification

Jest (only the added/changed specs; `--coverage=false --maxWorkers=1`):

```
Test Suites: 3 passed, 3 total
Tests:       48 passed, 48 total
```

Typecheck (once; `NX_NO_CLOUD=true npx nx typecheck dashboard --parallel=1`):

```
NX   Successfully ran target typecheck for project @ptah-extension/dashboard
Run duration:      32.3s
```

## Decisions

- Cache savings KPI renders "—" with the note "Needs per-model cache rates".
  The contract publishes one merged `costUsd` per fact and no per-class rates,
  so savings and the "Nx the raw token cost" multiple are not computable
  frontend-side; the view model returns `null` instead of inventing a number.
  Reversible: one view-model field once the contract carries savings.
- Default range 30 days; default tab Usage. `AnalyticsUsageStore` mirrors the
  staleness pattern of `SessionAnalyticsStateService` (generation counter,
  per-load `AbortController`, stale responses ignored) and this behavior is
  pinned by a store test.
- Provider display names come from a small map plus a title-case fallback
  (fact ids are machine slugs); accent colors are reused from
  `provider-account-card/provider-accent` — no second accent map.
- Unpriced facts render "—" for cost, contribute 0 to the cost chart series,
  and still count toward tokens and the unpriced quality share. Shares are
  `null` (rendered "—"), never 0, when the denominator is unknown.
- `vm.range` is set only when the enumerated window is exactly 7, 30 or 90
  days; any other window length is a `null` range, not a wrong label.
- Small presentational components use inline templates (matches the existing
  `metrics-cards` precedent); the smart container keeps a `templateUrl`.
- The chart is a single static SVG per state: Fritsch–Carlson monotone curves
  (no overshoot), `niceCeiling` gridlines, thinned x labels, one focusable
  column per day with a full aria-label, arrow-key focus movement, and the
  only motion (marker fade) is disabled under `prefers-reduced-motion`.

## Clarifications Needed

1. Cache savings are not computable from the settled contract. Ask the
   backend lane to add either a summary-level
   `cacheSavingsUsd: number | null` (plus `savingsMultiple` or
   `fullInputCostUsd` to derive it) or per-fact savings. Options:
   (a) summary-level `cacheSavingsUsd` + `savingsMultiple` (recommended — one
   field pair, no schema churn per fact); (b) per-fact `cacheSavingsUsd`.
   Evidence: `UsageFact` in `rpc-analytics.types.ts` carries a single merged
   `costUsd` and no per-class rates, so the frontend cannot decompose it.
   Until it lands, the tile honestly shows "—".