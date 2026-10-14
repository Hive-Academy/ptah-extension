# Code Logic Review R9t - Late intent/store Grid cleanup

Review family: Claude (reviewer) vs codex (implementer)

Batch: R9t, TASK_2026_629_c0b3. Scope: `canvas.store.ts`, `canvas.store.spec.ts`, `canvas-layout-intent.ts`, `canvas-layout-intent.spec.ts` (uncommitted diff vs HEAD). Other uncommitted changes (R9f, R9s) not reviewed. No tests, typecheck or nx were run (per instruction); review is read-only (rg, Read, git diff).

## Verdict

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVE-WITH-FIXES |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 3 |

Why 8 and not 9: the removal is behaviourally clean and the persistence contract is untouched, but the batch leaves one stale comment that references the lock it just deleted, a doc comment describing a clamp that no longer exists, and the contract's "keep `reorderTiles` and its specs" is satisfied only vacuously because no spec for it ever existed. Why not 7: every removed symbol has zero callers, the kept symbols are intact, `reorderTiles` and `commitDragIntent` bodies are byte-identical apart from the deleted lock guard, and no kept behaviour lost its only coverage.

## Findings

1. Moderate - stale reference to the deleted lock, introduced by this batch's own removal. `canvas-layout-intent.ts:77-79`: the `viewConstraintsFingerprint` doc still says "a locked grid uses it to admit a menu-driven height change". `setLayoutLocked`/`layoutLocked` are gone from the store (store diff lines removing `_layoutLocked`), so the sentence now describes a non-existent mechanism. Review focus 5 ("no new stale references to deleted members") is not fully met. Fix: drop the clause.

2. Moderate - doc comment promises a clamp that was deleted. `canvas-layout-intent.ts:61-65` (`TileViewConstraint`): "`heightUnits` is already clamped for a compact tile". `clampCompactHeightUnits` and `tileViewConstraint` were the only producers of that clamped value; nothing in libs/apps now builds a `TileViewConstraint` outside `canvas-layout-intent.spec.ts`. The invariant is now unenforced and undocumented as such. Fix: reword ("callers must pass an already-clamped height") or, better, route the whole dead constraint family to a removal batch (see finding 3).

3. Minor - large dead Gridstack projection surface remains and is not routed. The following non-spec exports in `canvas-layout-intent.ts` have no production importer (only `canvas.store.ts`, `canvas-layout-persistence.service.ts`, `orchestra-canvas.component.ts`, `canvas-rail.component.ts` import from the file, and they use only `MAX_CANVAS_TILES`, `TILE_SPANS`, `DEFAULT_TILE_WIDTH`, `reconcileIntent`, `retainTilesInLogicalRows`, `sameWidth`, `TileIntent`): `projectTileGeometry`, `projectDragIntent`, `packRows`, `totalExtentOf`, `snapSpan`, `SPAN_UNITS` (via snapSpan/pack), `compactResizeBounds`, `viewConstraintsFingerprint`, `sameViewConstraints`, `minimumUnitsFor`, `TileViewConstraint(s)`, `GRID_COLUMNS`, `*_COMPACT_TILE_HEIGHT_UNITS`. Also `CanvasStore.commitDragIntent`, `toggleLayoutFocus`/`layoutFocusTabIdFor` have no production caller. This is outside the R9t removal list, but the lane report's "Extra routing" implied checking for no-caller leftovers; it only checked the two named helpers. Recommend the team leader assign the rest (or explicitly accept it) so the Gridstack comments at `canvas-layout-intent.ts:1,13,16,25,109-111,268,580-585,725-727` do not live on indefinitely. Not blocking: nothing is wired, so nothing fails at runtime.

4. Minor - contract clause "keep `reorderTiles` and its specs" has no spec to keep. `rg reorderTiles` on HEAD finds only the method (`canvas.store.ts:388` at HEAD) and a `jest.fn()` stub in `orchestra-canvas.component.spec.ts:235`; HEAD's `canvas.store.spec.ts` has zero `reorderTiles` or `commitDragIntent` cases. So nothing was lost, but `reorderTiles` (stable-partial-list semantics, dense renumber, same-reference no-op) and `commitDragIntent` (revision gate, exact-id gate, first-tile row-break normalization) are both unit-untested. R9w will consume `reorderTiles` for Move up/down; it should own the spec. Flag so R9w's contract lists named cases.

5. Minor - residual "grid" wording in store comments (`canvas.store.ts:52-54, 81, 234, 635`: "grid sections", "workspace grid"). These describe the per-workspace mounted section, which still exists as a concept, so not wrong, but they read as Gridstack. Cosmetic; left to the style reviewer.

No Blocking or Serious logic findings.

## Review-focus answers

### 1. Callers of removed symbols; KEEP symbols intact

