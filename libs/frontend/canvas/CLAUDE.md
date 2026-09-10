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
- `src/lib/canvas.store.ts:21` — scoped (non-root) store; tracks workspace-partitioned tiles, focus, revision and Auto/1/2/3 maximum; capped at `MAX_TILES = 9`; bridges to `TabManagerService` for session→tab resolution. A tile is `{ tabId, order, weight, rowBreakBefore }` — **intent only**; no `x`/`y`/`w`/`h` is ever stored. Gesture commits are addressed by workspace and compare the captured revision atomically.
- `src/lib/canvas-layout.service.ts` — `ResizeObserver` + RAF driver plus the pure layout function. Columns come from a minimum tile width (`MIN_TILE_WIDTH = 480`) capped by the workspace preference. Explicit logical rows are partitioned first; responsive chunks are render-only and never write intent. Each rendered row's 12 Gridstack units are apportioned by weight.
- `src/lib/canvas-layout-intent.ts` — pure logical-row removal/reconciliation and drag projection. Removing a row start transfers its boundary to the row's next survivor. Capacity-one geometry can reorder only inside existing logical-row blocks.
- `src/lib/canvas-workspace-grid.component.ts` — the only file that talks to Gridstack. One grid per retained workspace. Stable creation options prevent Angular's item setter becoming a second geometry writer; one guarded imperative effect diffs and batches changed nodes only.
- `src/lib/canvas-render-metrics.service.ts` — bounded, panel-local geometry/gesture counters exposed as diagnostic data attributes by the workspace grid.
- `src/lib/canvas-tile.component.ts` — single tile shell hosting the chat surface.
- `src/lib/tile-agent-indicator.component.ts` / `tile-agent-mini-panel.component.ts` — per-tile agent status widgets.

## State Management

- Signal-based (`signal`, `computed`, `effect`); zoneless-friendly.
- `CanvasStore` is **scoped per component** (not `providedIn: 'root'`) so multiple canvases can coexist.
- Geometry flows one way: store intent → `CanvasLayoutService.computeLayout()` → `grid.update()`. Gridstack is a renderer, never a store.
- Gestures capture workspace, revision, capacity, dragged id and complete membership at start. The following stop/change validates the full engine node set before atomically writing order/breaks or weights to the captured workspace. Hide, lock, destroy, capacity/revision change and incomplete observations cancel or reject the whole commit. Every terminal path, including an accepted semantic no-op, then reconciles existing engine nodes from current authoritative intent; it never creates a missing node or projects an old gesture into another workspace.
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
