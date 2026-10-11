# Batch 4d report: boot restore wiring (TASK_2026_524_1125)

## Files changed

- CREATED `apps/ptah-extension-webview/src/app/initial-navigation.ts`: `injectInitialNavigation()`. It runs in an injection context and returns the boot navigation function. That function reads the override, the host value and the saved `ptahRoute`, calls `resolveBootNavigation`, starts `SurfaceRoutePersistence` and then navigates.
- MODIFIED `apps/ptah-extension-webview/src/app/app.ts`: `handleInitialView` now delegates to `injectInitialNavigation()`, which is captured as a field initializer. The direct `SurfaceRouterService` and `surfaceNavigationLanded` imports were removed.
- MODIFIED `apps/ptah-extension-webview/src/app/app.spec.ts`: adds 6 boot-branch unit tests with mocked collaborators.
- MODIFIED `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`: `bootWithInitialView` now runs the production function and no longer copies its logic. Adds `installHost` and `savedRoute` helpers, cleans up `window.vscode` in `afterEach`, and adds a new describe, "boot restore precedence (D5)", with 9 tests that use the real Router, the real `appRoutes` and the real `VSCodeService`.
- `libs/frontend/core/src/lib/services/vscode.service.ts` was not touched. `getState<unknown>('ptahRoute')` was enough: the value is re-wrapped as `{ ptahRoute: value }` and passed to `parseWebviewRouteState`. This settles the plan's §8 step 2 assumption, so `getRawState` was not needed. Because core was not changed, the core check was not run.

## Behaviour per D5 case

| Case                                                                        | Result                                                                                                                                                                       | Persisted seed                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `window.initialView` (DevTools) set                                         | That surface, even when a saved route exists                                                                                                                                 | host value (the override is never a seed) |
| Host deep link non-null and different from the saved seed                   | Host surface                                                                                                                                                                 | host value                                |
| Saved seed is null and host is non-null                                     | Host surface                                                                                                                                                                 | host value                                |
| Host equals the saved seed (Electron `'chat'`, unchanged VS Code HTML)      | Saved route via `navigateToUrl`                                                                                                                                              | host value (same as before)               |
| Host null (restored panel, reload) and a valid saved route                  | Saved route, e.g. `/chat/<id>` or `/thoth/skills`                                                                                                                            | the saved seed is carried forward         |
| Saved record invalid (scheme route, `v:2`, non-object)                      | Treated as no record, so host or `chat`                                                                                                                                      | host value or null                        |
| Saved route passes the contract but does not land (e.g. `/command-builder`) | Warns `[App] Restored route <r> did not land: <result>; falling back to the host view.`, then `navigateToSurface(normalizeInitialView(host))`, which ends on `chat` at worst | as planned                                |
| `getState` throws (Electron sync IPC)                                       | Warns `[App] Could not read the saved route:`; treated as no record                                                                                                          | as planned                                |

`SurfaceRoutePersistence.start(plan.seed)` is called before the first navigation, as plan §8 step 4 requires, so the boot's own `NavigationEnd` is persisted. The spec checks the persisted record `{v:1, route, seed, panelId}`. Restore problems never throw out of `ngOnInit`.

## Checks

`npx nx run-many -t test,typecheck,lint -p ptah-extension-webview --parallel=1`. The header named exactly one project: "Running targets test, typecheck, lint for project ptah-extension-webview".

- test: 17/17 suites passed, 428/428 tests passed, 0 failed.
- typecheck: passed.
- lint: passed.
- Jest printed "A worker process has failed to exit gracefully". The suite still passes. I did not check whether this happens without my change. Possible cause: the persistence `router.events` subscription is released through the root `DestroyRef`, which `TestBed.resetTestingModule` destroys.
- `@ptah-extension/core`: not run, because core was not changed.
- `ptah_get_diagnostics` on the 4 changed files: 0 errors. It also reported errors in sibling files I did not touch (`zone-change-detection.spec.ts`, `base-content-muted.spec.ts`, core `mock-rpc-service.ts`, shared `capability-id-codec.ts`). The Nx typecheck passes, so these appear to come from the diagnostics tool's own compiler config.

## Assumptions and follow-ups

- **Deviation:** the plan's §8 file list did not include the new file `initial-navigation.ts`. I extracted the logic so the specs exercise production code. Without it, they would have had to copy `handleInitialView`, which needs `App` and its full shell dependency graph. It is a single function, not a new abstraction layer.
- The host type `ptahConfig.initialView` is widened to `string | null`, because the host sends `null` on restore.
- In D5 the host fallback after an unlandable saved route uses the host value, not the DevTools override. The override never reaches the route branch.
- Batch 4c review defect 1 concerned early `ptahRoute` writes during boot. Starting persistence before navigation keeps that behaviour as planned. The interaction with `ChatTabRouteSync` correcting `/chat/<unknown-id>` was not exercised here because `ChatTabRouteSync` is not in the routing spec's providers. A follow-up integration test could cover it.
- A manual VS Code restart and Electron reload smoke check is still needed.
