# Code-logic review — PR #787 visual fix (uncommitted batch)

Review family: Glm (Ollama Cloud) reviewing codex

Scope: uncommitted edits in `libs/frontend/dashboard/src/lib/components/usage-dashboard/`
plus `analytics-card/analytics-card.component.html`, worktree
`D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard` (branch
`feat/analytics-dashboard`). New: `stacked-bar-chart.component.ts/.html`,
`stacked-bar-chart.geometry.ts`, `usage-cost-donut.component.ts`,
`usage-cost-donut.geometry.ts`. Deleted: the three `stacked-area-chart.*` files.
Every changed and new file was read in full; `provider-mark.component.ts` and
`usage-formatting.ts` were read to verify contracts the new code consumes.

## Verdict

**APPROVE WITH FIXES — 7/10.** 0 blocking, 0 serious, 2 moderate, 2 minor.

All eight acceptance criteria are implemented and most are pinned by tests. The
two moderate findings sit inside acceptance criteria the batch was asked to
verify (criterion 1 "no overlap", criterion 4 "tiny values"): the provider-mark
fix was applied to the cost summary but not to the breakdown table, and the
tiny-scale cost axis renders duplicate tick labels. The score stays above the
5–6 band because the core data path, the honesty rules ("at least", "unpriced",
"≥"), the donut geometry and the toggle states are all correct and test-pinned;
it stays below the 7–8 band because a named criterion is only partly met.

## Acceptance-criteria verification

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Provider logos ~16–20 px, no overlap | **Partly met** — see defect 1 | `usage-cost-summary.component.ts:78-82` passes `size="sm"`; `provider-mark.component.ts:72-84` renders a 16 px box with a 14 px mark; pinned by `usage-dashboard.component.spec.ts:164`. The breakdown table mark keeps the 32 px box — defect 1. |
| 2 | One "Usage" heading | Pass | The dashboard's own `h3` was removed (diff of `usage-dashboard.component.html`); the single heading renders at `analytics-card.component.html:7-9`. The dashboard's `h4`s are "Daily usage", "Cost share", "Breakdown" — no duplicate. |
| 3 | Axis tick labels >= 11 px | Pass | `stacked-bar-chart.component.html:72,121` set `text-[11px]` on both axes (was 9 px per `visual-review-pr787.md` finding 3). |
| 4 | Nice 1/2/5 ticks, edge cases | **Partly met** — see defect 2 | `stacked-bar-chart.geometry.ts:16-23`: max 0 → step 1; exact-step max 8 → step 2 (top tick 8); huge values capped by `sanitizeSeriesValue` (1e15) and tested at 1e12 (`usage-dashboard.component.spec.ts:576-590`). Tiny values: the algorithm produces a 0.002 step correctly, but the formatter collapses the labels — defect 2. |
| 5 | Daily stacked bars | Pass | One slot per day, `value <= 0` segments skipped (`stacked-bar-chart.component.ts:118-128`), stable provider order (`usage-summary.view-model.ts:180-185,254-264`: cost desc, tokens, id). Cost/Tokens toggle `usage-dashboard.component.html:124-144`. `unknownSeries` aligns with `series` by index: the readout maps `seriesIndex` → `unknownSeries[seriesIndex]?.[i]` (`stacked-bar-chart.component.ts:237-241`) and the parent builds both arrays from the same `vm.providerSeries` in one order (`usage-dashboard.component.ts:82-94`, `usage-dashboard.component.html:151`); "at least $x"/"unpriced" wording verified at `stacked-bar-chart.component.ts:246-250` and pinned end-to-end at `usage-dashboard.component.spec.ts:352-391`. Keyboard focus and arrow keys at `stacked-bar-chart.component.html:127-143` + `stacked-bar-chart.component.ts:275-291`; single-day centered bar at `stacked-bar-chart.component.ts:117` (spec `592-614`); chart `role="img"` + `aria-label` at `stacked-bar-chart.component.html:32-37`. |
| 6 | Cache savings number and wording, pinned | Pass | `(cost + savings) / cost` at `usage-summary.view-model.ts:230-237` gives (3.82+11.05)/3.82 = 3.89 → `toFixed(1)` "3.9"; wording at `usage-kpi-strip.component.ts:120-129` reads "Cost before cache savings: 3.9x raw cost". Pinned by `usage-summary.view-model.spec.ts:54-60` (3.9x) and `usage-dashboard.component.spec.ts:193` (full sentence with 1.4x). The multiple stays `null` unless cost and savings are fully known. |
| 7 | Toggles: selected state + aria | Pass | `btn-active` + `btn-primary` + `aria-pressed` on every toggle: analytics tabs `analytics-card.component.html:19-21,29-31`, session range `64-66`, usage range `usage-dashboard.component.html:14-16`, chart mode `127-129,137-139`, donut mode `usage-cost-donut.component.ts:17-18`, breakdown mode `usage-breakdown-table.component.ts:38-40,48-50`. |
| 8 | Donut | Pass | `buildCostSlices` (`usage-cost-donut.geometry.ts:18-42`) takes only finite, positive, non-null costs; unpriced items return `percent: null` and the template skips their arcs (`usage-cost-donut.component.ts:24-30`) while the legend shows "unpriced", never "$0" (`costLabel`, line 73); the exclusion note renders at line 46-48; the center uses "≥" while `unpricedFactCount > 0` (lines 66-70). Top five + "Other" (spec `usage-summary.view-model.spec.ts:62-71`, percentages sum to 1). Geometry read for the untested cases: one slice → fraction 1 → dash "C 0" (complete ring); zero priced slices → `visible` empty, `total` 0 → `fraction 0`, no NaN path, arcs all skipped, empty ring + legend only; tiny slices → small positive `length`, valid dash. `role="img"` + `aria-label` at line 22; legend rows `tabindex="0"` with `aria-label` at line 36-37. |

