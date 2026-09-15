# Implementation Notes — TASK_2026_442

## Summary

Implemented per-tile fluid canvas spans, deterministic responsive packing, named presets, snapped resize commits, accessible tile layout controls, transient layout focus, and panel/workspace-scoped v2 persistence with lossless v1 migration. Canvas hydration now reconciles exact restored tab ids without opening or loading sessions, and component teardown flushes layout state without closing tabs.

## Files changed

1. `libs/frontend/canvas/src/lib/canvas-layout-intent.ts` — added width intent types, span units, responsive row packing, preset projection, snapping, reconciliation, and span-aware drag projection.
2. `libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts` — replaced legacy capacity/weight tests with mixed-span, auto-weight, responsive fallback, focus, preset, snap, drag, deletion, and invalid-observation coverage.
3. `libs/frontend/canvas/src/lib/canvas-layout.service.ts` — projects packed intent into the unchanged public `{ x, y, w, h }` geometry and retains measurement/cell-height behavior.
4. `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts` — covers exact named-span rows, independent row combinations, auto fill, narrow fallback/restoration, layout focus, measurement, and degenerate inputs.
5. `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts` — added strict Zod v1/v2 storage boundary, migration, future-version write protection, hydration gating, debounced byte-equivalent writes, lifecycle flushes, and bounded warnings.
6. `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts` — covers v2 round-trip/keying, every v1 cap, arbitrary weights, invalid records, future bytes, hydration gating, debounce, lifecycle flush, and storage failures.
7. `libs/frontend/canvas/src/lib/canvas.store.ts` — replaced column/weight APIs with workspace-addressed span, row, layout-focus, preset, resize, hydration, lock, and persistence delegation APIs; retained the facade below 700 lines.
8. `libs/frontend/canvas/src/lib/canvas.store.spec.ts` — covers exact-id hydration, span/revision commits, lock, transient focus, presets, partitioning, LRU, row transfer, and workspace cleanup.
9. `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` — routes tile layout actions, includes focus/capacity in gesture validation, disables interaction during layout focus, and commits snapped resize spans while preserving the single Gridstack writer and `_applyingLayout` guard.
10. `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts` — updates the faithful Gridstack harness for snapped spans, responsive no-write restoration, focus suppression/exit, lock, complete validation, and feedback-loop behavior.
11. `libs/frontend/canvas/src/lib/canvas-tile.component.ts` — added the `NativePopoverComponent` layout menu, stored-span radio state, focus/row actions, lock guards, focus management, and arrow/Home/End keyboard navigation.
12. `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts` — adds layout trigger/menu ARIA, four radio options, typed outputs, keyboard navigation, and lock-disabled action coverage while retaining effort/model/visibility tests.
13. `libs/frontend/canvas/src/lib/canvas-layout-controls.component.ts` — replaced numeric cap controls with three presentational preset outputs while retaining the lock control.
14. `libs/frontend/canvas/src/lib/canvas-layout-controls.component.spec.ts` — covers preset labels/values, close behavior, singleton/lock disablement, and lock operability.
15. `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` — provides persistence at panel scope, hydrates authoritative tab ids, routes presets, synchronizes store lock, flushes on destroy, and removes force-close teardown.
16. `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` — updates hydration/provider fixtures and covers no session opening/loading, preset routing, persistence flush, non-destructive teardown, and retained workspace visibility.
17. `libs/frontend/canvas/CLAUDE.md` — documents the new width union, packing/preset/focus contracts, persistence ownership, hydration, lock, and geometry boundaries.

## Deviations from the approved plan

None. The public `src/index.ts` export surface and `TileLayout` shape were left unchanged; no project configuration, shared contract, RPC, backend, or additional sanitizer was introduced.

## Verification

### `npx nx typecheck @ptah-extension/canvas`

Result: PASS

Exact result line:

```text
NX   Successfully ran target typecheck for project @ptah-extension/canvas
```

### `npx nx lint @ptah-extension/canvas`

Result: PASS

Exact result lines:

```text
✔ All files pass linting
NX   Successfully ran target lint for project @ptah-extension/canvas
```

### `npx nx run-many -t test -p @ptah-extension/canvas @ptah-extension/tribunal-panel`

Result: PASS. Nx explicitly reported two projects.

Exact result lines:

```text
NX   Running target test for 2 projects:
- @ptah-extension/canvas
- @ptah-extension/tribunal-panel
Test Suites: 16 passed, 16 total
Tests:       333 passed, 333 total
Test Suites: 9 passed, 9 total
Tests:       107 passed, 107 total
NX   Successfully ran target test for 2 projects
```

## Revise round 2 (CodeRabbit)

### A. Responsive resize preserves named intent

- Verified the bug in `canvas-workspace-grid.component.ts`: a stored `third` renders at six units at responsive capacity two, while `snapSpan(6)` is `half`.
- The resize handler now compares the current named span and snapped span through `effectiveUnits` using the gesture snapshot's responsive capacity. Equal rendered widths are accepted as a semantic no-op and reconciled without a store commit. Auto widths still convert to named spans.
- Added a Gridstack component spec proving a stored `third` resized to six units at capacity two performs no store write and remains `third`.

