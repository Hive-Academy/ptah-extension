# Implementation plan — TASK_2026_531_c4a8 (contract-path copy)

Canonical file: `.ptah/specs/TASK_2026_531_c4a8/implementation-plan.md`.

## Root cause

- The context.md hypothesis (a render pass between Gridstack `dragstop` and
  `change`) is REFUTED. `gridstack.js` `onEndMoving` fires `dragstop` and then
  `_triggerChangeEvent` in one synchronous call stack, and the webview uses
  zone `eventCoalescing`, so no change detection runs between them.
- Remaining candidate (not confirmed, needs Linux CI): a geometry pass
  WHILE the gesture is in flight. Mid-drag container growth (`_extraDragRow`)
  can update the measured size, the geometry effect runs `grid.load(pre-drag)`,
  and `load` re-baselines the engine via `saveInitial`. At drop the node is
  not dirty, so no `change` arrives and the microtask cancels the gesture.

## Fix design

1. Keep the geometry `effect()` and the re-measure `effect()`. No
   `afterRenderEffect`, no `linkedSignal`.
2. Gate on `active = SURFACE_ACTIVE() && visible()`. Inject `SURFACE_ACTIVE`
   non-optionally.
3. While `_gesture !== null`, defer non-forced geometry writes and the
   re-measure. Release them in one `settleGesture` path at every gesture end.
4. Re-land the active-gated ResizeObserver with the ordering fix: validate the
   entry before cancelling the pending frame.
5. Render `data-canvas-rejected-gestures` and `data-canvas-change-callbacks`
   on the host, and assert all three metrics around the e2e drag.