Hygiene: no `console.*`, no `: any`/`as any`/`@ts-ignore` in the changed files (grep clean); no mojibake
signatures (grep clean); all source files at or under 300 lines (largest:
`stacked-bar-chart.component.ts` at 293; specs exempt); no references to the deleted
`stacked-area-chart.*` remain anywhere in `libs` (grep clean), so no re-export shims; all new
components are `OnPush` with `signal`/`computed`/`input()`.

## Numbered defects

### 1. Breakdown-table provider marks still render the 32 px box in a 14 px slot — Moderate

`usage-breakdown-table.component.ts:74-77` gives `ptah-provider-mark` the host class
`h-3.5 w-3.5` (14 px) but no `size` input, so the primitive takes its default `'md'`
branch (`provider-mark.component.ts:85-98,110`): a 32 px box holding a 24 px svg.
The host class sizes only the host element; the inner box overflows it. The next flex
sibling (the model display name) starts 14 px + 8 px gap = 22 px from the host's left
edge, while the visible glyph spans roughly 4–28 px of that range — the glyph runs into
the model name by several pixels. This is the same measured mechanism the visual review
rated visual-breaking in the cost summary (`visual-review-pr787.md` finding 1: a 16 px
slot with the same 32 px box produced a 4 px measured text overlap). The batch fixed
only the cost summary (`usage-cost-summary.component.ts:78-82`, `size="sm"` → 16 px
box, 14 px mark). Criterion 1 states "no overlap" without scoping it to one component.

Failure scenario: open the Usage tab, switch the Breakdown table to the Model view;
every model row's provider mark overlaps its model name — the exact defect class this
batch exists to fix.

Fix direction: pass `size="sm"` (the row already sizes the host at 14 px; the `sm`
mark at 14 px fits) and drop the host `h-3.5 w-3.5`, or size the row for the md mark.

### 2. Cost-mode Y-axis tick labels collapse on tiny scales — Moderate

`stacked-bar-chart.component.ts:153-157` labels gridlines with `formatCompactUsd`,
whose formatter has `maximumFractionDigits: 1` (`usage-formatting.ts:15-20`). The tick
algorithm is correct: for a max day total of $0.005 it produces a 0.002 step
(`niceCeiling(0.00125)` → 0.002, `stacked-bar-chart.geometry.ts:16-23`). But at one
fraction digit every tick at or below a tenth of a dollar rounds to the same string:
ticks 0.002/0.004/0.006/0.008 all render "$0.0" (zero renders "$0"/"$0.0"), so all five
Y labels are identical. Up to a max day total of ~$0.2, duplicate labels appear (a
0.05 step renders "$0.1" three times). The user cannot read the axis at exactly the
tiny-value range criterion 4 names. The bars themselves stay proportional and the day
readout still gives exact values, which limits the impact. The tick test does not catch
this because it formats with `String(value)` (`usage-dashboard.component.spec.ts:469,
495-511`); no test runs the real formatter over a tiny scale. Token mode is unaffected
(token counts are integers; a max of 4 tokens yields ticks "0,1,2,3,4").

Failure scenario: a nearly idle workspace whose highest-cost day is under $0.20 (for
example one cheap cache-read day) renders a Y axis whose labels are all "$0".

Fix direction: pick the label formatter from the scale — use `formatUsd` (two
decimals) while the step is below 0.1, and pin it with a test that uses the real
`chartValueFormat`.

### 3. Dead exports in the new geometry files — Minor

