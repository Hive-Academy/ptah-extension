# Implementation Report — TASK_2026_451 (compact canvas tile shrinks and neighbours reflow)

Working tree: `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing`
Branch: `feat/task-451-compact-tile-sizing` (left dirty; no git history commands were run)

All paths below are relative to `libs/frontend/canvas/src/lib/` unless stated otherwise.

## 1. Plan item → file:line

### 1. Pure constraint projection and skyline placement — `canvas-layout-intent.ts`

| Plan item | Implemented at |
|---|---|
| `FULL_TILE_HEIGHT_UNITS = 6`, `COMPACT_TILE_HEIGHT_UNITS = 2` | `canvas-layout-intent.ts:8`, `canvas-layout-intent.ts:11` |
| Internal view-tier/constraint types (`TileHeightTier`, `TileViewConstraint`, `TileViewConstraints`) | `canvas-layout-intent.ts:56-65` |
| `viewConstraintsFingerprint` (structural, order-sensitive) | `canvas-layout-intent.ts:72` |
| `minimumUnitsFor(capacity)` responsive compact width 4/6/12 | `canvas-layout-intent.ts:190` |
| `packRows` treats compact tiles as fixed participants at the minimum, excluded from auto remainder sharing | `canvas-layout-intent.ts:235`, `canvas-layout-intent.ts:254`, compact row seeding `canvas-layout-intent.ts:348-372` |
| Skyline placement: nondecreasing `readingFloorY`, `rowBreakBefore` hard fence, `(y, -w, x)` tie-break, auto contraction candidates, 12x6 focus target | `projectTileGeometry` `canvas-layout-intent.ts:423-505` (fence `:459`, tier height `:463`) |
| `totalExtentOf` = `max(y + h)` | `canvas-layout-intent.ts:507` |
| Drag reconstruction: bounded break-mask enumeration (≤ 2^8 = 256), min-Hamming then lexicographic mask, **no match rejects**; capacity-1 logical-row-block contiguity | `projectDragIntent` `canvas-layout-intent.ts:555-703` (expected tier `:580`, mask enumeration `:643-652`, Hamming `:679-692`) |

### 2. Layout service height/cell projection — `canvas-layout.service.ts`

| Plan item | Implemented at |
|---|---|
| `computeLayout(tiles, layoutFocusTabId, viewConstraints)` consumes positioned geometry | `canvas-layout.service.ts:96-129` |
| `totalExtent`, `hasFullTile` feed the cell height | `canvas-layout.service.ts:123-129` |
| `cellHeightFor`: `ceil(extent/6)` band margins, fit denominator `max(extent, 6)`, 90% floor only when a full tile exists | `canvas-layout.service.ts:153-176`, `MIN_TILE_VIEWPORT_RATIO` `canvas-layout.service.ts:17` |

### 3. Workspace Gridstack projection adapter — `canvas-workspace-grid.component.ts`

| Plan item | Implemented at |
|---|---|
| `GestureSnapshot.viewFingerprint` | `canvas-workspace-grid.component.ts:41-48` |
| Singleton CSS split: `.singleton` vs `.singleton-expanded` (`100% !important` only for full/layout-focused singleton) | class binding `:97-98`, CSS `:139-157` |
| Derived `viewConstraints` computed with structural `{ equal }`; `viewFingerprint`; `compactTabIds`; `isSingletonExpanded` | `:205`, `:231`, `:235`, `:245` |
| Frozen/compact per-tile creation options (`noResize`) | `:291-307` |
| **Lock exception**: `_appliedViewFingerprint` tracks the last applied projection; a locked+visible grid with a differing fingerprint applies view-driven geometry via `applyAuthoritativeGeometry(true)` (force bypasses the lock guard for this path only) | state `:342`, effect `:348-360`, applied write `:663` |
| `grid.setStatic(locked)` | `:384` |
| Per-node interaction state: compact movable but never resizable (`grid.movable`/`grid.resizable` split) | `applyNodeInteractionState` `:710-727` |
| Defensive refusal of a stale resize-start on a compact id | `:436` |
| Gesture captures the view fingerprint | `:449` |
| Mid-gesture view change cancels (reactive invalidation + terminal commit guard) | `:401-411`, `:507` |
| Terminal reconcile always re-applies authoritative geometry | `reconcileGesture` `:642-646` |
| Guarded batch: `_applyingLayout` + `finally`, `batchUpdate(true)` → `grid.update` per changed node → `batchUpdate(false)` | `:691-704` |
| Metric attributes (`data-canvas-grid-updates`, `data-canvas-gesture-commits`, …) | `:87-92` |

