# Lane report R9i — first Grid deletion: workspace grid, grid items, doomed exports

TASK_2026_629_c0b3 (Orchestra Canvas Rail board), batch R9i per `batches-rail-r9.md` "## Batch R9i"
(Wave 2, executor opencode lane; dependency R9b COMPLETE). Grid removal user-approved (decision 80;
parity rows 47-49, 51, 53-55, all `remove-proposed` under the decision-73 Gate 2 list).

W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
(branch `feat/task-629-canvas-board`). All touched paths are under `W\libs\frontend\canvas\src\`.

## 1. Exports removed — `libs/frontend/canvas/src/index.ts` (edited BEFORE any file deletion)

Removed (former line numbers):

- `CanvasTileComponent` (was index.ts:2)
- `CanvasEmptyStateComponent` (was index.ts:3)
- `CanvasLayout` type (was index.ts:7 — shared line; only `CanvasLayout` dropped from it)
- `TileAgentIndicatorComponent` (was index.ts:8)
- `TileAgentMiniPanelComponent` (was index.ts:9)

Kept and verified — `index.ts` after the edit is exactly these 5 lines:

```ts
export { OrchestraCanvasComponent } from './lib/orchestra-canvas.component';
export { CanvasStore } from './lib/canvas.store';
export type { CanvasTile } from './lib/canvas.store';
export { CanvasLayoutService } from './lib/canvas-layout.service';
export type { TileLayout } from './lib/canvas-layout.service';
```

The component FILES of tile / empty-state / indicator / mini-panel were NOT deleted — later batches
R9j / R9p / R9m own them, per the batch contract.

## 2. Files deleted (shell `rm`, not `git rm`; exact paths confirmed by glob before deletion)

- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.detail.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.styles.ts`
- `libs/frontend/canvas/src/lib/canvas-grid-items.ts`
- `libs/frontend/canvas/src/lib/canvas-grid-items.spec.ts`

Remaining `*grid*` files under `lib` (correct — owned later): `canvas-grid-release.ts` and
`canvas-grid-release.engine.spec.ts` (R9m). No other file was created, modified or deleted.

## 3. Zero-importer proof — rg from W over `libs` + `apps`, AFTER the edits

Command (one alternation covering every deleted basename and every removed export name;
`CanvasLayout\b` deliberately excludes `CanvasLayoutService`):

```
rg -n "canvas-workspace-grid|canvas-grid-items|CanvasTileComponent|CanvasEmptyStateComponent|TileAgentIndicatorComponent|TileAgentMiniPanelComponent|CanvasLayout\b" libs apps
```

Exit code 0, 69 matched lines. Results per name, every hit classified:

| Name | Remaining hits | Owner / classification |
| --- | --- | --- |
| `canvas-workspace-grid.component`, `.styles`, `.detail.spec` (deleted basenames) | No module import remains anywhere. Only the DOM selector string `ptah-canvas-workspace-grid`: `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:175,207,315,743,841,1024,1070` | **R9l** (Wave H3, HELD) owns rewriting the e2e selectors; e2e is never run in R9 lanes. Selector strings, not imports. |
| same | `libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts:296` — `expect(find('ptah-canvas-workspace-grid')).toBeNull()` | Kept file (R9b artifact). String inside a negative assertion — **not an import**; keeps passing because the query returns null. |
| same | `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts:906` — `'ptah-canvas-workspace-grid, ptah-canvas-empty-state, ptah-canvas-detail-panel'` | Kept file (R9b artifact). Selector-string list — **not an import**. |
| `canvas-grid-items` | **0 hits** | Clean. |
| `CanvasTileComponent` | `canvas-tile.component.ts:109` (doc comment), `:436` (class definition); `canvas-tile.component.spec.ts` 28 lines (2,44,108,142,150,153,241,275,283,286,377,404,412,415,464,500,508,524,1023,1061,1075,1091,1104,1111,1162,1218,1240,1256) | All inside files **R9j** deletes (`canvas-tile.component.ts` + its spec). |
| `CanvasEmptyStateComponent` | `canvas-empty-state.component.ts:13,70` (comment + class definition) | **R9p** deletes the file. |
| `TileAgentIndicatorComponent` | `tile-agent-indicator.component.ts:2,46` (definition); `canvas-tile.component.ts:51,134,496`; `canvas-tile.component.spec.ts:67,511,1078,1243` | **R9j** deletes all three files. |
| `TileAgentMiniPanelComponent` | `tile-agent-mini-panel.component.ts:2,115` + `tile-agent-mini-panel.component.spec.ts:4,6,21,29`; `canvas-tile.component.ts:52,135`; `canvas-tile.component.spec.ts:68,512,1079,1244` | **R9m** deletes mini-panel + spec; **R9j** deletes the canvas-tile files. |
| `CanvasLayout` (type) | `canvas-layout.service.ts:47` (interface definition), `:137` (method return type); `canvas-detail-geometry.ts:1,17` and `canvas-detail-geometry.spec.ts:2,6,24` — these import from `./canvas-layout.service`, not from the index | `canvas-layout.service.ts` is the definition site in a KEPT file — not an import of the removed index re-export; **R9k**'s contract owns dropping the type. `canvas-detail-geometry.*` are deleted by **R9j**. |

