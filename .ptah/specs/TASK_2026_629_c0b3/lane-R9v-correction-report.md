# Lane R9v correction report: TASK_2026_629_c0b3, batch R9v (decision row 103)

This is the one bounded post-review correction for `codex-review-R9v-fix.md`. It fixes the new Serious (a late position installs auto-update observers on a stale panel) and the rest of Moderate 1. The uncommitted R9v change was the starting point and was not reverted. No git commands were run.

## Finding -> fix -> file:line -> spec case -> result

| Finding | Fix | file:line | Spec case | Result |
| --- | --- | --- | --- | --- |
| **Serious**: after a timeout and a close, `computePosition` can resolve late. It then writes coordinates and installs `autoUpdate` on the closed panel, and nothing ever releases it. | Each `position()` request gets a token. `cleanup()` increments `requestToken` (`:189`). Every `position()` starts with `cleanup()` and then captures the current token (`:131`). After the await, a request that is no longer current returns normally: it writes no coordinates and installs no `autoUpdate` (`:156`, helper `isCurrent` `:165-167`). | `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:94,131,156,165-167,189` | service: `late result after cleanup installs no autoUpdate` (spec `:249`). popover: `close during a pending position leaves no auto-update after it resolves` (spec `:362`): open, 1000 ms timeout, panel shown, close, then the late resolve. | PASS |
| **Serious, close/reopen**: an older pending result can overwrite the single `cleanupFn` of the newer live request, which leaves that request's observer unreachable. | The same token. A newer `position()` invalidates the older request, so the older request can never assign `cleanupFn`. | same `:131,156` | `late result of an older request does not replace the newer request cleanup handle` (`:262`, the newer request resolves first). `older request resolving first installs nothing; the newer one owns the only auto-update` (`:281`, the older request resolves first). Both orders end with `cleanup()` calling the newer handle exactly once. | PASS |
| An auto-update tick that is in flight when `cleanup()` runs can still write coordinates. | The `autoUpdate` callback uses the same `isCurrent(request)` guard. | `floating-ui.service.ts:160` | `an auto-update tick that settles after cleanup writes nothing` (`:302`) | PASS |
| The host is destroyed while a position is pending. | `DestroyRef` → `cleanup()` invalidates the token, and `isDestroyed` is still checked in `isCurrent`. | `floating-ui.service.ts:166` | `installs no auto-update when the host is destroyed while a position is pending` (`:224`) | PASS |
| The normal path is unchanged. | (none) | (none) | `normal path installs auto-update once and cleanup stops it` (`:238`), plus the 14 existing cases | PASS |
| **Moderate 1 remainder**: the popover's generation check controlled focus and output but not the observer lifecycle. | The service now owns that lifecycle. In the popover, the stale-open branch's own `floatingUI.cleanup()` (`if (!this.isOpen())`) was redundant, so it was removed. The branch is now `if (generation !== this.openGeneration) return;` and its comment says the service drops the cancelled request. The `positionPanel` doc now says a late success applies only while the popover stays open. | `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:213-217,236-237` | The existing `does not focus or emit opened when closed before positioning resolves` (`:335`) used to assert that the late observer was *released*. It now asserts that the late observer is *never installed* (the `autoUpdate` call count does not change after the resolve). Its leaking `mockReturnValueOnce` was removed. The new timeout case is at `:362`. | PASS |

Why the popover's new case is a regression test: before this fix, the close ran `cleanup()` while no observer existed, the late resolve then called `autoUpdate`, and the call count rose by 1. That is the exact sequence the review describes. This follows from the code; the test was not run against the pre-fix code.

## Spec runs (from W, through the machine-wide lock, one at a time)

- `node .ptah/tmp/check-run.mjs r9v-corr-1 -- npx nx test @ptah-extension/ui --testFile=floating-ui.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, exit 0, log `%TEMP%\629-check-r9v-corr-1.log`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       20 passed, 20 total` (the file has 20 `it(` cases: 14 existing and 6 new)
- `node .ptah/tmp/check-run.mjs r9v-corr-2 -- npx nx test @ptah-extension/ui --testFile=native-popover.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, exit 0, log `%TEMP%\629-check-r9v-corr-2.log`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       20 passed, 20 total` (the file has 20 `it(` cases: 19 existing and 1 new)

Not run, as the scope required: full suite, typecheck and lint. Mode 2 re-runs the ui specs and TC/LINT(ui).

## Decisions

1. **The token is per service instance.** `FloatingUIService` is `@Injectable()` without `providedIn`. Every consumer provides it at component level and positions one floating element per instance, and the single `cleanupFn` field already assumes this. So one token for each instance is the right scope.
2. **The token is advanced by `cleanup()`, not by `position()`.** Because `position()` begins with `cleanup()`, one increment gives two things: a close cancels the pending request, and a newer request supersedes the older one. A pending request never touches `cleanupFn`. Only the current request assigns it, so a newer handle can never be replaced or dropped.
3. **`isDestroyed` is kept.** A `position()` call made after destroy would otherwise get a fresh token and install an observer that nobody releases. The flag now lives only in `isCurrent`.
4. **The stale request returns normally.** It does not throw. A rejection from `computePosition` still propagates as before, so the popover's `'failed'` fallback is unchanged.
5. **The public API is unchanged.** `position(referenceEl, floatingEl, options)` and `cleanup()` keep the same names, parameters and return types. The additions are private (`requestToken`, `isCurrent`). The 9 production users need no change.
6. **The popover branch was simplified rather than kept as a second guard.** The service now guarantees the behaviour, so the popover's conditional `cleanup()` was dead code ("replace, do not accumulate").

## Changed files (all absolute)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\ui\src\lib\native\shared\floating-ui.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\ui\src\lib\native\shared\floating-ui.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\ui\src\lib\native\popover\native-popover.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\ui\src\lib\native\popover\native-popover.component.spec.ts`

Out of scope, not touched: the pixel-fit and collapsed-scrollbar questions stay with the visual/manual check that is already assigned.
