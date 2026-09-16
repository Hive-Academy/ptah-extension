# Compact-View Tile Sizing Check

**Date:** 2026-09-15  
**Branch:** `feat/task-442-fluid-canvas-spans` (TASK_2026_442)  
**Scope:** Read-only architectural and layout investigation into compact mode sizing and neighbor reflow.

---

## Verdict

**Not covered.**

TASK_2026_442 introduces fluid horizontal layout (per-tile `TileWidthIntent` with named spans `third | half | two-thirds | full`, `auto` relative weights, presets, responsive capacity promotion, and local-storage persistence). It explicitly does **not** cover vertical sizing, compact mode sizing, or neighbor reflow when switching view modes.

Direct evidence from [implementation-plan.md](../TASK_2026_442_68ba/implementation-plan.md):
- **Deferred height tiers ([implementation-plan.md:70-74](../TASK_2026_442_68ba/implementation-plan.md#L70-L74)):**
  > *"Defer per-tile height tiers — Chosen approach: retain `TILE_HEIGHT_UNITS = 6` for all tiles. Rationale: current horizontal-only resize and height alignment are deliberate inputs to cell-height scrolling... Tall tiles introduce vertical collision/packing and are not needed for any acceptance criterion."*
- **Explicit out-of-scope exclusions ([implementation-plan.md:388-390](../TASK_2026_442_68ba/implementation-plan.md#L388-L390)):**
  > *"Per-tile normal/tall height, vertical resize, masonry or any other two-dimensional packing."*  
  > *"Raising `MAX_TILES`, compact/folded/chip levels of detail, zoom, notification center or concurrency changes from TASK_2026_404."*
- **Originating context notes ([context.md:37-38, 52-55](../TASK_2026_442_68ba/context.md#L37-L55)):**
  Equal tile height was identified as a known limitation, but height tiers were deemed optional and postponed in favor of solving width spans first.

The compact mode toggle in [canvas-tile.component.ts](../../../libs/frontend/canvas/src/lib/canvas-tile.component.ts) updates only the presentation layer inside the chat view. It has no connection to stored canvas intent, `packRows()`, `computeLayout()`, or Gridstack geometry.

---

## Layout derivation

### 1. Inside the Tile: Content vs. Stretched Layout

Inside the tile, compact view content does **not** size to its content. Instead, it is stretched vertically and horizontally across every layer of the DOM hierarchy down to the fixed Gridstack item dimensions:

1. **Gridstack Item Geometry**:
   Gridstack assigns explicit pixel heights to `.grid-stack-item` based on derived `h` (hardcoded to 6 units) multiplied by `cellHeight`.
   In [canvas-layout.service.ts:12-13, 140-150](../../../libs/frontend/canvas/src/lib/canvas-layout.service.ts#L12-L13), `cellHeightFor()` enforces:
   ```ts
   const minTileCellHeight = Math.floor((height * MIN_TILE_VIEWPORT_RATIO) / TILE_HEIGHT_UNITS);
   ```
   With `MIN_TILE_VIEWPORT_RATIO = 0.9` and `TILE_HEIGHT_UNITS = 6`, a 6-unit tile is guaranteed to occupy at least 90% of the container viewport height.
2. **Tile Component Shell**:
   In [canvas-tile.component.ts:91](../../../libs/frontend/canvas/src/lib/canvas-tile.component.ts#L91), the host element root `.canvas-tile` has `class="canvas-tile flex flex-col border rounded-lg h-full overflow-hidden"`.
   In [canvas-tile.component.ts:227](../../../libs/frontend/canvas/src/lib/canvas-tile.component.ts#L227), the outlet wrapper div has `class="flex-1 min-h-0 overflow-hidden"`.
3. **Chat View Component**:
   In [chat-view.component.html:1, 3, 8, 10](../../../libs/frontend/chat/src/lib/components/templates/chat-view.component.html#L1-L10):
   ```html
   <div class="flex h-full">
     <div class="flex-1 flex flex-col min-w-0 relative">
       @if (resolvedViewMode() === 'compact' && resolvedActiveTab()) {
         <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
           <ptah-compact-session-card class="flex-1 min-h-0" ... />
         </div>
       }
   ```
4. **Compact Session Card Organism**:
   In [compact-session-card.component.ts:58, 64, 89](../../../libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts#L58-L89):
   - Host binding: `class: 'flex flex-col h-full'`
   - Root element: `class="flex flex-col h-full border overflow-hidden ..."`
   - Inner activity feed: `<ptah-compact-session-activity class="flex-1 min-h-0" ...>` explicitly consumes all remaining height.
   - Even when the user collapses the card internally (`isCollapsed() === true`), the surrounding elements retain `h-full` and `flex-1`, rendering empty background whitespace rather than shrinking the Gridstack tile.
5. **Singleton Override**:
   In [canvas-workspace-grid.component.ts:136-141](../../../libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L136-L141), whenever there is only 1 tile, CSS forces `gridstack.singleton > gridstack-item { width: 100% !important; height: 100% !important; }`.

### 2. Height (`h`) and Width (`w`) Derivation Today

- **Height (`h`)**:
  Derived exclusively in [canvas-layout.service.ts:104-116](../../../libs/frontend/canvas/src/lib/canvas-layout.service.ts#L104-L116):
  ```ts
  rows.forEach((row, rowIndex) => {
    let x = 0;
    for (const tile of row) {
      positioned.push({
        tabId: tile.tabId,
        x,
        y: rowIndex * TILE_HEIGHT_UNITS,
        w: tile.units,
        h: TILE_HEIGHT_UNITS,
      });
      x += tile.units;
    }
  });
  ```
  `h` is hardcoded to `TILE_HEIGHT_UNITS = 6` for all tiles. There is **no input** to `CanvasLayoutService.computeLayout()` or `packRows()` that can alter a tile's height.
- **Width (`w`)**:
  Derived solely from `TileIntent.width` via `effectiveUnits(tile.width, capacity)` in [canvas-layout-intent.ts:154-162](../../../libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L154-L162).
  Width is modified only by:
  - Header layout popover menu actions (`spanRequested` -> `CanvasStore.setTileSpan`)
  - Horizontal resize gestures snapped to named spans (`commitResizeSpan`)
  - Layout presets (`even-grid`, `one-plus-two`, `focus-plus-stack`)
  Compact mode does not emit to or modify `TileWidthIntent`. Hence, tile width is completely unaffected when switching to compact mode.

---

## Root causes

1. **Hardcoded Height in Layout Derivation**  
   [canvas-layout.service.ts:5, 110-112](../../../libs/frontend/canvas/src/lib/canvas-layout.service.ts#L5)<br>
   `TILE_HEIGHT_UNITS = 6` is a module constant. `computeLayout()` assigns `h: TILE_HEIGHT_UNITS` and `y: rowIndex * TILE_HEIGHT_UNITS` unconditionally to every tile.

2. **Per-Grid Viewport Height Floor**  
   [canvas-layout.service.ts:12-13, 140-150](../../../libs/frontend/canvas/src/lib/canvas-layout.service.ts#L12-L13)<br>
   `MIN_TILE_VIEWPORT_RATIO = 0.9` calculates `minTileCellHeight = Math.floor((height * 0.9) / 6)`, ensuring a 6-unit row takes ~90% of the viewport and preventing any row from becoming shorter in pixels.

3. **`TileIntent` Model Lacks Height / View-Mode Dimension**  
   [canvas-layout-intent.ts:37-42](../../../libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L37-L42)<br>
   `TileIntent` only models `{ tabId, order, width: TileWidthIntent, rowBreakBefore }`. Neither height nor view mode is captured in the store or intent types.

4. **Pure 1D Horizontal Row Packing**  
   [canvas-layout-intent.ts:185-219](../../../libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L185-L219)<br>
   `packRows()` only packs horizontal span units up to `GRID_COLUMNS = 12`. It has no 2D bin-packing, column-occupancy model, or vertical compaction logic.

5. **Compact View Mode Toggle Disconnected from Canvas State**  
   [canvas-tile.component.ts:198-202, 411-413](../../../libs/frontend/canvas/src/lib/canvas-tile.component.ts#L198-L202)<br>
   `onToggleViewMode()` invokes `tabManager.toggleTabViewMode(this.tabId())` in `TabManagerService`. It does not emit an event to `CanvasWorkspaceGridComponent` or `CanvasStore`, does not bump `workspaceRevision`, and does not trigger canvas re-projection.

6. **TASK_2026_442 Specification Explicitly Deferred Height Tiers**  
   [implementation-plan.md:70-74, 388-390](../TASK_2026_442_68ba/implementation-plan.md#L70-L74)<br>
   Per-tile height tiers and compact/chip levels of detail were scoped out to keep the width-span migration tractable.

7. **CSS Flexbox and Percentage Rules Force Full Height**  
   - [canvas-tile.component.ts:91, 227](../../../libs/frontend/canvas/src/lib/canvas-tile.component.ts#L91) (`h-full`, `flex-1 min-h-0`)
   - [chat-view.component.html:1, 3, 8, 10](../../../libs/frontend/chat/src/lib/components/templates/chat-view.component.html#L1-L10) (`h-full`, `flex-1`, `min-h-0`)
   - [compact-session-card.component.ts:58, 64, 89](../../../libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts#L58-L89) (card host and root `h-full`, activity feed `flex-1 min-h-0`)

8. **Gridstack Resizing Configured for Horizontal Only**  
   [canvas-workspace-grid.component.ts:179](../../../libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L179)<br>
   `resizable: { handles: 'e, w' }` blocks vertical resizing gestures.

---

## Proposed fix + UX

### Architectural Guidelines
1. **Unidirectional Layout Authority**: Geometry must remain a pure projection: `Store Intent / View Constraints -> canvas-layout-intent.ts -> CanvasLayoutService -> grid.update()`. Gridstack event handlers must never resolve or invent geometry constraints ([libs/frontend/canvas/CLAUDE.md:42](../../../libs/frontend/canvas/CLAUDE.md#L42)).
2. **Single Source of Truth**: `TabManagerService.tabs()` already manages `tab.viewMode: 'full' | 'compact'` reactively. Do not duplicate view mode into persisted canvas intent; treat it like `layoutFocusTabId` as an observed projection input.

### Smallest Correct Fix
1. **Pass View Mode as a Projection Input**:
   - In [canvas-workspace-grid.component.ts](../../../libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts), inject `TabManagerService` (already imported in the canvas library).
   - Create a computed signal mapping `tabId -> TabViewMode` from `tabManager.tabs()`.
   - Pass this view-mode mapping into `layoutService.computeLayout(this.tiles(), this.layoutFocusTabId(), viewModes)`.
2. **Define Discrete Height Units**:
   - In [canvas-layout-intent.ts](../../../libs/frontend/canvas/src/lib/canvas-layout-intent.ts):
     - `FULL_TILE_HEIGHT_UNITS = 6`
     - `COMPACT_TILE_HEIGHT_UNITS = 2` (or 3, matching header + condensed activity/input ~200-240px).
3. **Pure Vertical Placement & Reflow in `canvas-layout-intent.ts`**:
   - *Row Compaction*: Determine the effective height of each row: `rowHeight = Math.max(...rowTiles.map(t => t.heightUnits))`.
   - When all tiles in a row are switched to compact, that row's height shrinks to `COMPACT_TILE_HEIGHT_UNITS`. Subsequent rows advance by `y += rowHeight`, allowing tiles below to reflow upwards.
   - *Optional 2D Skyline Reflow*: If compact tiles are half-height (e.g. 3 units) and share a column span, stack them vertically within the 12-column skyline so individual compact tiles don't leave vertical holes.
4. **Adaptive Viewport Scaling**:
   - In [canvas-layout.service.ts:140-150](../../../libs/frontend/canvas/src/lib/canvas-layout.service.ts#L140-L150), update `cellHeightFor()` to divide available height by the total vertical units `max(y + h)` across all positioned tiles, rather than assuming `rows * 6`. Exclude compact tiles from the `MIN_TILE_VIEWPORT_RATIO = 0.9` floor.
5. **Mode-Aware Singleton Styling**:
   - In [canvas-workspace-grid.component.ts:136-141](../../../libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L136-L141), disable the `height: 100% !important` override when the singleton tile is compact.

### Expected UX
- **Compact View Activation**:
  - The tile height immediately collapses from 6 units to 2 (or 3) units.
  - Tiles directly below reflow upward into the freed vertical space.
  - The tile retains its existing width span (or auto weight).
- **Restoring Full View**:
  - Toggling back to full view expands the tile back to `h = 6`.
  - Neighbouring tiles below are pushed downward (fluid downward reflow).
  - Pre-existing order, row breaks, and width spans remain untouched.
- **Lock Interaction**:
  - Decided behavior: Canvas lock freezes layout intent and gestures; toggle button in header should either be disabled when locked or explicitly documented as content-only.

---

## Test coverage gaps

**Existing tests covering compact mode sizing: None.**

Review of spec files in the repository:
1. `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts:110, 240, 366, 439`: Only mocks `getTabViewMode: jest.fn().mockReturnValue('full')` for unrelated tests. No assertions exist for clicking `onToggleViewMode`, icon switching, or layout emission.
2. `libs/frontend/chat-state/src/lib/tab-manager.lifecycle.spec.ts:384-393` and `libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts:970-976`: Test only the string property toggle on `TabManagerService` (`getTabViewMode(id) === 'compact'`). No layout or geometry assertions exist.
3. `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts`: All tests assert `h === 6` and `y === rowIndex * 6`. No tests exist for compact mode, variable heights, or vertical reflow.
4. `libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts`: All tests assert on horizontal span units and row breaks. No tests exist for tile heights.
5. `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts`: No tests for view mode changes triggering grid updates.
6. `libs/frontend/chat-ui/src/lib/molecules/compact-session/`: No unit test spec files exist in this directory.

### Tests Required for the Proposed Fix
- `canvas-layout-intent.spec.ts`: Variable tile height packing, row height derivation, and vertical reflow.
- `canvas-layout.service.spec.ts`: Mixed full/compact tile geometry, cell height calculation without viewport floor on compact tiles.
- `canvas-workspace-grid.component.spec.ts`: Reactive view-mode changes triggering `grid.update()` with `_applyingLayout` set, ensuring no accidental gesture commits.
- `canvas-tile.component.spec.ts`: View mode toggle button interaction and accessible title updates.
