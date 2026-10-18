# Batch S7live report

## Changes

- `libs/frontend/core/src/lib/routing/surface-view-transitions.ts:67-91`: Clear stale entrance state when tracking a transition, set `ptah-vt-entering` after `updateCallbackDone` only for the current transition, and clear both classes on settle.
- `apps/ptah-extension-webview/src/styles.css:754-759,801-803,833-836`: Name the surface only for the old capture, animate the live incoming surface with the existing rise keyframe, retain the old snapshot exit, and disable the live animation under reduced motion. The unused new-snapshot animation was removed. Root transition rules and `::view-transition { pointer-events: none; }` remain.
- `libs/frontend/core/src/lib/routing/surface-view-transitions.spec.ts:119-127,217-272`: Assert entrance state after the update, cleanup on settle, stale-state clearing on supersession, and that a superseded late update cannot mark the newer transition.

## Verification

- Scoped Jest: 1 suite, 23 tests passed.
- `npx nx typecheck core --parallel=1`: passed.
- `npx nx lint core --parallel=1`: passed with 14 warnings and 0 errors. Warnings are in the core project, including pre-existing files outside this change.
- Ptah diagnostics were requested for the changed files but timed out; the scoped typecheck completed successfully.
- Nx Cloud reported a disabled organization (401) after the successful Nx targets. No browser or Electron run was performed in this batch.

## Decisions

- Kept the old snapshot exit and removed only the unreachable new-snapshot rise rule. Evidence: the approved design requires an old capture and live incoming DOM; `styles.css:754-759,801-803`. Reversible: yes.
- Used controlled `updateCallbackDone` promises in tracker unit tests to prove ordering and supersession. Evidence: existing `makeTransition()` fixture and tracker tests in `surface-view-transitions.spec.ts`. Reversible: yes.
