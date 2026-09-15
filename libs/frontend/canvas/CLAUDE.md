# Canvas (Orchestra Canvas)

[Back to Main](../../../CLAUDE.md)

## Purpose

Multi-session Orchestra Canvas panel. It renders a drag-and-resize Gridstack grid of up to nine chat tiles, each backed by a `TabManagerService` tab.

## Boundaries

**Belongs here**: tile composition, panel-scoped layout/store/persistence, and agent indicator widgets.
**Does not belong**: tab lifecycle (`@ptah-extension/chat`), session RPC, or app routing (`AppStateManager`).

## Public API

`src/index.ts` exports `OrchestraCanvasComponent`, `CanvasTileComponent`, `CanvasEmptyStateComponent`, `CanvasStore`, `CanvasLayoutService`, `TileAgentIndicatorComponent`, `TileAgentMiniPanelComponent`, and the existing `CanvasTile`, `CanvasLayout`, and `TileLayout` types. `TileLayout` remains exactly `{ x, y, w, h }`; `libs/frontend/tribunal-panel` consumes it.

## Key Files

- `orchestra-canvas.component.ts` is the OnPush panel root. Its providers scope the store, layout, persistence, and metrics services to one canvas instance.
- `canvas.store.ts` is the intent facade. State is partitioned by workspace and contains active-session focus, transient layout focus, revisions, lock state, and at most nine tiles.
- `canvas-layout-intent.ts` owns the `TileWidthIntent` union, 12-unit deterministic packer, preset projection, resize snapping, row-preserving reconciliation, and span-aware drag projection.
- `canvas-layout.service.ts` observes the viewport and projects intent to public Gridstack geometry. Responsive capacity derives from `MIN_TILE_WIDTH = 480` and never mutates stored intent.
- `canvas-layout-persistence.service.ts` is the workspace/panel local-storage boundary. Zod validates v1/v2 records, v1 weights migrate losslessly to `auto`, unknown future records remain byte-preserved and read-only, and writes start only after hydration.
- `canvas-workspace-grid.component.ts` is the only Gridstack writer. Stable item options prevent Angular from becoming a second geometry authority; a guarded effect diffs and batches only changed nodes.
- `canvas-tile.component.ts` hosts one chat surface and an accessible `NativePopoverComponent` menu for span, transient focus, and row-boundary actions.
- `canvas-layout-controls.component.ts` is the presentational preset and lock dock.
- `canvas-render-metrics.service.ts` exposes bounded, panel-local geometry and gesture counters.

## Intent and State

A tile is `{ tabId, order, width, rowBreakBefore }`. `width` is either a named span (`third | half | two-thirds | full`, mapping to `4 | 6 | 8 | 12` units) or `{ kind: 'auto', weight }`. Concrete `x`, `y`, `w`, and `h` are never stored.

Auto tiles split the remaining width of their rendered row by weight. Named spans keep their chosen width and may leave a deliberate gap. At narrow widths spans promote in the projection only, then restore when the viewport widens.

`focusedTabId` remains active chat selection and synchronizes with `TabManagerService`. `layoutFocusTabId` is separate, transient, workspace-scoped, and not persisted. It projects one tile as a full-width row and disables Gridstack move/resize until focus exits.

Persistence keys are workspace- and panel-scoped. Hydration reconciles validated intent against exact restored tab ids and never opens or loads sessions. Ordinary component destruction flushes pending layout writes and does not close tabs.

## Geometry and Gesture Contracts

- Geometry flows one way: store intent → `CanvasLayoutService.computeLayout()` → `grid.update()`. Gridstack is a renderer, never a store.
- Gestures capture workspace, revision, responsive capacity, layout-focus id, dragged id, and complete membership. Stop/change validates the full node set before atomically committing drag intent or the dragged tile's snapped named span.
- Hide, lock, focus, destroy, capacity/revision changes, and incomplete observations cancel or reject the commit. Every terminal path reconciles existing nodes from current authoritative intent.
- `_applyingLayout` is set synchronously around mutation and cleared in `finally`. `batchUpdate` is not a guard because `batchUpdate(false)` emits `change`.
- Vertical resizing remains unavailable (`resizable.handles: 'e, w'`); row height stays aligned with the cell-height scrolling rule.

## Angular Conventions

Standalone OnPush components, signals, `inject()`, signal-based `viewChild`, and zoneless-safe effects. The store is never root-scoped. No code outside `CanvasWorkspaceGridComponent` calls Gridstack, and `CanvasLayoutService` never imports it.

Lock is enforced in the UI and store. It blocks presets, span, row, layout focus, drag, and resize changes. Do not add geometry back to tile intent or exceed `MAX_TILES = 9`.
