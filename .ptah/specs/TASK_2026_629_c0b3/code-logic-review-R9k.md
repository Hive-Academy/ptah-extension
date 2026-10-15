# Code Logic Review R9k — TASK_2026_629_c0b3

Review family: Claude (reviewer) vs codex (implementer)

Batch: R9k, slim `canvas-layout.service.ts`, delete layout controls and board toggle.
Score: 7/10
Verdict: APPROVE-WITH-FIXES (0 blocking, 1 serious, 3 moderate, 3 minor)

Scope read in full: `canvas-layout.service.ts` and its spec (working copy), HEAD versions of the service and of both deleted components, `canvas/src/index.ts`, `lane-R9k-report.md`, the R9k contract and parity rows 45, 46, 61. Consumers read: `orchestra-canvas.component.ts:291,318-321`, `canvas-rail-board.component.ts:176,210`, Tribunal `tribunal-ui.types.ts:2,87` and `tribunal-state.service.ts:19,273,490`. No tests, typechecks or lint were run, per the batch rules.

## Findings

1. SERIOUS: the spec self-imports the lib through its own barrel alias. `canvas-layout.service.spec.ts:4` has `import type { TileLayout } from '@ptah-extension/canvas'`, and this is the only such import in `libs/frontend/canvas` (rg confirmed). `@nx/enforce-module-boundaries` is on as an error in the root config (`eslint.config.mjs:253`) and normally rejects a project importing itself by alias ("use relative imports within the same project"). Mode 2 for this batch includes `LINT(canvas)`, so this will probably fail the gate. I did not run lint, so this is inferred. The same line is why the fifth test (`:126-129`) is weak. The import is type-only, so it is erased at runtime, and the assertion `expect(position).toEqual({...})` compares an object with its own literal. The only thing it can fail on is a missing export at compile time, and only if the jest config type-checks. Fix: import `TileLayout` from `./canvas-layout.service`, which is the only thing the spec can legitimately prove. To prove the barrel export, use a typed fixture in the Tribunal lib, since Tribunal already compiles against the barrel (`tribunal-ui.types.ts:2`, and R9k's Mode 2 `TC(tribunal-panel)`). Rename the test so it does not claim barrel coverage.

2. MODERATE: stale component-spec mocks hide API drift. `orchestra-canvas.component.spec.ts:241-248` and `:735-740` still build `CanvasLayoutService` mocks with `containerHeight`, `columnsFor` and `computeLayout`, cast via `as unknown as CanvasLayoutService`. Those members no longer exist on the service, and the cast stops the compiler from catching it. Nothing fails today, but the mocks assert a contract that has gone, and a future reader will believe Grid geometry still exists. The file belongs to R9m/R9l territory, not R9k's file list. Route it to whoever owns `orchestra-canvas.component.spec.ts` (R9l or R9t) and trim the mocks to `{ observe, containerWidth }`.

3. MODERATE (route to R9l): e2e selectors for the deleted layout controls. `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:145`, `:553`, `:883` use `getByRole('button', { name: 'Layout options' })`, and `:569` and `:898` use `[role="group"][aria-label="Layout presets"] button[data-preset]`. `:553-575` also drives "Lock tiles". These can never match now, so those e2e cases fail or hang. This is R9l's to fix, and R9k is not at fault. No other hits in `apps`, including the showcase specs (checked basenames, class names, selectors, "Layout options", "data-preset" across `apps` and `libs` for ts, html, scss, css and json).

4. MODERATE: the zero-importer claim holds for code, but three spec-only selector absence assertions remain: `orchestra-canvas.rail.spec.ts:297-298` and `orchestra-canvas.component.spec.ts:891`. They assert absence of `ptah-canvas-board-toggle`, `ptah-canvas-layout-controls` and the combined selector. They are valid regression guards while the selectors are dead, but once the names are gone nothing can ever render them, so they pass vacuously. Keep or drop them, whichever R9l or R9t prefers. Not a defect.

5. MINOR: behaviour change not mentioned in the contract. The old observer ignored entries with `height <= 0` (HEAD `canvas-layout.service.ts` observer). The new one gates on width only (`canvas-layout.service.ts:53`). The writer disclosed this, and it is safe because Rail reads only `containerWidth` (`canvas-rail-board.component.ts:210`). It is covered by `spec:66-67`, which measures `(800.4, 0)` and expects 800. I traced the one real hazard: a collapsed zero-height viewport with a positive width now updates the width band. That is harmless, and arguably better than before.

6. MINOR: stale doc references to deleted code. `canvas-layout-intent.ts:23` mentions `CanvasLayoutService.cellHeightFor`, `canvas-layout-intent.ts:8` and `:292` mention `MAX_COLUMNS` and `MIN_TILE_WIDTH`, and `canvas.store.ts:42,82` say the service "derives grid" geometry. All are comments in files R9t owns. List them in R9t's checklist.

7. MINOR: the spec leaves two lifecycle properties unasserted. Calling `observe()` a second time should disconnect the previous observer and not double observe (`service.ts:48` calls `disconnect()` first, so the code is correct, but no test pins it). Reactivation (`spec:93-108`) asserts `observeMock` was called twice but not that `disconnectMock` fired once before the re-observe. Both are cheap additions.

## Review focus answers

1. Zero live importers: confirmed. rg for basenames, class names, selectors and `Layout options`/`data-preset` across `libs` and `apps` found no TypeScript or template consumers, only the spec absence assertions and the e2e hits above. `OrchestraCanvasComponent` imports and templates no longer reference either component (HEAD template usage was already removed by R9j/R9m; the current file only injects `CanvasLayoutService` and calls `observe`).

2. Parity rows:
   - Row 45 (board mode toggle): the deleted component only emitted `modeChanged('rail' | 'grid')` and carried no shortcut, menu entry, aria-live or storage write of its own. The only persisted effect was through `CanvasStore.setBoardMode`, which is still exported (`canvas.store.ts:267`) and is slated for removal in R9t. Stored `'grid'` values render Rail (`orchestra-canvas.rail.spec.ts:288-296`). This is an approved Grid-only removal (decision 73).
   - Row 46 (presets and layout menu): the deleted controls emitted `presetRequested` and `lockToggled`, with Escape-to-close and popover focus return. All of it served Grid presets and layout lock. `applyPreset` (`canvas.store.ts:485`) and `setLayoutLocked` (`:303`) now have no non-spec callers, which is expected until R9t. The Rail density control is a separate component and was untouched. Approved removal.
   - Row 61 (layout projection): `computeLayout`, `columnsFor` and the cell-height math are gone with no non-spec callers. `containerWidth`, `observe`, `active` and `TileLayout` are kept as the row states. Order and migration helpers stay in `canvas-layout-intent.ts` for R9t.
   - The only global keyboard handler is the Rail one (`orchestra-canvas.component.ts:62`, `canvas-rail-keyboard`), which is unrelated. No capability moved or was lost silently.

3. Service lifecycle: unchanged and correct. `observe()` calls `disconnect()` before creating a new observer, so a repeat call does not double observe (`service.ts:48-50`). `disconnect()` cancels any pending frame, disconnects, and nulls the observer and element (`:75-80`). It is registered via `destroyRef.onDestroy` (`:44`). Frame generation guards a stale callback after cancel (`:56-59`). Reactivation re-observes only when an element and observer exist and the surface became active (`:36-41`). `containerWidth` is the only signal remaining and the only member any consumer reads: `canvas-rail-board.component.ts:210`, the rail spec mock at `orchestra-canvas.rail.spec.ts:243` (`observe` only), and `canvas-rail-board.component.spec.ts:246`. The `#sessionViewport` element is rendered unconditionally (`orchestra-canvas.component.ts:231-236`), so `afterNextRender` always finds it. `TileLayout` is exported from the barrel (`index.ts:5`) and matches Tribunal's use: a plain `{ x, y, w, h }` shape at `tribunal-ui.types.ts:87`, `tribunal-state.service.ts:273` and `:490`. `CanvasLayoutService` is still exported from the barrel, no consumer imports `CanvasLayout`, `PositionedTile`, `MIN_TILE_WIDTH` or `MAX_COLUMNS` (rg found only intent-file comments), and the service has no storage API.

4. Spec cases: four substantive cases (width updates and rounding, zero or invalid ignored, `spec:62-70`; latest pending frame wins and the earlier frame is cancelled with id 11, `:72-89`; inactive ignored and reactivation re-observes, `:91-108`; destroy disconnects exactly once, cancels the pending frame and a late frame is a no-op, `:110-124`). I traced each against the code and none is vacuous. The fifth (Tribunal type use) is tautological, see finding 1. The writer's note about a mid-run failure fixed by queuing frames matches the design of tests 2 to 4.

5. Persisted write paths: the service never wrote to storage (neither HEAD nor now). The deleted components wrote nothing directly. The only write path they triggered was `setBoardMode` through the store, and the reader tolerates a stored `'grid'` by normalising to Rail (`orchestra-canvas.rail.spec.ts:156-157,288-296`). Nothing to repair.

## Five logic questions

1. Silent failure: none new. A zero-width entry is dropped silently, so `containerWidth` can stay 0, and `railWidthBand(0)` governs the band until the first positive measurement. That behaviour is pre-existing and bounded.
2. Unexpected user action: the e2e cases that click "Layout options" will fail (finding 3), a test-only effect. No user-facing path calls the deleted controls.
3. Wrong answer from data: a fractional width is floored (`service.ts:60`), and the spec covers it. A transient positive width from a hidden-then-shown surface is handled by the active gate plus re-observe.
4. Dependency failure: if `ResizeObserver` is absent, the constructor in `observe()` would throw. That is unchanged from HEAD and is acceptable in Electron/Chromium.
5. Missing: nothing in the requirements; stale mocks and comments need a cleanup owner (findings 2 and 6).

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Keep width observation/release | COMPLETE | Not asserting double-`observe` (finding 7) |
| Keep exported `TileLayout`, Tribunal compiles | COMPLETE | Spec import is a self-alias (finding 1) |
| Remove Grid geometry imports and tests | COMPLETE | None |
| Delete controls and toggle with specs | COMPLETE | None |
| Leave intent and store exports for R9t | COMPLETE | Stale comments noted for R9t |
| Spec: width observation/release | COMPLETE | None |
| Spec: Tribunal type import | PARTIAL | Tautological and self-alias (finding 1) |
| Parity rows 45, 46, 61 | COMPLETE | None |

## Verdict

APPROVE-WITH-FIXES, 7/10. The logic change itself is sound and minimal: the lifecycle code that remains is the HEAD logic with height tracking and geometry removed, and no capability was dropped silently. The score is held down by the likely lint failure from the self-alias import, which also makes the Tribunal case a no-op. Fix finding 1 before the Mode 2 LINT(canvas) gate. Findings 2, 3 and 6 are handoffs to R9l and R9t, not rework for R9k.
