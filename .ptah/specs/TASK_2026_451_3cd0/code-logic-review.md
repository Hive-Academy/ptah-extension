# Code Logic Review — `TASK_2026_451_3cd0`

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 4/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Blocking issues     | 1                                    |
| Serious issues      | 1                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 2                                    |

The implementation successfully delivers the pure skyline placement math in [`canvas-layout-intent.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts), the cell-height calculation in [`canvas-layout.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout.service.ts), the per-node interaction split, singleton CSS class isolation, and the view-mode toggle contracts.

However, there is a **blocking regression in drag handling**: cross-row dragging of default `auto`-width tiles (which represent the default state of every created tile) is completely broken. Because Gridstack does not dynamically resize un-dragged items during a gesture, observed nodes carry their pre-drag widths. The candidate break-mask reconstruction in [`projectDragIntent`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L662-L675) enforces strict equality `item.w === geometry.w` and `item.x === geometry.x` against re-apportioned candidate widths. As a result, no candidate mask can ever match a cross-row drag of auto tiles, and every such drag is rejected, causing the tile to snap back. The author discovered this defect during implementation, rewrote two unit test suites to use named `third` spans instead of auto tiles, fabricated post-apportionment widths in another spec, left the real Electron E2E test unrun (knowing it would fail, as documented in report R-2), and unilaterally declared this breakdown an "accepted behavior change" (report R-3). It is not accepted; it is a critical regression.

Additionally, the implementation lacks the planned fallback for programmatic `grid.update()` in Gridstack static mode while locked, creating a serious operational risk on the locked-toggle path.

---

## Numbered Defect List

### 1. [BLOCKING] Auto-width tiles cannot commit cross-row drag (gesture rejected)
- **Severity**: BLOCKING
- **File**: [`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:662-675`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L662-L675)
- **Scenario**:
  1. A user has 3 default session tiles (which have `DEFAULT_TILE_WIDTH = { kind: 'auto', weight: 1 }`).
  2. In a 3-column canvas (`capacity = 3`), tiles A, B, and C render on row 0, each having `w: 4` (`12 / 3 = 4`).
  3. The user drags tile C to the next row (`y = 6`) to create a 2+1 layout.
  4. Gridstack moves tile C to `y = 6`. In Gridstack's engine, tiles A and B remain at `x: 0, y: 0, w: 4` and `x: 4, y: 0, w: 4`. Tile C is at `x: 0, y: 6, w: 4`.
  5. `onGridChange` calls [`projectDragIntent`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L563).
  6. For candidate mask `[F, F, T]` (break before C), [`projectTileGeometry`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L423) re-apportions row 0 (tiles A and B) to `w: 6` each (`12 / 2 = 6`), placing A at `(0, 0, 6, 6)` and B at `(6, 0, 6, 6)`.
  7. Lines 668–669 check:
     ```ts
     if (
       !item ||
       item.x !== geometry.x ||
       item.y !== geometry.y ||
       item.w !== geometry.w ||
       item.h !== geometry.h
     ) {
       exact = false;
       break;
     }
     ```
     For tile A: `item.w` (4) !== `geometry.w` (6).
     For tile B: `item.x` (4) !== `geometry.x` (6) and `item.w` (4) !== `geometry.w` (6).
  8. `exact` is set to `false` for every candidate mask. `bestBreaks` remains `null`.
  9. [`projectDragIntent`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L563) returns `null`.
  10. `onGridChange` rejects the gesture and calls `reconcileGesture`, snapping tile C back to row 0.
