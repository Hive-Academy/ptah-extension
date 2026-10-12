# Batch 2 report — TASK_2026_623_3492 (S2 text fallback, index, patch text, budgets)

Executor: backend-developer. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`
(branch `feat/task-623-display-panel`, on top of Batch 1 commit `29c30cf06`). No git operations performed.

## Tasks completed

### Task 2.1 — text fallback for `accordion`, `avatar`, stat trend/spark: COMPLETE

- `surface-text-fallback.ts`
  - Added `case 'avatar'` to `renderDisplay`. Output is `Avatar: <name> — <subtitle>`, or `Avatar: <name>` when there
    is no subtitle.
  - The `stat` case appends `renderStatExtras(component)` after the unchanged v1 `renderStat` line:
    - trend: `; trend <up|down> <amount>[%][ (good|bad)]`. The direction is written as a word, not a sign or a colour.
    - spark: `; spark N points from <first> to <last> (low <min>, high <max>)`. The spark is summarised rather than
      listed, because it can hold up to 5,000 points.
  - `accordion` goes through the existing layout branch. `isSurfaceLayoutComponent` already covers it since Batch 1, so
    the output is its trimmed required title with the children indented underneath. No new code was needed.
  - `/3` output is unchanged. `renderStat` in `dashboard-text-fallback.ts` was not touched, and a stat with no `trend`
    or `spark` gets an empty suffix.
- `surface-text-fallback.spec.ts`: new describe `dashboard-catalog/4 kinds and stat fields` with five cases:
  - the accordion's title and indented child, checked line by line;
  - an avatar with and without a subtitle;
  - a trend with percent and polarity, and a trend with neither;
  - the spark summary, including a negative low;
  - a `/3` stat line that renders the same under both catalog versions.

### Task 2.2 — barrel exports, patch error text (A6), contract pair spec: COMPLETE

- `surface.index.ts` now exports:
  - the constants `SURFACE_CATALOG_VERSION_4`, `SURFACE_CATALOG_4_ONLY_LAYOUT_KINDS`,
    `SURFACE_CATALOG_4_ONLY_DISPLAY_KINDS`, `SURFACE_CATALOG_4_ONLY_STAT_FIELDS`, `SURFACE_CATALOG_4_LAYOUT_KINDS`,
    `SURFACE_CATALOG_4_DISPLAY_KINDS`, `SURFACE_CATALOG_4_COMPONENT_KINDS`, `SURFACE_TREND_DIRECTIONS`,
    `SURFACE_TREND_POLARITIES` and `SURFACE_SPARK_MIN_POINTS`;
  - the types `SurfaceCatalogVersion`, `SurfaceTrendDirection` and `SurfaceTrendPolarity` (from `surface-catalog`), and
    `SurfaceContractCatalogVersion` (from `surface.validator`).
  - The new `surface.types` interfaces (`SurfaceAccordionComponent`, `SurfaceAvatarComponent`, `SurfaceStatTrend`) were
    already covered by the existing `export type * from './surface.types'`.
  - The `/4` component schemas were not added. The barrel exports boundary schemas only, and that pattern was kept.
- `surface-patch.ts`
  - The hard-coded message "only section, stack, grid and card take children" now uses `PARENT_KINDS_TEXT`.
  - `PARENT_KINDS_TEXT` is built once from `SURFACE_CATALOG_4_LAYOUT_KINDS` and reads
    `section, stack, grid, card and accordion`.
  - This is the same `/4` superset that `isSurfaceLayoutComponent` accepts (`surface-bindings.ts`, Batch 1), so the
    message cannot drift from the check.
- `surface-contract.spec.ts`
  - The pair assertion now expects the third pair `['dashboard-spec/2', SURFACE_CATALOG_VERSION_4]`.
  - Added `expect(SURFACE_CATALOG_VERSION_4).toBe('dashboard-catalog/4')`.
  - The `/3` assertions (19 kinds, v1 lists, limits) are unchanged.

### Task 2.3 — budgets spec for spark points (A7): COMPLETE

- `surface-budgets.spec.ts`: new describe `stat spark points (A7, dashboard-catalog/4)` with four cases:
  - exactly `maxSeriesPoints` (5,000) is accepted, and one more is rejected, naming `components.0.spark`;
  - the minimum `SURFACE_SPARK_MIN_POINTS` (2) is accepted, and 1 is rejected;
  - two stats each at the limit, plus a line chart at the limit, are accepted. This shows the budget is per component,
    not summed across the surface. It agrees with the Batch 1 A7 finding (`dashboard-catalog.ts:167`, `checkChart`).
  - a `/3` envelope with an in-budget spark is rejected, naming `components.0.spark`, by both the document validator and
    `create`.
- The `/4` cases go through `validateSurfaceDocument`. `ptah_surface_update` (`create`/`patch`) accepts `/3` only by
  Batch 1 design. Its reason reads "dashboard-catalog/4 is the ptah-ui display catalog; ptah_surface_update accepts
  dashboard-catalog/3 only".

## Files

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-text-fallback.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-text-fallback.spec.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.index.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-patch.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-contract.spec.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-budgets.spec.ts
- MODIFIED (outside the file list, see deviations) D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-patch.spec.ts

## Verification (tailed)

Jest: the Batch 2 spec list, plus `surface-patch.spec.ts` in the same single invocation.

```
npx jest -c libs/shared/jest.config.ts .../surface-text-fallback.spec.ts .../surface-budgets.spec.ts
  .../surface-validator.spec.ts .../surface-contract.spec.ts .../surface-patch.spec.ts --coverage=false --maxWorkers=2
