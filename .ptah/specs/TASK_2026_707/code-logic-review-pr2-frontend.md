# Code Logic Review — TASK_2026_707 PR 2 Frontend

Review family: codex; implementer family: ptah-cli (Ollama Cloud).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Verdict | REVISE |
| Blocking defects | 0 |
| Major defects | 6 |
| Minor defects | 2 |
| Failure modes found | 8 |

The fold and UI cover the intended happy path, but several valid partial-data and reload paths present a complete-looking or wrong answer. This is a 5 rather than a 3–4 because the core grouping, UTC enumeration, token classes, and request generation guard are implemented and tested; it is not a 7–8 because cost honesty and workspace/range freshness affect the primary display.

## Numbered defects

1. **Major — previous workspace or range data is displayed as current.** `analytics-usage.store.ts:80-105` starts a new request without clearing or tagging `_summary`; `usage-dashboard.component.html:15-17,45-75` updates the selected range but continues rendering the old view model while loading and after a failed refresh. The same happens when the workspace changes through `usage-dashboard.component.ts:100-105`. A user can select 7d or switch workspace and see the old 30d/workspace totals under the new selection, with no loading indication once prior data exists. **Fix:** associate each summary with its requested workspace and range; on scope change hide/clear the old summary until the matching answer arrives. Retain stale data only for a same-scope refresh and label it as such. Test a pending range/workspace load and its failure.

2. **Major — partial cost is presented as a complete total and shares have an ambiguous denominator.** `usage-summary.view-model.ts:410-413,433-439,488,491-508,646-648` excludes null costs from the number but sets `isPartial` only from source statuses. `usage-cost-summary.component.ts:39-56,144-148` then renders `$5.00` and `100% of cost` when priced and unpriced facts coexist with all sources marked complete. The primary total should be a known lower bound and the shares should say they are of *known priced cost*. **Fix:** track unpriced facts at total and row level; mark a positive known total as `≥` when any cost is unknown, label the cost-share denominator, and mark mixed-priced rows as lower bounds. Keep `null` when no cost is known.

3. **Major — the cost chart turns unknown into zero.** `usage-summary.view-model.ts:429-441` initializes each cost day at zero and adds only priced facts; `stacked-area-chart.component.ts:409-426` announces `no usage` for a day whose only fact has unpriced tokens. A user toggling Cost sees a zero area even when actual spend is unknown. **Fix:** carry per-provider/day cost coverage separately from the numeric known lower bound; expose unknown-cost days in the chart and its day aria label/readout, and distinguish `≥ $0` from observed zero. The current token series can remain numeric.

4. **Major — the savings multiple can be mathematically wrong.** `usage-summary.view-model.ts:414-418,488,551-559` requires all savings to be known but does not require all *cost* to be known. The valid fixture in `usage-summary.view-model.spec.ts:265-290` includes an unpriced fact with known savings and asserts a `1.48x` multiple using a `$5` priced subset as denominator while including that fact's savings in the numerator. That ratio is not the multiple for total raw token cost. **Fix:** suppress the multiple whenever any in-window cost is unknown, or compute it only over a matching set of facts with both cost and savings known and label that narrower population.

5. **Major — malformed or overflowing chart numbers invalidate SVG geometry and readouts.** `stacked-area-chart.component.ts:331-345,368-379,409-425` sums arbitrary `values` without finite/nonnegative checks. A `NaN`, negative, or sum beyond finite range makes `yMax`, points, grid labels, or aria text invalid; the component is a public normalized-series input and does not enforce its stated domain. **Fix:** validate or clamp each input at one boundary, reject/report invalid series, and guard cumulative overflow before generating paths, labels, and accessibility text. Test NaN, negative, and very large values.

6. **Major — raw dependency errors reach the UI.** `analytics-usage.store.ts:91-103` copies `result.error` or a thrown `Error.message`; `usage-dashboard.component.html:54-74` renders it verbatim, including after refresh. An RPC/transport error containing a path, token, or internal detail becomes user-visible, contrary to the project's fixed-message error convention. **Fix:** map typed/coded failures to safe fixed UI messages and keep raw details in a protected diagnostic channel. Test an error containing a sensitive marker.

7. **Minor — one-day input has no plotted area or focus marker.** `stacked-area-chart.component.ts:327-328,431-436` returns no geometry or marker for one day although `columns` and the readout are populated at `:396-429,439-462`. **Fix:** draw a single-day point/bar and center the focus marker. Add a one-day component test.

