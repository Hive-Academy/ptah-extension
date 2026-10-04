# Implementation plan — TASK_2026_531_c4a8

BUGFIX, partial depth. Implementation lane: `codex`. Review lane: `opencode`.

## 1. Diagnosis

### The context.md hypothesis, as stated, is refuted

The hypothesis needs a render pass to run **between** Gridstack `dragstop` and
`change`. Gridstack cannot produce that order:

- `node_modules/gridstack/dist/gridstack.js:2603-2641` (`onEndMoving`) calls
  `this.triggerEvent(event, target)` (dispatches `dragstop`/`resizestop`) and
  then `this._triggerChangeEvent()` in the **same synchronous call stack**.
- `triggerEvent` (`:2811`) and `_triggerChangeEvent` (`:1683`) call their
  handlers synchronously. Nothing awaits, nothing schedules.
- The webview uses `provideZoneChangeDetection({ eventCoalescing: true })`
  (`apps/ptah-extension-webview/src/app/app.config.ts:141`). Change detection
  (and so every `afterRenderEffect`) is deferred to the next animation frame,
  never run inside the mouseup handler.
- The `queueMicrotask` in `onGestureStop` runs only after the whole handler
  returns, so after `change` too.

So a render pass cannot fall between `stop` and `change` in the real app.

### The remaining candidate (not confirmed — e2e does not boot on Windows)

A geometry pass can still run **while the gesture is in flight**, between
`dragstart` and `dragstop`. Every mousemove of the two-leg drag is a zone task
and schedules change detection. The drag pulls the third tile below row one,
so Gridstack grows the grid by `_extraDragRow` (`:2638-2639`). That can change
the measured `sessionViewport` (for example, a vertical scrollbar appears in the
1200px viewport, where the drop point is only about 15px above the floor). The
ResizeObserver then updates `containerWidth`/`containerHeight`, `layout`
recomputes, and the geometry pass runs `grid.load(<pre-drag snapshot>)`.
`load` also ends in `_triggerChangeEvent` → `engine.saveInitial()`, which
rewrites the `_orig`/dirty baseline of every node mid-drag. At drop, the final
`change` then reports no dirty nodes (no `change` at all) or the engine nodes
hold the pre-drag rows, and the microtask cancels the gesture. That matches the
observed `['0','0','0']` with a healthy canvas.

The `acb791814` design makes this window wider: the merged `afterRenderEffect`
reads the container signals explicitly and also re-applies after every render
pass where any tracked signal moved. `main` has the same exposure in principle,
with a narrower trigger set. The e2e metric assertions (section 3) will tell
"rejected" (`rejected-gestures` +1) from "swallowed" (`change-callbacks` does not
grow, or grows without a commit) on the next Linux CI run.

## 2. Fix design

Do not depend on the event order. **Never re-apply authoritative geometry while
a gesture is in flight.**

1. Keep the geometry-applying `effect()` (no `afterRenderEffect`) and keep the
   separate re-measure `effect()`. Gate both on `active()` instead of
   `visible()`, where `active = computed(() => surfaceActive() && visible())`.
2. In the non-forced path of `applyAuthoritativeGeometry` (the effect path),
   skip the write while `this._gesture !== null` and set
   `_geometryDeferred = true`. Forced calls (reconcile after commit, reject or
   cancel) still apply, after `_gesture` is cleared. Reconcile already applies
   the latest authoritative geometry, so it also clears `_geometryDeferred`.
3. The re-measure `onResize()` is also skipped while a gesture is in flight.
4. Inject `SURFACE_ACTIVE` non-optionally in `CanvasLayoutService`. Re-land the
   active-gated ResizeObserver from `acb791814` **with the ordering fix**:
   validate the entry (active, non-zero) BEFORE cancelling the pending rAF.
   Keep the re-observe on reactivation.
5. Keep `layout`, `items` and `compactSingletonHeight` as plain `computed`.
   The gate is in the effects and in the observer. Do not port the
   `linkedSignal` conversion — it adds risk and no proven value.
6. `onGestureStart`, `onGridChange` and the gesture-cancel effect use `active()`.
   Tiles receive `[visible]="active()"`.

## 3. Tests

- `canvas-workspace-grid.component.spec.ts`:
  - stop → geometry pass → change: start a drag, move engine nodes, call
    `onGestureStop`, change the container size and flush effects/render, then
    call `onGridChange`. Expect one commit and no rejection. On the
    `acb791814` code the flush writes pre-drag geometry into the engine and the
    commit does not happen.
  - start → geometry pass → stop → change (mid-drag variant): same expectation.
  - Inactive surface: no geometry pass, no gesture start; reactivation applies.
  - All specs use `provideSurfaceActiveTesting()`.
- `canvas-layout.service.spec.ts`: a 0x0 entry after a good entry does not
  cancel the pending frame (expect 1180, not stale 1464). Inactive entries do
  not write. Reactivation re-observes.
- `canvas.spec.ts` (e2e): read `data-canvas-gesture-commits`,
  `data-canvas-rejected-gestures` and `data-canvas-change-callbacks` before the
  drag, and assert after `mouse.up()`: change-callbacks grew, commits +1,
  rejections unchanged — with messages that name "rejected" vs "swallowed".

## 4. Out of scope

TASK_2026_524 Batch 3/4 (detaching `[class.hidden]`, routing changes).
