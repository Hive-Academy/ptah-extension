# Agent output - root

## Outcome

Implemented the approved R1-lite + R4a canvas batch. It is ready for independent
logic and style review.

The implementation keeps `MAX_TILES = 9`, keeps public `TileLayout` exactly
`{x,y,w,h}`, and does not recreate tiles, tabs, sessions, or chat surfaces when
layout intent changes. R4b persistence/hydration/disposal, compact redesign,
LOD, zoom, `detailPin`, and the existing canvas-destroy tab closure are unchanged.

## Source changes

- `canvas-layout-intent.ts` adds pure logical-row partitioning, row-preserving
  removal, effective Auto/1/2/3 capacity, and guarded drag projection. Removing
  C from `A B | C D` produces `A B | D`. At capacity one, only reordering inside
  existing contiguous logical-row blocks is accepted.
- `CanvasStore` now stores `rowBreakBefore`, a workspace-scoped columns
  preference, and a monotonic workspace revision. Drag and resize commits name
  the captured workspace and compare the expected revision atomically. Exact
  complete membership is required; stale and incomplete commits are no-ops.
- `CanvasLayoutService` partitions logical rows first and then applies
  responsive render-only wrapping. Narrowing and widening never writes row
  intent.
- `CanvasWorkspaceGridComponent` caches one stable creation-options object per
  tile. Its guarded imperative effect is the only post-mount geometry writer,
  diffs engine nodes, batches once, and calls `grid.update()` only for changed
  nodes. Gesture state is captured at start and cancelled on hide, lock,
  destroy, workspace/capacity/revision change, or replacement by a new gesture.
  Rejected, cancelled, and accepted semantic no-op gestures now synchronously
  reconcile existing engine nodes from current authoritative intent. Unknown or
  removed nodes are skipped, and an old-workspace gesture is never projected
  through a new workspace partition.
- Real Gridstack gravity compacts a tile dropped directly below an available
  column. The component therefore retains the last real drag observation and
  projects that user position at change time; the canonical derived writer then
  normalizes the accepted logical row.
- `CanvasLayoutControlsComponent` provides an internal OnPush Auto/1/2/3
  workspace control. All four native buttons are disabled while locked, and the
  handler independently rejects a programmatic call while locked. It is
  intentionally not added to the library public API.
- `CanvasRenderMetricsService` owns bounded panel-local counters for creation
  options, actual computed-layout cache misses, apply checks, changed apply
  passes, updates, callbacks and gesture outcomes. A publication clock refreshes
  diagnostic attributes without making metrics a layout dependency. The grid
  exposes measured width plus computation/apply/update/commit checkpoints for
  real-browser evidence.
- Canvas guidance was updated to describe the row, gesture and single-writer
  contracts.

## Changed files

Production and guidance:

- `libs/frontend/canvas/src/lib/canvas-layout-intent.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-render-metrics.service.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-layout-controls.component.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-layout.service.ts`
- `libs/frontend/canvas/src/lib/canvas.store.ts`
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`
- `libs/frontend/canvas/CLAUDE.md`

Tests:

- `libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-render-metrics.service.spec.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-layout-controls.component.spec.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts`
- `libs/frontend/canvas/src/lib/canvas.store.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts`
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`
- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`

Task prose:

- `.ptah/specs/TASK_2026_404_6fcd/task-description.md`
- `.ptah/specs/TASK_2026_404_6fcd/context.md`
- this report

Approved step-0 files were not modified by this batch.

## Test coverage added

- explicit 2+1 intent, Auto/1/2/3, and wide -> narrow -> wide projection;
- row-start deletion/boundary transfer;
- capacity-one valid within-row reorder and cross-row interleave rejection;
- missing, duplicate, unknown and non-finite node rejection;
- stale revision and cross-workspace atomic rejection;
- hide, lock, capacity-change, stale-revision and stopped-without-change
  cancellation, each with unchanged intent and complete settled known-node
  geometry;
- accepted semantic no-op reconciliation and removed-node non-resurrection;
- stable creation options, one changed-node-only batch, and zero repeated updates;
- disabled/accessibly native locked preference controls, guarded programmatic
  selection, bounded metrics, and computation-vs-apply accounting;
- real Electron pointer drag, gravity/collision placement, real east-handle
  unequal resize, a first-row tile dragged downward, responsive resize,
  workspace A -> B -> A, DOM identity, lock-during-drag cancellation, pointer
  no-op settling, and width-specific repeat-application checkpoints.

## Real Gridstack evidence

The focused Electron Playwright test used the existing launcher, which creates
a fresh temporary `--user-data-dir` and `PTAH_DB_PATH` for each run. No user
profile or production database was used.

The final focused run rebuilt the Electron main process and renderer through the
Nx e2e target before launching the isolated app:

```text
npx nx run ptah-electron-e2e:e2e --skip-nx-cache -- --grep "real Gridstack drag"
```

Result:

```text
Running 1 test using 1 worker
[canvas-metrics] {"updatesAtMount":3,"updatesAfterGestures":15,"updatesAfterFirstNoopResize":15,"updatesAfterNoopResize":15}
1 passed (17.1s)
```

An earlier Nx-driven run built successfully and reached the real test, but its
new multi-button disabled assertion used a strict locator and failed before the
geometry checks. After correcting that test-only assertion, the final run above
passed from a fresh rebuild. Each 2599/2600 resize waited for a distinct
measured-width change, a new layout-computation checkpoint, and exact complete
engine geometry. The measured
same-capacity resizes issued zero additional updates. The lock-during-pointer
gesture restored exact prior geometry, left the commit count unchanged, and
disabled all four controls; a subsequent pointer down/up in place also retained
the exact geometry.

The pre-change implementation had no runtime counter, so no invented pre-change
measurement is claimed. Source inspection established that it replaced every
item options object and also explicitly called `grid.update()` for every node;
the new measured mount performed three imperative updates, one per initially
changed node.

The successful Nx e2e run also emitted a `MaxListenersExceededWarning` for
process exit listeners and repeated `NO_COLOR`/outdated-agent-config warnings.
They did not fail the build or test; no claim is made about their historical
origin.

To make the worktree build runnable, ignored worktree-local junctions were
created for `prismjs`, `daisyui`, `web-tree-sitter`, and
`@vscode/tree-sitter-wasm`, each targeting the already-installed package in the
parent checkout. They are not source changes and `git status` does not list them.

## Fresh scoped verification

### Tests

```text
npx nx run-many -t test -p @ptah-extension/canvas @ptah-extension/tribunal-panel ptah-extension-webview ptah-electron --skip-nx-cache -- --runInBand
```

Header confirmed `Running target test for 4 projects`.

- canvas: 8 suites, 109 tests passed
- tribunal-panel: 16 suites, 333 tests passed
- webview: 8 suites, 149 tests passed
- Electron: 32 suites passed, 1 skipped; 455 tests passed, 4 skipped
- aggregate: 64 suites passed, 1 skipped; 1,046 tests passed, 4 skipped
- warning: tribunal Jest config emitted its existing ESM-config warning

### Typecheck

The requested five-project command ran:

```text
npx nx run-many -t typecheck -p @ptah-extension/canvas @ptah-extension/tribunal-panel ptah-extension-webview ptah-electron ptah-electron-e2e --skip-nx-cache
```

Header confirmed 5 projects. Canvas, tribunal, webview and Electron e2e passed;
the command failed in the consuming Electron app because
`apps/ptah-electron/src/config/build-artifact-gate.ts` references `jest`,
`describe`, and `it` from the app tsconfig without Jest types. This file was not
changed in this batch. Historical baseline attribution was not tested because
doing so safely would require another checkout/worktree operation that this task
forbids, so this report does **not** label the failure pre-existing. A clean
follow-up run for the four relevant passing projects confirmed `Successfully
ran target typecheck for 4 projects`.

### Lint

```text
npx nx run-many -t lint -p @ptah-extension/canvas @ptah-extension/tribunal-panel ptah-extension-webview ptah-electron ptah-electron-e2e --skip-nx-cache
```

Header confirmed 5 projects and all targets passed. Canvas, tribunal and
webview were clean. Electron reported 4 existing warnings; Electron e2e
reported 9 existing warnings, all outside the changed canvas spec.

`git diff --check` also passed. No Nx reset was run because no project config
changed. No commit, push, checkout, rebase, or reset was performed.

## Remaining gaps and next step

- R4a is in-memory only by design. An application restart does not yet preserve
  row intent or the columns preference.
- Ordinary canvas destruction still force-closes tabs. That pre-existing
  lifecycle defect belongs to R4b and was deliberately not changed here.
- Unknown-future schema protection, transactional authoritative-tab hydration,
  implicit-workspace migration, teardown flush, and real destroy/remount proof
  remain R4b.
- The Electron app-wide typecheck failure above remains outside this batch; its
  historical baseline status is unverified.

Next action: independent logic and style review of this batch before R4b.