`PAD_R` and `PAD_B` (`stacked-bar-chart.geometry.ts:9,11`), `MAX_SERIES_VALUE`
(line 15) and `DONUT_CIRCUMFERENCE` (`usage-cost-donut.geometry.ts:16`) are exported
but consumed only inside their own files; no component, template or spec imports them
(grep across `libs/frontend/dashboard/src` finds no other use). The batch's own rule
list says "no dead exports". Fix: make them module-local.

### 4. Single-day chart aria label reads "1 days from X to X" — Minor

`stacked-bar-chart.component.ts:264-269` builds
`"Daily usage stacked bar chart, ${days.length} days from … to …"` without a
singular branch, and the from/to dates are the same day in the single-day case
the criterion names. Fix: pluralize and collapse the range for `days.length === 1`.

## Not counted as defects

- Multiple chart instances on one page would collide on the `usage-chart-col-N`
  element ids and the `focusColumn` querySelector (`stacked-bar-chart.component.ts:286-291`)
  could focus the wrong chart's column. Only one instance exists in this dashboard;
  the component is not used elsewhere. Worth a prefix if it is ever reused.
- A priced item with `costUsd === 0` appears neither in donut arcs nor in the donut
  legend (`usage-cost-donut.geometry.ts:19-32` filters `> 0` and `=== null`). A
  zero-share item has no arc and no honest percentage, so dropping it is defensible;
  the honesty rules target unpriced ≠ 0, not a true zero. Recorded as accepted.
- Eleven pre-existing diagnostics outside this batch (core mock RPC, two sibling
  specs, shared BigInt) were reported by the implementer and are not introduced by
  this change; not re-verified here.

## The five logic questions

1. **Silent failure:** the two moderates above — the overlap persists where the
   criterion asked for none (defect 1), and distinct tick values render as one
   label so the axis silently under-informs (defect 2). Zero-cost rows silently
   vanish from the donut legend (accepted, above).
2. **Unexpected user action:** toggling Cost/Tokens mid-focus is safe — the readout
   and marker bounds-check `focusedDay` against `days.length`
   (`stacked-bar-chart.component.ts:214-231`), and the day list does not change with
   the mode. Donut Provider/Model toggle only switches the local `mode` signal.
3. **Wrong answer input:** NaN, negative and huge values are sanitized to 0/capped
   (`stacked-bar-chart.geometry.ts:24-26`) and pinned by tests; tiny cost totals are
   the wrong-answer case (defect 2).
4. **Dependency failure:** RPC failures surface a fixed message, stale ranges are
   aborted and cleared, refresh keeps old data marked stale — all pre-existing store
   behavior, covered by `usage-dashboard.component.spec.ts:649-821`; this batch does
   not touch it.
5. **Missing from requirements:** the breakdown-table mark sizing (defect 1) and the
   single-day aria grammar (defect 4).

## Verification basis and residual uncertainty

No test, typecheck, lint, build or e2e was run by this review (forbidden by the task
brief). Evidence is static: full reads of every changed/new file, the two spec files,
`provider-mark.component.ts`, `usage-formatting.ts`, the implementer report
(`batch-pr787-visual-fix.md`) and `visual-review-pr787.md`. The orchestrator's
`nx typecheck dashboard` pass and `nx test dashboard` run (15 suites, 236 tests)
stand as the executed-check evidence; the implementer's own second Jest run had no
recorded completion, but the orchestrator's later full run supersedes it. I did not
and cannot do a visual pass (no image reading); the overlap claim for defect 1 rests
on the same DOM geometry the visual review measured in the summary, not on a fresh
screenshot.

## Decisions

1. **Read criterion 1 as tab-wide, not summary-only.** Options: scope it to the cost
   summary (the implementer's choice) or to every provider mark in the Usage tab.
   Evidence: the review brief states the criterion without a component scope, and the
   visual review's measured overlap mechanism reproduces exactly in the table rows.
   Reversible: yes — pass `size="sm"` in the table.
2. **Locate the tiny-value failure in the formatter, not the algorithm.** The
   `niceCeiling` step math is correct for every named edge; the collapse happens when
   `formatCompactUsd` renders those steps. Fixing the formatter keeps the tested
   algorithm untouched. Reversible: yes.
3. **Accept the donut's drop of zero-cost items.** Options: render a "$0.00 — 0%"
   legend row, or drop it. A zero share has no arc and no honest percentage; the
   honesty contract the dashboard states is about unpriced usage, not true zeros.
   Reversible: yes.
4. **Treat the single-day marker and stacking geometry as verified by read + spec.**
   The centered-bar and marker coordinates are computed in `stacked-bar-chart.component.ts:117,214-221`
   and pinned by `usage-dashboard.component.spec.ts:592-614`; no additional check was run.