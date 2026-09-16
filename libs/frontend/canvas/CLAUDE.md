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
- `canvas-layout-intent.ts` owns the `TileWidthIntent` union, 12-unit deterministic packer, preset projection, resize snapping, row-preserving reconciliation, span-aware drag projection, the 6/2 height tiers, and transient view-constraint projection.
- `canvas-layout.service.ts` observes the viewport and projects intent to public Gridstack geometry. Responsive capacity derives from `MIN_TILE_WIDTH = 480` and never mutates stored intent. `computeLayout(tiles, layoutFocusTabId, viewConstraints)` returns per-tile geometry plus the fitted `cellHeight`; the 90% viewport floor applies only while a full-height tile is wrapped.
- `canvas-layout-persistence.service.ts` is the workspace/panel local-storage boundary. Zod validates v1/v2 records, v1 weights migrate losslessly to `auto`, unknown future records remain byte-preserved and read-only, and writes start only after hydration. View mode is never persisted here.
- `canvas-workspace-grid.component.ts` is the only Gridstack writer. Stable item options prevent Angular from becoming a second geometry authority; a guarded effect detects changes and loads one collision-safe authoritative snapshot. It derives view constraints from `TabManagerService`, suppresses move/resize per node, and applies view-driven geometry through a narrow lock exception.
- `canvas-tile.component.ts` hosts one chat surface and an accessible `NativePopoverComponent` menu for span, transient focus, and row-boundary actions.
- `canvas-layout-controls.component.ts` is the presentational preset and lock dock.
- `canvas-render-metrics.service.ts` exposes bounded, panel-local geometry and gesture counters.

## Intent and State

A tile is `{ tabId, order, width, rowBreakBefore }`. `width` is either a named span (`third | half | two-thirds | full`, mapping to `4 | 6 | 8 | 12` units) or `{ kind: 'auto', weight }`. Concrete `x`, `y`, `w`, and `h` are never stored.

Auto tiles split the remaining width of their rendered row by weight. Named spans keep their chosen width and may leave a deliberate gap. At narrow widths spans promote in the projection only, then restore when the viewport widens.

`focusedTabId` remains active chat selection and synchronizes with `TabManagerService`. `layoutFocusTabId` is separate, transient, workspace-scoped, and not persisted. It projects one tile as a full-width row and disables Gridstack move/resize until focus exits.

Persistence keys are workspace- and panel-scoped. Hydration reconciles validated intent against exact restored tab ids and never opens or loads sessions. Ordinary component destruction flushes pending layout writes and does not close tabs.

## View Modes (compact/full)

`TabManagerService` stays the single authority for a tab's view mode. Canvas never stores it: it is absent from `TileIntent`, from the canvas store, and from v1/v2 persistence. Each render derives a transient `TileViewConstraints` list (`tabId` plus `heightTier`) from the live tab state, fingerprints it structurally, and skips any Gridstack write when the fingerprint is unchanged.

A full tile renders at 6 height units. A compact tile renders at 2 height units and at the responsive minimum width for the current capacity (4, 6, or 12 units), regardless of its stored span. The stored width intent is untouched: exiting compact restores it exactly.

Placement uses a deterministic 12-column skyline. Full tiles pack by logical row and compact tiles flow into the same skyline; a full tile may contract to fill a hole under a compact tile, and `rowBreakBefore` stays a hard fence no tile crosses. The layout-focus tile always renders 12x6, even when its view tier is compact. A singleton full or layout-focused tile stretches to the whole grid; a compact singleton keeps its projected 2-unit height.

## Geometry and Gesture Contracts

- Geometry flows one way: store intent plus derived view constraints → `CanvasLayoutService.computeLayout()` → `grid.load(layout, false)`. The full authoritative snapshot uses Gridstack's collision-safe all-node load path; Gridstack is a renderer, never a store.
- Gestures capture workspace, revision, responsive capacity, layout-focus id, dragged id, view-constraint fingerprint, and complete membership. Stop/change validates the full node set before atomically committing drag intent or the dragged tile's snapped named span.
- Drag reconstruction keeps `y` and `h` strict for every node under each candidate break mask. Unmoved named-span and compact tiles must also match `x` and `w`; the dragged tile and full-tier auto tiles may retain transient Gridstack `x`/`w` until the committed intent is projected again. No matching mask rejects the gesture. A view-mode change during a gesture cancels it and reconciles from current intent.
- Hide, lock, focus, destroy, capacity/revision changes, and incomplete observations cancel or reject the commit. Every terminal path reconciles existing nodes from current authoritative intent.
- Compact tiles are not resizable and not movable beyond what the projector can reconstruct. `applyNodeInteractionState` sets `grid.movable`/`grid.resizable` and the no-resize handle per node, matching each tile's view tier and lock state.
- `_applyingLayout` is set synchronously around mutation and cleared in `finally`. `grid.load()` closes its internal batch by emitting `change`, so the explicit guard remains required.
- Vertical resizing remains unavailable (`resizable.handles: 'e, w'`); row height stays aligned with the cell-height scrolling rule.
- Lock exception: a locked and visible grid still applies view-driven geometry when the view-constraint fingerprint changes (`applyAuthoritativeGeometry(true)` bypasses the lock guard for this path only). Width and height measurements are frozen from the last authoritative application when the lock engages, so a pending responsive reflow cannot hitchhike on the view-only exception. The guarded batch temporarily suspends Gridstack static mode, restores it in `finally`, then reapplies per-node interaction state. It commits no store intent and performs no other mutation.

## Angular Conventions

Standalone OnPush components, signals, `inject()`, signal-based `viewChild`, and zoneless-safe effects. The store is never root-scoped. No code outside `CanvasWorkspaceGridComponent` calls Gridstack, and `CanvasLayoutService` never imports it.

Lock is enforced in the UI and store. It blocks presets, span, row, layout focus, drag, and resize changes. The compact/full toggle is the one deliberate exception: view mode is owned by `TabManagerService`, not by layout intent, so the toggle stays enabled while locked and the grid applies the resulting geometry through the lock exception above. Do not add geometry back to tile intent or exceed `MAX_TILES = 9`.
