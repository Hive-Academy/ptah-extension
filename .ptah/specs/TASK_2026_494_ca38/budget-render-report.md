# Budget confirmation report — TASK_2026_494 Req 8 / Task 9.1

Source: `libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts`. Every case below is:

1. built AT (not over) its provisional limit;
2. accepted by `validateDashboardSpec` (v1) or `validateSurfaceDocument` (v2);
3. rendered through the real `SurfaceRendererComponent` (default `SURFACE_VIEW_MODEL_BUILDER`, no override), asserted to emit no `renderFailed`;
4. timed with jsdom `performance.now()` around `fixture.detectChanges()`.

Run: `npx nx test declarative-dashboard --skip-nx-cache --testPathPattern=budget-render --verbose` (2026-09-25). All 13 cases below passed; the full project run was 213/213 green (17 suites).

## A4 — jsdom timing caveat

jsdom has no layout, paint, compositing or GPU cost. `jsdomMs` is therefore a **relative signal only**: evidence that no case is pathologically slower than its neighbours in this same jsdom process, not a prediction of Electron wall-clock render time. The first case in a fresh `jest` worker (`v1 maxComponents=200`, 1175.01 ms) includes one-time Angular/Ivy JIT and DI-graph warm-up cost that later cases in the same worker do not pay — visible from every later case, including the same 200-component-class case shape re-touched by `maxSurfaceBytes` (343.85 ms for 150 stat components plus a 64 KiB data model), dropping by more than 3x once the JIT/DI paths are warm. No manual Electron run was taken for this batch; if one is taken later, its number goes in a new column here rather than replacing the jsdom figures.

## Results

### v1 (provisional `DASHBOARD_LIMITS`, `dashboard-catalog.ts`)

| Limit | Value | Fixture | Accepted? | Rendered, no `renderFailed`? | jsdom ms |
| --- | ---: | --- | :---: | :---: | ---: |
| `maxComponents` | 200 | `makeStatPairs(200)` (2-level tree, tree-wide count) | yes | yes | 1175.01 |
| `maxTreeDepth` | 8 | `makeNestedStats(8)` (single chain, 8 levels) | yes | yes | 22.84 |
| `maxTableRows` | 1,000 | `makeTable(1000, 2)` | yes | yes | 23.00 |
| `maxTableColumns` | 50 | `makeTable(1, 50)` | yes | yes | 22.80 |
| `maxSeriesPoints` | 5,000 | `makeChart([2500, 2500])` (summed across 2 series) | yes | yes | 19.87 |
| `maxSpecBytes` | 262,144 (256 KiB) | `makeDashboardSpecOfExactBytes(262144)` | yes | yes | 11.74 |

### v2 (provisional `SURFACE_LIMITS`, `surface-catalog.ts`)

| Limit | Value | Fixture | Accepted? | Rendered, no `renderFailed`? | jsdom ms |
| --- | ---: | --- | :---: | :---: | ---: |
| `maxInputs` | 100 | 100 `text` inputs, distinct ids/paths | yes | yes | 225.47 |
| `maxOptions` (select) | 50 | one `select` with 50 options | yes | yes | 12.06 |
| `maxOptions` (radio-group) | 50 | one `radio-group` with 50 options | yes | yes | 21.08 |
| `maxChildrenPerNode` | 50 | one `stack` with 50 `stat` children | yes | yes | 159.65 |
| `maxGridColumns` | 4 | one `grid` (`columns: 4`) with 4 `stat` children | yes | yes | 13.72 |
| `maxDataModelBytes` | 65,536 (64 KiB) | 1 `stat` component; `dataModel` padded to exactly 64 KiB | yes | yes | 5.35 |
| `maxSurfaceBytes` | 262,144 (256 KiB) | 150 `stat` components (padded titles) + a 64 KiB `dataModel`, combined to exactly 256 KiB | yes | yes | 343.85 |

`maxOptions` is one budget in `SURFACE_LIMITS` (`50`); it is exercised twice above — once on a `select`, once on a `radio-group` — per Req 8 / implementation-plan.md "Budget confirmation".

