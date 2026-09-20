# CodeRabbit Review Response (PR #539)

This document addresses all 11 review comments from CodeRabbit on PR #539 in accordance with project constraints.

## Findings Summary

| # | File & Location | Status | Summary |
|---|-----------------|--------|---------|
| 1 | `.ptah/specs/TASK_2026_480_c2d8/renderer-analysis.md:309` | **FIXED** | Corrected store-ticker rate estimate: clarified that both stores are root-scoped singletons (at most 2 CD passes/sec across the app) and marked per-session arithmetic as unverified. |
| 2 | `.ptah/specs/TASK_2026_481_7b0f/implementation-plan.md:168` | **FIXED** | Defined concurrent request failure handling: exactly-once settlement for all active in-flight requests on worker kill, single in-process fallback for the failing request, caller fallback ownership with query deduplication to prevent main-thread spikes, and specified a concurrent-timeout spec. |
| 3 | `.ptah/specs/TASK_2026_481_7b0f/implementation-plan.md:196` | **FIXED** | Added `writeCounter: number` (validated as `z.number().int().nonnegative()`) to the request protocol schema and documented cache-validation rules to prevent stale snapshots from overwriting fresh cache entries. |
| 4 | `.ptah/specs/TASK_2026_481_7b0f/implementation-plan.md:356` | **FIXED** | Documented explicit read-only exception to the `context.md` shared-connection rule for out-of-process workers (`readonly: true`, WAL snapshot isolation, no checkpoints, synchronous clean teardown). |
| 5 | `.ptah/specs/TASK_2026_482_d4a8/context.md:68` | **FIXED** | Updated scope item 1 to reflect that the `runOutsideAngular` signal-write hypothesis was tested and rejected (Angular scheduler still scheduled `ApplicationRef._tick()`), and documented the shipped direct `textContent` DOM fix. |
| 6 | `.ptah/specs/TASK_2026_483_6f21/round-2-report.md:267` | **FIXED** | Fixed all mojibake characters (`â€”`) in the Round 3 section, replacing them with proper UTF-8 em dashes (`—`). |
| 7 | `libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts:102` | **FIXED** | Added `lastAttemptKey` tracking and a 10-second deduplication cooldown to `recordFailure`, preventing double-counting when both `status === 'failed'` and stderr patterns report for the same connection attempt. |
| 8 | `libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts:150` | **FIXED** | Handled stderr as a stream: added `stderrBuffer` to retain incomplete trailing text across chunk boundaries, used `RegExp.exec()` to find all failure notices in each chunk, and threaded `noticeSessionId` from `sdk-query-options-builder.ts`. |
| 9 | `libs/backend/memory-curator/src/lib/retention/retention-run-budget.ts:85` | **SKIPPED** | The comment asks to cap `maxDeferMs` by `msLeft()`, which would reintroduce the exact livelock defect this branch was created to resolve (where governor wait consumed the run's remaining wall budget). Round 2 review passed the 5,000 ms ceiling + single-batch latch design. |
| 10 | `scripts/drain-observation-queue.spec.ts:498` | **FIXED** | Injected a no-findings liveness stub into `main` for both fixture tests (`backs up...` and `dry run...`), eliminating host-process CIM/WMI environmental flakiness on Windows. |
| 11 | `scripts/drain-observation-queue.ts:1114` | **FIXED** | Updated `onSignal` to count interrupt signals and immediately terminate the process with exit code 130 upon a second interrupt, giving operators an escape path. |

---

## Test Execution

Per the direct instruction from the user/orchestrator (*"DO NOT RUN ANY TEST COMMAND THIS TIME. Not npm run test:scripts, not nx test, not nx run-many, nothing. The orchestrator will run the tests separately."*), no automated test suites were executed during this turn. All changes were made strictly to addressed files while leaving prohibited files completely untouched.