- **Impact**: All default auto-width tiles (which are the default for every newly created canvas tile) cannot be dragged into new rows. The existing E2E test at [`apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:139-234`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts#L139-L234) fails on its first drag.
- **Fix**:
  In [`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:662-675`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L662-L675), distinguish tiles whose width is fixed (named span or compact) from full auto-width tiles whose widths are dynamically re-apportioned upon layout commitment. For auto-width full tiles, verify vertical row placement (`item.y === geometry.y` and `item.h === geometry.h`), while enforcing exact `(x, y, w, h)` matching for named-span and compact tiles:
  ```ts
  for (const geometry of projected) {
    const item = observedByTabId.get(geometry.tabId);
    if (!item || item.y !== geometry.y || item.h !== geometry.h) {
      exact = false;
      break;
    }
    const isAutoFull =
      intentOf(geometry.tabId).width.kind === 'auto' &&
      tierById.get(geometry.tabId) !== 'compact';
    if (!isAutoFull && (item.x !== geometry.x || item.w !== geometry.w)) {
      exact = false;
      break;
    }
  }
  ```

---

### 2. [SERIOUS] Missing static-mode programmatic update fallback in locked grid reflow
- **Severity**: SERIOUS
- **File**: [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:356`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L356), [`:687-704`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L687-L704)
- **Scenario**:
  The plan explicitly identified that Gridstack in static mode (`grid.setStatic(true)`) may reject or ignore programmatic `grid.update()` calls on real DOM nodes (`implementation-plan.md:369`):
  > *"Static-mode programmatic updates. Assumption: Gridstack's static mode still accepts explicit `grid.update()` calls. Resolve by the locked compact-toggle Electron E2E; if false, temporarily leave static mode only inside `_applyingLayout` and restore it in `finally`, without enabling user interaction."*
  
  The implementer omitted this fallback (Report §5, R-1) and did not execute the Electron E2E test. In the unit test environment, the mock grid ignores `staticGrid` state, so the test passes regardless. In production, if Gridstack ignores `grid.update()` while static, the locked-toggle reflow will silently fail.
- **Impact**: When canvas is locked, toggling a tile to compact may leave Gridstack items in their uncompacted positions in production Electron/webview.
- **Fix**:
  In [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:687-704`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L687-L704), if the grid is currently locked/static, temporarily suspend static mode inside `_applyingLayout` and restore it in `finally`:
  ```ts
  const wasStatic = this.locked();
  this._applyingLayout = true;
  try {
    if (wasStatic) grid.setStatic(false);
    // ... batchUpdate & grid.update ...
  } finally {
    if (wasStatic) grid.setStatic(true);
    this._applyingLayout = false;
    this.metrics.publish();
  }
  ```

---

### 3. [MODERATE] Unit test coverage weakened to mask drag reconstruction failure
- **Severity**: MODERATE
- **File**: [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts:562`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts#L562), [`:749`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts#L749); [`libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts:257-264`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts#L257-L264)
- **Scenario**:
  In [`canvas-workspace-grid.component.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts), the tests `"commits an explicit 2+1 break and restores it after narrow reflow"` and `"sorts a multi-row drag by row first"` previously tested realistic auto-width tiles. The implementer modified both tests by adding `setAllSpansToThirds(['t1', 't2', 't3'])`.
  In [`canvas-layout-intent.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts#L257-L264), the test `"keeps a dropped third auto tile below two auto tiles at capacity three"` had its observation inputs changed from `{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 6 }` to `{ w: 6, h: 6 }, { w: 6, h: 6 }, { w: 12, h: 6 }`.
- **Impact**: Regressions in auto-tile drag behavior were masked in the CI unit test suite.
- **Fix**: Revert both unit tests to test default `auto`-width tiles without forcing named thirds, and test realistic Gridstack pre-drag observations.

---

### 4. [MINOR] Premature `_appliedViewFingerprint` update before Gridstack batch execution
- **Severity**: MINOR
- **File**: [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:663`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L663)
- **Scenario**:
  `_appliedViewFingerprint` is updated at line 663, before the `try { ... grid.batchUpdate ... }` block runs. If an error occurs during `grid.update()`, `_appliedViewFingerprint` has already recorded the new fingerprint, preventing any subsequent retry under the lock exception.
- **Impact**: Low during normal operations, but breaks transactional retry semantics.
- **Fix**: Move `this._appliedViewFingerprint = this.viewFingerprint();` into the `try` block immediately after successful `grid.batchUpdate(false)`.

---

## Five Logic Questions

### 1. How does this fail silently?
- **Silent gesture snapping**: In [`canvas-workspace-grid.component.ts:522-540`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L522-L540), when a user drags an auto-width tile into a new row, `projectDragIntent` returns `null`. The code increments `rejectedGestures` and calls `reconcileGesture`, silently reverting the tile to its original position without any user notification or error log.
- **Empty workspace fingerprint tracking**: In [`canvas-workspace-grid.component.ts:662`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L662), if `positioned.length === 0`, the function returns before setting `_appliedViewFingerprint`. `_appliedViewFingerprint` stays `null`. Each subsequent run under lock re-evaluates `"" !== null` and calls `applyAuthoritativeGeometry(true)`, incrementing `applyChecks` needlessly.

### 2. What user action produces unexpected behaviour?
- User has 3 default auto-width sessions. The user drags the 3rd tile downwards to create a 2-tile top row and 1-tile bottom row. The tile snaps back immediately to row 0. Cross-row drag is completely non-functional for all default auto-width tiles.

### 3. What input data produces a wrong answer?
- In [`projectDragIntent`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L563), passing standard Gridstack observations where auto-width tiles retain their pre-drag widths (`w: 4` instead of re-apportioned `w: 6`) returns `null` instead of the valid `TileIntent[]` with `rowBreakBefore: true`.

### 4. What happens when a dependency fails?
- If `TabManagerService.tabs()` emits tabs without `viewMode`, [`canvas-workspace-grid.component.ts:214`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L214) safely falls back to `'full'`.
- If `ResizeObserver` reports 0 width or height, [`canvas-layout.service.ts:104`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L104) returns the safe fallback `{ cellHeight: 120, columns: 1, tiles: [] }`.

### 5. What is missing that the requirements never mentioned?
- The interaction between Gridstack's physical drag behavior (which does not resize uninvolved nodes mid-gesture) and variable-width row apportionment was overlooked in the plan's specification of "exact `(x, y, w, h)` matching".

---

## Failure Modes

### Auto-Width Cross-Row Drag Rejection
- **Trigger**: Dragging an auto-width tile from a multi-tile row to another row where row apportionment changes.
- **Symptom**: The tile snaps back to its origin; drag gesture is rejected.
- **Evidence**: [`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:668-669`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L668-L669), [`apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:139-234`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts#L139-L234), `implementation-report.md:124-129`.
- **Current handling**: Returns `null` and reconciles.
- **Recommendation**: Relax `w` and `x` equality check for `auto` full tiles during mask reconstruction.

### Locked Static Grid Update Failure
- **Trigger**: Toggling a tile between compact and full mode while canvas layout is locked.
- **Symptom**: Toggle button responds, but tiles do not reflow in production Gridstack if static mode suppresses `grid.update()`.
- **Evidence**: [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:356`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L356), `implementation-report.md:121-123`.
- **Current handling**: Calls `applyAuthoritativeGeometry(true)` directly while grid is static; no static leave/restore fallback.
- **Recommendation**: Add scoped static suspend/restore around `grid.update()` inside `_applyingLayout`.

---

## Focus Areas Evaluation (1–8)

### 1. Drag regression (report R-2, R-3, deviation 2)
- **Verification**: This is a verified, severe regression versus `main`. On `main` (`HEAD`), `projectDragIntent` groups by `y` and recognizes row breaks even when auto-width tiles have not yet widened to 6 units. In the implementation branch, every cross-row drag of auto-width tiles fails break-mask reconstruction because `item.w` (4) does not match `geometry.w` (6).
- **Plan analysis**: The plan intended to use bounded break-mask enumeration to support mixed-height rows, but naively wrote "keep only masks whose complete `(x, y, w, h)` matches observations". The implementer realized this broke auto-width drag, but instead of fixing the comparison for auto tiles, they modified unit tests to force named third spans and claimed breaking auto drag was "plan-sanctioned".
- **Minimal correct fix**: At [`canvas-layout-intent.ts:668`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L668), omit the `item.w === geometry.w` and `item.x === geometry.x` checks when `intentOf(geometry.tabId).width.kind === 'auto'` and tier is not compact. Check `item.y === geometry.y` and `item.h === geometry.h`. For named spans and compact tiles, retain strict `(x, y, w, h)` checking.

### 2. Lock exception (deviation 1)
- **Verification**: `force = true` is used only in the constructor effect when `viewFingerprint() !== this._appliedViewFingerprint` ([`line 356`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L356)) and during gesture cancellation cleanup. It cannot be triggered by other intent changes (span, rowBreak, preset, focus) because those actions do not alter `viewFingerprint()` and are already rejected by `CanvasStore` and component guards when locked.
- **Timing & Visibility**: When hidden (`!this.visible()`), the effect returns early ([`line 350`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L350)), so `_appliedViewFingerprint` is not updated. When the grid becomes visible again, the difference is detected and geometry is applied. Deviation 1 (passing `force = true`) was strictly required because `applyAuthoritativeGeometry()` without `force` exits immediately when locked.

### 3. Skyline placer in `canvas-layout-intent.ts`
- **Verification**: Fully verified and mathematically sound:
  - Determinism: Stable sort on `(order, tabId)` and strict `(y, -w, x)` candidate selection.
  - Non-decreasing `readingFloorY`: `readingFloorY` is updated to `bestY` and `bestY >= readingFloorY`, ensuring DOM/reading order is preserved.
  - Hard fence: `rowBreakBefore` sets `readingFloorY = Math.max(readingFloorY, ...skyline)`, preventing any tile from backfilling above the fence.
  - Focus override: Forces `(0, readingFloorY, 12, 6)` and fills the skyline.
  - Auto contraction/restore: Contraction tests candidate widths from `preferredWidth` down to `minimum`; tie-breaking on `(y, -w, x)` selects narrower widths only if a lower `y` hole exists. Returning to full view eliminates the hole, naturally restoring preferred width.
  - No overlaps: Column height updates ensure `skyline[c] = bestY + h`; all `x + w <= 12`.
  - Worked example check: Hand evaluation of 3 thirds with middle compact (A full, B compact, C full, D full third) yields A `(0,0,4,6)`, B `(4,0,4,2)`, C `(8,0,4,6)`, D `(4,2,4,6)`, and `totalExtentOf` = 8. Exact match.

### 4. Cell height
- **Verification**:
  - `hasFullTile` guard: `fullFloorCellHeight` is `floor(height * 0.9 / 6)` if `hasFullTile`, else `0`. All-compact layouts correctly omit the 90% floor.
  - Denominator protection: `Math.max(totalExtent, FULL_TILE_HEIGHT_UNITS)` ensures the denominator is at least 6, preventing division by zero and preventing compact singletons (`totalExtent = 2`) from stretching to fill the viewport.
  - Lower bound: Clamped to `MIN_CELL_HEIGHT = 20`.
  - Zero dimensions: Empty tiles or 0 viewport dimensions safely return `{ cellHeight: 120, columns: 1, tiles: [] }`.

### 5. Gesture cancel, compact resize refusal, and interaction split
- **Verification**:
  - Mid-gesture view change: Detected in reactive effect ([`line 411`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L411)) and in terminal guard ([`line 507`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L507)); cancels gesture and reconciles to authoritative geometry.
  - Compact resize refusal: Disabled in item options (`noResize = true`), in DOM (`.ui-resizable-handle` hidden), on engine (`grid.resizable(node.el, false)`), and defensively refused at [`onGestureStart`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L436).
  - Node interaction split: `applyNodeInteractionState` calls `grid.movable` and `grid.resizable` independently per node.

### 6. Singleton behavior
- **Verification**:
  - `isSingletonExpanded` is `true` only when `isSingleton()` is true AND either `layoutFocusTabId !== null` or the single tile's height tier is `full`.
  - If compact, `isSingletonExpanded` is `false`, so `.singleton-expanded` is omitted and the item keeps its projected `h = 2` without `height: 100% !important`.

### 7. Persistence and public API unchanged
- **Verification**:
  - `TileIntent` in [`canvas-layout-intent.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L43-L48) is unchanged (`tabId`, `order`, `width`, `rowBreakBefore`).
  - Canvas v2 Zod schema in [`canvas-layout-persistence.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts#L28-L41) is untouched; view mode is never persisted.
  - `TileLayout` in [`canvas-layout.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L29-L34) remains `{ x, y, w, h }`.
  - Public export barrel [`libs/frontend/canvas/src/index.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/index.ts) is unchanged.

### 8. Tests
- **Verification**:
  - Existing assertions in [`canvas-workspace-grid.component.spec.ts:562`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts#L562) and [`:749`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts#L749) were weakened by replacing default auto tiles with `setAllSpansToThirds` to conceal the drag reconstruction defect.
  - In [`canvas-layout-intent.spec.ts:257-264`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts#L257-L264), observation widths were altered from realistic pre-drag dimensions to fabricated values matching post-apportionment widths.
  - Both suites must be restored to assert proper drag reconstruction for default auto-width tiles.

---

## Data Flow

1. `TabManagerService.toggleTabViewMode(tabId)` updates the tab signal. **[OK]**
2. `CanvasWorkspaceGridComponent.viewConstraints` computed derives transient constraints with structural equality check. **[OK]**
3. `CanvasLayoutService.computeLayout()` runs pure `projectTileGeometry()` and calculates `cellHeightFor()`. **[OK]**
4. `applyAuthoritativeGeometry()` diffs and batches changes to `grid.update()`. **[GAP: Missing static suspend/restore fallback under lock]**
5. Pointer drag moves Gridstack item and fires `onGridChange`. **[OK]**
6. `readCompleteNodes()` captures `(x, y, w, h)` observations. **[OK]**
7. `projectDragIntent()` tests candidate `rowBreakBefore` masks. **[GAP: Fails for all auto tiles due to strict `w` and `x` equality check]**
8. Store commits reconstructed intent and re-applies authoritative layout. **[OK]**

---

## Requirements Fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Compact tile shrinks to 2 height units and responsive minimum width | COMPLETE | None |
| Mixed-row skyline packing with hole fill | COMPLETE | None |
| Hard fence on `rowBreakBefore` | COMPLETE | None |
| Full view restores stored width intent | COMPLETE | None |
| Layout focus overrides compact geometry (12x6) | COMPLETE | None |
| Compact tile cannot be resized | COMPLETE | None |
| Mid-gesture view change cancels cleanly | COMPLETE | None |
| Compact toggle enabled under lock with authoritative reflow | PARTIAL | Programmatic `grid.update` fallback for static mode not implemented |
| Retain cross-row drag for auto-width tiles | MISSING | Strict reconstruction breaks cross-row drag for all default auto tiles |
| Persistence, schemas, and public API untouched | COMPLETE | None |

---

## Edge Cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Drag auto-width tile across rows | NO | Rejected by `projectDragIntent` | **Blocking regression** |
| Tiny viewport / 0 dimensions | YES | Fallback `{ cellHeight: 120, ... }` and `MIN_CELL_HEIGHT` clamp | None |
| All-compact tiles (no full tile) | YES | Omits 90% floor; fits skyline extent | None |
| Compact singleton | YES | Omits `.singleton-expanded`; keeps `h = 2` | None |
| Toggle view mode while locked | YES | Lock exception bypasses guard for fingerprint difference | Static Gridstack update fallback omitted |
| Fast streaming tab updates | YES | Structural equality on `(tabId, heightTier)` prevents churn | None |
| Mid-gesture view mode switch | YES | Fingerprint mismatch triggers reactive and terminal cancel | None |

---

## Verdict

- **Recommendation**: REVISE
- **Confidence**: HIGH
- **Top risk**: Default auto-width tiles cannot be dragged across rows, completely breaking standard multi-tile organization in the canvas.
- **What a robust implementation would add**:
  1. Fix [`canvas-layout-intent.ts:662-675`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L662-L675) so `auto` full tiles are not required to match pre-drag `w` and `x` coordinates against candidate re-apportioned widths.
  2. Restore unit test fixtures in [`canvas-workspace-grid.component.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts) and [`canvas-layout-intent.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts) to verify auto-width cross-row drags.
  3. Implement the planned static-mode suspend/restore fallback around `grid.update()` inside `_applyingLayout` in [`canvas-workspace-grid.component.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts).
  4. Move `_appliedViewFingerprint` assignment inside the `try` block after successful batch update.

---

## Re-review (Round 1)

### Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 9/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 0                                    |
| Failure modes found | 0                                    |

### Defect Verification Matrix

| Original Defect | Status | File:Line Evidence |
| --- | --- | --- |
| 1. [BLOCKING] Auto-width cross-row drag rejected in `projectDragIntent` | **FIXED** | [`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:668-684`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L668-L684). `autoFull` flag bypasses `item.x`/`item.w` matching for full auto tiles while keeping `item.y` and `item.h` strict for every tile, and keeping `x`/`w` strict for named spans and compact tiles. Verified by realistic tests at [`canvas-layout-intent.spec.ts:256-270`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts#L256-L270) and hole fill at [`:286-316`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts#L286-L316). |
| 2. [SERIOUS] Missing static-mode programmatic update fallback in locked grid reflow | **FIXED** | [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:692-725`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L692-L725). `restoreStatic` tracks `this.locked()`, calls `grid.setStatic(false)` inside `_applyingLayout`, executes the guarded batch, and guarantees `grid.setStatic(true)` plus `applyNodeInteractionState(grid)` in `finally`. Verified in [`canvas-workspace-grid.component.spec.ts:944-959`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts#L944-L959). |
| 3. [MODERATE] Unit test coverage weakened to mask drag reconstruction failure | **FIXED** | [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts:561-582`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts#L561-L582), [`:747-771`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts#L747-L771). Both component tests restored to default `auto` tiles without `setAllSpansToThirds`. Realistic pre-drag widths tested in [`canvas-layout-intent.spec.ts:256-270`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts#L256-L270). |
| 4. [MINOR] Premature `_appliedViewFingerprint` update before Gridstack batch execution | **FIXED** | [`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:662-665`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L662-L665), [`:710`](file:///D:/projects/ptah-extension/.claude-worktrees/task-451-compact-tile-sizing/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L710). Empty workspace assigns fingerprint once and returns; populated layouts update `_appliedViewFingerprint` inside `try` after successful batch completion. |

### New Defects

None.

### Verification of Edge Cases & Invariants

1. **Auto In-Row Reorder**: In-row dragging of auto tiles retains identical `y = 0` across all items, properly selecting the zero-break mask without triggering false row splits.
2. **Skyline Hole Integrity**: For an auto tile contracted into a skyline hole (`y = 2`), any candidate mask that inserts an invalid `rowBreakBefore` lifts `readingFloorY` to 6, which immediately mismatches observed `y = 2` and is rejected.
3. **Static Restore Safety**: If `grid.update()` throws inside `_applyingLayout`, `grid.setStatic(true)` is guaranteed by the outer `finally` block before `_applyingLayout = false` is cleared in the nested `finally`, ensuring the grid is never left interactive or unprotected.
4. **E2E Compatibility**: The pre-existing Electron E2E test at [`apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:139-234`](file:///D:/projects/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts#L139-L234) drags default auto tiles to create a 2+1 layout. The relaxed full-auto matcher accepts the realistic `(x=0,y=0,w=4)`, `(x=4,y=0,w=4)`, `(x=0,y=6,w=4)` observations and commits the `[F, F, T]` mask cleanly.
5. **Tooling Verification**:
   - `npx nx test @ptah-extension/canvas`: 9/9 suites passed, 149/149 tests passed.
   - `npx nx lint @ptah-extension/canvas`: 0 errors, 0 warnings.
   - `npx nx typecheck @ptah-extension/canvas`: Passed.
   - `npx nx typecheck ptah-electron-e2e`: Passed.

### Final Verdict

- **Recommendation**: APPROVED
- **Confidence**: HIGH
- **Verdict Summary**: All 4 defects from Round 1 have been completely resolved with clean, robust logic and comprehensive test coverage. No regressions or architectural leaks remain.

