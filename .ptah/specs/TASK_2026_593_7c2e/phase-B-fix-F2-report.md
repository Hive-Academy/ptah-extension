# Phase B fix F2 report

## Changes by finding

| Finding | Change | File:line | Spec |
| --- | --- | --- | --- |
| 0, VS Code typecheck | Reviewed the B5 adapter, visibility, registration, provider, and DI files against the current `WebviewManager` and port signatures. No definite source-level type mismatch found; the failed Nx output was unavailable. | `libs/backend/platform-vscode/src/implementations/ptah-view-visibility.ts:17`; `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:308` | Typecheck reserved for orchestrator. |
| M4 | Stale VS Code Open reveals Ptah, displays fixed `Already answered`, and sends no route. | `libs/backend/platform-vscode/src/implementations/vscode-host-attention-notifications.ts:68` | `vscode-host-attention-notifications.spec.ts` stale-click case. |
| M5 | Renderer-ready registration reports whether it attached; a failed registration clears `waitingForRenderer`. Callback clears it before checking the window. | `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.ts:118`; `apps/ptah-electron/src/activation/bootstrap.ts:250` | `electron-host-attention-notifications.spec.ts` readiness retry case. |
| M6 | Electron checks the current window for destruction before reveal, send and readiness routing; missing window drops the route with a fixed log line. | `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.ts:108`; `apps/ptah-electron/src/activation/bootstrap.ts:236` | Readiness retry case exercises later delivery. |
| M7 | Electron observer exceptions are caught and logged by error name; push delivery continues. | `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:62,104` | `webview-manager-adapter.spec.ts` observer throw case. |
| M8 | Electron replaces an in-window notice with a count and newest title; its click picks newest current member. VS Code uses the same 350 ms window and summary text, and routes to newest current member. | `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.ts:58`; `libs/backend/platform-vscode/src/implementations/vscode-host-attention-notifications.ts:41` | Electron and VS Code adapter burst cases. |
| M12 | Coordinator resolve/attach errors are isolated from boot and logged by error name on Electron, VS Code and CLI. | `apps/ptah-electron/src/activation/bootstrap.ts:459`; `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:182`; `libs/backend/cli-engine/src/lib/container.ts:684` | Dedicated boot attach failure specs remain outstanding. |
| Minor | VS Code remains ineligible when any Ptah view is visible, as plan section 4 requires. Open routing now picks one webview, with panel fallback. | `libs/backend/platform-vscode/src/implementations/vscode-host-attention-notifications.ts:19`; `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts:70` | Existing visibility and provider specs; no new route-count spec. |

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Preserve visibility suppression | Plan section 4 explicitly says emit only when no Ptah sidebar or panel is visible. Unfocused but visible sidebar remains suppressing. | Yes |
| Replace Electron notice during a burst | The shared contract requires immediate single-request issue; Electron has no update API in this adapter. Closing the prior handle and showing a count keeps one current native handle. | Yes |
| Use one VS Code route destination | Sidebar when registered, otherwise first panel; each renderer receives one route. The provider already has readiness queues for both. | Yes |

## Not done

- No Nx, Jest, TypeScript, diagnostics, lint or build ran under the explicit memory-safe read/edit-only instruction. Item 0 cannot be verified without the orchestrator's error lines or its scoped rerun.
- Dedicated bootstrap, CLI container and VS Code phase-2 resolve-failure specs were not added. Their failure paths were changed but remain unverified by test execution.
- VS Code `show*Message` is not retractable, so an earlier notice in a burst may remain in the notification center after the summary is issued. Electron closes the earlier handle before showing the summary.
