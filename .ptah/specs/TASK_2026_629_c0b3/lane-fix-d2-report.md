# Fix D2 lane report

## Changes

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:41`: The live status is a visible inline line using `text-base-content/80`, with `role="status"` and `aria-live="polite"` retained.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:79-125`: A rejected Rail lane open clears the prior notice, announces again in a microtask, and expires after four seconds. A successful open clears it immediately. `DestroyRef` clears the timeout and prevents a pending microtask from recreating the notice after destruction.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts:152-185`: Covers visibility, repeated rejection with an observable empty-to-message transition, successful-open clearing, expiry, and timeout cleanup on destroy with fake timers.

## Spec results

- Required locked command: `node .ptah/tmp/check-run.mjs fix-d2-rerun -- npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
- Passed: 1 suite, 10 tests. `git diff --check` passed for both changed files.
- The first run failed only on an overly strict test assertion that assumed the fixture had exactly one pending timer. The assertion now checks cleanup of the notice's own timer handle. The final run passed.

## Decisions

- Kept the status element mounted so its live region persists between announcements; clearing its text before the next microtask makes each repeated rejection observable.
- Used a sequence counter to prevent an older queued announcement from appearing after a later click. `DestroyRef` handles timeout cleanup, including when the component is destroyed while a notice is active.
- Left `CanvasDetailService` and Rail files unchanged.
