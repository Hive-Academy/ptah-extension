# O23 review fixes

## Changes

- `libs/frontend/core/src/lib/routing/surface-view-transitions.ts:100-137`: The cross-surface branch clears `ptah-vt-none` and resets the no-snapshot count before `SurfaceTransitionTracker.track`. It also advances a generation token. Earlier same-surface `finished` handlers see an old generation and cannot change the new transition's state. The no-snapshot branch registers one `DestroyRef` cleanup that clears the class, count, and generation when the router injector is destroyed.
- `libs/frontend/core/src/lib/routing/surface-view-transitions.spec.ts:125-135,160-265`: The tests now await the stub's `finished` promise, including the rejected case and overlapping switches. A new handoff spec observes the class at `track` time, then settles the old transition and checks the class stays absent. A new destroy spec checks immediate class removal and that the stale finisher leaves it absent.
- `apps/ptah-extension-webview/src/styles.css:755-757`: Kept the name-clearing rule and removed the redundant no-snapshot pseudo-animation rule. With no named elements, those pseudo-elements are not generated.

## Input during the update callback

`apps/ptah-extension-webview/src/styles.css:773-775` already has `::view-transition { pointer-events: none; }`, so the transition overlay does not swallow pointer input during the update callback. The browser may still delay painting until the callback finishes; this needs a browser or perf probe and was not measured here.

## Verification

No tests, lint, build, or browser run were performed as instructed. A scoped Ptah diagnostics request timed out after 45 seconds: it did not check either TypeScript file, and CSS is unsupported. No diagnostic result is claimed.

## Decisions

- **Generation token plus count.** Options: reset only the count or invalidate old handlers too. The review's same-surface-to-cross-surface case can settle the old promise after tracking, so invalidation prevents stale decrements. Reversible within this helper.
- **Register one destroy cleanup after first no-snapshot transition.** Options: one cleanup per transition or one per feature instance. The latter removes the shared root class and resets local state once when its injector is destroyed. Reversible within this helper.
- **Keep the existing overlay input rule.** It already sets `pointer-events: none`; no CSS behavior change is needed for this review point. Browser frame timing remains unverified under the no-test rule.
