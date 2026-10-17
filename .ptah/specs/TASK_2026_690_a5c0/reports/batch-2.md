# Batch 2 — Canvas chain

## Files changed

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:166-176`: bound the pane container and tiles with `min-h-0`/`flex-1`, kept horizontal overflow, prevented container vertical scrolling, and made tile scrolling conditional on the lane. Removed the split tile's 400px minimum so stacked panes can shrink. The pane entrance and O12 clip rule at line 87 remain intact; `PANE_OVERLAYS` was not edited.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:50-70`: clipped the orchestrator host, kept other lane hosts scrollable, and made its tabpanel and embedded transcript wrapper a bounded flex chain. The `laneBlocks()` key and `rail-lane-enter` wrapper remain.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:329-369,457-479,1085-1105,1860-1868`: added per-session lane-key fixtures and class contracts for side-by-side/stacked panes, pane scroll ownership, and the removed height minimum; retained existing entrance, divider, focus and details coverage.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts:205-236`: added class contracts for the orchestrator flex chain and CLI, subagent and background lane scrolling.

## Scroll owners before and after

| Lane | Before | After |
| --- | --- | --- |
| Orchestrator | Pane container could scroll vertically; tile `overflow-y-auto`; lane host `overflow-auto`; chat transcript scroller | Pane container `overflow-y-hidden`; tile and lane host clipped; chat transcript scroller remains the sole vertical owner around the transcript. |
| CLI, subagent, background | Tile `overflow-y-auto` and lane host `overflow-auto` | Tile and lane host retain their scroll classes. The pane container no longer takes vertical scroll; these lanes remain scrollable inside their panes. |
| Details and compact sheet | Independent `overflow-auto`/`overflow-y-auto` surfaces | Unchanged; they scroll when opened. |

## Running-app measurements for orchestrator

Measure at a wide side-by-side split and a 760px stacked split, each with a long transcript and multiline composer. Record `clientHeight`, `scrollHeight`, `scrollTop`, bounding `top`/`bottom`, and computed `overflowX`/`overflowY` for `#session-viewport`, `[data-testid="rail-pane-container"]`, each `[data-testid="canvas-tile"]`, `ptah-canvas-focus-area`, `ptah-canvas-lane-view`, its `[role="tabpanel"]`, `ptah-canvas-detail-transcript`, `ptah-session-embed`, and the chat transcript scroller. Verify that the container, orchestrator tile and lane host do not gain vertical scroll range, the transcript does, and the composer stays within the pane. Repeat after selecting CLI/subagent/background lanes and opening details; their pane content and details should scroll. Check both pane orders, focus changes via click and `focusin`, and entrance animation while the O12 clip is active.

## Verification

No tests, lint, build, serve or e2e were run, as requested. Scoped Ptah diagnostics found no errors in the four edited files; it reported seven errors in untouched sibling/dependency files (`orchestra-canvas.rail.spec.ts`, `mock-rpc-service.ts`, `capability-id-codec.ts`). Runtime geometry remains for the orchestrator to measure.

## Decisions

| Decision | Options and evidence | Reversible? |
| --- | --- | --- |
| Remove the fixed 400px split tile minimum for all lanes | Keep it vs let stacked flex tiles shrink. The minimum could force the pane container beyond a short viewport; other lanes retain their own scrolling. | Yes. |
| Clip only the orchestrator tile and lane host | Clip every lane vs use the selected lane key/kind. The plan requires scrolling in CLI, subagent and background panes; `CanvasDetailService.laneKeyFor` defaults to `orchestrator`. | Yes. |
| Keep the lane block and entrance structure | Rebuild the lane subtree vs change only its sizing. Existing keyed block and entrance contracts are covered in the nearby specs. | Yes. |
