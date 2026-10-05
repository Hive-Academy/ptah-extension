# Implementation notes — TASK_2026_531_c4a8

## Files changed

- `libs/frontend/canvas/src/lib/canvas-layout.service.ts` — injects `SURFACE_ACTIVE` non-optionally, pauses and invalidates resize frames while inactive, re-observes on reactivation, and validates ResizeObserver entries before cancelling a valid pending frame.
- `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts` — uses `provideSurfaceActiveTesting()` and covers inactive observations, re-observation, stale-frame invalidation, and the good-entry/zero-entry ordering regression (`1180`, not stale `1464`).
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` — adds the combined surface/workspace activity gate and prevents authoritative Gridstack writes and remeasurement during an in-flight gesture.
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts` — uses `provideSurfaceActiveTesting()`, covers inactive/reactivation behavior, and adds both gesture/geometry ordering regressions.
- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` — asserts change callbacks, rejection count, and exactly one commit immediately after the first two-leg drag and before polling row geometry.
- `.ptah/specs/TASK_2026_531_c4a8/implementation-notes.md` — this implementation record.

## Guard design

`CanvasWorkspaceGridComponent.active` combines the injected surface activity signal with the existing workspace visibility input. Geometry projection, remeasurement, gesture cancellation/start/change handling, the non-forced geometry gate, and tile visibility use that combined signal.

While `_gesture` is non-null, a non-forced `applyAuthoritativeGeometry()` records `_geometryDeferred` and returns before writing to Gridstack. The remeasurement effect likewise returns without setting `_wasVisible`, so it remains retryable. A forced gesture reconcile applies the latest authoritative state and clears `_geometryDeferred`; if reconciliation is skipped (including `cancelGesture(false)` or a stale workspace), cancellation explicitly attempts the deferred application after clearing the gesture. An inactive forced reconcile leaves the flag set, and the activity-driven geometry effect applies it after reactivation. The same cancellation path retries a pending remeasurement once no gesture is in flight.

`CanvasLayoutService` validates activity, entry presence, and positive dimensions before cancelling the current animation frame. Frame generations invalidate callbacks cancelled by deactivation, and re-observation requests fresh geometry after the surface becomes active again.

## Guard-removed experiment

The in-flight guard block was temporarily removed, the two new regressions were run together, and the block was restored immediately afterward.

Command:

```text
npx nx test canvas --runInBand --testNamePattern="commits a (stopped drag|drag) after a deferred geometry pass" 2>&1 | Select-Object -Last 60
```

Result: expected failure. Both tests failed (`2 failed`) because `grid.load()` was called once during the gesture when each test expected no authoritative load. This verifies both sequences are sensitive to removal of the guard:

- stop → geometry pass → change: failed at the no-`grid.load()` assertion.
- start → geometry pass → stop → change: failed at the no-`grid.load()` assertion.

After restoring the guard, the full canvas suite passed.

## Verification

Focused regressions:

```text
npx nx test canvas --runInBand --testNamePattern="deferred geometry pass|inactive|pending measurement|reactivation" 2>&1 | Select-Object -Last 40
```

Final result: `Test Suites: 7 skipped, 2 passed, 2 of 9 total`; `Tests: 222 skipped, 5 passed, 227 total`; `NX Successfully ran target test for project @ptah-extension/canvas`.

The requested literal canvas command was attempted:

```text
npx nx run-many -t typecheck,test,lint -p canvas 2>&1 | tail -n 40
```

PowerShell result: command did not start because `tail` is unavailable (`tail : The term 'tail' is not recognized`). The PowerShell-equivalent command was then used:

```text
npx nx run-many -t typecheck,test,lint -p canvas 2>&1 | Select-Object -Last 40
```

Final result: `NX Successfully ran targets typecheck, test, lint for project @ptah-extension/canvas` with all three targets marked successful.

Electron e2e lint (PowerShell tail equivalent):

```text
npx nx lint ptah-electron-e2e 2>&1 | Select-Object -Last 20
```

Final result: `NX Successfully ran target lint for project ptah-electron-e2e`; ESLint reported `0 errors, 15 warnings` elsewhere in the project.

Final targeted Ptah diagnostics reported: `No diagnostics in the requested files.`

## Open issues

- The Electron e2e runtime was not run, as required, because it does not boot reliably on Windows.
- Nx Cloud reported that the organization exceeded the free plan, but local targets completed normally.
- Workspace-wide diagnostics still report unrelated existing errors in `canvas.store.spec.ts`, `mock-rpc-service.ts`, and `capability-id-codec.ts`; the scoped canvas Nx typecheck passed and no requested file has a diagnostic.

## Revise round 1

### Fixes

- Added live host attributes for `rejectedGestures` and `changeCallbacks`. Both use the existing `metric()` publication-clock read, and both counters publish on increment.
- Reordered the e2e diagnostics to poll change callbacks, then poll the commit with the current rejected count in its failure message, then compare rejected gestures without polling. The change-callback message now acknowledges both a swallowed and a never-emitted callback.
- Added `settleGesture()`, the single post-gesture release path used by cancellation and every commit/rejection exit from `onGridChange()`. It reconciles first, applies any geometry still deferred for a stale workspace, and retries a skipped activation remeasure.
- `onGestureStart()` now invokes cancellation only when a prior gesture exists. This prevents an empty cancellation from consuming the pending activation remeasure before the new gesture is latched.
- `ngOnDestroy()` now clears gesture state directly, avoiding geometry writes or `onResize()` during teardown.
- Moved complete gesture-node validation into `canvas-gesture-observation.ts` and the pure first-tile order lookup into `canvas-layout-intent.ts`. The component and both helper modules now pass the 700-line lint rule without suppression.

Files changed in this revision:

- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-layout-intent.ts`
- `libs/frontend/canvas/src/lib/canvas-gesture-observation.ts` (new pure validation helper)
- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`
- `.ptah/specs/TASK_2026_531_c4a8/implementation-notes.md`

### Tests added

- A host-binding regression asserts `data-canvas-change-callbacks` and `data-canvas-rejected-gestures` render and update after a change callback and a rejected gesture.
- An activation regression latches a drag before the reactivation effects flush, verifies `onResize()` is skipped while the gesture is live, commits the drag, and verifies the remeasure runs exactly once after settlement.

### Commands and results

Initial combined verification (before fixing the activation-test ordering exposed by the new test):

```text
npx nx run-many -t typecheck,test,lint -p canvas,ptah-electron-e2e --skip-nx-cache --outputStyle=static 2>&1 | Select-Object -Last 50
```

Result: `NX Running targets typecheck, test, lint for 2 projects failed`; failed task `@ptah-extension/canvas:test`.

Focused diagnosis:

```text
npx nx test canvas --skip-nx-cache --outputStyle=static --testNamePattern="retries an activation remeasure|renders live change-callback" 2>&1 | Select-Object -Last 60
```

Result before the `onGestureStart()` correction: `Test Suites: 1 failed, 8 skipped, 1 of 9 total`; the activation test observed one premature `onResize()` call.

Focused verification after the correction:

```text
npx nx test canvas --skip-nx-cache --outputStyle=static --testNamePattern="retries an activation remeasure|renders live change-callback" 2>&1 | Select-Object -Last 20
```

Result: `Test Suites: 8 skipped, 1 passed, 1 of 9 total`; `Tests: 227 skipped, 2 passed, 229 total`; `NX Successfully ran target test for project @ptah-extension/canvas`.

Line-budget checks used while extracting the helper:

```text
npx eslint libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts --no-cache 2>&1 | Select-Object -Last 10
npx eslint libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts libs/frontend/canvas/src/lib/canvas-layout-intent.ts --no-cache 2>&1 | Select-Object -Last 12
npx eslint libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts libs/frontend/canvas/src/lib/canvas-layout-intent.ts libs/frontend/canvas/src/lib/canvas-gesture-observation.ts --no-cache 2>&1 | Select-Object -Last 12
```

Intermediate results identified 705 counted lines in the component and then 703 in `canvas-layout-intent.ts`. Final result: exit code 0 with no lint output.

Final required verification:

```text
npx nx run-many -t typecheck,test,lint -p canvas,ptah-electron-e2e --skip-nx-cache --outputStyle=static 2>&1 | Select-Object -Last 50
```

Final result: `NX Successfully ran targets typecheck, test, lint for 2 projects`; exit code 0. Electron e2e lint still reports its existing `15 problems (0 errors, 15 warnings)`.

Final scoped Ptah diagnostics: `No diagnostics in the requested files.` The unrelated sibling diagnostics already listed above remain.

### Open issues

- The Electron e2e runtime was not run, as instructed, because it does not boot on Windows.