Test Suites: 5 passed, 5 total
Tests:       254 passed, 254 total
```

- The first run had 3 failures, all in my new budget cases, because they used `create` for `/4` envelopes. The cause is
  the `/3`-only update path described under Task 2.3.
- I fixed the spec and re-ran once. That run is the one shown above.
- After that, Prettier reflowed whitespace in `surface-budgets.spec.ts` only. It made no semantic change, and there was
  no third run.

```
npx nx typecheck @ptah-extension/shared --parallel=1
NX  Successfully ran target typecheck for project @ptah-extension/shared

npx nx lint @ptah-extension/shared --parallel=1
✖ 6 problems (0 errors, 6 warnings)
NX  Successfully ran target lint for project @ptah-extension/shared
```

- The 6 lint warnings are the same set recorded at Batch 1, including `surface.schemas.ts` at 758 lines against the
  700-line limit.
- `@ptah-extension/declarative-dashboard` typecheck was not run, as instructed. It is known red until Batch 13.

## Risks and edge cases handled

- **`/3` regression (HIGH):**
  - The `/3` text fallback is unchanged: `renderStat` was not touched, and a spec case renders the same `/3` stat under
    both versions.
  - The `/3` contract assertions are unchanged: 19 kinds, v1 lists and limits.
  - A `/3` envelope carrying a spark is still rejected by both validators, naming the field.
  - All 109+ existing `surface-validator.spec.ts` cases pass.
- **A6:** the parent-kind message is now derived from `SURFACE_CATALOG_4_LAYOUT_KINDS`, as the Batch 1 decision
  requires. A new patch spec case shows that `add-component` puts an `avatar` into an `accordion` parent.
- **A7:** the spec pins the per-component rule at the limit, at the limit plus one, at the minimum, and with several
  components each at the limit. This is consistent with Batch 1.
- **Contract-pair red window from Batch 1** (`surface-contract.spec.ts:74-77`): closed. The spec is green with the
  third pair.
- The batches.md edge-case list has no item owned by Batch 2. Those items belong to Tasks 3.x, 4.2, 5.1, 13+ and 20+.

## Plan deviations

- `surface-patch.spec.ts` was edited even though it is not in the Batch 2 file list.
  - Its existing assertion pinned the old literal "only section, stack, grid and card take children", which Task 2.2
    is required to change. Leaving it would have left a red spec in the same project.
  - I updated that one assertion and added the A6 accordion-parent case.
  - I added the spec to the same single Jest invocation rather than running a separate check.
  - It is the same lib and the same rollback boundary, the same situation as Batch 1's `surface-bindings.ts` decision.

## Out-of-scope observations

- The main contracts barrel `libs/shared/src/mcp-apps-contracts/index.ts:113-120` re-exports the `/3` version constants
  (`SURFACE_CATALOG_VERSION`, `SURFACE_SUPPORTED_CATALOG_VERSIONS`, `DASHBOARD_CONTRACT_VERSION_PAIRS`) but not
  `SURFACE_CATALOG_VERSION_4`. I did not touch it because it is outside this batch's list. A later consumer that imports
  from the zod-free main barrel may need it added; consumers that use the `/surface` subpath already have it.