### 4. Tile toggle contract and documentation

| Plan item | Implemented at |
|---|---|
| Toggle button: dynamic `aria-label`/`title` ("Switch to compact/full view"), `data-testid="tile-view-mode-toggle"`, `mousedown`/`pointerdown`/`touchstart` stopPropagation | `canvas-tile.component.ts:199-217` |
| `onToggleViewMode` → `tabManager.toggleTabViewMode(tabId)`, no store mutation | `canvas-tile.component.ts:427-430` |
| `layoutLocked` documented as the deliberate exception (view mode owned by TabManagerService) | `canvas-tile.component.ts:273-279` |
| Store documentation-only correction (lock freezes layout intent/gestures; view projection outside store authority) | `canvas.store.ts:67`, `canvas.store.ts:124-125` |
| CLAUDE.md: new "View Modes (compact/full)" section; updated "Geometry and Gesture Contracts" (one-way flow with constraints, strict drag reconstruction, per-node suppression, lock exception); lock paragraph names the toggle exception | `libs/frontend/canvas/CLAUDE.md` |

### 5. Electron E2E — `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`

| Plan item | Implemented at |
|---|---|
| Compact shrink + skyline reflow + restore (4 thirds, compact middle → fourth tile at `(4,2,4,6)`, compact item `(4,0,4,2)` with no resize handle, full restore leaves the hole) | test at `:474` |
| Locked-toggle coverage (toggle enabled, geometry reflows, Gridstack static class, presets/span/row/focus disabled, gesture commit count unchanged, restore, unlock) | test at `:568` |
| Compact singleton `gs-h="2"`, `gs-w="4"`, no `singleton-expanded`, item height < grid height | test at `:720` |
| Retained full-only narrow geometry (previous `:275-279`) | unchanged inside the existing drag test |

## 2. Tests added per spec file

**`canvas-layout-intent.spec.ts`** — rewritten in place; 26 tests. New coverage: height-tier constants; structural fingerprint; compact width 4/6/12 at capacities 3/2/1 with byte-identical intent; hole fill under a compact tile (extent 8); stored-span ignored (plan worked example 2, C at `(6,2)`); nine compact auto tiles banded (extent 6); `rowBreakBefore` fence (D at `(0,6)`); auto contraction into an earlier hole plus exact restore; compact focus target 12x6; determinism under equal candidates and shuffled input; mixed-height drag reorder accepted; min-Hamming break recovery; rejection of overlaps / non-integers / wrong height tier; capacity-one block contiguity plus in-row reorder; incomplete and duplicate membership rejection.

**`canvas-layout.service.spec.ts`** — 15 tests. Added: compact layout-focus target 12x6 and restore; mixed skyline reflow (t4 at `(4,2,4,6)`); all-compact row at two units; responsive compact widths 4/6/12 without mutating the stored span; the 90%-floor replacement trio (floor active with a wrapped full tile, all-compact stack fitted to true extent with cellHeight 48 < 90, extent-scaled fit 97 vs 48); compact singleton at two units instead of viewport stretch.

**`canvas-workspace-grid.component.spec.ts`** — 35 tests. Fake grid extended with `movable`/`resizable`; writable `tabs` signal in the tab-manager fake. New `describe('view-mode tiers')` (`:428`): unrelated tab-field write causes zero `grid.update`/`batchUpdate`; compact reflow performs exactly two `grid.update` calls with exact geometry, cell-height update, and unchanged intent/revision; per-node interaction state (`movable(true)`, `resizable(false)`, `noResize` for compact; stale compact resize-start refused with `_gesture` null and `rejectedGestures > 0`); mid-gesture tier change cancels and reconciles. Lock suite: view-driven application while locked commits no store intent, never leaves static, and refreezes gestures (`:926`). Singleton suite: full singleton expanded, compact singleton stays at `h = 2` without the expanded class (`:1101`). Two existing drag tests rewritten with named thirds (see §4).

