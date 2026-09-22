# Context

## What was reverted and where to find it

Commit `acb791814` (branch `refactor/task-524-batch2-surface-active`) contains the
full attempt. Four files were reverted to main before PR 574 merged:

- `libs/frontend/canvas/src/lib/canvas-layout.service.ts`
- `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts`

Everything else from batch 2 merged. `SURFACE_ACTIVE` already exists at
`libs/shared/src/angular/index.ts`, is re-exported from
`libs/frontend/core/src/lib/routing/surface-active.ts`, and is already provided
for the canvas subtree by `SurfaceActiveDirective` with
`ptahSurfaceActive="canvas"`. Its `active` computed is
`chatAddressed() && layoutMode() === 'grid'`. So the token is available to
canvas today; only the consumer side was removed.

Bind it in specs with `provideSurfaceActiveTesting()` from
`@ptah-extension/core/testing`. Inject it NON-optionally, as every other
webview consumer does — an optional inject falls back to "always active", the
gate goes dead, and no test fails.

## The failure

`apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:137`

```
Expected: ['0', '0', '6']
Received: ['0', '0', '0']
Timeout 30000ms exceeded while waiting on the predicate
```

Three CI runs across two commits, all identical. The failure screenshot shows a
healthy canvas: three tiles rendered correctly, side by side, in one row. The
drop simply never committed.

## What was ruled out

- **`linkedSignal` freezing `layout` at mount.** The reverted code converted
  `layout`, `items` and `compactSingletonHeight` from `computed` to
  `linkedSignal` keyed on `active`. A probe test confirmed Angular's
  `linkedSignal` computation DOES track signals read inside it, not only
  `source`, so the layout was not frozen. Not the cause.
- **Gesture translation logic.** `canvas-workspace-grid.component.spec.ts:648`
  ("commits an explicit 2+1 break and restores it after narrow reflow") is the
  unit-level equivalent of the failing e2e and passed throughout.
- **A pixel-geometry flake alone.** The margin IS tight — tiles measure roughly
  1085px tall in the 1200px viewport, so the test's computed drop point
  (`first.y + first.height + header/2`) lands about 15px above the viewport
  floor. Worth knowing, but it does not explain three consistent failures when
  main is consistently green.

## Leading hypothesis, unconfirmed

The reverted code replaced the geometry-applying `effect()` with an
`afterRenderEffect()` and merged the separate re-measure effect into it.

`onGestureStop` sets `_gestureStopped = true` and queues a microtask that
cancels the gesture unless `onGridChange` consumes it first. `onGridChange`
early-returns whenever `_applyingLayout` is true. If the after-render pass runs
between Gridstack's `stop` and `change` events, `applyAuthoritativeGeometry`
sets `_applyingLayout`, writes the PRE-drag geometry back into Gridstack, and
the real `change` is then swallowed by that guard — after which the microtask
cancels the gesture. That produces exactly the observed all-zeros row with an
otherwise healthy canvas.

This was never confirmed. It is a starting point, not a conclusion.

## Constraint on reproducing it

`ptah-electron-e2e` does not stay up on Windows — the app boots, logs
`CompileAndCall failed to evaluate electron script ... script execution has
been terminated`, and `firstWindow` times out after 30s. Whoever takes this
should either fix that harness first or work on Linux, because iterating
through CI costs roughly 20 minutes per attempt and the unit suite does not
reproduce the defect.

The component already exposes `data-canvas-rejected-gestures`,
`data-canvas-gesture-commits`, `data-canvas-change-callbacks` and
`data-canvas-layout-computations` on its host. Asserting those around the drag
would distinguish "gesture rejected" from "change swallowed" immediately. Note
that neither the Playwright trace nor the `error-context.md` page snapshot
carries raw DOM attributes, so the values have to be asserted in the test
itself rather than recovered from a failure artifact afterwards.

## One fix from this work that DID land

`canvas-layout.service.ts` cancelled its pending animation frame BEFORE
validating the ResizeObserver entry. Hiding the grid delivers a 0x0
observation, so that entry revoked a good measurement still in flight and
scheduled nothing to replace it, leaving container dimensions stale. That fix
was reverted along with the rest of the canvas file, because the defect only
existed in the reverted code. If this task reintroduces the active-gated
observer, reintroduce the ordering fix and its regression test with it — the
test was verified to fail without the fix (stale 1464 instead of 1180).
