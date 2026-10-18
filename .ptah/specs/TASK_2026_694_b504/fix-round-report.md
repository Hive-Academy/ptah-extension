# Fix round report — TASK_2026_694_b504

## Fixes and tests

| Item | Fix | Regression coverage |
| --- | --- | --- |
| S1 | Toast now renders before the start/scene branch in `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:188`; no-workspace opens set list error and clear stale cards in `libs/frontend/command-center/src/lib/model/session-coordinator.ts:58-66`. | Page toast in start view: `command-center-page.component.spec.ts:647`; no-workspace state: `session-coordinator.spec.ts:170`. |
| S2 | Workspace binding repeats `openStart()` while the active workspace differs from the bound one, regardless of its null start-view result: `command-center-workspace-binding.ts:32-40`. The no-workspace binding refreshes list status at line 21. Status creates a new session from the start view: `command-center-page.component.ts:488-500`. | Switch during load: `command-center-workspace-binding.spec.ts:9`; Status: `command-center-page.component.spec.ts:665`. |
| S3 | Failed new-tab restore force-closes the newly created tab without a confirmation dialog, clears its send lock and active record, and clears its Current card: `session-coordinator.ts:212-220`. | Failure and retry: `session-coordinator.spec.ts:179`. |
| S4 | `choosing` guards concurrent selections in `session-coordinator.ts:146-224`; start-view controls use it to disable clicks in `command-center-start.component.ts:29-94` and page binding at `command-center-page.component.ts:240`. | Double click: `session-coordinator.spec.ts:190`; disabled controls: `command-center-start.component.spec.ts:81`. |
| Moderate: pagination | Each list page has a separate five-second abort timer, and All mode is captured once: `session-coordinator.ts:97-120`. | Pagination, error and retry: `session-coordinator.spec.ts:207`. |
| Moderate: workspace after await | Current and newly created restores check the workspace after `switchSession`: `session-coordinator.ts:168,201`. | Selection and workspace binding tests above. |
| Moderate: current restore | Current-tab store binding occurs only after successful restore; failure returns to start: `session-coordinator.ts:162-179`. | Existing restore retry test: `session-coordinator.spec.ts:148`. |

## Checks

- Prettier ran on every changed source and spec file.
- `nx typecheck command-center --parallel=1`: passed.
- `nx lint command-center --parallel=1`: passed, zero warnings.
- Four changed Jest specs: 4 suites, 58 tests passed; after final cleanup changes, the two affected suites passed again (31 tests), and the page spec passed again (23 tests).
- Full `nx test command-center --parallel=1 -- --maxWorkers=2`: 363 tests passed, but the page-controller spec worker exhausted its 4 GB heap; target failed with 1 suite unable to run. A repeat with `--workerIdleMemoryLimit=512MB` had the same result. An isolated page-controller run also stalled and was stopped before another heap exhaustion.
- Degradation audit: 294 unsuppressed sites, within the required ceiling.
- `ptah_get_diagnostics` was invoked after edits. It exposed a spec mock return type in the changed page spec, which was fixed and whose 23 tests passed; it also listed type errors in unrelated existing specs. The final requested spec diagnostic retry timed out. The explicit Nx library typecheck passed.

## Decisions

- Status on the start view creates a new Command Center session. This follows `send()` and keeps Status usable without a selected card. The alternative was disabling Status; the choice is reversible.
- A failed Current-tab restore returns to the start view with a toast. This avoids binding the scene to an unrestored tab; the choice is reversible.
- The existing `TabManagerService.forceCloseTab()` API removes the failed, newly created tab without the confirmation that `closeTab()` requires for every Command Center tab. The coordinator clears the send lock and active record because this force-close API is designed for transfer flows. This choice is reversible.

## Not done

- The full project test target could not complete because the page-controller Jest worker ran out of memory. No files outside `libs/frontend/command-center/**` or this report were changed.
