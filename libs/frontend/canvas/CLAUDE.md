# Canvas (Orchestra Canvas)

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

Multi-session "Orchestra Canvas" panel. Renders a drag-and-resize grid of chat tiles (up to 9), each backed by a tab from `@ptah-extension/chat`'s `TabManagerService`. Layout is powered by Gridstack.js.

## Boundaries

**Belongs here**: tile composition, per-canvas layout/store, agent indicator widgets.
**Does NOT belong**: tab lifecycle (lives in `@ptah-extension/chat`), session RPC (core), app routing (core `AppStateManager`).

## Public API

From `src/index.ts`: `OrchestraCanvasComponent`, `CanvasTileComponent`, `CanvasEmptyStateComponent`, `CanvasStore`, `CanvasLayoutService`, `TileAgentIndicatorComponent`, `TileAgentMiniPanelComponent` plus `CanvasTile`, `CanvasLayout`, `TileLayout` types. **Unchanged by TASK_2026_387** — the intent refactor changed what `CanvasTile` holds, not which names this lib exports. `TileLayout` keeps the exact shape `{ x, y, w, h }`; `libs/frontend/tribunal-panel` imports it, so changing it is a cross-lib break.

## Internal Structure

Flat — all files live directly under `src/lib/`. No subfolders.

## Key Files

- `src/lib/orchestra-canvas.component.ts:50` — top-level panel; OnPush; `providers: [CanvasStore, CanvasLayoutService]` ensures each canvas instance has its own store.
- `src/lib/canvas.store.ts:21` — scoped (non-root) store; tracks `tiles`, `focusedTabId`; capped at `MAX_TILES = 9` (3×3); bridges to `TabManagerService` for session→tab resolution. A tile is `{ tabId, order, weight }` — **intent only**; no `x`/`y`/`w`/`h` is ever stored. Writers: `reorderTiles(orderedTabIds)` and `setTileWeights(map)`, both returning the same array reference on a no-op so the signal does not notify.
- `src/lib/canvas-layout.service.ts` — `ResizeObserver` + RAF driver plus the pure layout function. Columns come from a minimum tile width (`MIN_TILE_WIDTH = 480`), `columns = clamp(floor((width + margin) / (MIN_TILE_WIDTH + margin)), 1, MAX_COLUMNS)` — not from pixel breakpoints. Each row's 12 Gridstack units are apportioned by weight (largest remainder, floor `MIN_TILE_UNITS = 2`), so every row — including a short last one — sums to exactly 12 and fills the width. `cellHeight` still keeps each tile at `MIN_TILE_VIEWPORT_RATIO` of the viewport and lets the canvas scroll.
- `src/lib/canvas-workspace-grid.component.ts` — the only file that talks to Gridstack. One grid per retained workspace.
- `src/lib/canvas-tile.component.ts` — single tile shell hosting the chat surface.
- `src/lib/tile-agent-indicator.component.ts` / `tile-agent-mini-panel.component.ts` — per-tile agent status widgets.

## State Management

- Signal-based (`signal`, `computed`, `effect`); zoneless-friendly.
- `CanvasStore` is **scoped per component** (not `providedIn: 'root'`) so multiple canvases can coexist.
- Geometry flows one way: store intent → `CanvasLayoutService.computeLayout()` → `grid.update()`. Gridstack is a renderer, never a store.
- Gestures flow back typed: `(dragStopCB)` / `(resizeStopCB)` latch which gesture ended, then the `(changeCB)` that follows reads `grid.engine.nodes` (the full post-push set, not the dirty `nodes` the event carries) and writes **order** for a drag or **weight** for a resize. A `change` with no latched gesture writes nothing.
- The write-back is suppressed by a synchronous `_applyingLayout` boolean set around the grid-mutation block and cleared in a `finally`. `batchUpdate` is **not** a guard — `batchUpdate(false)` calls `_triggerChangeEvent()` and does emit `change`.
- Focused tab syncs with `TabManagerService`.

## Dependencies

**Internal**: `@ptah-extension/ui` (NativePopover), `@ptah-extension/core` (`AppStateManager`), `@ptah-extension/chat` (`TabManagerService`, `ChatStore`).
**External**: `gridstack` (v12.6.0, uses `gridstack/dist/angular`), `lucide-angular`, `@angular/forms`.

## Angular Conventions Observed

OnPush everywhere, standalone components, signals + `inject()`, `afterNextRender`, `viewChild` signal-API, `effect()` for signal bridges (TASK_2025_271).

## Guidelines

- Never lift `CanvasStore` to root; it must be scoped per panel.
- Intent changes flow through Gridstack's `changeCB`; positions are derived on every layout pass and never stored. Do not add an `x`/`y`/`w`/`h` field back to `CanvasTile`.
- No code outside `CanvasWorkspaceGridComponent` may call a Gridstack API, and `CanvasLayoutService` must never import Gridstack — that is what keeps it unit-testable without the jest module mock.
- Vertical tile resize is deliberately unavailable (`resizable.handles: 'e, w'`): rows must stay height-aligned for the `cellHeight` scroll rule, and intent has no per-tile height field.
- Respect `MAX_TILES = 9` — tile-add operations return `null` when capped.
