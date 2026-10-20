# PR #780 review fixes

| Comment # | Valid? | Fix file:line | Spec | Tests: line |
| --- | --- | --- | --- | --- |
| 1 | Yes | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1883`; `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts:208` | `agent-process-manager.service.spec.ts:2805`; `host-attention-coordinator.spec.ts:286` | CLI: 176 passed; coordinator: 37 passed |
| 2 | Yes | `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.ts:109` | `electron-host-attention-notifications.spec.ts:145` | 14 passed |
| 3 | Yes | `libs/frontend/core/src/lib/services/notification.service.ts:82` | `notification.service.spec.ts:62` | 16 passed |
| 4 | Yes | `libs/frontend/notification-center/src/lib/notification-center.store.ts:114` | `notification-center.store.spec.ts:99` | 6 passed |
| 5 | Yes | `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:172` | `notification-snackbar.component.spec.ts:113` | 9 passed |

Audit: `degradation-audit: TOTAL 291 unsuppressed site(s)`; no `FAIL` line; command exited 0. The requested total was 294.

## Decisions

- Lane failure release uses the coordinator's existing generation-aware `resolve` path and runs after `sdkHandle.continue` starts successfully. Failure presentation is unchanged.
- The store catch logs the rejection, shows a fixed status, and carries a `degradation-audit: reported` comment. The snackbar dismiss resumes a paused clock first.
- Only the named implementation and spec files were changed. `git diff --check` passed.

## Not done

- The audit did not produce the requested exact total of 294. It produced 291 with no failures; I did not alter unrelated code or the audit baseline to force the number.
