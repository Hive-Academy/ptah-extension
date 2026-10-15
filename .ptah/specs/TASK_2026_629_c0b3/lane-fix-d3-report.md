# Fix D3 lane report

## Changes

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:38-45`: Kept the transcript host's full-height layout, made it relative, and placed a persistent, zero-flow live region at the top. A keyed visible child uses `bg-base-200` and `text-base-content`.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:54-57,113-127`: Each rejected click synchronously increments a sequence signal and replaces the notice child. The prior four-second timeout is canceled before a new one is armed. Successful opens, expiry, and `DestroyRef` cleanup clear the notice and timer.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts:152-191`: Checks visible notice content, replacement and detachment of the first span after a repeated rejection, a single remaining notice timer after two synchronous rejections, successful-open clearing, four-second removal while retaining the status region, and timer cleanup on destroy.

## Test results

- Canvas target: `node .ptah/tmp/check-run.mjs d3-spec-rerun -- npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — passed, 1 suite and 10 tests. An earlier run failed on the spec's raw timer count because Angular also schedules fixture timers; the assertion now lets those short timers settle before counting.
- Webview ratchet: `node .ptah/tmp/check-run.mjs d3-ratchet -- npx nx test ptah-extension-webview --testFile=apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — failed, 10 passed and 1 failed. Its sole offender is `canvas/src/lib/canvas-rail/canvas-rail-card.component.ts` with `text-base-content/70 x1`; the transcript component was not flagged. The Rail file belongs to another writer and was left untouched.
- `git diff --check` passed for the two edited transcript files.

## Decisions

- Kept the live-region container mounted and positioned without layout space so it remains in view without changing the chat view height chain.
- Used Angular's keyed `@for` to replace the notice DOM node on every rejection in one render, without a microtask or a second announcement timer. Angular emits NG0956 in the spec because that replacement is intentional.
- Preserved the four-second expiry and `DestroyRef` cleanup. No CanvasDetailService, Rail, or chat-ui files were changed.
