# Code Logic Review - R9j (delete Grid detail panel, geometry, tile, indicator)

Review family: Claude (implementer: opencode)
Task: TASK_2026_629_c0b3, Wave 3 | Reviewed: working tree on HEAD ca4021597 (uncommitted deletions)
Score: 8/10 | Verdict: APPROVE-WITH-FIXES (source deletion is clean; the unowned showcase locators need an owner)

## Scope examined
- Deleted (7): `canvas-detail/canvas-detail-panel.component.ts` + `.spec.ts`, `canvas-detail-geometry.ts` + `.spec.ts`, `canvas-tile.component.ts` + `.spec.ts`, `tile-agent-indicator.component.ts`. Contents read via `git show HEAD:`.
- Deleted exports: `CanvasDetailPanelComponent` (`ptah-canvas-detail-panel`), `canvasDetailGeometry`/`CanvasDetailGeometry`, `CanvasTileComponent` (`ptah-canvas-tile`), `TileAgentIndicatorComponent` (`ptah-tile-agent-indicator`).
- Checks run: `rg` over `libs` and `apps` for every module basename, class name and selector; `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` (rv-W3): green.
- Public API: `libs/frontend/canvas/src/index.ts` exports none of the deleted symbols.

## Verdict on the contract
- Zero importers of the deleted modules or classes anywhere (code and specs). Typecheck passes.
- Preserved, verified by reading importers: `CanvasDetailService` (provided at `orchestra-canvas.component.ts:68`; injected by `canvas-rail-card.component.ts:129`, `canvas-rail-board.component.ts:177`, `canvas-focus-area.component.ts:79`, `canvas-needs-you-queue.component.ts`); `canvas-session-overrides.ts` (used by `canvas-detail-transcript.component.ts:26,73`); lane tabs and lane view (`canvas-focus-area.component.ts:15-16,50-51`); `canvas-session-details.component` (`canvas-rail-board.component.ts:23`); `canvas-card-click.ts` (`canvas-rail-card.component.ts:26,167`).
- No kept file imported a type or constant from a deleted file. The deleted panel and tile were leaf consumers of kept units; nothing flowed the other way.
- Capability: lane selection moved to the Rail focus area via `selectLaneFor`/`laneKeyFor` (rows 56-58 "move lane selection"). Geometry math, the tile host, the per-tile menu and the badge are Grid-only by decisions 73/80.
- Row 58 flagged a "card ownership regression needed" for the badge replacement. That test gap predates R9j and sits with the Rail card batches. It is not an R9j defect.

## Five logic questions
1. Silent failure: none in source. Showcase and e2e locators fail loudly (timeouts), and only when someone records a showcase.
2. User action: none; the deleted components were already unreachable after R9b/R9i.
3. Wrong-answer input: not applicable.
4. Dependency failure: not applicable.
5. Missing: the e2e/showcase locators (finding 1) and the now-dead detail-service surface (finding 3).

## Findings

### 1. [Moderate] Four showcase locators point at the deleted `ptah-tile-agent-indicator`; no batch owns them
- Files: `apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts:181,256`, `chat-code-edit.scene.ts:161`, `canvas-orchestra.scene.ts:166`.
- Will a recording break? These scenes were already unrunnable before R9j. Each one first finds its session through `[data-testid="canvas-tile"]` (`canvas-orchestra.scene.ts:202`, `chat-code-edit.scene.ts:228`, and `reviewTile()` used at `lane-console-review.scene.ts:203`). No non-spec element in `libs/frontend/canvas` carries that testid today (the Grid tile host and workspace grid are gone), and the scenes also drive `button[title="Switch to compact view"]`, a Grid-tile control. The first `tiles.nth(...).waitFor` therefore times out long before any indicator locator is reached. R9j adds no new recording failure; the indicator lines are extra dead references on top of an already-broken flow.
- Severity: Moderate. The showcase config is a separate Nx target (`apps/ptah-electron-e2e/project.json:25`, `showcase`) with no CI gate. The wider breakage (tile testid, compact toggle, Grid-era narration such as "pan the whole grid") is far larger than four selectors.
- Owner: not R9l (its e2e files are `canvas.spec.ts` and `task-337-agent-card-refresh.spec.ts`) and not R9x (`canvas.spec.ts`). Putting scene rewrites into either would widen a tightly scoped selector batch with video work. Recommend a separate showcase/e2e follow-up batch (video-director, or the R11 stale-selector sweep) covering `src/showcase/*.scene.ts` and the shared `canvas-tile` locators in `src/support/perf-*.ts` and `specs/task-3xx-*.spec.ts`, since they are the same upstream break. Until then, mark the affected scenes as not recordable in the task notes rather than leaving four locators that read as live.

### 2. [Minor] Stale string in a kept spec
- `orchestra-canvas.component.spec.ts:906` lists `ptah-canvas-detail-panel` in a comma selector asserting absence. Harmless (the assertion stays true) but weaker than it reads; trim when the file is next touched.

### 3. [Minor] Orphaned `CanvasDetailService` surface; belongs to later batches
- `canvas-detail.service.ts:51 toggle(...)` has no production caller now: the deleted tile was the only one (it called `detail.toggle`, `detail.open`, `detail.close`, `detail.selectLane`). `next()`/`prev()` (`:71,75`) are used only by `canvas-detail-keyboard.ts:30-31`, which R9m deletes. `tile-agent-mini-panel.component.ts` and `canvas-detail-keyboard.ts` are orphaned too (R9m).
- Fix: have R9l (which owns `canvas-detail.service.ts` and its spec) remove `toggle`/`next`/`prev` and `step()` once R9m lands, rather than keeping them alive for a spec. Confirm R9m deletes `tile-agent-mini-panel.component.ts` as well.

## Residual uncertainty
- I did not run Jest (barred). Typecheck does not compile specs (A7); the rg over specs is clean, so the risk is low. Mode 2's FULL(canvas) is the backstop.
