# Batch 2 fix — Canvas chain

## Fixes

1. **Short stacked height:** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:168,172` gives each stacked split tile a 240px minimum and makes the pane container vertically scrollable in stacked split mode. The container scrolls only when the two tile floors and gap exceed its height; side-by-side and unsplit modes keep vertical overflow hidden. The orchestrator tile remains clipped, leaving the transcript as its inner scroll owner. `canvas-rail-board.component.spec.ts:465-480,1099-1119` checks the classes for both orientations and the stacked floor. Browser geometry at 760x600 and shorter heights remains for the orchestrator to measure.
2. **Effective lane kind:** `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:38-63,255-257` now resolves the visible kind through one function, including the missing-agent fallback. `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:171-172,310-312` uses that same function for tile overflow. `canvas-rail-board.component.spec.ts:457-494` covers a stored background key after its agent disappears; `canvas-lane-view.component.spec.ts:205-243` checks that the displayed lane and host both return to orchestrator geometry.
3. **Tab-change spec:** `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts:745-765` replaces an exact tabpanel `className` assertion with checks for required sizing classes and absence of the fade class. **Cause:** Batch 2 added `flex flex-col` to the orchestrator tabpanel, so the exact string `h-full min-h-0` became stale. The component's tab-change effect still returns before scheduling a frame when `tabId` changes (`canvas-lane-view.component.ts:294-313` after this edit); no component behavior repair was needed.

## Verification

No tests, typecheck, lint, build, serve, or e2e were run under the task rule. Ptah AST analysis parsed all four edited files without errors. Scoped Ptah diagnostics were requested after edits, but the TypeScript check was still running after 45 seconds and returned all four files as unchecked. The running-app height and scroll measurements remain open.

## Decisions

| Decision | Options and evidence | Reversible? |
| --- | --- | --- |
| Use a 240px tile floor only for stacked splits | A fixed 400px floor forced short-height overflow; no floor made short panes unusable. The review recommended a modest 240px floor and conditional container scrolling. | Yes. |
| Share a pure effective-kind resolver between board and lane view | Reading the stored key in the board disagreed with the lane view when an agent disappeared. The resolver follows the lane view's existing ownership checks and fallback. | Yes. |
| Correct the tab-change assertion | The failure was the expected class string, while the component still made no tab-change frame request. The spec now asserts the behavior and sizing contract separately. | Yes. |