**`canvas-tile.component.spec.ts`** — 19 tests. Added: toggle stays enabled and works under `layoutLocked=true`; dynamic "Switch to compact/full view" aria label; exactly one `toggleTabViewMode(tabId)` call with mousedown/pointerdown/touchstart swallowed and no `focusRequested`. Updated the lock assertion: every `[data-layout-item]` menu button disabled while the adjacent view toggle remains enabled. Added a `beforeEach` mock reset so call-count assertions are isolated.

**`canvas.store.spec.ts`** — untouched (no behavioral change; comments only in `canvas.store.ts`).

**`apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`** — 3 new tests (see §1 table); existing 4 tests retained verbatim.

## 3. Verification results (verbatim summaries)

Run from the worktree root:

```
npx nx test @ptah-extension/canvas
  Test Suites: 9 passed, 9 total
  Tests:       148 passed, 148 total

npx nx typecheck @ptah-extension/canvas
  NX  Successfully ran target typecheck for project @ptah-extension/canvas

npx nx lint @ptah-extension/canvas
  NX  Successfully ran target lint for project @ptah-extension/canvas
```

Additional checks beyond the required three:

```
npx nx typecheck ptah-electron-e2e   (tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json)
  NX  Successfully ran target typecheck for project ptah-electron-e2e

npx nx lint ptah-electron-e2e
  NX  Successfully ran target lint for project ptah-electron-e2e
```

The Electron E2E itself was NOT run (it needs a built app, per the task instruction). No `npx nx reset` was run.

## 4. Deviations from the plan

1. **Lock exception needed a production fix beyond the plan text.** The constructor effect's locked branch originally called `applyAuthoritativeGeometry()` (force = false), which returns early at the `if (!force && (!this.visible() || this.locked())) return;` guard — the lock exception could never fire. Fixed by calling `applyAuthoritativeGeometry(true)` at `canvas-workspace-grid.component.ts:356`. The plan specified the behavior; this fix makes the specified path reachable. Covered by the lock test at spec `:926`.
2. **Full-tier auto drag reconstruction deliberately relaxes horizontal matching.** Gridstack leaves untouched auto tiles at their pre-drag `x`/`w`, while the candidate projector re-apportions their committed row. `projectDragIntent` therefore requires `y`/`h` for full-tier auto tiles and keeps exact `x`/`y`/`w`/`h` matching for named spans and compact tiles. The two workspace-grid drag tests use their original default-auto fixtures again; no named-span substitution is needed.
3. **Intent-spec hole-fill expectation corrected to `(6, 2)` for tile C.** The plan's worked example 2 states "C full third: `(6, 2, 4, 6)`" and the `(y, -w, x)` tie-break selects the lowest `x` among equal candidates. An earlier draft of the test expected `(8, 2)`; the assertion now matches the plan.
4. **`canvas-tile.component.spec.ts` gained a `beforeEach` with `jest.clearAllMocks()`** in the layout-menu describe. The new exact call-count assertion (`toHaveBeenCalledTimes(1)`) needs per-test mock isolation; the describe previously had none. Implementations are unaffected (`clearAllMocks` clears calls, not implementations).
5. **`canvas.store.spec.ts` was not touched.** The plan allowed renaming its lock test only if the file had to change; the store edit stayed comment-only, so the rename condition did not occur.
6. **The pre-existing E2E drag test (`:139`) was intentionally left unmodified.** See risk R-2.

## 5. Open risks

**R-1 — Gridstack static-mode programmatic updates: mitigated in code.**
Locked authoritative application now calls `setStatic(false)` inside `_applyingLayout`, performs the guarded batch, restores `setStatic(true)` in `finally`, and reapplies per-node interaction state after restoration. The unit test asserts `setStatic(false) -> update -> setStatic(true)` order and no store commit. The Electron E2E remains the unrun real-engine validation.

**R-2 — retained auto-tile Electron drag: unit-level regression resolved.**
The existing E2E at `canvas.spec.ts:139` remains unchanged and still exercises default auto tiles. Its realistic capacity-3 geometry is now accepted by the relaxed full-auto matcher, as pinned by both pure and workspace-grid unit tests. The E2E itself was not run per instruction, so real pointer/Gridstack behavior remains unverified in this round.