- `rg 'applyPreset|projectPreset|commitResizeSpan|setTileSpan|setLayoutLocked|layoutLocked|toggleRowBreak|setBoardMode|clampCompactHeightUnits|tileViewConstraint|CanvasLayoutPreset'` over the whole repo (excluding .ptah, node_modules, dist, *.md; includes libs, apps, e2e, showcase, .ts/.tsx/.js/.mjs/.html): zero matches. I widened beyond the lane's `libs apps` and added `layoutLocked` (the readonly signal that was also removed; not on the contract list but a necessary consequence of dropping the lock).
- `canvas/src/index.ts` exports only `OrchestraCanvasComponent`, `CanvasStore`, `CanvasTile`, `CanvasLayoutService`, `TileLayout`. None of the removed symbols was a barrel export. Nothing external can break.
- KEEP list verified present and unchanged: `MAX_CANVAS_TILES` (`canvas-layout-intent.ts:11`, comment edit only), `TILE_SPANS`/`TileSpan` (`:22-23`, used by `canvas-layout-persistence.service.ts:6,25`), `DEFAULT_TILE_WIDTH` (`:45`, used `canvas.store.ts:302`), `TileIntent`, `TileWidthIntent`, `logicalRows`, `reconcileIntent` (`canvas.store.ts:20`, used in hydrate), `retainTilesInLogicalRows` (used by `dropTile`), `sameWidth` (used by `sameIntent`). Store imports are all still used (no unused import left by removing `TILE_SPANS`, `projectPreset`, `CanvasBoardMode`).
- `densify` (private, `canvas-layout-intent.ts:182`) is still used by `retainTilesInLogicalRows`/`reconcileIntent`; removing `projectPreset` did not orphan it.

### 2. Persistence of an old record

See Write-path trace. Result: an old v3 record loads as Rail with no data loss and no throw.

### 3. `reorderTiles` / `commitDragIntent` unchanged

Diffed bodies. `reorderTiles` (`canvas.store.ts:364-384`): not in the diff at all. `commitDragIntent` (`:388-405`): the only change is deletion of `if (this._layoutLocked()) return false;`. With the lock signal gone this is the correct, behaviour-preserving edit (the lock defaulted to false and its only setter was `setLayoutLocked`, which had no production caller after R9k). `toggleLayoutFocus` lost the same guard; same reasoning.

### 4. Removed spec cases vs kept coverage

Removed store cases: `setTileSpan` (single-span + revision), `commitResizeSpan` (workspace/revision addressing), lock-blocks-everything, preset x3. Removed intent cases: preset projection, `clampCompactHeightUnits`, `tileViewConstraint`. None was the sole coverage of a kept behaviour: `logicalRows`/`retainTilesInLogicalRows` keep intent-spec cases at `canvas-layout-intent.spec.ts:498-520` ("preserves logical rows on deletion", capacity-one reorder cases); store-level row-boundary preservation on close keeps `canvas.store.spec.ts:405`; layout focus keeps `:367`, `:395` and the intent spec's "focus flushes before and after the target"; close keeps the `removeTile` describe at `:424`. The row-break regression was rewritten from `toggleRowBreak` to seeding via `persistence.load.mockReturnValueOnce` (`:405-414`), which still exercises dropTile -> retainTilesInLogicalRows with a real break, and is arguably a more honest fixture (it is the only way a break can now enter the store besides `commitDragIntent`). Coverage that never existed and still does not: `reconcileIntent` is not directly unit-tested in either spec (only through store hydration cases at `:287`, `:374`); `reorderTiles`/`commitDragIntent` as noted in finding 4. Pre-existing gap, not a regression.

Board-persistence specs: `setBoardMode('grid')` cases were converted to `setRailCollapsed`/`setRailDensity`/`setRailScrollTop`. The call-count arithmetic is consistent (4 -> 3 schedules; the idempotent re-set of 13 still asserts no extra schedule). The `mode` field is now absent from the changed-field assertions, which is correct because nothing can change it.

### 5. Stale comments

Targets from the routing note: `canvas-layout-intent.ts:8` (MAX_COLUMNS) fixed; `:23`-area (cellHeightFor compact-height comment) fixed; `:292` (MIN_TILE_WIDTH) fixed to "Narrowest unit count allocated to a tile at this capacity" (`:248`); `canvas.store.ts:42,82` ("CanvasLayoutService derives grid coordinates") and `:100` ("Gridstack") fixed. Remaining stale: findings 1, 2, 5 above. The doc comment for `MAX_COMPACT_TILE_HEIGHT_UNITS` now says "legacy Gridstack row units", acceptable. No new reference to R9k/R9m-deleted members (`CanvasLayoutService.cellHeightFor` mention removed with the helper).

## Write-path trace

Store state that reaches persistence: `_workspaceTiles` and `_workspaceBoard`, both via `schedulePersist(path)` (`canvas.store.ts:340-348`), which hands persistence a lazy snapshot `{ tiles, board: boardFor(path) }`. Focus (`_workspaceFocusedTabId`) and layout focus (`_workspaceLayoutFocus`) are never persisted and still are not.