**Verdict: no live import of any deleted file or removed export from a kept file. No blocker; nothing
needed fixing in `index.ts`** (it no longer matches any of the five names — see §1).

Corroborating orphan check (not required by the contract; run once for the risk section):
`rg -n "canvas-grid-release|canvas-live-budget|canvas-gesture-observation" libs apps` → only each
module's own spec imports it (`canvas-live-budget.spec.ts:1`, `canvas-grid-release.engine.spec.ts:9`);
`canvas-gesture-observation` has zero references at all. The Grid-only helpers are now importer-free
exactly as the plan's A2 importer map predicted; R9p/R9m delete them.

## Checks

No spec run — the batch contract requires none (Mode 2 runs FULL(canvas), TC(canvas), LINT(canvas) and
TC(@ptah-extension/tribunal-panel) after all Wave-2 writers have returned). Only the read-only rg
proofs above were run, directly from W. No git command that changes state was run; deletions used the
shell `rm`.

## Decisions

1. Contract order honoured: the five doomed exports were removed from `index.ts` BEFORE any file
   deletion, so there was no window in which the index re-exported deleted modules.
2. The shared type-export line `export type { CanvasLayout, TileLayout }` was split so only `TileLayout`
   (consumed by `tribunal-panel`) remains re-exported; `CanvasLayoutService` kept per contract.
3. The two kept-file hits (`orchestra-canvas.rail.spec.ts:296`, `orchestra-canvas.component.spec.ts:906`)
   were classified as NON-imports — R9b's negative assertions proving the Grid hosts are absent. They are
   not blockers under the "live import" rule, they keep passing (the queries return null), and the batch
   forbids modifying any other file, so they were left untouched.
4. `canvas-layout.service.ts` still defines and uses `CanvasLayout` internally: that is the type's
   definition site in a kept file, not an import of the removed index re-export. Intra-canvas consumers
   import from the file path, so nothing breaks; R9k already owns removing the type. External imports via
   `@ptah-extension/canvas` are now impossible — the intent of assumption A3 (no consumer outside canvas).
5. The e2e selector strings in `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` were left for
   R9l (HELD, Wave H3), which owns rewriting them; e2e is explicitly not run in R9 lanes.
6. The first `rm` attempt used space-separated paths, which PowerShell's `Remove-Item` refused to bind
   (positional-parameter error). It failed during parameter binding, before execution, so nothing was
   deleted by it; retried immediately with comma-separated paths, which succeeded.

## Risks

- **Stale selector vocabulary in kept files.** `ptah-canvas-workspace-grid` strings remain in
  `orchestra-canvas.rail.spec.ts:296` and `orchestra-canvas.component.spec.ts:906` (passing absence
  assertions; no owning later batch) and in 7 lines of the e2e `canvas.spec.ts` (R9l, HELD). Harmless
  today; if R9l never runs, the e2e lines would need a separate cleanup decision.
- **Specs are not typechecked** (plan assumption A7: `typecheck` compiles `tsconfig.lib.json` only). The
  rg proof shows no kept spec importing any deleted basename, so exposure is limited to the string
  references above, which are not imports; the Wave-2 FULL(canvas) run is the remaining safety net.
- **Shared worktree.** The other Wave-2 writers (R9e/R9n/R9o on chat/chat-ui) are file-disjoint from
  canvas, so the proof should stay valid; it was nevertheless taken against the live tree at the time
  of this report.
- **Interim dead code (planned).** `canvas-live-budget.ts`, `canvas-grid-release.ts`,
  `canvas-gesture-observation.ts` and `canvas-empty-state.component.ts` now have no production
  importers until R9p/R9m/R9p delete them — this is the planned wave order, not a defect.
- `TileLayout` is now the only layout type re-exported from the canvas index; Mode 2 schedules
  TC(@ptah-extension/tribunal-panel) for this wave precisely because of the index change.
