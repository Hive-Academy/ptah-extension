# Batch B4a + B4b report

## Summary

Implemented Electron native attention delivery, pre-delivery ingress observation, bootstrap coordinator attachment, and a separate DI resolution guard. Native notices use a fixed label and the coordinator's session title, retain only safe target fields, group a 350 ms burst under one handle, close on resolution, and recheck the current generation before routing a click. Renderer routes wait for the main frame to finish loading. Missing or unsupported native capabilities skip delivery.

## Files

- `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.ts` — native adapter and safe click routing.
- `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.spec.ts` — shared port contract and focused, unsupported, burst, stale-click, and queued-route cases.
- `libs/backend/platform-electron/src/registration.ts`, `src/index.ts` — capability injection, token registration, and export.
- `apps/ptah-electron/src/ipc/webview-manager-adapter.ts`, `webview-manager-adapter.spec.ts` — disposable ingress observer, zero-view and broadcast coverage.
- `apps/ptah-electron/src/activation/bootstrap.ts` — Electron Notification/window capabilities and coordinator attachment immediately after the WEBVIEW_MANAGER binding.
- `apps/ptah-electron/src/di/expected-resolvable.ts`, `container.smoke.spec.ts` — standalone coordinator token and resolution smoke case.

## Teardown decision

`bootstrap.ts` has no shutdown teardown; the Electron quit handlers are in `main.ts`, outside this batch's ownership. The manager and coordinator are process-scoped, so no explicit observer detach is needed at process exit. Native handles are disposed through the port when its owner disposes, and resolved generations close their handles during normal operation.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Inject narrow native/window capabilities into platform registration | Direct Electron import vs capability options. `registration.ts` already accepts Electron API adapters and must remain usable by tests without an Electron runtime. | Yes |
| Keep one native handle for a 350 ms burst | One handle vs a handle per request. Plan section 4 requires grouping; the first safe titled notice is the representative, and later members share its handle while retaining independent key/generation resolution. | Yes |
| Queue one renderer readiness listener for click routes | Per-click listeners vs one listener. `IpcBridge` drops pushes without a live renderer; a bounded map of unresolved routes avoids per-click listeners. | Yes |
| Omit coordinator detach at process exit | Bootstrap-local teardown vs process lifetime. The plan explicitly allows this when bootstrap has no teardown and `main.ts` is out of scope. | Yes |

## Not done

- Scoped diagnostics and tests were not run: the task's memory-safe rule explicitly reserves all Nx, Jest, TypeScript, Electron, and test execution for the orchestrator. AST parsing reported zero syntax errors for the edited source and specs.
- No `main.ts` or `phase-2-libraries.ts` changes were made, as directed.