**R-3 — auto-width cross-row drag regression: resolved.**
Full-tier auto tiles can again commit cross-row drags even when committed row apportionment changes their `x`/`w`. Vertical placement and height remain strict, including for an auto tile contracted into a compact-created skyline hole; named-span and compact geometry remains fully strict.

**R-4 — the Electron E2E was not executed in this task.**
All three new E2E tests typecheck and lint (`npx nx typecheck ptah-electron-e2e`, `npx nx lint ptah-electron-e2e`, both green) but have never run against a built app. Real Gridstack behavior remains the outstanding validation boundary.

## Revise Round 1

| Review defect | Resolution | Ownership and evidence |
|---|---|---|
| 1. Default auto-width cross-row drag rejected | Full-tier auto tiles match candidate masks on strict `y`/`h`; named spans and compact tiles remain strict on `x`/`y`/`w`/`h`. | Previous lane: `canvas-layout-intent.ts:662-681`. Verified in this lane, including the contracted auto tile whose skyline-hole `y` depends on its width. |
| 2. Static locked grid had no safe update fallback | Locked authoritative application suspends static mode inside `_applyingLayout`, batches updates, restores static mode in `finally`, then reapplies every node's move/resize state. | This lane: `canvas-workspace-grid.component.ts:692-722`; order/no-store-write test at `canvas-workspace-grid.component.spec.ts:925-968`. |
| 3. Auto drag tests were weakened | Restored the two workspace-grid tests to default auto tiles and realistic coordinates; kept named-third coverage only in separate compact/lock tests. | Previous lane: realistic capacity-3 pure drag case and skyline-hole case. This lane: corrected the hole fixture/mask and restored component tests at `canvas-workspace-grid.component.spec.ts:561-582` and `:747-771`. |
| 4. Applied fingerprint written before batch success | Empty layouts now record the fingerprint once; non-empty layouts record it only after the batch/cell-height work succeeds. | This lane: `canvas-workspace-grid.component.ts:659-665`, `:697-711`. |

Additional cleanup: removed all three `@typescript-eslint/no-non-null-assertion` warnings from `canvas-workspace-grid.component.spec.ts:491-511`. Updated `libs/frontend/canvas/CLAUDE.md:52-57` so the gesture and lock contracts match the implementation. The pre-existing auto-tile Electron drag at `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:139` was intentionally not changed.

### Tests restored or added

- Restored `commits an explicit 2+1 break and restores it after narrow reflow` to the main/default auto-tile fixture.
- Restored `sorts a multi-row drag by row first` to the main/default auto-tile fixture.
- Retained the previous lane's realistic capacity-3 pure auto drag regression.
- Corrected and verified the previous lane's skyline-hole regression: a full auto tile remains at `y = 2` only when the candidate keeps the compact-created hole open.
- Strengthened locked compact reflow to assert `setStatic(false) -> grid.update(...) -> setStatic(true)`, final frozen interaction state, and no store intent/revision write.

### Verification

Run from `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing`:

| Command | Exact result |
|---|---|
| `npx nx test @ptah-extension/canvas` | PASS — 9 suites passed, 149 tests passed, 0 failed. |
| `npx nx typecheck @ptah-extension/canvas` | PASS — Nx successfully ran the canvas typecheck target. |
| `npx nx lint @ptah-extension/canvas` | PASS — `All files pass linting`; 0 errors and 0 warnings. |
| `npx nx typecheck ptah-electron-e2e` | PASS — Nx successfully ran the Electron E2E typecheck target. |

The Electron E2E was not run, and `npx nx reset` was not run.

### Risk state after revision

- **R-1: mitigated.** Static mode is synchronously suspended/restored around the guarded batch, with interaction state reapplied after restore. Real-engine E2E remains outstanding.
- **R-2: resolved at unit/integration level.** The unchanged auto-tile E2E scenario is covered by restored realistic tests; the E2E itself remains unexecuted.
- **R-3: resolved.** Auto-width cross-row drag is supported again; it is not an accepted rejection behavior.
