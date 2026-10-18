# Code Logic Review - TASK_2026_683: R5 fix round (findings 1, 2, 6, 10, 11)

Review family: claude (reviewer) vs codex (implementer). Read-only; nothing executed. The orchestrator's typecheck, lint and 463-test Jest run stand as the only runtime evidence. The lane's mutation run for finding 1 was not repeated, so that claim is checked by reasoning below.

Verdict: APPROVED. No Blocking or Serious items. Two Minor notes.

| Finding | Status | Evidence |
| --- | --- | --- |
| 1 destroy test | FIXED | `chat-view.session-enter.spec.ts:175-190` |
| 2 zone test | FIXED | `chat-view.session-enter.spec.ts:192-210` |
| 6 re-queue once | FIXED | `chat-tab-route-sync.service.ts:317-327`, spec `:459-487` |
| 10 S3/S4 conditional | FIXED | `nav-session-motion.perf.spec.ts:661-669` |
| 11 two-rAF sample | FIXED | `nav-session-motion.perf.spec.ts:154-176` |

## Finding 1 - FIXED

`chat-view.session-enter.spec.ts:176-190`. The `setTimeout` spy is installed before `mount()`. The test takes the handle of the last `setTimeout(..., 400)` call (`:181-182`) and spies `clearTimeout` only after that. It then requires `clearTimeout` to be called with exactly that handle on `fixture.destroy()` (`:186`). It advances 400 ms and requires `enteringTabId()` to still be `'B'` (`:187-188`).

Removing `clearTimeout(this.enteringTimer)` at `chat-view.component.ts:701` breaks both assertions:
- The handle-specific `toHaveBeenCalledWith` fails. This is the weakness I raised before: no Angular-internal `clearTimeout` can match a handle that only the component created.
- The surviving timer fires at `:1207-1209` and sets the signal to `null`, so `:188` fails.

Where the lane's reported mutation run (2 tests failed with the cleanup removed, 7/7 after restoring) can be checked against the code, it matches this reasoning. The other failure it mentions was a zone assertion, which is finding 2.

The stub template (`:116-118`) still binds `enteringTabId()`, so `enteringTabId` is the real production signal.

## Finding 2 - FIXED

`chat-view.session-enter.spec.ts:192-210`. A depth counter is wrapped around the injected `NgZone.runOutsideAngular`. The `setTimeout` spy records `outsideDepth > 0` only for the 400 ms call. If the production code at `chat-view.component.ts:1206` dropped `runOutsideAngular`, `timerOutside` would be false and the test would fail. Unrelated zone calls no longer influence it. The component calls `this.ngZone.runOutsideAngular` through the instance property at call time, and the spy replaces that property on the same injector instance (`:194-199`), so the hook is effective.

Minor (test hygiene): if `expect(timerOutside)` fails, `setSpy.mockRestore()` at `:209` is skipped. `TestBed.resetTestingModule` in `afterEach` does not undo a spy on `global.setTimeout`. `jest.useRealTimers()` in `afterEach` mitigates it, but a `try/finally` or `jest.restoreAllMocks()` in `afterEach` would be safer.

## Finding 6 - FIXED, bounded

`chat-tab-route-sync.service.ts:317-327`:
- `reconcileDroppedCorrection(retryIfPending = true)` re-queues once through `queueMicrotask(() => this.reconcileDroppedCorrection(false))` (`:319`).
- The retry passes `false`. If the surface is still pending it returns with `correctionDropped` unchanged. It cannot re-queue again, so there is no infinite loop.
- It re-checks `correctionDropped` first (`:318`). A reconciliation that succeeded in between turns the retry into a no-op.
- Callers: the router subscriber microtask (`:134`) and the deferred `afterTransition` branch (`:303`). Both go through the same bounded method. A reconcile that finds a diverged URL calls `followActiveTab`, which calls `replaceChatUrl`. That clears `correctionDropped` (`:298`) and defers again through `afterTransition`. It is asynchronous and gated on a transition or navigation starting, so it is not a synchronous recursion.

Spec `:459-487`: the pending mock returns `'settings'` at the cancel event and `null` after a microtask. The test asserts `reconcile` was called exactly 2 times (`:477`), then checks the corrected URL and `replaceState`. Without the retry it is 1 call and fails. The mock's microtask ordering only works because the sync subscriber queues its microtask before the test's subscriber. That ordering is deterministic (the sync subscribes first in `setUp`).

