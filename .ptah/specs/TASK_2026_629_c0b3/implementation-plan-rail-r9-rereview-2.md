Verdict: APPROVED — 9/10

Scope: revise round 2 only (rereview N1-N7, 7c, 8). Plan lines cited are from `implementation-plan-rail-r9.md`.

| # | Status | Evidence |
| --- | --- | --- |
| N1 | CLOSED | Order (plan 92) is R9j -> R9m -> R9k -> R9q -> R9t. R9m (107) deletes `canvas-grid-release.ts` and the engine spec. Their only other importer, `canvas-workspace-grid.component.ts`, goes in R9i. |
| N2 | CLOSED | R9a (102) owns persistence and its spec only. R9t (108) owns `canvas.store.ts`, its spec, `canvas-layout-intent.ts` and its spec. R9k (115) is 6 files and leaves intent and store "intact for R9t". Store Grid callers are in `orchestra-canvas` (R9b) and the grid/tile files (R9i/R9j). rg finds no other caller of applyPreset, setTileSpan, setLayoutLocked, toggleRowBreak or setBoardMode. |
| 7c | CLOSED | R9l (111) narrows `CanvasBoardMode`. The remaining lib-code `'grid'` uses each have an earlier or same-batch owner: `canvas-detail.service.ts:47` (R9l), persistence `:47` (R9a normalizes), `orchestra-canvas.component.ts:136-427` (R9b) and store (R9t). |
| 8 | CLOSED | rg confirms the keep list. Persistence imports `MAX_CANVAS_TILES`, `TILE_SPANS`, `logicalRows` and `TileIntent` (:4-9). `canvas-rail.component.ts:15` imports `MAX_CANVAS_TILES`; `canvas-rail.component.spec.ts:5` imports `DEFAULT_TILE_WIDTH`. Store imports (:19-30) are all kept, apart from preset and span items that R9t removes. `migrateCanvasIntentV1` lives in persistence. Canvas `index.ts` exports nothing from intent. |
| N3 | CLOSED | R9g (107): optional inject, `openLane('sub:'/'bg:' + id)`, and a safe action when the token is absent. R9n (108): factory with `skipSelf` + `optional` that prefers the parent. R9f (110): provides Rail `SESSION_CARD_ACTIONS` plus the case "Rail tile click selects `sub:` lane and does not mount `SingleChatSubagentView`". The token contract is unchanged (`session-context.token.ts:62-69`, openLane/openSession). The host passes its providers through a parent injector (`canvas-detail-transcript.component.ts:54-58`), so `skipSelf` resolves to it. |
| N4 | CLOSED | R9o (111) has 8 files, including the chip spec and the new `turn-summary-mini-card.styles.ts`. Both chip specs exist on disk. |
| N5 | CLOSED | R9r (109) says "every `compactHeightUnits` reference". rg shows that the R9r/R9s files, deleted canvas files (R9i/R9j) and a comment at `chat-view.component.ts:911` (R9h) are the only remaining uses. `setCompactHeight` callers are only `canvas-tile` and `workspace-grid`, both deleted before R9r. |
| N6 | CLOSED | Line 88 now reads "Executor per batch assigned by team-leader Mode 1 under decision 78". Every row has a fit value. This matches decisions.md row 78 ("Team-leader Mode 1 assigns executors per batch"). |
| N7 | CLOSED | R9f names the `HIDE_AGENT_SIDEBAR: true` removal; the code is at `:56`. R9j uses `canvas/src/lib/canvas-detail-geometry.ts`, which exists. R9l states that `packaged-deps.spec.ts` is unowned and unchanged. |

## File-to-batch map

- I rebuilt the map from plan 102-116 and 107-111: 20 batches and 108 file slots. No file has two owners, and no batch has more than 8 files (R9h, R9f and R9o have 8). The two `index.ts` files are owned by R9i (canvas) and R9h (chat).
- Parallel sets: {R9c, R9d, R9g}, {R9e, R9n} and {R9h, R9o}. Each set has 3 or fewer batches and no shared files.
- Importers of each deleted file (rg, `libs` and `apps`):
  - workspace-grid: orchestra (R9b).
  - grid-items: workspace-grid (R9i, same batch).
  - live-budget: orchestra (R9b) and grid-items (R9i).
  - gesture-observation: workspace-grid (R9i).
  - empty-state: orchestra (R9b) and index (R9i).
  - detail-panel: orchestra (R9b).
  - detail-geometry: workspace-grid (R9i).
  - canvas-tile: grid specs and index (R9i).
  - tile-agent-indicator: canvas-tile (R9j, same batch).
  - grid-release: workspace-grid (R9i).
  - mini-panel: canvas-tile (R9j) and index (R9i).
  - detail-keyboard: `orchestra-canvas.component.ts:48` (R9b).
  - layout-controls and board-toggle: orchestra and both orchestra specs (R9b).
- In each case the importer's owner runs before the deleting batch, or is the deleting batch itself. Every batch can end green in the stated order.

## New findings

None (no Blocking or Serious).

## Minor notes (non-blocking)

- `canvas-layout-persistence.service.spec.ts:18` still types `mode: 'grid' as const` into `schedule()`. This does not turn R9l red: the canvas spec tsconfig sets `isolatedModules: true`, and `typecheck` runs `ngc` on `tsconfig.lib.json` only. R9a should still build its v3-Grid case from raw stored JSON so the spec matches the narrowed type.
- `canvas/src/index.ts:7` re-exports `type CanvasLayout`. If R9k removes that interface, it breaks lib typecheck in a file it does not own. Either R9i drops the export as a "doomed export", or R9k keeps the interface.
- The R9t keep list omits `TileSpan`. It stays anyway, because the kept `TileWidthIntent` (`canvas-layout-intent.ts:61-63`) needs it.
