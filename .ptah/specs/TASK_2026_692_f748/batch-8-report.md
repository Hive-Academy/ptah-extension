# Batch 8 test report

## Scope and files

Task 8.1 is implemented in:

- Created `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.coalesce.spec.ts`
- Created this report: `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-8-report.md`

No service, batch-state, task-state, or other source file was edited. The new spec uses the project Jest configuration, its adjacent spec's mutable wall clock and `VirtualTimeScheduler` pattern, a **real `CompactionCoordinator`**, and the service's real RxJS pipeline. The coordinator timer adapter is in-memory so its dwell timer cannot hold the test process. The service's callback and completion listeners are connected through the same registration methods used by the adjacent spec.

## Cases and evidence

| Case in new spec | Evidence |
| --- | --- |
| Manual admission before idle enqueue | `admitManualCompact` returns `send` with reservation; delayed `beforeEnqueue` throws `manual-reserved`; no claim or notice. Passing. |
| Manual admission after idle claim | Returns `coalesced`; one sender call and one boundary notice; PostCompact releases claim. Passing. |
| Boundary → result → manual → PostCompact | Manual remains coalesced and claim remains held through result; PostCompact releases it; one send and one notice. Passing. |
| PostCompact first, acting and OBSERVE_ONLY | Separate positive cases prove immediate reserved manual `send` in the same virtual frame, with released claim. Passing (2 parameter rows). |
| Old-boundary notice across a new run, acting and OBSERVE_ONLY | The old boundary gets the notice. Assertions that the new run and manual boundary get none expose a service defect, so both rows use `it.failing`. |
| PostCompact with no boundary, acting and OBSERVE_ONLY | Manual reservation is admitted synchronously; grace deadline closes without notice, warning, or timer action. Passing (2 rows). |
| Boundary without PostCompact | Grace deadline logs `postcompact-timeout` and releases claim. Passing. |
| Same-frame due/input/PreCompact feedback | Tests both scheduler insertion orders. At most one send; when input wins, zero sends. Passing (2 rows). |
| Unresolved send then release | Delayed `beforeEnqueue` throws `compaction-state`; no claim, timer action, or retained alias/key/current ID. Passing. |
| Late send/deadline feedback after release | Resolving old send and advancing virtual time leaves zero groups and actions. Passing. |
| Old unresolved send, release, new binding, then old completion | New group is armed before old completion. Expected alias/current ID and second fire expose the old finalizer defect, so this case uses `it.failing`. |
| Reducer throw in one group | A one-time config throw reaches group `catchError`; after release the failed key has no alias/key/current ID, while another session still sends and its timer clears on release. Passing. |
| 1,000 sessions | All 1,000 arm; releasing all leaves zero scheduler actions and zero alias/key/current ID/notice entries. Passing. |

Existing adjacent specs retain coverage for claim timeout, BACKOFF/failed send, lapsed sleep/wake, individual cancellation causes, rekey, and dispose. These cases ran in the same six-suite idle-folder check. The new spec focuses on ordering, coalescing, and retained state as assigned to Batch 8.

## Service defects

1. `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:152-157`: an old group's `finalize` deletes aliases and `currentIds` by key after a released session has already rebound to a new group with that key. The new group's due signal cannot resolve, so it does not fire. The regression case is `it.failing`; the service was not edited.
2. `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:174-178,297-299`: a notice set for an old boundary is not cleared on a new `sessionBound` run. A later manual boundary under the same session ID can observe the stale idle notice. Both acting and OBSERVE_ONLY regression rows are `it.failing`; the service was not edited.

## Listed risks

| Plan-validation risk | Handling in this batch |
| --- | --- |
| A2 coordinator-origin slash command | Plan records live probe P1 as passed; this test-only batch did not repeat a live SDK probe. |
| Existing constructor call sites | New spec constructs the current service signature. Whole agent-sdk project suite passed. |
| Shared settings count | Assigned to Task 5.1; not modified here. Whole project suite passed. |
| Service spec size | Cases live in the separate coalescing spec as planned. |
| Router admission await race | Assigned to Task 12.1; local before/after-claim ordering is pinned here. |
| `postCompactSeen` through late COMPACTING | Assigned to coordinator/router specs in Tasks 1.2 and 12.1; real coordinator PostCompact-first manual admission is exercised here. |
| Pending send outlives release | Delayed `beforeEnqueue` veto and late feedback cases pass; the rebind variant exposes the old-finalizer defect above. |
| Timer/action leak | 1,000-session release and reducer-failure cleanup cases pass with zero remaining scheduled actions for released sessions. |
| Large lifecycle manager | Outside this spec-only batch; no manager changes. |
| UI completion evidence | Outside this backend test-only batch; visual review remains scheduled by the plan. |
| Settings write path | Outside this batch; local service setting behavior is covered by adjacent idle specs in the passing folder run. |

## Decisions

- Used `it.failing` only for assertions that expose the two current service defects. Positive PostCompact-first manual admission has separate passing rows so the expected-failure marker cannot hide a regression in that behavior. This is reversible once the service defects are fixed.
- Used PowerShell `Select-String`/`Select-Object` as the filtering equivalent of the requested `grep`/`head`/`tail`, because `grep` is unavailable in this Windows shell. Command arguments, worker cap, project scope, and `NX_NO_CLOUD=true` were retained.

## Verification

`ptah_get_diagnostics` on the new spec after the final edit: **0 errors, 0 warnings**.

With `NX_NO_CLOUD=true`, the final idle-folder run used `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle --coverage=false --maxWorkers=2`:

```text
Test Suites: 6 passed, 6 total
Tests:       71 passed, 71 total
EXIT_CODE=0
```

After that passed, the final project run used `npx nx test @ptah-extension/agent-sdk --parallel=1 -- --maxWorkers=2`:

```text
Test Suites: 2 skipped, 169 passed, 169 of 171 total
Tests:       3 skipped, 3588 passed, 3591 total
EXIT_CODE=0
```

The project run also emitted a Jest worker-exit warning. It did not fail the run; no open-handle diagnosis was run because this batch is limited to the new spec and all requested checks passed. Jest counts the three `it.failing` rows as passing because their defect assertions fail as expected. No build, serve, e2e, or workspace-wide test was run.
