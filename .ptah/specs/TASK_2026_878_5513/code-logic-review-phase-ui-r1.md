# UI phase code logic review, round 1

## Verdict

**REVISE — 7/10.** All five earlier findings are resolved in the reviewed paths. The failed-push recovery introduces one race that can make a newer indexing run appear failed and no longer busy.

## Findings status

| Earlier finding | Status | Evidence and rationale |
| --- | --- | --- |
| 1. Accepted start followed by failed status read is silent | **RESOLVED** | `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts:380-388,480-489`: `loadStatus` reports unsuccessful replies, and accepted start/resume shows a fixed status-read failure. The refusal message remains when `accepted` is false. |
| 2. Code index alert can render raw shared errors | **RESOLVED** | `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:174-182` renders `rebuildError` there. `libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.ts:220-222,341-343,418-431` now maps list and stats failures to fixed sentences; the other shared-error producers use the same mapping. |
| 3. Failed push with rejected status reload leaves stale running state | **RESOLVED** | `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts:287-316` clears progress, handles both unsuccessful and rejected status reads, retires `running`, changes a stale `indexing` state to `error`, and emits a fixed failure message. A separate race in this new recovery is below. |
| 4. Poll clears manual curator busy state | **RESOLVED** | `libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-state.service.ts:194-213,216-255` gives the manual RPC its own guarded `curatorRunning` signal, cleared in `finally`; `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts:220-235` disables and labels the button from that signal. |
| 5. Stats refresh erases or replaces rebuild failure | **RESOLVED** | `libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.ts:305-321,325-344` stores the rebuild failure in a separate fixed-error signal, untouched by stats loads; `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:174-182` displays it in Code index. |

## New findings

1. **Serious — `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts:301-316`.** `refreshAfterFailure` has no generation or workspace check after awaiting `tryLoadStatus`. A failed-push status read can remain pending while a new start or workspace status read succeeds. If the older read then fails, this code mutates the **current** `_status`, clears its `running` field, and writes “Indexing failed” over the newer action message. This is reachable when a background scan fails: its old `running` state does not set `isBusy`, so a new start can be clicked while the failed-push read is pending (`:181-186,405-410`). Capture the status generation and workspace for the failed push; apply fallback mutation and message only if that failure is still current. Add a deferred-RPC regression case where the newer run loads before the older read rejects.

## Decisions

- Mark the original failed-push finding resolved because the originally reported rejected-read path now retires the stale running view. Track the newly introduced out-of-order completion as its own finding.
- Retain **REVISE** until the failed-push fallback is guarded against newer status and action updates. The fixed sentence itself is appropriate; its timing is the defect.
- Review was read-only apart from this deliverable. No Nx, npm, tests, or git commands were run. The coordinator's reported scoped test results were not independently reproduced here. No matching review skill loader was exposed in this lane.

