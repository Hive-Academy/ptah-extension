# Mode 2 - Wave 6 - Batch R9t (Late intent/store Grid cleanup)

Verdict: **R9t PASS** - VERIFIED, commit pending (decision row 95). No commit was made.

Inputs read: `batches-rail-r9.md` (Batch R9t contract, Mode 2 = FULL/TC/LINT canvas),
`lane-R9t-report.md`, `code-logic-review-R9t.md` (APPROVE-WITH-FIXES 8/10, 0 Blocking,
0 Serious, 2 Moderate, 3 Minor), `decisions.md` rows 93-95.

## Files on disk (exactly 4)

`git diff --stat` for the batch paths: 4 files, +29 / -290.

- `libs/frontend/canvas/src/lib/canvas.store.ts` (-100 net)
- `libs/frontend/canvas/src/lib/canvas.store.spec.ts` (79 lines changed)
- `libs/frontend/canvas/src/lib/canvas-layout-intent.ts` (-101 net, includes the row-94 comment edit)
- `libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts` (-39)

The KEEP list is still exported from `canvas-layout-intent.ts`: `MAX_CANVAS_TILES` :11,
`TILE_SPANS` :22, `TileSpan` :23, `TileWidthIntent` :41, `DEFAULT_TILE_WIDTH` :45,
`TileIntent` :52, `sameWidth` :159, `logicalRows` :165, `retainTilesInLogicalRows` :193 and
`reconcileIntent` :215.

## Row-94 comment fixes (review Moderates 1-2)

Both comments are accurate.

- Moderate 2, `canvas-layout-intent.ts:59-64` (`TileViewConstraint`) now reads "This module does
  not clamp `heightUnits`: the caller supplies the final value, and a tile without a constraint
  projects at `FULL_TILE_HEIGHT_UNITS`." The code agrees. `:527`
  (`constraint?.heightUnits ?? FULL_TILE_HEIGHT_UNITS`) and `:611` use the value without
  clamping. The only `clamp` left in the file is `clampCapacity` (:240), which is unrelated.
- Moderate 1, `canvas-layout-intent.ts:74-78` (`viewConstraintsFingerprint`) now reads
  "Gestures compare this string to detect a mid-gesture view or height change". The
  "locked grid" clause is gone, and `rg` finds no `locked`/`Locked` in the file.

Minors 3-5 are recorded and not fixed, as instructed: the remaining dead projection surface,
missing `reorderTiles`/`commitDragIntent` specs (owned by R9w), and "grid" wording in store comments.

## Checks (run from W through `.ptah/tmp/check-run.mjs`, one at a time)

| # | Label | Command | Exit | Summary |
| - | ----- | ------- | ---- | ------- |
| 1 | r9t-full | `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 | `Test Suites: 1 failed, 22 passed, 23 total` / `Tests: 2 failed, 241 passed, 243 total` |
| 2 | r9t-tc | `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | 0 | `Successfully ran target typecheck for project @ptah-extension/canvas` |
| 3 | r9t-lint | `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | 0 | `17 problems (0 errors, 17 warnings)`, `Successfully ran target lint` |

The logs are in `%TEMP%`: `629-check-r9t-full.log`, `629-check-r9t-tc.log` and
`629-check-r9t-lint.log`.

### Failure attribution: R9t vs R9f

- **R9t: 0 failures.** The only failing suite is not an R9t file. Suites 22/22 pass outside the
  failing one, including `canvas.store.spec.ts` and `canvas-layout-intent.spec.ts`.
- **R9f (not counted against R9t), 1 suite / 2 tests:**
  `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts`
  - `CanvasLaneViewComponent > uses the owner for stop and the responder for Allow and Deny`
  - `CanvasLaneViewComponent > answers a sub-agent session permission and retains transcript across progress`
  - Cause: `TypeError: fixture.componentInstance.stop is not a function` (stack frames are only in
    that spec, at :110, :120, :142 and :189). This matches the R9f fix round now in progress, which
    removes the lane-header Stop and `stop()` under decision 93 (M1/M5). The spec has not caught
    up yet. This is R9f's job, and its own Mode 2 must clear it.
- Lint: the 17 warnings are spread across 5 spec files: `canvas-lane-tabs.component.spec.ts`,
  `canvas-lane-view.component.spec.ts` (R9f), `canvas-layout-persistence.service.spec.ts`,
  `canvas-focus-header.component.spec.ts` and `canvas-rail.component.spec.ts`. None of the 4
  R9t files has a warning, and there are 0 errors.

## rg proof (libs/ and apps/)

- `rg -n -w 'applyPreset|projectPreset|setLayoutLocked|toggleRowBreak|layoutLocked|_layoutLocked|commitResizeSpan|setTileSpan|setBoardMode|clampCompactHeightUnits|tileViewConstraint|CanvasLayoutPreset' libs apps`
  -> no matches (exit 1). There are zero callers of the removed symbols.
- `rg -n -w 'reorderTiles|commitDragIntent' libs apps` -> both are still present:
  - `libs/frontend/canvas/src/lib/canvas.store.ts:364` `reorderTiles(orderedTabIds: readonly string[])`
  - `libs/frontend/canvas/src/lib/canvas.store.ts:388` `commitDragIntent(`
  - `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts:235` `reorderTiles: jest.fn()` (stub)

## Verdict

**R9t PASS.** All 4 files are on disk with real removals and the KEEP list intact. Both row-94
comments are accurate. FULL(canvas) has no R9t failure; its only red suite is R9f's mid-edit
`canvas-lane-view.component.spec.ts`. TC(canvas) is green and LINT(canvas) has 0 errors. The
removed symbols have zero callers, and `reorderTiles` and `commitDragIntent` remain.

## Ready commit command (orchestrator runs it in the foreground in W, only when no writer lane is running)

Run it in Bash from W. Stage only these 4 paths; the R9f files stay unstaged.

```bash
cd "D:/projects/ptah-extension/.claude-worktrees/feat-task-629-canvas-board-697f422f00f5"
git add libs/frontend/canvas/src/lib/canvas.store.ts \
  libs/frontend/canvas/src/lib/canvas.store.spec.ts \
  libs/frontend/canvas/src/lib/canvas-layout-intent.ts \
  libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts
git diff --cached --name-only   # expect exactly the 4 paths above
git commit -F - <<'EOF'
refactor(canvas): batch R9t - drop grid presets, lock and span resize

Remove the Grid-only store members applyPreset, setTileSpan,
commitResizeSpan, setLayoutLocked (with the layoutLocked signal),
toggleRowBreak and setBoardMode, and the intent exports projectPreset,
CanvasLayoutPreset, clampCompactHeightUnits and tileViewConstraint,
with their spec cases.

Keep the strict v3 width and row-break intent, reconcileIntent,
retainTilesInLogicalRows, sameWidth, reorderTiles and commitDragIntent.
The row-boundary regression now seeds a persisted break. Doc comments
no longer describe the deleted lock or compact-height clamp.

Mode 2: canvas typecheck and lint green; canvas tests have no R9t
failure (R9f lane-view spec mid-edit, not this batch).

TASK_2026_629. Parity rows 50, 61, 64. Decisions 94, 95.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

The subject is 69 characters and every body line is at most 72. The type is `refactor` and the
scope is `canvas`, both from `.commitlintrc.json`. After the commit, record the SHA on the
R9t header and on Task R9t.1 in `batches-rail-r9.md`, and set both to COMPLETE.
