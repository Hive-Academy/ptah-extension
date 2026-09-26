# Code Logic Review — `TASK_2026_494` Batch 4

Scope: `libs/frontend/declarative-dashboard/src/lib/table/table-rows.ts` (+ spec),
`libs/frontend/declarative-dashboard/src/lib/charts/chart-geometry.ts` (+ spec),
`libs/frontend/declarative-dashboard/src/lib/components/dashboard-chart.component.ts` (+ spec).
Read in full, together with `batches.md` Batch 4, `implementation-plan.md:258-261` (D5) and `:776-786`,
`task-description.md` Req 4.1/4.4/5.1-5.3/7.1-7.6, `batch-4-report.md`, and `prototype/index.html:178-271`.
`npx nx run-many -t test -p @ptah-extension/declarative-dashboard --skip-nx-cache` re-run: green.
`ptah_get_diagnostics` on the three source files: 0 errors, 0 warnings.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 7/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 3                                    |
| Failure modes found | 3                                    |

## Five logic questions

### 1. How does this fail silently?

- `tableRows` no-ops a sort whose `columnKey` does not match any `node.columns[].key`: `column = node.columns.findIndex(...)`
  is `-1`, the `if (state.sort && column >= 0)` guard (`table-rows.ts:37`) skips sorting, and the caller gets the
  filtered-but-unsorted rows back with no indication the requested sort was ignored. A caller passing a stale or
  renamed column key (e.g. after a spec update changes column keys but view state persists) gets a plausible-looking
  but silently wrong order. Low likelihood, not covered by a spec.
- `nextTableSort` returning `undefined` for "back to original" is by design (`table-rows.ts:19`, tested), not a
  silent failure — flagged only so it isn't mistaken for one.

### 2. What user action produces unexpected behaviour?

- Selecting a chart point on a table page beyond page 0 after a live data update that shrinks the series: `page()`
  (`dashboard-chart.component.ts:104`) clamps immediately via `pageSlice`, so the rendered page always matches the
  current data — no crash — but the parent's stored `viewState.page` value is not corrected until the user clicks
  Previous/Next again (`toggleTable`/`setPage` only emit on click, `dashboard-chart.component.ts:107-110`). This is
  consistent with the controlled-input pattern the plan specifies ("parent feeds state back"); the display never goes
  wrong, only the persisted page number is briefly stale relative to what is shown. Not a defect, noted for the B12/B15
  consumer that owns the round trip.
- Clicking "Show as table" then paging, then clicking "Show as chart" and back: `viewState` is round-tripped
  unchanged (`chartAsTable` and `page` both persist in the same object spread), so the table returns to the same page
  — correct per the component's own contract, verified by the toggle spec (`dashboard-chart.component.spec.ts:28-40`).

### 3. What input data produces a wrong answer?

- **Mixed number/string values in one table column** (`table-rows.ts:36-46`). The comparator only takes the numeric
  branch when *both* cells being compared are `typeof 'number'`; otherwise it falls back to
  `cellText(left).localeCompare(cellText(right))`. `DashboardTableCell` is `string | number | boolean | null`
  per-cell with no column-level type constraint (`dashboard-spec.types.ts:115`, `DashboardTableCellSchema` at
  `dashboard-spec.schemas.ts:185-190` validates each cell independently). For a column holding `[2, "9", 10]`:
  `compare(2, "9")` takes the string path ("2" < "9" ⇒ 2 first, correct by luck), `compare("9", 10)` also takes the
  string path ("9" > "10" lexically ⇒ 10 sorts before "9"), `compare(2, 10)` takes the numeric path (2 < 10). The
  resulting ascending order is `2, 10, "9"` — a column that is "mostly numeric" with one string cell (a very
  plausible producer pattern, e.g. `"N/A"` mixed with amounts) sorts numbers greater than 9 ahead of that string
  even though the visual expectation is a single consistent order. No spec exercises a column with mixed cell types.
- **Duplicate `x` within the same series** on either chart kind (`chart-geometry.ts:20-21,40-45`). `categoryIndex`
  is built from the set of x-values across *all* series, so two points in the *same* series sharing an `x` map to
  the same `category`, hence the same `px`/`barX`. For a bar chart this draws two bars for one series at the exact
  same x slot (one hides the other); for a categorical line chart it produces two `ChartPoint`s at the same `px`,
  visually collapsing to one polyline vertex. The producer contract does not forbid duplicate x within one series,
  and no spec exercises it.