`maxStringLength` (shared between `DASHBOARD_LIMITS` and `SURFACE_LIMITS`) is not a `budget-render.spec.ts` case: it is pinned at the validator boundary (`dashboard-budgets.spec.ts`, `surface-budgets.spec.ts`), not the render boundary, and Req 8's acceptance criterion 1 does not name it. `SURFACE_STORE_LIMITS` and the remaining `SURFACE_LIMITS` entries not listed above (`maxActionsPerComponent`, the id/path-grammar limits, the data-model shape limits, `maxUpdateRequestBytes`, `maxPatchOps`, `maxRpcRequestBytes`, `maxSubmitMessageBytes`, `maxStateReadBytes`, the write-log limits) are out of scope for this render test for the same reason — they stay PROVISIONAL.

## Constants changed

None. All 13 cases rendered without `renderFailed`, and no jsdom timing indicated a case that needed a smaller budget. `DASHBOARD_LIMITS` and `SURFACE_LIMITS` are unchanged from their pre-existing values; only their doc comments changed, to record which entries are now confirmed and by which test.

## Verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard @ptah-extension/shared --skip-nx-cache` — 6/6 targets green.
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit` — exit 0.
- `surface-budgets.spec.ts` and `dashboard-budgets.spec.ts` (`libs/shared`) — unchanged, part of the green `@ptah-extension/shared:test` run above.

## Follow-up: DOM-count assertions (code-logic-review-batch-9.md, Moderate-1)

The review found that `runCase` asserted only `renderFailed === false`, which `attemptBuild`
(`surface-renderer.component.ts:112-119`) treats as satisfied by an empty `components: []` array —
a silent "dropped every node" regression would still read as a pass. Seven of the count-shaped
cases now also assert the actual rendered count through the DOM, via the same
`data-apps-focus-key` / `querySelectorAll` pattern `surface-renderer.component.spec.ts:87-100`
already uses:

| Case | New assertion |
| --- | --- |
| v1 `maxComponents` = 200 | `[data-apps-focus-key$=":expand"]` (one per rendered `DashboardStatComponent`) has length 200 |
| v1 `maxTableRows` = 1,000 | `tbody tr` has length `SURFACE_PAGE_SIZE` (25, first page); the table's `p[role="status"]` reads "1000 results"; the pager's `span[role="status"]` reads "Page 1 of 40" |
| v1 `maxTableColumns` = 50 | `thead th` and `tbody td` each have length 50; `tbody tr` has length 1 |
| v2 `maxInputs` = 100 | `input[type="text"]` has length 100 |
| v2 `maxOptions` (select) = 50 | `select option` has length 51 (50 options + the fixed blank placeholder) |
| v2 `maxOptions` (radio-group) = 50 | `input[type="radio"]` has length 50 |
| v2 `maxChildrenPerNode` = 50 | `[data-apps-focus-key$=":expand"]` has length 50 |
| v2 `maxGridColumns` = 4 | `[data-apps-focus-key$=":expand"]` has length 4 (4 `stat` children of the grid) |

All 13 cases still pass with these assertions in place (13/13 in the scoped `budget-render` run;
213/213 for the full `declarative-dashboard` project).

**Red evidence.** A temporary test (removed before this report; never committed) overrode
`SURFACE_VIEW_MODEL_BUILDER` to return `{ renderFailed: false, viewModel: { title: {...},
components: [] } }` — the exact shape Moderate-1 describes — for the `maxInputs` fixture, then ran
the same `runCase` with the `input[type="text"]` count assertion. Observed output:

```
[budget-render] TEMP maxInputs with empty builder override: accepted=true renderFailed=false jsdomMs=1.35
● TEMP proof › fails the DOM assertion when the builder silently returns zero components
  expect(received).toHaveLength(expected)
  Expected length: 100
  Received length: 0
  Received object: []
    at src/lib/budget-render.spec.ts:329:75
```

This confirms the earlier gap directly: `renderFailed=false` still fires (the validator-acceptance
and render-failure checks alone would have passed), but the new DOM-count assertion catches the
silently-empty render and fails the test. The temporary override and test were removed immediately
after this observation; `git status`/`git diff` on `budget-render.spec.ts` show only the permanent
assertions above.

Verification re-run after the fix (tails):

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard @ptah-extension/shared --skip-nx-cache` → `Successfully ran targets lint, typecheck, test for 2 projects` (6/6 green).
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit` → exit 0, no output.
- Scoped run: `Test Suites: 17 passed, 17 total`, `Tests: 213 passed, 213 total`.
