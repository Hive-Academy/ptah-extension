# R5 logic-review fixes

## Changes and verification

| Finding | Change and test | Evidence |
| --- | --- | --- |
| 1 | `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts:175` captures the 400 ms timeout handle, requires that exact handle in `clearTimeout` on destroy, advances 400 ms, and checks the destroyed component's `enteringTabId()` remains `B`. The 399/400 ms assertion remains a separate test. | Temporarily removed the destroy cleanup at `chat-view.component.ts:701` and ran the permitted chat-view Jest spec: **1 suite failed, 2 tests failed, 5 passed**. The new destroy test failed at `toHaveBeenCalledWith(call!.id)`. The other failure was the initial zone assertion, corrected afterward. The component was restored in the command's `finally` block from its original byte array; the cleanup line is present at line 701. Final chat-view run: **7 passed, 7 total**. |
| 2 | `chat-view.session-enter.spec.ts:192` verifies that the 400 ms `setTimeout` is called while the injected `NgZone.runOutsideAngular` callback is executing. This isolates the target timer from unrelated zone calls. | Included in the **7/7** passing chat-view spec. No production component edit remains. |
| 6 | `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts:317` retries dropped-correction reconciliation in one additional microtask when a surface is pending. The retry flag prevents an unbounded queue. `chat-tab-route-sync.service.spec.ts:459` holds the pending surface for the first reconciliation, clears it before the second, asserts exactly two calls before transition settlement, then checks the corrected URL and replace state. | Final route-sync spec: **35 passed, 35 total**. The two-call assertion makes the retry observable independently of later transition settlement. |
| 10 | `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts:663` requires an entrance only for S2. S3/S4 viewport, index, and delay checks run when animated messages exist. `:469` records `entrance.animatedCount` in each window row of the JSON report. | Probe change was not run; Electron/e2e checks are reserved for the orchestrator. |
| 11 | `nav-session-motion.perf.spec.ts:166` records the animation event immediately, then updates `visibleAtStart` after two animation frames (`:172`) so scroll restoration can settle. `:31` raises `probeVersion` to 3, requiring a matching M0 baseline for M1. | Probe change was not run; Electron/e2e checks are reserved for the orchestrator. |

`ptah_get_diagnostics` reported no errors in the four edited source files. It reported 266 errors in sibling files outside this assignment.

## Decisions

- Reconcile at most once more after a pending surface: a bounded microtask follows the existing router-event microtask pattern and prevents a persistent retry loop.
- Store `animatedCount` on each window's `entrance` object because the persisted window rows are the probe's report output.
- Preserve the animation event's original timing and other fields; defer only `visibleAtStart` for start events. Observed legacy records retain their existing immediate visibility sample.
