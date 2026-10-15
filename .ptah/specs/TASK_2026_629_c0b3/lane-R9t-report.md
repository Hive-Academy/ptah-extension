# Lane report R9t

Status: complete. Rail-only store/intent cleanup implemented in the four assigned files.

## Symbols

- Removed: `CanvasStore.applyPreset`, `setTileSpan`, `commitResizeSpan`, `setLayoutLocked`, `toggleRowBreak`, and `setBoardMode`; intent exports `projectPreset`, `CanvasLayoutPreset`, `clampCompactHeightUnits`, and `tileViewConstraint`. The now-unused store lock signal and single-tile mutation helper were removed too.
- Kept: `MAX_CANVAS_TILES`, `TILE_SPANS`, `TileSpan`, `DEFAULT_TILE_WIDTH`, `TileIntent`, `TileWidthIntent`, `logicalRows`, `reconcileIntent`, `retainTilesInLogicalRows`, `sameWidth`, `reorderTiles`, and `commitDragIntent`. Persistence's v3 width/row-break shape was not changed.

## Files

- `libs/frontend/canvas/src/lib/canvas.store.ts:20`: removed Grid imports; at `:251` Rail board setters remain; at `:364` and `:388`, reorder and drag commit remain. Removed Grid setter, lock, span resize, row-break toggle, and preset mutation. Updated stale geometry comments near `:34`, `:73`, and `:100`.
- `libs/frontend/canvas/src/lib/canvas.store.spec.ts:317`: board persistence tests now exercise Rail fields; at `:406`, the row-boundary removal test starts from persisted intent. Removed Grid controls' cases. Corrected the persistence mock's path argument at `:83`.
- `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:7`: removed obsolete `MAX_COLUMNS` reference; at `:19`, removed compact-height helpers and their stale `cellHeightFor` comment; at `:248`, corrected the stale `MIN_TILE_WIDTH` comment. Removed preset type and projector while retaining intent, migration, and projection helpers.
- `libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts:1`: removed preset and compact-height helper cases/imports; retained logical-row, width, projection, and drag intent coverage.

## Reference proof

Before removal, `rg -n -g '*.ts' -g '*.html' 'applyPreset|projectPreset|commitResizeSpan|setTileSpan|setLayoutLocked|toggleRowBreak|setBoardMode|clampCompactHeightUnits|tileViewConstraint|CanvasLayoutPreset' libs apps` found references only in the four assigned files. The same search after removal returned no matches (exit 1). In particular, there was no production caller for `clampCompactHeightUnits` or `tileViewConstraint` after R9k/R9s.

## Checks

- `node .ptah/tmp/check-run.mjs r9t-store -- npx nx test @ptah-extension/canvas --testFile=canvas.store.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — exit 0; Tests: 17 passed, 17 total.
- `node .ptah/tmp/check-run.mjs r9t-intent -- npx nx test @ptah-extension/canvas --testFile=canvas-layout-intent.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — exit 0; Tests: 37 passed, 37 total.
- `ptah_get_diagnostics` after final edits: no diagnostics in the four requested files. Seven diagnostics remain in unrelated sibling files (`orchestra-canvas.rail.spec.ts`, `mock-rpc-service.ts`, `capability-id-codec.ts`).

## Decisions

- Removed `setBoardMode` entirely because its only callers were Grid-specific cases in the assigned spec; existing Rail field setters provide the board mutations in production. Historical board-mode handling remains for R9l.
- Kept `commitDragIntent` and `reorderTiles` even though current Rail UI has no drag/reorder controls, as required for later work. Left strict v3 width and row-break intent unchanged.
- Retained the row-boundary removal regression using persisted intent instead of the removed toggle.

## Clarifications Needed

None.
