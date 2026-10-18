# Code Logic Review, Batch 2 (Canvas chain), TASK_2026_690_a5c0

Review family: Claude reviewer, codex implementer.

Score: 7.5/10. Verdict: APPROVED (with two moderate follow-ups). Source reading only; no tests run (Batch 4 mid-edit). `PANE_OVERLAYS` (line 40) is Batch 4's and was ignored.

## Blocking / Serious
None.

## Moderate

- M1. The 400px split minimum was removed outright instead of replaced by the "compact viewport policy" the plan asked for (plan line 19, 66). `canvas-rail-board.component.ts:166-167`: tiles are `min-h-0 flex-1` and the container is `overflow-y-hidden`, so a stacked split in a short window gives each pane an arbitrary share with no floor. At roughly 500px of viewport height each pane is about 250px including header, lane tabs and composer, leaving a few lines of transcript, and CLI/subagent/background panes have no way to get more room because the container no longer scrolls vertically. Add a modest floor (for example `min-h-[240px]`) paired with a container `overflow-y-auto` only when stacked and short, or document that short heights intentionally shrink. Needs a rendered check at 760x600 stacked.
- M2. Two sources decide "orchestrator". The tile uses `detail.laneKeyFor(id) === 'orchestrator'` (`canvas-rail-board.component.ts:169`, stored key), while the lane view uses `selectedKind()` (`canvas-lane-view.component.ts:52-53`), which falls back to orchestrator when the stored `cli:`/`sub:`/`bg:` target no longer exists (`:229-237`). In that case the tile is `overflow-y-auto` and the lane host `overflow-hidden`. This is benign (the host is bounded `h-full`, so the tile gets no scroll range and the transcript remains the only scroller), but the two classes disagree and a future change could create a double scroller. Prefer one source (expose `selectedKind` or resolve the effective lane key in the service). The board spec stubs `laneKeyFor` only with stored keys, so this fallback is untested.
- M3. Specs assert classes only and not geometry. That fits the instruction (jsdom cannot compute layout), but nothing guards that the lane view's host `h-full` still resolves inside the tile's stretched flex height; that remains a rendered measurement (the report's checklist) and must be run before merge. The `ptah-canvas-detail-transcript` wrapper is a plain block `flex-1` item with an `h-full` child (`canvas-lane-view.component.ts:72-73`); percentage height on that child depends on the flex item being treated as definite. Browsers do this for column flex containers with definite height, but verify at stacked 760.

## Minor
- `canvas-lane-view.component.ts:72`: `hidden` and `flex-1` on the same div; harmless (display none), but the transcript wrapper stays in the flex panel for non-orchestrator lanes, where the panel is not flex, so `flex-1` is dead there.
- Tests are long single-line in places; prettier will handle it.

## Focus checks

1. One vertical scroller for the orchestrator: PASS by source. Container `overflow-y-hidden`, orchestrator tile `overflow-hidden`, lane host `overflow-hidden`, tabpanel `flex flex-col h-full min-h-0`, transcript wrapper `min-h-0 flex-1`; the chat transcript scroller from Batch 1 is then the only vertical owner. No hidden-scrollbar trick.
2. Other lanes: PASS. Tile `overflow-y-auto` and host `overflow-auto` for cli/sub/bg (`:52-53`, board `:169`); the tabpanel is not flex there, preserving prior layout. Spec at lane-view spec `bounds only the orchestrator host...` covers all three kinds plus the rail-lane-enter wrapper.
3. Side-by-side and stacked: container flex-row/flex-col toggle unchanged; `overflow-x-auto` kept so the 360px min-width still scrolls horizontally. The stacked spec asserts min-h-0, flex-1, overflow-hidden and the removed `min-h-[400px]` (see M1).
4. Preserved contracts: `laneBlocks()` and `track block.key` unchanged (`canvas-lane-view.component.ts:75`), `rail-lane-enter` wrapper intact and asserted, `[animate.enter]` pane entrance and `data-pane-*`/divider bindings unchanged. In the orchestrator lane the empty `.rail-lane-enter` sibling is a zero-height flex item, so it does not take space. I did not re-inspect the O12 clip rule (line 87); the report says untouched and the diff does not touch it.
5. Lane siblings and overlay focus: `focusin`/click activation handlers unchanged; the focus-area got only `min-h-0`. With the tile `overflow-hidden`, a tile-local absolute overlay (Details dialog) is clipped to the pane, which matches the previous `overflow-y-auto` clipping.

## Required follow-ups (non-blocking)
1. Decide and test the short-height policy (M1).
2. Unify the orchestrator decision (M2) or add a test for the fallback case.
3. Run the rendered measurement at 1440 side-by-side and 760 stacked (M3).

## Re-review (after fix round)

Review family: Claude reviewer, codex implementer. Score: 8.5/10. Verdict: APPROVED.

- Height floor: fixed. Stacked split tiles get min-h-[240px], and the pane container scrolls vertically only when stacked and displayed (overflow-y-auto), otherwise overflow-y-hidden (canvas-rail-board.component.ts pane container and tile bindings). Residual by design: in a stacked split shorter than two floors the container scrolls while the orchestrator transcript also scrolls, so two vertical scrollers appear only in that short case. Acceptable and consistent with the plan's compact policy; confirm at 760x600 in the rendered pass.
- Unified lane kind: fixed. effectiveCanvasLaneKind (canvas-lane-view.component.ts) is now the single decision, used by the lane view's selectedKind and by the board's tile classes (effectiveLaneKind). Its checks match the removed selectedCli, selectedSubagent and selectedBackground logic (same ownership filters and ids), so behaviour is unchanged for existing lanes. Minor: the board derives sessionId from tab.claudeSessionId while the lane view takes it as an input; they should agree, and a mismatch would only change which class applies.
- Tab-change test rewrite: acceptable. Strict className equality became classList checks (h-full, min-h-0, flex, no focus-fade), and the lane spec gained the vanished-subagent fallback case. It no longer rejects stray extra classes, a fair trade given the intended class set changed.
- The rendered measurement at 1440 side-by-side and 760 stacked remains open for the orchestrator's visual pass; it is not a code defect.