### B. Hydration clears stale layout focus

- `CanvasStore.hydrateWorkspace` now clears a workspace's transient layout focus when the carried id is absent from reconciled authoritative tiles.
- Added a store spec covering a stale focus moved from the implicit partition into a real workspace.

### C. Tile layout-menu tests use the production template

- Removed the layout-menu test-authored template override.
- The tests now render `CanvasTileComponent`'s real template while replacing only child chat/indicator/messaging surfaces with inert stubs.
- Assertions cover the production `data-testid="tile-layout-trigger"`, trigger ARIA, `role="menu"`, four `menuitemradio` buttons with `data-span` and stored `aria-checked`, focus and row action labels, lock-disabled actions, and keyboard navigation.

### D. Layout service coverage restored

- Added a cell-height assertion proving wrapped tiles retain the 90% viewport-height floor.
- Added an `observe()` measurement test proving requestAnimationFrame coalescing/cancellation, floored signal publication, and ResizeObserver disconnection on destroy.

### E. Persistence test doubles and migration scheduling

- Added `needsWrite: false` to persistence load doubles in `canvas.store.spec.ts`, `canvas-workspace-grid.component.spec.ts`, and both real-store fixtures in `orchestra-canvas.component.spec.ts`.
- Typed the store persistence load mock as `CanvasLayoutLoadResult`.
- Added a store spec proving `needsWrite: true` schedules persistence even when migrated tiles already equal reconciled tiles.

### F. Skewed auto-weight apportionment

- Added the capacity-three `10/1/1` auto-weight case and asserted the responsive floor produces `[4, 4, 4]`.

### G. Revision scope is discriminating

- Expanded the resize revision test with an independently hydrated `/ws/b` partition and a valid mutation that advances only B.
- The test proves `/ws/a` still accepts its unchanged captured revision, then rejects that stale revision after A advances and accepts A's updated revision.

### H. Review documentation corrected and resolved

- Corrected `code-style-review.md` to state that an older client treats an unknown v2 span as corrupt/writable and may overwrite it.
- Corrected `code-logic-review.md` scope to eight production and eight spec files.
- Appended `## Resolution after revise rounds` to both reviews. The logic resolution records the deliberate auto-row break decision and round-one lifecycle, preset assertion, and fractional-future-version fixes. The style resolution records the `DestroyRef` fix, declines menu-query caching as negligible, and corrects the round-one total to 445 tests.

### Skipped items

None.

### Verification

#### `npx nx typecheck @ptah-extension/canvas`

Result: PASS

```text
NX   Successfully ran target typecheck for project @ptah-extension/canvas
```

#### `npx nx lint @ptah-extension/canvas`

Result: PASS

```text
✔ All files pass linting
NX   Successfully ran target lint for project @ptah-extension/canvas
```

#### `npx nx run-many -t test -p @ptah-extension/canvas @ptah-extension/tribunal-panel`

Result: PASS. Nx reported exactly two projects.

```text
NX   Running target test for 2 projects:
- @ptah-extension/canvas
- @ptah-extension/tribunal-panel
Test Suites: 16 passed, 16 total
Tests:       333 passed, 333 total
Test Suites: 9 passed, 9 total
Tests:       118 passed, 118 total
NX   Successfully ran target test for 2 projects
```

## Revise round 1

### Changes

- `libs/frontend/canvas/src/lib/canvas-layout-intent.ts` — kept the approved drag-break rule unchanged and documented that its fit check mirrors `packRows` minimum-unit accounting.
- `libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts` — pinned dropped auto-tile row intent and packed geometry at responsive capacities three and two; expanded `focus-plus-stack` to assert exact order, width, and row-break intent for every tile.
- `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts` — treats every numeric version greater than 2, including fractional versions, as future/read-only and uses a class-field `DestroyRef` injection.
- `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts` — covers version 2.5 preservation, `beforeunload`, hidden `visibilitychange`, and visible `visibilitychange` without flushing.

No other implementation changes were made in revise round 1.

### Verification

#### `npx nx typecheck @ptah-extension/canvas`

Result: PASS

```text
NX   Successfully ran target typecheck for project @ptah-extension/canvas
```

#### `npx nx lint @ptah-extension/canvas`

Result: PASS

```text
✔ All files pass linting
NX   Successfully ran target lint for project @ptah-extension/canvas
```

#### `npx nx run-many -t test -p @ptah-extension/canvas @ptah-extension/tribunal-panel`

Result: PASS. Nx reported exactly two projects.

```text
NX   Running target test for 2 projects:
- @ptah-extension/canvas
- @ptah-extension/tribunal-panel
Test Suites: 16 passed, 16 total
Tests:       333 passed, 333 total
Test Suites: 9 passed, 9 total
Tests:       112 passed, 112 total
NX   Successfully ran target test for 2 projects
```
