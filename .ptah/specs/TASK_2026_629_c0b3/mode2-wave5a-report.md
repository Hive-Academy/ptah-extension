# Mode 2 report: Wave 5a (batch R9k), TASK_2026_629_c0b3

Verdict: R9k COMPLETE, committed `e8e190455`. Not pushed. The branch is local only.

## Inputs read

- `batches-rail-r9.md` Batch R9k and the execution rules
- `lane-R9k-report.md`, `code-logic-review-R9k.md` (APPROVE-WITH-FIXES 7/10), `lane-R9k-fix-report.md`

## On-disk verification

- `libs/frontend/canvas/src/lib/canvas-layout.service.ts`: real implementation, 81 lines. The exported
  `TileLayout` is kept (`:12`). Width-only ResizeObserver with rAF coalescing, a frame-generation guard,
  inactive cancel, re-observe on reactivation, and `disconnect` on destroy (`:20-81`). No Grid geometry
  remains.
- `canvas-layout.service.spec.ts`: five cases. Fix-round finding 1 is confirmed: `:4` imports `TileLayout`
  from `./canvas-layout.service`, so there is no self-import through the barrel. The test at `:125` is
  renamed and reads each field.
- `canvas-layout-controls.component.ts`/`.spec.ts` and `canvas-board-toggle.component.ts`/`.spec.ts` are
  deleted (git `D`).

## Zero-importer scan (rg, `*.ts`/`*.html`)

Patterns: both basenames, `CanvasLayoutControlsComponent`, `CanvasBoardToggleComponent`, both
selectors, `Layout options`, `Layout presets`, `data-preset`.

- libs: no live importers. Three spec absence assertions only: `orchestra-canvas.rail.spec.ts:297-298`,
  `orchestra-canvas.component.spec.ts:891` (review finding 4, recorded).
- apps, routed to R9l and not fixed here: `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:145`,
  `:553`, `:883` (`Layout options`), and `:569`, `:898` (`Layout presets ... data-preset`).
- Removed geometry symbols (`computeLayout|columnsFor|cellHeightFor|PositionedTile|CanvasLayout|
  MIN_TILE_WIDTH|MAX_COLUMNS|containerHeight`): no code consumers. The remaining hits are
  stale mocks in `orchestra-canvas.component.spec.ts:241-243`, `:735-737` (finding 2) and comments in
  `canvas-layout-intent.ts:8`, `:23`, `:292` (finding 6, R9t).

## Checks (serial, lock runner, from W)

| Label | Command | Result |
| --- | --- | --- |
| w5-canvas-full | FULL(@ptah-extension/canvas) | exit 0. `Test Suites: 22 passed, 22 total`, `Tests: 247 passed, 247 total` (Wave 4: 24/269; the -2 suites are the deleted specs) |
| w5-canvas-tc | TC(@ptah-extension/canvas) | exit 1. Only error: `../chat-state/src/lib/tab-persistence.ts:171:10 - error TS2367: ... 'TabViewMode \| undefined' and '"compact-tall"' have no overlap.` |
| w5-canvas-lint | LINT(@ptah-extension/canvas) | exit 0. `16 problems (0 errors, 16 warnings)`, the same count as Wave 4. None in R9k files |
| w5-tribunal-tc | TC(@ptah-extension/tribunal-panel) | exit 1. Same single error, `tab-persistence.ts:171:10` TS2367 |

Logs are in `%TEMP%\629-check-w5-*.log`.

### Attribution of the TC failures (not R9k)

- `libs/frontend/chat-state/src/lib/tab-persistence.ts` belongs to R9s (uncommitted, in review). It is not one
  of R9k's six paths.
- At HEAD, the file has no `tab.viewMode === LEGACY_COMPACT_TALL_VIEW_MODE` comparison: `git show HEAD:`
  has only the constant at `:173` and doc mentions. The new `restoredViewMode` (working tree `:170-174`)
  compares `TabViewMode` directly against `'compact-tall'`. R9s's edit introduced it.
- Both typecheck logs contain exactly this one error. Neither has an error in a canvas file, in
  `canvas-layout.service*` or in `tribunal-ui.types.ts`, the `TileLayout` consumer. R9k therefore passes
  TC(canvas) and TC(tribunal-panel) on its own files.
- R9f (codex, in flight) changed canvas files during this run. FULL(canvas) and LINT(canvas) were still
  green, so no R9f failure needed separating.

Action for R9s (its Mode 2 will fail on this): narrow or widen the compared value, e.g. compare `as string`
or read the raw stored value as `unknown`. Do not suppress it. This belongs to R9s's fix round.

## Commit

- `e8e190455 refactor(canvas): batch R9k - slim layout service, delete grid controls`
- Staged with explicit `git add --` on the six R9k paths only: 6 files, +61/-802. The pre-commit hook passed
  and `--no-verify` was not used.
- Left unstaged: the R9f canvas files, the R9s chat-state/chat-types files and `.ptah/**` docs. This report and
  the `batches-rail-r9.md` update are not committed.

## Review findings disposition

| # | Severity | Disposition |
| --- | --- | --- |
| 1 | Serious | FIXED in the fix round. `spec:4` uses a relative import and the test is renamed. Lint shows 0 errors |
| 2 | Moderate | RECORDED. Stale `CanvasLayoutService` mocks in `orchestra-canvas.component.spec.ts:241-248`, `:735-740` should be trimmed to `{ observe, containerWidth }` by that file's owner (R9l/R9t) |
| 3 | Moderate | ROUTED -> R9l. e2e selectors at `canvas.spec.ts:145, 553, 569, 883, 898` |
| 4 | Moderate | RECORDED. The three vacuous absence assertions stay; R9l/R9t may drop them |
| 5 | Minor | RECORDED. The width-only gate (zero height accepted) is intended and covered by `spec:64-65` |
| 6 | Minor | ROUTED -> R9t. Stale comments at `canvas-layout-intent.ts:8, 23, 292` and `canvas.store.ts:42, 82` |
| 7 | Minor | RECORDED. There is no test pinning double-`observe` disconnect or disconnect-before-reobserve |

## Parity

Rows 45, 46 and 61 are approved Grid-only removals (decision 73), per the review's row-by-row trace. The
kept state is `containerWidth`, `observe`, `active` and `TileLayout`.
