# Batch 15 — Surface id and Electron-only route

## Requirements and evidence

| Requirement | Evidence |
| --- | --- |
| `command-center` is a `ViewType` after `apps` and documented as Electron-only through its route guard | `libs/shared/src/lib/types/webview-surface.types.ts:42,56-57` |
| `command-center` follows `apps` in `SURFACE_ROUTE_IDS` | `libs/shared/src/lib/types/webview-surface.types.ts:78-79` |
| Electron-only guarded route and `SURFACE_ACTIVE` provider | `apps/ptah-extension-webview/src/app/app.routes.ts:190-199` |
| Lazy route imports `CommandCenterPageComponent` from `@ptah-extension/command-center` | `apps/ptah-extension-webview/src/app/app.routes.ts:200-203` |
| No VS Code active page; guard refuses match before lazy loader | `apps/ptah-extension-webview/src/app/app.routes.ts:191-193`; routing spec below |

## Spec cases

| Case | Location |
| --- | --- |
| `lists every routable surface exactly once` includes `command-center` | `libs/shared/src/lib/types/webview-surface.types.spec.ts:23-38` |
| `never calls window.history while navigating every surface` now ends on `command-center` on Electron | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:255-271` |
| `lands initialView "command-center" on chat without requesting its lazy chunk` | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:684` |
| `lands initialView "command-center" on its route and requests its lazy chunk` | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:765` |
| `defers %s with loadComponent` includes `command-center` | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:897-905` |
| `guards exactly the Electron-only surfaces with electronOnlySurface` now expects both ids | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:942-950` |
| `places command-center after apps and before the fallbacks` | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:953` |
| `resolves %s to a real component class` includes `command-center` | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:960` |

## Pinned-list grep

Searched `rg -n "'apps'" apps libs -g '*.spec.ts'`. Updated the complete route-id list at `libs/shared/src/lib/types/webview-surface.types.spec.ts:35-36` and the Electron-only and lazy-route lists at `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:101,897-905,960`. Updated the final-route order assertion in that same spec. No other grep hit pins the webview surface-id list. Out-of-scope hits in `libs/frontend/chat/.../electron-shell.apps-tab.spec.ts` and `libs/frontend/core/.../marketplace-route.spec.ts` concern Apps tab behavior and a legacy marketplace route value, respectively; neither is a pinned surface list.

## Verification

- `npx prettier --write` on the four changed files: exit 0; three unchanged, routing spec formatted.
- `npx prettier --check` on the four changed files: exit 0, “All matched files use Prettier code style!”
- `npx eslint` on the four changed files: exit 0, no findings.
- `ptah_get_diagnostics` scoped to the four changed files: no diagnostics in requested files. It reported 16 errors in sibling files, including unrelated spec and core testing files and `capability-id-codec.ts`.
- Nx, Jest, TypeScript CLI, and git commands were not run, as required for this lane. The orchestrator owns the scoped test/typecheck/lint run.

## Needed changes outside the batch

None identified from the pinned-list grep. The parallel page lane supplied the `CommandCenterPageComponent` barrel export in `libs/frontend/command-center/src/index.ts` during this batch; that file was not edited here.

## Decisions

- Followed the existing Apps route and spy pattern. The VS Code case checks the lazy loader is never invoked; the Electron case checks it is invoked and the route activates.
- Kept the shared route-id list host-neutral, with host refusal handled only by `canMatch`.

## Anything not done

No suite was run in this lane under the task's verification restrictions. The scoped diagnostics tool found sibling errors but none in the four changed files.