Minor (coverage): there is no case where the surface stays pending through both attempts. The expected result is exactly 2 calls and `correctionDropped` left true. The bound is only proven by reading the code. The residual behaviour is unchanged: if the Router is still pending after two microtasks, the URL stays on the wrong tab until the next navigation event. This is the documented, accepted ceiling for this fix.

## Finding 10 - FIXED

`nav-session-motion.perf.spec.ts:661-669`. "Entrance exists" is now `S2` only (`:663`). For S3 and S4 the viewport, first-index-0 and first-delay-0 checks apply only when `animated.length > 0` (`:664-668`). This matches the earlier recommendation and the B4 decision that history arriving after an empty or replaying activation is not animated. `animatedCount` is written into each window row (`:469`) and declared in the `WindowRecord` type (`:91`), so a missing S3/S4 cascade is visible in the report without failing M1.

## Finding 11 - FIXED

`nav-session-motion.perf.spec.ts:154-176`. The record is built and pushed synchronously (`:166-170`), so its timing, index, delay and `atMs` are unchanged. For `source === 'start'` only `visibleAtStart` is updated, after two nested `requestAnimationFrame` calls (`:171-175`). `observed` and legacy records keep their immediate sample (`:169`).

Stale generation and a later scenario:
- The rAF callback has no `generation` guard, but none is needed. The callback writes only to its own `record` object.
- `capture()` clears the array with `probe.entranceEvents.length = 0` (`:261`) and `measure()` deletes the probe each window (`:428`). A stale callback therefore mutates an orphaned object that is in no later window's array.
- `visibleInScroller` (`:147-153`) returns `false` when the current active scroller does not contain `el`. A later scenario's scroller cannot produce a true for an old element. The worst case is a false negative for an element detached within about 33 ms, which is the correct reading anyway.

Event recorded before the sample resolves:
- `record` is pushed by reference at `:170`.
- The window is serialized by `page.evaluate` after `waitForTimeout(timing.remaining)` has brought it to at least 610 ms after the click (`:421-430`).
- `animationListener` accepts events up to 600 ms (`:178`), but entrance starts come from a stagger delay of `--i * step` with a cap of 6 (`transcript-session-entrance.ts:5`). They begin in the first few hundred ms. The two-frame sample (about 17-33 ms) resolves long before serialization, and the mutated `visibleAtStart` is in the returned data.
- The `:455` first-visible filter and the `:665` assertion read the post-sample value.

Minor (residual): this relies on timing margin rather than an explicit flush. An entrance starting in the last ~35 ms of the 600 ms window would serialize with the initial `false` and could produce a false assertion failure. With a cap of 6 and the current step this is not reachable. If the stagger step or cap grows enough to approach about 570 ms, the margin disappears.

`probeVersion = 3` (`:31`), written to both the partial and complete files (`:361`). M1 requires the same version (`:342-343`). An existing v2 `m0.json` is refused until M0 is re-recorded with this probe. That is the intended safety, but the M0 baseline must be re-run before any M1 assertion run.

## Five logic questions

1. Silent failure: none new. The destroy test no longer passes without the cancellation (`:186-188`). The route-sync retry still gives up silently after two pending checks. That is bounded and documented.
2. Unexpected user action: not affected by this round. Tests and probe only; the one production change (`reconcileDroppedCorrection`) is bounded.
3. Wrong-answer input: the probe's `visibleAtStart` could be wrong only for an entrance starting in the last ~35 ms of the window. Not currently reachable.
4. Dependency failure: Router internals still decide when `pendingSurface()` clears. The single re-queue covers one extra microtask only.
5. Missing: a persistent-pending route-sync test, and `try/finally` spy restoration in the zone test. Both Minor.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for findings 1, 2, 10 and 11 (code read in full for each). MEDIUM-HIGH for 6: the bound and the retry are confirmed by reading, and the 2-call assertion is sound, but the persistent-pending case has no test.
- Top risk: M0 must be re-recorded at probe version 3 before M1 is run.
- Optional follow-ups: a test where the surface stays pending (expect exactly 2 calls); restore spies in `afterEach` in `chat-view.session-enter.spec.ts`.