8. **Minor — tests miss the failure paths above.** `usage-dashboard.component.spec.ts:202-216` switches range only after the first response settles; `:404-425` asserts late-response suppression but not what is shown during the new request; `:281-367` covers only two finite positive chart days. `usage-summary.view-model.spec.ts:265-290` actually pins the invalid mixed-cost ratio. **Fix:** add assertions for pending/failed scope changes, mixed cost lower-bound labels, unpriced cost chart days, invalid/large chart values, and the one-day case.

## Five logic questions

1. **How does this fail silently?** A complete source list plus an unpriced fact produces a plain `$5.00` and `100% of cost` (`usage-summary.view-model.ts:410-413,646-648`; `usage-cost-summary.component.ts:39-56,144-148`). A stale prior summary also remains visible during a new scope request (`analytics-usage.store.ts:80-105`).
2. **What user action produces unexpected behaviour?** Selecting another range or changing workspace while a previous result exists shows the previous answer with the new selection (`usage-dashboard.component.ts:100-109`; `usage-dashboard.component.html:15-17,45-75`). Switching to Cost on an unpriced-only day shows zero/no usage (`usage-summary.view-model.ts:429-441`; `stacked-area-chart.component.ts:409-426`).
3. **What input produces a wrong answer?** A valid unpriced fact with known savings produces a false savings multiple (`usage-summary.view-model.ts:551-559`); negative, NaN, or overflowing chart inputs corrupt SVG output (`stacked-area-chart.component.ts:331-345`).
4. **What happens when a dependency fails?** A failed first request gets a retry alert, but its raw error is rendered (`analytics-usage.store.ts:91-103`; `usage-dashboard.component.html:54-64`). A failed reload keeps the last result, which can be for a different range or workspace (`usage-dashboard.component.html:66-75`). Generation and abort do prevent late old responses from overwriting a newer answer (`analytics-usage.store.ts:75-105`).
5. **What is missing from the requirements?** The implementation needs a rule for which scope a retained summary belongs to, a visible representation of unknown cost on the chart, and an explicit denominator for shares when some costs are unknown (`analytics-usage.store.ts:39-45`; `usage-summary.view-model.ts:188-194,236-244`).

## Data flow and coverage

`ClaudeRpcService.call('analytics:usageSummary')` (`analytics-usage.store.ts:85-89`) → generation-guarded store signals (`:90-105`) → pure fold (`usage-summary.view-model.ts:358-657`) → cost/chart/KPI/table/quality children (`usage-dashboard.component.html:87-139`). UTC day enumeration includes empty days (`usage-summary.view-model.ts:110-124,587-599`), and the chart creates a focusable column for each (`stacked-area-chart.component.ts:396-429`). Processed tokens sum all four disjoint classes and cached-input share uses cached read divided by cached read plus uncached input (`usage-summary.view-model.ts:392-409,536-548`). Savings unknown counts and lower bounds are propagated (`:414-418,549-559`), subject to defect 4. Provider accents reuse the existing `providerAccent` function (`usage-summary.view-model.ts:30,499`); no second accent map was added. The chart uses thinned x labels (`stacked-area-chart.component.ts:382-394`), arrow-key day focus (`:475-490`), and reduced-motion CSS (`:165-175`). No `innerHTML` was found in the reviewed components. The Sessions branch still renders its range selector, metrics cards, progressive session list, stats card grid, and modal (`analytics-card.component.html:55-75,109-204`); its state still loads on mount (`analytics-card.component.ts:85-90`).

## Verification and limits

Scoped Jest run: 3 suites, 53 tests passed (`usage-summary.view-model.spec.ts`, `usage-dashboard.component.spec.ts`, `analytics-card.component.spec.ts`). Diagnostics found no errors in the requested implementation files; eight sibling diagnostics remain in `frontend/core` tests, other dashboard specs, and shared code, so this review does not attribute them to PR 2. I read the frontend implementation and RPC contract; this review does not reassess backend fact provenance or actual theme contrast. Existing tests exercise many happy-path behaviors, but none invalidate the eight failure modes above.

## Decisions

- Treat a share of known priced cost as useful only when its denominator is stated and the total is marked as a lower bound. Alternative: hide all cost shares whenever any fact is unpriced. Evidence: the plan requires known lower-bound labeling and the current fold already preserves the priced subtotal (`implementation-plan.md:109`; `usage-summary.view-model.ts:410-413,488`). Reversible: yes.
- Keep a prior summary during a same-scope refresh if it is explicitly marked stale; clear it for a new range or workspace. Alternative: clear for every request. Evidence: the store already retains it and the template has a refresh-failed state (`analytics-usage.store.ts:39-45,80-105`; `usage-dashboard.component.html:66-75`). Reversible: yes.

## Verdict

**REVISE, 5/10.** Fix the major cost-honesty and scope-freshness defects before approval; add targeted failure-path tests. No source files were edited.
