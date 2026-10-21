# PR #787 Electron usage visual fix

## Changes by criterion

| Criterion | Change and evidence | Verification |
| --- | --- | --- |
| 1. Provider marks | `usage-cost-summary.component.ts:74` passes the existing `size="sm"` input, so the primitive renders a 16 px box instead of its default 32 px box. | Dashboard spec asserts the small size. |
| 2. Duplicate heading | `usage-dashboard.component.html:3` leaves the date span and controls under the single card heading at `analytics-card.component.html:7`. | Existing dashboard render spec passes. |
| 3. Axes | `stacked-bar-chart.component.html:72,121` uses 11 px text and 80% opacity on both axes. | Chart spec checks labels; Electron appearance still needs a visual pass. |
| 4. Nice ticks | `stacked-bar-chart.component.ts:112,153` derives the bar scale and four grid steps from the same 1/2/5 ceiling in `stacked-bar-chart.geometry.ts:17`. | Chart spec expects 0, 2, 4, 6, 8 for a six-unit maximum. |
| 5. Daily stacked bars | `stacked-bar-chart.component.ts:107` builds one slot per day and skips zero segments; `stacked-bar-chart.component.html:77` draws SVG rects. The area component, template, and geometry were renamed without compatibility shims. Existing focus, keyboard, aria, hover, hatch, cost/tokens, and single-day behavior remain. | Chart specs cover four segments over two days, sparse zero day, focus, unpriced readout, sanitization, and one day. |
| 6. Cache multiple | `usage-kpi-strip.component.ts:123` now calls the existing `(cost + savings) / cost` result “Cost before cache savings … x raw cost.” | View-model spec uses $11.05 savings and $3.82 cost and expects 3.9x; dashboard spec checks wording. |
| 7. Selected toggles | `usage-dashboard.component.html:15,128,138`, `usage-breakdown-table.component.ts:39,49`, `analytics-card.component.html:20,30,65`, and `usage-cost-donut.component.ts:17` add selected `btn-primary` color to the existing `btn-active` and `aria-pressed` state. | Existing toggle specs and donut toggle assertion pass. |
| 8. Donut | `usage-cost-donut.component.ts:9` adds the in-house SVG, Provider/Model toggle, centered total, accessible SVG summary and focusable legend. `usage-cost-donut.geometry.ts:18` groups after five slices and excludes unknown cost from arcs. `usage-dashboard.component.html:111` places it under the cost summary. | Geometry spec checks top-five plus Other, percentages, and unpriced exclusion; dashboard spec checks SVG, label, arcs, and Model toggle. |

## Verification

- Permitted command: `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/usage-dashboard --coverage=false --maxWorkers=1`.
- Jest tail: `Test Suites: 2 passed, 2 total`; `Tests: 54 passed, 54 total`; `Snapshots: 0 total`; `Time: 13.07 s`.
- A second run after the final axis-scale adjustment was started, but its completion was unavailable at report time. The first run passed before that adjustment and the selected-button class additions.
- Scoped `ptah_get_diagnostics` reports no diagnostics in changed TypeScript files. It also reports 11 pre-existing sibling errors outside this batch (core mock RPC, two other dashboard specs, and shared BigInt target errors).
- UTF-8 text check found no mojibake signatures in changed files. No Electron visual session was run under the task's command restrictions.

## File line counts

| File | Lines |
| --- | ---: |
| `stacked-bar-chart.component.ts` | 293 |
| `stacked-bar-chart.component.html` | 175 |
| `stacked-bar-chart.geometry.ts` | 28 |
| `usage-cost-donut.component.ts` | 77 |
| `usage-cost-donut.geometry.ts` | 43 |
| `usage-dashboard.component.ts` | 130 |
| `usage-dashboard.component.html` | 169 |
| `usage-cost-summary.component.ts` | 185 |
| `usage-kpi-strip.component.ts` | 131 |
| `usage-breakdown-table.component.ts` | 181 |
| `usage-summary.view-model.ts` | 291 |
| `usage-dashboard.component.spec.ts` | 822 |
| `usage-summary.view-model.spec.ts` | 402 |
| `analytics-card.component.html` | 209 |

## Decisions

1. Keep the established savings formula and clarify its label. Options were changing the formula to savings divided by cost, or describing the existing total-before-savings ratio. The latter preserves the already-tested calculation and makes $11.05/$3.82 read consistently as 3.9x before savings. Reversible: yes.
2. Use DaisyUI `btn-primary` with existing `btn-active` for selected controls. Nearby controls already used `join` and `btn-active`; the additional fill makes the state clearer in both themes while retaining `aria-pressed`. Reversible: yes.
3. Draw only positive daily bar segments; retain focus targets on zero days. This follows the chart's day-by-day accessibility behavior without visually fabricating usage. Reversible: yes.

## Not done

- No Electron screenshot comparison was possible within the permitted verification commands.
- The later Jest run had not returned a completion result when this report was written; the earlier 54-test run passed.
