# Canvas (Orchestra Canvas)

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

Multi-session "Orchestra Canvas" panel. Renders a drag-and-resize grid of chat tiles (up to 9), each backed by a tab from `@ptah-extension/chat`'s `TabManagerService`. Layout is powered by Gridstack.js.

## Boundaries

**Belongs here**: tile composition, per-canvas layout/store, agent indicator widgets.
**Does NOT belong**: tab lifecycle (lives in `@ptah-extension/chat`), session RPC (core), app routing (core `AppStateManager`).

## Public API

From `src/index.ts`: `OrchestraCanvasComponent`, `CanvasTileComponent`, `CanvasEmptyStateComponent`, `CanvasStore`, `CanvasLayoutService`, `TileAgentIndicatorComponent`, `TileAgentMiniPanelComponent` plus `CanvasTile`, `CanvasLayout`, `TileLayout` types.

## Internal Structure

Flat — all files live directly under `src/lib/`. No subfolders.

## Key Files

- `src/lib/orchestra-canvas.component.ts:50` — top-level panel; OnPush; `providers: [CanvasStore, CanvasLayoutService]` ensures each canvas instance has its own store.
- `src/lib/canvas.store.ts:21` — scoped (non-root) store; tracks `tiles`, `focusedTabId`; capped at `MAX_TILES = 9` (3×3); bridges to `TabManagerService` for session→tab resolution.
- `src/lib/canvas-layout.service.ts:24` — `ResizeObserver` + RAF driver computing responsive grid layout across breakpoints (500/900 px).
- `src/lib/canvas-tile.component.ts` — single tile shell hosting the chat surface.
- `src/lib/tile-agent-indicator.component.ts` / `tile-agent-mini-panel.component.ts` — per-tile agent status widgets.

## State Management

- Signal-based (`signal`, `computed`, `effect`); zoneless-friendly.
- `CanvasStore` is **scoped per component** (not `providedIn: 'root'`) so multiple canvases can coexist.
- Gridstack events `(changeCB)` → store position updates; focused tab syncs with `TabManagerService`.

## Dependencies

**Internal**: `@ptah-extension/ui` (NativePopover), `@ptah-extension/core` (`AppStateManager`), `@ptah-extension/chat` (`TabManagerService`, `ChatStore`).
**External**: `gridstack` (v12.5.0, uses `gridstack/dist/angular`), `lucide-angular`, `@angular/forms`.

## Angular Conventions Observed

OnPush everywhere, standalone components, signals + `inject()`, `afterNextRender`, `viewChild` signal-API, `effect()` for signal bridges (TASK_2025_271).

## Guidelines

- Never lift `CanvasStore` to root; it must be scoped per panel.
- Position changes must flow through Gridstack's `changeCB` to keep store/DOM in sync.
- Respect `MAX_TILES = 9` — tile-add operations return `null` when capped.
