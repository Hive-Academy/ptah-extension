# Batch BL report — detached canvas tile release

## Files changed

- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`: pin live engine nodes, release stale nodes from the intent tile set before deciding whether geometry changed, restore original locks in `finally`, count drift, and clear `creationOptions` on destroy.
- `libs/frontend/canvas/src/lib/canvas-grid-release.ts`: live-node pin and restore, stale-node selection, and the apply comparisons extracted to stay within the configured `max-lines` lint limit.
- `libs/frontend/canvas/src/lib/canvas-grid-release.engine.spec.ts`: real GridStack instance and `GridStackEngine`, exercised through real `GridStack.load(items, false)`; row-break gap and unpinned control.
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts`: fake `removeWidget`, release, gesture, zero-size, empty-set, throw, and destroy coverage; updated old ghost expectations.
- `libs/frontend/canvas/src/lib/canvas-render-metrics.service.ts`: `releasedNodes` and `geometryDrift` counters.

## Check-first findings

1. No pre-existing canvas production code writes node-level `locked`; the canvas `locked()` signal controls static mode (`canvas-workspace-grid.component.ts:719,739`). The new helper preserves each prior node value (`canvas-grid-release.ts:56-73`).
2. A locked node is skipped by top-gravity packing (`node_modules/gridstack/dist/gridstack-engine.js:448-453`). The lock guard in `moveNode` is commented out (`:935-938`). The real GridStack test confirms a pinned row-break gap survives release and `load`, while its unpinned control moves D upward (`canvas-grid-release.engine.spec.ts:102-118`).
3. `load(items, false)` does not remove absent nodes: removal is under `if (!blank && addRemove)` (`node_modules/gridstack/dist/gridstack.js:659-673`). It filters matching nodes, retains their existing objects, then pushes those objects back and updates them (`:675-703`), preserving the temporary `locked` flag. No change to the planned design was needed.
4. Real `load(items, false)` accepts authoritative positions on pinned live nodes: every live `{x,y,w,h}` equals the projected layout after lock restoration (`canvas-grid-release.engine.spec.ts:102-112`). No design change was needed.

## Decisions

- Live IDs come from `this.tiles()` (`canvas-workspace-grid.component.ts:737`); stale nodes are selected before removal (`canvas-grid-release.ts:77-85`). An empty positioned layout with nonempty intent releases only stale nodes. An empty tile set releases all nodes. Active gestures skip release (`canvas-workspace-grid.component.ts:742`).
- A stale node with an element uses `grid.removeWidget(el, false, false)` so Angular owns DOM removal; a node without an element uses `engine.removeNode` (`canvas-workspace-grid.component.ts:806-815`). Pins are restored before static mode and interaction state (`:789-801`).
- The real test uses GridStack's shipped UMD bundle because the Jest CommonJS runtime cannot import its ESM entry. It still exercises the shipped real GridStack and engine through `GridStack.load` (`canvas-grid-release.engine.spec.ts:12,58,83`).

## Verification

- `npx nx test @ptah-extension/canvas --testFile=canvas-grid-release.engine.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 2 passed.
- Same command with `--testFile=canvas-workspace-grid.component.spec.ts`: 83 passed.
- Same command with `--testFile=canvas-workspace-grid.detail.spec.ts`: 1 passed.
- `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 23 suites, 304 tests passed after final edits.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed; one warning in `chat` about an unnecessary optional chain.
- `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed, 0 errors; 10 warnings in unchanged specs. No `max-lines` warning. Grid component: 877 physical lines; lint's configured line count is below its 700-line threshold.
- Scoped `ptah_get_diagnostics`: no diagnostics in the five changed source/spec files. It reported 12 errors in unchanged sibling test and shared files, outside this batch's allowed paths. The Nx project typecheck and tests passed.
- `npx prettier --write` ran only on the five changed canvas files.

## Manual Electron heap and layout check

1. Open three canvas tiles with long transcripts. Take heap snapshot 1. Close one tile, force GC with DevTools' trash icon, then take snapshot 2.
2. Filter snapshot 2 for `Detached`. Expect no detached `<gridstack-item>`, `<ptah-canvas-tile>`, or `chat-msg-slot` tree for the closed tile; the former 18,898-node detached tree should be gone.
3. If one remains, inspect its first non-DOM retainer. `GridStackEngine.nodes` suggests the release hook did not run; `DDElement`, `_dd`, or `dd-manager` suggests `_removeDD` was skipped; `QueryList._results` or an `LView` array suggests wrapper/Angular retention and needs the path escalated.
4. Compare snapshots: `HTMLElement` count should drop by roughly the closed tile's node count; `GridstackItemComponent` and `CanvasTileComponent` should each drop by one.
5. Close all tiles, reopen one, and repeat five open/close cycles. Counts should return to the one-tile baseline without growth.
6. With a compact tile beside a full tile and a row break below, close a row-one tile. Lower tiles should keep their row-break positions.
7. Close a tile while the canvas is locked. Unlock, force GC, and repeat the detached-tree check; release should happen after unlock.

## Open items

- The Electron heap and visual checks above require a running Electron instance and remain for the user. In particular, the first non-DOM retainer cannot be confirmed by jsdom tests.
- The B6 sibling-overlay manual gate also remains: panel top within 8 px of the clicked row bottom, lower rows visible and clickable, and scroll height increased by panel height. A failed gate selects the documented bottom-panel fallback (`spike-detail-row.md`, `decisions.md` row 22).