### 4. What happens when a dependency fails?

- Pure modules (`table-rows.ts`, `chart-geometry.ts`) have no I/O or external dependency; they cannot fail from a
  transport or host error, only from malformed input, which is the upstream view-model builder's contract (per the
  plan, "a view-model build failure gives `renderFailed` and an empty subtree" — outside this batch's files).
- `DashboardChartComponent` has no RPC, timer or subscription of its own; the toggle/select/page handlers are
  synchronous `output.emit()` calls with no failure path to swallow. The component text confirms zero
  `ClaudeRpcService`/`VSCodeService` calls are reachable from any control here (Req 7.3's "client-only" contract),
  consistent with the report's "no chart dependency" claim.

### 5. What is missing that the requirements never mentioned?

- The plan and task description do not say what should happen when a table column's cells are not all the same
  type, or when a series contains duplicate x-values — both are plausible producer outputs the contracts do not
  forbid, and both degrade silently rather than erroring (see Q3). Neither is a stated acceptance criterion, so this
  is a gap in the requirements rather than a violation of one.
- Nothing in Batch 4 marks a barrel/index export for these three modules — matches the report's explicit statement
  that "index/barrel exports were intentionally left for the owning later batch" and the plan's D-4 sequencing; not a
  defect here.

## Failure modes

### Non-transitive table sort comparator on mixed-type columns

- Trigger: a table column whose cells mix `number` and `string` (or `boolean`) values.
- Symptom: rows render in an order that looks locally sensible pairwise but is not a consistent total numeric order
  (numbers past single digits can sort behind a string cell that numerically should follow them).
- Evidence: `table-rows.ts:42-44` (`typeof left === 'number' && typeof right === 'number' ? numeric : localeCompare`).
- Current handling: falls back to string comparison for any pair where either side is not a number; no column-level
  type normalization or coercion.
- Recommendation: either coerce numeric-looking strings before comparing, or accept as a known limitation given
  `DashboardTableCell` permits heterogeneous columns — if accepted, note it near the comparator so a future reader
  does not assume it is a total numeric order.

### Duplicate x collapses points/bars within one series

- Trigger: a `DashboardSeries` whose `points` array repeats the same `x` value.
- Symptom: for `bar-chart`, two bars for the same series render fully overlapping at the same `barX`; for a
  categorical `line-chart`, two vertices share the same `px`, visually merging into one point on the polyline.
- Evidence: `chart-geometry.ts:20-21` (`categories`/`categoryIndex` built once, shared across all series and all of
  a series' own points), used at `:40-45` for both `px` (line) and `barX` (bar).
- Current handling: none; no dedup, no warning.
- Recommendation: if the producer contract truly forbids duplicate x within a series, note that assumption at the
  top of `chartGeometry`; otherwise disambiguate duplicate x with a stable per-occurrence offset.

### Silent no-op on stale/unknown sort column key

- Trigger: `state.sort.columnKey` does not match any `node.columns[].key`.
- Symptom: rows are filtered but left in original (index) order with no signal that the requested sort was ignored.
- Evidence: `table-rows.ts:36-37`.
- Current handling: guarded no-op, returns unsorted-but-filtered rows.
- Recommendation: acceptable as defensive behaviour (never throws, matches Req/plan "pure, never throws" pattern used
  elsewhere in this task); flagged only as a residual gap in observability, not a required fix.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: non-transitive sort comparator for mixed-type table columns — `table-rows.ts:42-44` (see Failure modes).
- Moderate: duplicate x within one series overlaps chart geometry — `chart-geometry.ts:20-21,40-45` (see Failure
  modes).
- Moderate/fidelity: the implementation encodes every series in `currentColor` with unfilled (`fill="none"`) bars and
  stroke-dasharray patterns plus a text legend and `svg:title` per series/point (`dashboard-chart.component.ts:61-90`),
  while the approved prototype additionally colours series with `--brand-primary`/`--brand-secondary` hue via
  `chart-series-a`/`chart-series-b` classes and fills bars solid, using pattern only as a *secondary* cue
  (`prototype/index.html:200-202,239-249`, `prototype/assets/app.css:272-273`). Task-description Req 7.4
  ("...each series shall carry a direct label or a pattern, not hue alone") is satisfied literally — the
  implementation gives both a direct label (legend text, `svg:title`) and a pattern (dasharray), so hue is not
  required for the requirement to hold, and CSP-safe hue is achievable without a `style` attribute (e.g. daisyUI
  `stroke-*`/`fill-*` utility classes plus a uniquely-`id`'d `<pattern>` for a hatched fill) if the team wants closer
  prototype fidelity. This is not a requirement violation; it is a fidelity gap that the plan itself defers — Batch 4
  is a pure-component batch, and R10's rendered visual-evidence gate runs after Batch 17/20 against the full Apps
  page, not per sub-component. Recommend the team-leader carry this forward explicitly as a decision point for that
  visual-review gate (adopt hue via utility classes for closer fidelity, or formally accept pattern-only and update
  the prototype note) rather than treating it as resolved by this batch.
- Minor: silent no-op on unmatched sort column key — `table-rows.ts:36-37` (see Failure modes), no spec exercises it.
- Minor: the bar-chart legend swatch (`<svg><line .../></svg>`, `dashboard-chart.component.ts:85-86`) renders a line
  glyph even when the chart itself is drawing rectangles; cosmetically inconsistent with the rendered shape, not a
  behavioural defect.

## Data flow

1. `DashboardSeries[]` (validated upstream, out of scope) → `chartGeometry(series, kind)` computes shared category
   index, min/max bounds and per-point `px`/`py`/`barX/Y/W/H` in one pass — OK, guarded for empty/singleton/extreme
   values and 5,000-point volume (tests confirm `Number.isFinite` on every coordinate and `O(n)` output).
2. `DashboardChartComponent.geometry` (a `computed()`) wraps `chartGeometry` with `node().series ?? []` — OK, safe
   against a `data`-reference node where `series` is absent (the template's `@if (node().data)` branch pre-empts
   the chart/table render path entirely so `geometry()`/`page()` are never read in that branch).
3. Chart SVG render: `currentColor` stroke/fill attributes plus `stroke-dasharray`, no `style` attribute or element
   anywhere in the template — OK, confirmed by `element.querySelector('style, [style]')` returning null in the spec
   and by direct source read.
3b. Table view: `page = computed(() => pageSlice(geometry().rows, viewState().page))` — OK, re-slices to at most 25
   rows regardless of stored page validity (clamped in `pageSlice`).
4. User toggles/pages/selects → component reads `this.viewState()`/`this.selection()` fresh each call and emits a
   new object via `viewStateChange`/`selectionChange` — OK for the documented controlled-component contract (parent
   must feed the emitted state back into the `viewState`/`selection` inputs); this batch does not include that
   parent, so the round trip itself is unverified here and is the consuming batch's responsibility.
5. `selectPoint` re-checks `node().selectable` before emitting even though the calling button only renders under the
   same condition — OK, defence in depth confirmed by the spec that flips `selectable` to `false` after render and
   asserts no further `selectionChange` emission (`dashboard-chart.component.spec.ts:61-63`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 4.1 (line/bar charts, numeric + categorical x, signed y) | COMPLETE | Duplicate-x-within-series edge case not handled or tested (Moderate) |
| Req 4.4 (data-reference notice with rowCount) | COMPLETE | none |
| Req 5.1 (sort cycle asc/desc/original, stable, no mutation) | COMPLETE | Sort comparator not a consistent total order for mixed-type columns (Moderate) |
| Req 5.2 (filter visible text only, case-insensitive) | COMPLETE | none |
| Req 5.3 (page size 25, clamped, native Previous/Next) | COMPLETE | none |
| Req 7.3 (chart/table toggle, aria-pressed, client-only) | COMPLETE | none |
| Req 7.4 (label or pattern, not hue alone) | COMPLETE | Satisfied literally; prototype additionally uses hue, implementation does not (fidelity note, not a requirement gap) |
| Selection only via paged chart-table buttons, selectable-only | COMPLETE | none |
| CSP: attributes only, no style | COMPLETE | none |
| No `text-base-content/NN` alpha utilities | COMPLETE | none |

Implicit requirements not addressed: sort/comparison behaviour for heterogeneous column cell types; chart geometry
behaviour for duplicate x values within one series. Neither is named in task-description.md or the plan.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty series/points | YES | guarded `xs.length ? ... : 0`, `Math.min(0, ...)`/`Math.max(0, ...)` base case | none |
| Singleton point | YES | `min===max` → `ratio` returns `0.5` (`chart-geometry.ts:31`) | none |
| 5,000 points | YES | polylines only, tested `<20` SVG descendants, all coords finite | none |
| Extreme finite values (`Number.MAX_VALUE`) | YES | scale-first `ratio` avoids overflow, tested | none |
| Negative values + baseline | YES | `Math.min(0, ...)`/`Math.max(0, ...)` keep 0 in range; `barY`/`barHeight` computed from baseline | none |
| Mixed numeric/categorical x on a line chart | YES | falls back to categorical bucketing when not every x is numeric | no dedicated spec for the mixed case, only all-numeric and all-categorical are tested |
| Numeric x on a bar chart | YES | always categorical-bucketed regardless of kind | no dedicated spec with numeric x on a bar chart |
| Duplicate x within one series | NO | same category/px/barX reused, points overlap | Moderate (see Failure modes) |
| Duplicate x across series | YES | intentional — same category aligns bars/points for grouped comparison | none, this is by design and tested |
| Mixed number/string cells in a sort column | NO | comparator not a consistent total order | Moderate (see Failure modes) |
| Filter with empty query | YES | `|| !query` fallback plus every string trivially includes `''` | none |
| Sort with unknown column key | YES (no-op) | guarded `column >= 0` check | silent, no signal to caller (Minor) |
| Page index NaN/negative/overshoot | YES | `Number.isFinite` guard + `Math.min`/`Math.max` clamp, tested | none |
| Selection on non-selectable node | YES | template hides the control; `selectPoint` re-guards | none |
| Selection index stability across pages | YES | `seriesIndex`/`pointIndex` carried on the row object itself, independent of page slice | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the table sort comparator is not a consistent total order once a column mixes cell types, which is
  legal per `DashboardTableCell` and unguarded by any schema-level column-type constraint — low probability given
  typical dashboard producers, but a real wrong-answer path if it occurs.
- What a robust implementation would add: a documented (or enforced) column-type-homogeneity assumption for sort;
  an explicit decision (accept or dedupe) for duplicate-x points within one series; a spec exercising a mixed
  numeric/categorical series and a numeric-x bar chart to lock in the intended fallback behaviour.

## Fix round 1 re-check

Scope: the delta only, per `batch-4-fix-1-report.md` — `dashboard-chart.component.ts` (+ spec), `table-rows.ts`
(+ spec), `chart-geometry.spec.ts` (no production change). Full files re-read, not diffed blind. Re-ran
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache` (lint, typecheck,
test all green) and `ptah_get_diagnostics` on both changed source files (0 errors, 0 warnings). The prior APPROVE
for the rest of the batch stands; this section covers only what changed.

### CSP: still attribute/class only, no style

Confirmed. The new hue encoding uses static Tailwind/daisyUI utility class names (`SERIES_STROKES`/`SERIES_FILLS`,
`dashboard-chart.component.ts:11-12`) bound via `[attr.class]`, never `[style]`/`style=`. `barFill()`
(`:137`) returns either `null` (attribute removed, series 0 relies on the `fill-primary` class) or a `url(#id)`
string bound via `[attr.fill]` — both are plain SVG attribute values, not CSS. Axis text now also carries
`class="text-base-content-muted"` (`:79-84`) instead of a bare `fill="currentColor"` only — still a class, not an
alpha-suffixed utility, so the "no `text-base-content/NN`" rule (review point e) still holds; `text-base-content-muted`
is the pre-existing non-alpha muted-text token used elsewhere in this lib (matches `dashboard-chart.component.ts:15`'s
own `text-base-content` pattern). The `element.querySelector('style, [style]')` assertion is retained and extended
across the new specs (`dashboard-chart.component.spec.ts:32,94`) and passes.

### Pattern ids: unique per instance, `url(#id)` resolves inside the component

Confirmed. `instanceId = nextChartInstance++` is assigned once per component instance at field-initializer time
(`dashboard-chart.component.ts:10,122`), a module-level monotonic counter, so two mounted `DashboardChartComponent`
instances rendering nodes with the *same* `node.id` still get distinct `patternId()` values
(`ptah-chart-{instanceId}-hatch-{index}`, `:133`). The new two-instance spec
(`dashboard-chart.component.spec.ts:96-115`) mounts both components under one shared `document.body` container (the
scenario that actually matters — SVG `id` collisions are a document-global problem, not a per-fixture one — jsdom
does not auto-isolate `id`s across fixtures) and asserts `patterns[0].id !== patterns[1].id`,
`document.getElementById(id)` resolves to the right `<pattern>`, and each instance's bars reference their own
pattern via `url(#id)`. `<defs>` lives inside the same `<svg>` as the `<rect>` consumers
(`:66-76` inside `:62`'s `<svg>`), so the fragment reference is same-document and resolves correctly; this also
matches the fix report's claim. The counter is a plain incrementing number with no reset/dispose path, which is
technically unbounded over a session's lifetime, but at one increment per chart-component construction it would
take longer than any realistic session to matter — not a practical resource-growth concern.

### Descending order, stable tie-break, null-last semantics

Comparator (`table-rows.ts:16-22`): `rank()` maps `null`/`''` → 2, `number` → 0, everything else (nonempty
string/boolean) → 1; a nonzero rank difference decides the comparison outright; same-rank numbers compare
numerically; same-rank non-numbers compare via `cellText(...).localeCompare(...)`. The sort call
(`:46-53`) multiplies the full `compareCells` result (rank difference included) by `direction`, and the tie-break
`a.originalIndex - b.originalIndex` is added unconditionally afterward, never multiplied by `direction`.

- Originalindex tie-break stable in both directions: confirmed. Numeric ties (`2` at original index 2 and 7 in the
  new spec) sort `2` before `7` in *both* ascending and descending output (`table-rows.spec.ts:22-23`:
  `asc` ends `...,3,4`, `desc` ends `...,0,2,7` — 2 precedes 7 even though the run is descending), because the
  tie-break is never sign-flipped. This is exactly the "originalIndex remains the stable tie-break in both
  directions" claim in the fix report, and it holds.
- Descending reverses correctly: confirmed for the numeric/text values — ascending group order (numbers, then
  text/booleans) inverts to (text/booleans, then numbers) in descending, and within each group the intra-group
  comparison sign also flips, matching a textbook `direction`-multiplied comparator.
- "Null-last in both directions" — **does not hold literally**, and the evidence shows why: because `rank`
  is folded into the same value that gets multiplied by `direction`, descending does not keep nulls pinned to the
  bottom — it *mirrors the whole ascending order*, so nulls (`rank` 2, the highest rank) move to the **front** in
  descending. The new spec's own expected value confirms this: ascending ends with the null/empty pair
  (`table-rows.spec.ts:22`, `...,3,4]`), while descending *starts* with them (`:23`, `[3,4,8,...]`). This is
  internally consistent (full mirror of ascending, a common and defensible convention — many sort UIs work this way
  by design) and it is what the fix report itself describes ("Descending reverses this order"), not a
  contradiction of the report's own claim. But it is not "nulls always sort last regardless of direction," which
  is the other common convention and the more literal reading of "null-last semantics hold in both directions."
  Task-description.md's Req 5.1 acceptance criteria (`task-description.md:123`) only require ascending → descending
  → original cycling and `aria-sort` reflecting state; it does not specify where nulls land in a descending sort,
  so this is not a requirements violation. Flagging as a **Minor / clarification note**: the doc comment at
  `table-rows.ts:15` ("Ascending groups: numbers, nonempty text/booleans, then null/empty") describes only the
  ascending case and should be read as "mirrored under descending," not "descending keeps nulls at the bottom" —
  worth a one-line comment addition so a future reader does not assume unconditional null-last, but not a defect.

### Regressions

None found. The previously-flagged Moderate item **not** in this fix's scope — duplicate `x` within one series
colliding in `chartGeometry`'s shared `categoryIndex` (`chart-geometry.ts:20-21,40-45`, unchanged by this round) —
still stands as carried-forward, non-blocking. The two new `chart-geometry.spec.ts` cases (mixed numeric/categorical
line x, numeric bar x) both confirm the categorical-fallback behaviour is intentional and correctly computed
(`chart-geometry.spec.ts:4-15`), closing the "no dedicated spec" gap noted for those two rows in the original Edge
cases table; that table's "Mixed numeric/categorical x" and "Numeric x on a bar chart" rows should now read
"covered" rather than "no dedicated spec."

### Fix round 1 verdict

- Recommendation: APPROVE
- Score: 8/10 (up from 7/10 — both fix-scoped findings resolved with evidence and new tests; CSP and pattern-id
  uniqueness hold; the sole open item is the pre-existing, out-of-scope duplicate-x geometry note, still Moderate
  and non-blocking)
- Confidence: HIGH
- Residual note (non-blocking): document that descending sort mirrors nulls to the front rather than keeping them
  pinned to the bottom, so a future reader of `table-rows.ts:15`'s doc comment does not assume otherwise.
