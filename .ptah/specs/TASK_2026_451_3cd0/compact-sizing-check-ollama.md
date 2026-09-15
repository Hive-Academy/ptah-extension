# Compact-view tile sizing check

Date: 2026-09-15. Branch: `feat/task-442-fluid-canvas-spans`. Read-only investigation.

## Verdict

**Not covered.** The TASK_2026_442 fluid-layout work covers width only. It does not read the tab view mode, and it explicitly excludes compact sizing. The plan lists it as out of scope:

- `.ptah/specs/TASK_2026_442_68ba/implementation-plan.md:390` — "compact/folded/chip levels of detail" is out of scope.
- `implementation-plan.md:71-74` — "Defer per-tile height tiers": `TILE_HEIGHT_UNITS = 6` stays for all tiles.
- `implementation-plan.md:388` — "Per-tile normal/tall height, vertical resize, masonry or any other two-dimensional packing" is out of scope.

So the reported behaviour is by design of this task, not a regression of it. The compact toggle changes chat content density only. It never reaches the layout layer.

## Intent data path

The full data path never touches view mode:

1. `TileIntent` holds `tabId`, `order`, `width`, `rowBreakBefore` only. There is no height or view-mode field.
   - `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:37-42`
2. `packRows` packs width units into rows. It reads `width` intent, `rowBreakBefore`, capacity, and the transient layout-focus id. It never reads view mode.
   - `canvas-layout-intent.ts:185-219`
3. `computeLayout` maps every packed row to geometry. Every tile in every row gets the same fixed height: `y: rowIndex * TILE_HEIGHT_UNITS, h: TILE_HEIGHT_UNITS`, with `TILE_HEIGHT_UNITS = 6`.
   - `libs/frontend/canvas/src/lib/canvas-layout.service.ts:5` (constant), `:110-112` (assignment)
4. `cellHeightFor` derives one shared cell height from the viewport. `MIN_TILE_VIEWPORT_RATIO = 0.9` is a per-grid floor, not a per-tile value.
   - `canvas-layout.service.ts:12`, `:140-150`
5. `CanvasStore` holds tiles, focus, revisions, lock, and layout focus per workspace. It has no view-mode state. A grep over `libs/frontend/canvas/src` finds view-mode reads in one file only: `canvas-tile.component.ts:373-375, :410-413`.
   - `libs/frontend/canvas/src/lib/canvas.store.ts:93-107` (state signals)
6. `CanvasLayoutPersistenceService` v2 writes only `tabId`, `order`, `width`, `rowBreakBefore`. The Zod schemas are `strictObject`, so any new intent field would also need a schema bump to validate.
   - `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts:28-41` (v2), `:43-62` (v1), `:265-278` (write)

## Where view mode lives

- `TabViewMode = 'full' | 'compact'` — `libs/frontend/chat-types/src/lib/chat-types.ts:430`; `TabState.viewMode?: TabViewMode` — `chat-types.ts:639`.
- `TabManagerService.toggleTabViewMode` / `getTabViewMode` — `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2540-2547`, `:2551-2552`. `getTabViewMode` reads the `_tabs()` signal, so it is reactive inside a `computed`.
- View mode is **not persisted**. Neither `tab-persistence.ts` nor `tab-workspace-partition.service.ts` mentions `viewMode`. A reload resets every tab to `'full'`.
- Boundary check: the canvas already imports `TabManagerService` from `@ptah-extension/chat` (`canvas.store.ts:9`, `canvas-tile.component.ts:19-25`). Tags: canvas is `scope:webview, type:feature` (`libs/frontend/canvas/project.json:7`); chat-state is `scope:webview, type:data-access` (`libs/frontend/chat-state/project.json:7`). Observing view mode from the canvas breaks no module boundary. No new dependency is needed.
- The toggle has two other entry points outside the canvas: the chat tab bar (`libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:199`) and inside the chat view itself (`libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1293`). Any sizing fix must react to view mode wherever it is toggled, not only to the tile-header button.

## Root causes

1. The compact toggle writes chat state only. It never notifies the canvas layout layer.
   `canvas-tile.component.ts:410-413` (`onToggleViewMode` → `tabManager.toggleTabViewMode`) and `tab-manager.service.ts:2540-2545`. Nothing else changes.
2. `computeLayout` assigns one fixed height to every tile, regardless of content mode.
   `canvas-layout.service.ts:5` (`TILE_HEIGHT_UNITS = 6`) and `:110-112` (`y: rowIndex * TILE_HEIGHT_UNITS, h: TILE_HEIGHT_UNITS`).
3. `TileIntent` cannot express a height preference. The intent union covers width only.
   `canvas-layout-intent.ts:26-28` (`TileWidthIntent`), `:37-42` (`TileIntent`).
4. Tile width is also untouched by the toggle. Width comes from the stored span/auto intent, and the compact toggle does not write a span. So the tile keeps its width too.
   `canvas-tile.component.ts:412` writes no span; width renders from `effectiveUnits` (`canvas-layout-intent.ts:154-162`).
5. No neighbour reflow is possible from a compact toggle. The grid projection depends on tile intent, layout focus, and measured size only (`canvas-layout.service.ts:89-101`, `canvas-workspace-grid.component.ts:199-209`). A view-mode change changes none of these, so the derived geometry is byte-identical.
6. Vertical resize is deliberately disabled, which keeps every row height-aligned. This is a standing contract of this library, independent of TASK_2026_442.
   `canvas-workspace-grid.component.ts:176-179` (`resizable: { handles: 'e, w' }`), `libs/frontend/canvas/CLAUDE.md:46`.

