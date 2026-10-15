# Code Logic Review — R9i (first Grid deletion), TASK_2026_629_c0b3

Review family: Claude (implementer: opencode)

Score: 9/10 — Verdict: APPROVED (two Minor, two Moderate notes; none blocks commit)

Scope: `libs/frontend/canvas/src/index.ts` diff, the six deleted files (read via `git show HEAD:`), every
`@ptah-extension/canvas` consumer in `libs` and `apps`, rg over the whole tree for the deleted basenames and
removed export names, parity rows 47-49, 51, 53-55. Verification run: `nx typecheck @ptah-extension/canvas
--skip-nx-cache` (lock runner, rv-R9i) passed. No source edited, no state-changing git.

## 1. index.ts (check 1) — PASS

- Diff removes exactly: `CanvasTileComponent`, `CanvasEmptyStateComponent`, `TileAgentIndicatorComponent`,
  `TileAgentMiniPanelComponent`, and `CanvasLayout` (the shared type line was split to `export type { TileLayout }`).
- Kept and unchanged: `OrchestraCanvasComponent`, `CanvasStore`, `CanvasTile`, `CanvasLayoutService`, `TileLayout`.
  No other export existed, so nothing extra was removed.
- Consumers of the barrel outside canvas (`rg "@ptah-extension/canvas" libs apps`):
  `tribunal-panel/.../tribunal-ui.types.ts:2` and `tribunal-state.service.ts:19` import `TileLayout` (kept);
  `apps/ptah-extension-webview/src/app/app.config.ts:79` imports `OrchestraCanvasComponent` (kept). The other
  hits are comments and `project.json` names. No import of a removed export anywhere. No electron app consumer.
- Residual: `tribunal-panel` typecheck is in the Mode 2 list but I did not run it (one-check limit). The import
  surface is type-only `TileLayout`, which is still exported, so risk is negligible.

## 2. Remaining rg hits (check 2) — PASS, no live import from a kept file

Hits for `CanvasWorkspaceGrid|canvas-workspace-grid|canvas-grid-items|canvasGridItems|canvasDetailStyles|
canvasWorkspaceGridStyles` in `libs` and `apps` outside docs:

- Zero module imports of any deleted file. `canvas-grid-items`, `canvasGridItems`, `canvasDetailStyles` and
  `canvasWorkspaceGridStyles` have no hits at all.
- Removed-export names, each in a file a later batch deletes or in its own definition file:
  - `CanvasTileComponent`: `canvas-tile.component.ts` and `.spec.ts` (R9j).
  - `TileAgentIndicatorComponent`: its own file and the tile (R9j).
  - `TileAgentMiniPanelComponent`: its own file and spec (R9m), imported by the tile (R9j).
  - `CanvasEmptyStateComponent`: its own file only (R9p).
  - `CanvasLayout`: `canvas-detail-geometry.ts` and spec (R9j), `canvas-layout.service.ts:47,137` (definition,
    R9k). `canvas-layout.service.ts` is kept, but `CanvasLayout` is no longer exported from the barrel.
    Intra-lib path imports are unaffected.
- Dependency-chain check: the tile imports indicator and mini-panel (`canvas-tile.component.ts:51-52`). R9j
  (tile, indicator) and R9m (mini-panel) are both Wave 3/4 and R9m depends on R9j. Mini-panel is not left
  importing something deleted earlier. Fine.
- Wave ordering observation: until R9j/R9m/R9p land, `canvas-tile`, `canvas-empty-state`, `tile-agent-*`,
  `canvas-live-budget`, `canvas-gesture-observation` and `canvas-grid-release` are dead code (only their own
  specs or each other import them). That is intended (A2 importer map) and typecheck passes.
- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` references `ptah-canvas-workspace-grid` and
  `gridstack-item` (lines 32, 172, 175, 207, 314, 315, 613, 679, 743, 840, 841, 894, 998, 1013, 1024, 1048,
  1070, 1087). These are selectors and are already stale since R9b dropped the Grid host. R9l owns them and
  e2e is held. Not an import. Acceptable, but the e2e spec is red until R9l (see Finding 3).
- `gridstack` is still required: `package.json:174`, `webview/src/styles.css:13`, `packaged-deps.spec.ts:174`
  and `tribunal-panel` (tribunal page uses gridstack). Do not remove the dependency or the CSS import.

## 3. Capability hosted by deleted files vs. preserve list (check 3) — PASS with one notice

The deleted files' imports (HEAD): `canvas-store`, `canvas-layout.service`, `canvas-tile`, `canvas-layout-intent`,
`canvas-gesture-observation`, `canvas-render-metrics.service`, `TabManagerService`, `canvas-grid-items`,
`canvas-grid-release`, `canvas-detail-geometry`, `canvas-workspace-grid.styles`, `gridstack`. None of these
are exports of the deleted files that kept code consumed (rg proves zero). The styles file exported only
`canvasWorkspaceGridStyles` and `canvasDetailStyles`; neither is referenced anywhere, so the Rail cannot have
depended on shared style constants. `canvas-grid-items.ts` held `canvasGridItems` only (live-budget/auto-card,
row 53); the Rail's one-focused-live-session model replaces it.

Parity mapping: rows 47, 49, 51, 53, 54, 55 are all `remove-proposed` under decision 73 Gate 2 and approved by
decision 80. Row 48 ("Grid drag order") is `move`, not removal: the Rail must provide order. Notice below.

Notice (Moderate, documented elsewhere): row 48 says "Rail order regression needed" and the batches file defers
Rail reorder to the split-focus addendum item 13. After R9i no UI can reorder tiles: `CanvasStore.reorderTiles`
(`canvas.store.ts:388`) and `commitDragIntent` (`canvas.store.ts:412`) are still present, but `commitDragIntent`
now has zero non-spec callers and the Rail has no reorder gesture. This is a known sequenced gap (HANDOFF.md:110,
decision 80 — user kept side-by-side and Rail reorder as an addendum), not a defect in R9i. Do not ship a
release between R9i and addendum item 13 without it.

## 4. Stale selectors in kept specs (check 4) — harmless, minor misleading value

- `orchestra-canvas.rail.spec.ts:296` `expect(find('ptah-canvas-workspace-grid')).toBeNull()`: the tag no longer
  exists anywhere in the source, so the assertion is now vacuous (cannot fail). It was a real guard against a
  Grid regression while the component existed; after deletion it is dead. Harmless to run; mildly misleading as
  coverage. The adjacent `ptah-canvas-board-toggle` and `ptah-canvas-layout-controls` negatives still guard
  files that still exist.
- `orchestra-canvas.component.spec.ts:906`: the comma selector list still guards `ptah-canvas-empty-state` and
  `ptah-canvas-detail-panel` (both still real until R9p/R9j). The grid token in it is inert but does not weaken
  the check.
- Neither spec fails. Recommended cleanup: drop the grid token in the later batch that deletes the last of the
  named hosts (R9p/R9j), or R9t. Not worth an out-of-contract edit now (R9i is limited to the listed files).

## Findings

1. Minor — `orchestra-canvas.rail.spec.ts:296`. Negative assertion on a selector that no longer exists.
   Fix: delete the line, or fold into R9t spec cleanup; no behaviour change.
2. Minor — `orchestra-canvas.component.spec.ts:906`. Remove `ptah-canvas-workspace-grid` from the selector list
   when R9p/R9j next touch the file. Fix: edit string only.
3. Moderate (process, not code) — `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` (lines above). The
   e2e suite targets `ptah-canvas-workspace-grid` / `gridstack-item` and is already failing against the Rail
   build; R9i makes the Grid host unrecoverable. Held to R9l by design. Fix: keep R9l on the checklist and do not
   treat e2e as a gate for R9 batches; make sure the final release gate runs after R9l.
4. Moderate (known, tracked) — Rail reorder gap (parity row 48). See check 3. Fix: land addendum item 13 before
   any release; ensure R9t does not delete `reorderTiles` or `commitDragIntent` before item 13 decides which
   store API the Rail reorder uses (`commitDragIntent` is now only a candidate, with no caller).

No Blocking or Serious findings.

## Five logic questions (brief)

1. Silent failure: none introduced; deletion is compile-checked. The only silent case is the vacuous negative
   assertion (Finding 1).
2. Unexpected user action: dragging or resizing tiles no longer exists and cannot reorder (row 48 gap), by
   approval.
3. Wrong-answer input: persisted v3 layouts with explicit width/row-break survive in the service; nothing in the
   deleted files wrote persistence (grid read intent and called store setters), and `canvas-layout.service.ts`
   and the persistence service are untouched.
4. Dependency failure: not applicable to a pure deletion; typecheck passes; barrel consumers resolve.
5. Missing: Rail reorder; e2e rewrite (R9l); orphaned store state (`_layoutLocked`, `_workspaceLayoutFocus`,
   `gridUpdates` metric) now unreachable from UI. All are assigned to later batches (R9t, R9q).

## Verdict

APPROVED. The export diff matches the contract exactly, no consumer in `libs` or `apps` imports a removed
symbol, every remaining reference is in a file a later batch deletes or is a selector string, the deleted styles
and grid-items helpers have no other consumers, and `nx typecheck @ptah-extension/canvas` is green. Confidence:
HIGH for the compile-time contract; MEDIUM that Mode 2 FULL(canvas) specs stay green, since I did not run the
suite (not permitted) and `canvas.store.spec.ts` / `canvas-layout.service.spec.ts` still exercise Grid-era store
APIs that are legal but now caller-less.