Remaining tile writers (all through `setWorkspaceTiles` at `:323`, which bumps the revision then `schedulePersist`):
1. `appendTile` (via `addTile`/`addTileFromSession`/`adoptTab`): dense order, `DEFAULT_TILE_WIDTH`, `rowBreakBefore:false`. OK.
2. `removeTileOnly`/`removeTile`/`removeTileFromAnyWorkspace` -> `dropTile` -> `retainTilesInLogicalRows`: renumbers densely and preserves logical rows. OK.
3. `reorderTiles`: dense reorder, partial list cannot drop tiles, same reference when unchanged (no write). Unchanged vs HEAD.
4. `commitDragIntent`: revision-gated, exact-id-set-gated, normalizes `order` and first-tile break, no-op when intent equal. Unchanged apart from the removed lock guard. No production caller currently.
5. `hydrateWorkspace`: `reconcileIntent(loaded.tiles ?? existing, authoritativeIds, MAX)`; schedules a write only if `needsWrite` or reconciliation changed intent. Unchanged.

Removed writers: `setTileSpan`/`commitResizeSpan` (width), `toggleRowBreak` (rowBreakBefore), `applyPreset` (width + order + breaks). Consequence: no code path now authors a `span` width or a new row break; `width`/`rowBreakBefore` values reach storage only by round-tripping what was loaded (and via `commitDragIntent` if R9w or later wires it). This is the intended "strict v3 width/row-break data kept" state, not data loss: persistence `write()` (`canvas-layout-persistence.service.ts:310-325`) still serialises `width` (span or auto) and `rowBreakBefore` verbatim.

Board writer: `updateBoard` (`canvas.store.ts:263-269`) now reachable only through `setRailCollapsed`, `setRailDensity`, `setRailScrollTop`. Removing `setBoardMode` changes nothing the store writes back for normal use because persistence `write()` forces `board: { ...snapshot.board, mode: 'rail' }` (`:322`) regardless of store state, and `load()` parses `mode` through `.catch('rail').transform(() => 'rail')` (`:47`). So even a stale `mode:'grid'` in memory is written as `'rail'`. `CanvasBoardMode` still includes `'grid'` in `canvas-board-mode.ts:1`; the store no longer imports it. Cleaning that type is R9l, per the lane report.

Old record load simulation (record written by pre-R9 code at schema v3, which R3 introduced on this same unreleased branch):
- Persisted fields were exactly `{version:3, tiles:[{tabId,order,width,rowBreakBefore}], board:{mode,railCollapsed,railDensity,railScrollTop}}` (R3 `deab106e1` board schema, verified via `git show`). `layoutLocked` was an in-memory signal never serialised; presets only rewrote width/order/breaks (already inside the tile schema); `compactHeightUnits` lives on chat tabs (`chat-state`, R9s), not in the canvas record. So there is no extra key for the strict v3 schema to reject.
- `mode:'grid'`: `boardSchema` normalises to `'rail'` (R9a, `e24a8c93e`). Span widths: still in `widthSchema` via `TILE_SPANS`. Row breaks: kept.
- Store acceptance: `hydrateWorkspace` takes `loaded.tiles` (already `normalize`d by persistence) and `loaded.board` (`DEFAULT_BOARD_STATE` shape) and passes them to `reconcileIntent` and `setIn(_workspaceBoard...)`. The store did not depend on removed members to consume these. `reconcileIntent`/`retainTilesInLogicalRows`/`sameWidth` retained, so span widths and breaks round-trip. No throw path added.
- Residual pre-existing behaviour (not caused by R9t): a v3-versioned record that fails strict validation (e.g. an unknown extra key) falls through v2/v1, hits `warn('parse')` and returns `tiles:null, writable:true` (`canvas-layout-persistence.service.ts:247`), so the next write silently replaces it with defaults. Unreachable for records produced by this branch's own writer (`write()` emits only the schema's keys), so not raised as a finding, but it is the one place an old/foreign v3 record could lose data.

## Five logic questions (condensed)

1. Silent failure: none introduced. Removal turns former `false` returns (locked, unknown tab) into compile-time absence rather than runtime success.
2. Unexpected user action: none; no UI path to the removed members remains (repo-wide rg is empty, so no stale template binding).
3. Wrong-answer input: an in-memory `board.mode === 'grid'` cannot be set any more; if one arrives from a future caller of `updateBoard`, persistence still writes `'rail'`.
4. Dependency failure: persistence/hydrate paths unchanged.
5. Missing: specs for `reorderTiles`/`commitDragIntent`, and an owner for the remaining dead projection code (findings 3, 4).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Old v3 record, `mode:'grid'` | YES | schema normalises to rail; write forces rail | none |
| Old record with span widths / row breaks | YES | schema + `write()` preserve them | no UI can author new ones now (intended) |
| Row-boundary survives tile close | YES | `dropTile` -> `retainTilesInLogicalRows`, spec `:405` | spec seeds via persistence mock |
| Layout focus cleared when its tile is removed | YES | `setWorkspaceTiles` `:328-331` | unchanged |
| Stale revision on drag commit | YES | `commitDragIntent` revision + id-set gates | untested |
| Partial list passed to `reorderTiles` | YES | missing tiles keep relative order | untested |

## Required fixes before commit

- Fix findings 1 and 2 (two comment edits in `canvas-layout-intent.ts`). Both are trivial; the batch is otherwise ready for the team leader's suite run.
- Findings 3-5: route, do not block.