## Proposed intent-layer fix

### Data shape

Add a per-tile height preference to the **projection input**, not to stored `TileIntent`:

- Extend `computeLayout(tiles, layoutFocusTabId, heightOverrides: ReadonlyMap<string, 'normal' | 'compact'>)` or pass a richer per-tile view-model.
- Source the map reactively from `TabManagerService` in `CanvasWorkspaceGridComponent` (a `computed` over `tabManager.tabs()` mapping `tabId → viewMode`). `getTabViewMode` is signal-backed, so this stays zoneless-safe.
- Do **not** copy the flag into `TileIntent`. The view mode already has three toggle entry points (tile header, tab bar, chat view). A copy would create two authorities that drift. Treat it like `layoutFocusTabId`: observed state that changes projection only.
- Do **not** persist it. View mode is un-persisted today (`tab-persistence.ts` has no `viewMode`), the v2 schema is `strictObject`, and the plan already rules out persisting projection-only state (`implementation-plan.md:391`). No schema bump to v3 is needed.

### What `computeLayout` should produce

- `COMPACT_TILE_HEIGHT_UNITS = 2` (a header-height band) beside `TILE_HEIGHT_UNITS = 6`.
- A compact tile renders `h: COMPACT_TILE_HEIGHT_UNITS`; a normal tile keeps `h: 6`.
- Compute `y` cumulatively: each row's height is the maximum of its members' height units, and `y` advances by that row height. Keep rows in reading order; do not reorder.
- Simplest deterministic rule for mixed rows: a row keeps normal height unless **all** its members are compact. This preserves the documented row-alignment contract (`CLAUDE.md:46`) inside a row. A compact tile in a mixed row still shows its compact content, but the saved height only materializes when the whole row is compact. This avoids the two-dimensional packing the plan deferred (`implementation-plan.md:73-74`).
- Minimum viewport floor: keep the current `MIN_TILE_VIEWPORT_RATIO = 0.9` rule (`canvas-layout.service.ts:140-150`) applied to the tallest row. Do not add a per-tile floor; the compact band is short by intent, and a floor would defeat it.

### How neighbours reflow

- The existing projection path already re-applies derived geometry: `layout` computed → `applyAuthoritativeGeometry` → `grid.update()` (`canvas-workspace-grid.component.ts:199-209`, `:558-597`). Rows below a compact row receive smaller `y` values and slide up. Gridstack `float: false` gravity matches this direction already (`canvas-workspace-grid.component.ts:170-173`).
- Width stays untouched: the stored span intent still governs `w` (`canvas-layout-intent.ts:154-162`). If the product also wants a compact tile to narrow, add a `compact` branch to `effectiveUnits` later — keep it out of this fix.
- Gridstack will report changed node positions via its `change` event; the `_applyingLayout` guard (`canvas-workspace-grid.component.ts:259`, `:271-275`) must stay set around the update so a view-mode-driven reflow is not misread as a user gesture.

### Lock interaction — decision needed

Lock freezes "layout intent or projection changes" (`implementation-plan.md:223`). A compact toggle under lock would now change projection. Either exempt view mode from lock (it is a content action) or disable the toggle while locked. Recommend exempting it and documenting the exception, because the same toggle already works inside the locked chat surface.

## Test coverage gaps

**Existing tests for compact sizing: none.** The only view-mode references in canvas specs are `TabManagerService` mocks:

- `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts:110-111`, `:240-241`, `:366-367`, `:439-440` (mock setup only).
- Chat-state has toggle round-trip tests with no layout claims: `libs/frontend/chat-state/src/lib/tab-manager.lifecycle.spec.ts:384-392`, `tab-manager.intent-mutators.spec.ts:969-975`.

Spec cases to add:

1. `canvas-layout.service.spec.ts`
   - A compact tile renders `h = COMPACT_TILE_HEIGHT_UNITS`; a normal tile keeps `h = 6`.
   - A fully compact row is shorter; a mixed row keeps normal height.
   - Rows below a compact row advance by the compact row height (reflow).
   - The viewport-ratio floor still holds for the tallest row when a compact band exists.
   - `computeLayout` is total for empty `heightOverrides` (backwards-compatible default).
2. `canvas-workspace-grid.component.spec.ts`
   - A view-mode change re-applies derived geometry with `_applyingLayout` set, and does not start a gesture commit.
   - A compact reflow while a drag is in flight cancels the gesture (extend the gesture-invalidation effect inputs, `canvas-workspace-grid.component.ts:309-328`, with the height-override identity).
   - The grid projection never writes a span, order, or row break on a view-mode change.
3. `canvas.store.spec.ts`
   - No store state or revision changes when view mode toggles (guards against accidental intent mirroring).
4. `canvas-tile.component.spec.ts`
   - The header button title/icon follow `isCompactMode()`.
   - The toggle still routes through `TabManagerService` and stops propagation.

## Clarifications Needed

None blocking the analysis. One product decision before implementation: whether lock must also freeze compact sizing (see "Lock interaction"), and whether a compact tile should also narrow (deferred here).