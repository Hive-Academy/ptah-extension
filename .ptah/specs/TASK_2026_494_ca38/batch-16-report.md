# Batch 16 report: surface id, route and Electron-only guard

Task 16.1. Executor: frontend-developer (subagent). No git commands were run.

## Files

- MODIFIED `libs/shared/src/lib/types/webview-surface.types.ts`: `'apps'` added to `ViewType` (`:55`) and
  `SURFACE_ROUTE_IDS` (`:76`), in both cases after `'tasks'`. A doc comment on `ViewType` (`:39-42`) says `apps` is
  Electron-only. No second list was added. `ACCEPTED_INITIAL_VIEWS` is derived from `SURFACE_ROUTE_IDS`, so it picks
  up `apps` on its own.
- MODIFIED `libs/shared/src/lib/types/webview-surface.types.spec.ts`: the literal list at `:24-36` gains `'apps'`.
- CREATED `apps/ptah-extension-webview/src/app/electron-only-surface.guard.ts`: exports
  `electronOnlySurface: CanMatchFn = () => inject(VSCodeService).isElectron` (`:19-20`). It is a `canMatch` guard, so a
  refused match happens before `loadComponent` runs.
- MODIFIED `apps/ptah-extension-webview/src/app/app.routes.ts`:
  - `:11` imports the guard.
  - `:58-61` adds the doc line for `apps`: lazy, Electron-only, refused by `canMatch`, and only reachable through the
    dynamic import (R8).
  - `:158-168` adds the `apps` route after `tasks` and before the two fallbacks. It has
    `canMatch: [electronOnlySurface]`, `SURFACE_ACTIVE` via `surfaceActiveFor('apps')`, and
    `loadComponent: () => import('@ptah-extension/mcp-apps-page').then((m) => m.AppsPageComponent)`.
- MODIFIED `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`: see the D-1 and spec-pin sections below.

R8: `@ptah-extension/mcp-apps-page` is referenced only by the dynamic import in `app.routes.ts` and by `await import(...)`
in the spec. Nothing eager imports it or `mcp-apps-contracts`.

## Spec pins (`webview-routing.spec.ts`)

Test helpers:

- `ELECTRON_ONLY_SURFACES = ['apps']` (`:93`).
- `hostIsElectron(bool)` (`:101-105`) spies on the real `VSCodeService.isElectron` getter. The real service stays in
  the graph, and the getter is the only value the guard reads.
- `post()` moved from the SWITCH_VIEW describe to module scope (`:108-114`) with no change to its body, so the new
  describe can reuse it.
- `routeFor()` (`:116-120`).

| Pin | Test | Result |
| --- | --- | --- |
| Lock-step (`paths` equal `SURFACE_ROUTE_IDS`) | `app.routes` › "declares exactly the surfaces…" (unchanged) | pass |
| Host allow-list (F4) | `app.routes` › "cannot drift from the HOST allow-list" (unchanged) | pass |
| VS Code: `initialView='apps'` → `/chat`, `currentView()==='chat'`, `loadComponent` spy not called | `:386-397` (goes through `bootWithInitialView`, which also asserts the navigation landed) | pass |
| VS Code: `SWITCH_VIEW {view:'apps'}` → `/chat`, `currentView()==='chat'`, spy not called | `:399-411` (starts from `settings`) | pass |
| Electron: `initialView='apps'` → `/apps` | `:458-466` (`currentView()==='apps'`, spy called once) | pass |
| Electron: `SWITCH_VIEW 'apps'` → `/apps` | `:468-480` (spy called once) | pass |

The `loadApps` spy is installed in `beforeEach` (`:378`) before anything injects the Router, so the Router's copy of the
table carries it. The Electron cases assert that the spy is called, which proves the "never called" assertions are not
vacuous.

Refused-`canMatch` edge cases added:

- SWITCH_VIEW `apps` while `chat` is already showing still ends on `/chat` without loading the chunk (`:414-424`).
- The guard refuses on every attempt, from `settings` and then from `tasks` (`:426-438`).
- A refusal is silent (`:440-452`): `navigateToSurface('apps')` returns a result that counts as landed. No
  `console.error` is logged and `ErrorHandler.handleError` is not called. This matches plan D2 ("a refused match
  redirects to chat silently").

Guard unit tests (`electronOnlySurface` describe, `:485-523`):

- `isElectron=true` → `true`, and `isElectron=false` → `false`.
- The real `VSCodeService` default in jsdom, with no host globals, refuses.

Structural tests:

- "defers %s with loadComponent" gains `apps` (`:586`).
- New: "guards exactly the Electron-only surfaces with electronOnlySurface" (`:593-601`). Only `apps` has `canMatch`,
  and its value is `[electronOnlySurface]`.
- New: "places apps after tasks and before the fallbacks" (`:604-608`).
- "resolves %s to a real component class" gains `apps` (`:616`).
- New: "resolves apps to the Apps lib's AppsPageComponent" (identity with the barrel export, `:630-637`).

Mutation check: I temporarily changed the guard to `isElectron || true`. The spec then failed 7 tests: the 5 VS Code
refusal tests and 2 guard unit tests. I restored the guard and confirmed the restore.

## D-1 / R1 handling

Both loops still cover every surface, `apps` included. No test was deleted and no assertion was weakened.

- `:209-225` "never calls window.history while navigating every surface" now runs with `hostIsElectron(true)`, so
  `apps` really is navigated to rather than redirected.
  - **Changed assertion:** `currentSurface()` was expected to be `'tasks'` and is now expected to be `'apps'`
    (`:220`). The assertion pins the last entry of `SURFACE_ROUTE_IDS`, and TASK_2026_494 appends `apps` after `tasks`.
    It is the same check at the same strength against the new last surface. An inline comment gives the reason.
  - I chose the Electron host because its `file:` document is the one that rejects `history.pushState`.
- `:227-247` is a new companion test: "never calls window.history on VS Code either, where Electron-only surfaces
  redirect". It walks every surface with `isElectron=false`. It asserts:
  - the last id is Electron-only;
  - the walk ends on `chat` at `/chat`;
  - no History API method was called.

  Together the two tests keep the no-history property proven on both hosts.
- `:321-332` is the `it.each` "lands a %s deep link on its route". It still iterates every `JEST_RESOLVABLE_SURFACE_IDS`
  entry and still expects `/${id}`. For Electron-only ids it calls `hostIsElectron(true)` first. The VS Code refusal is
  tested separately in the describe above.

## A1 outcome

**Resolves.** `import('@ptah-extension/mcp-apps-page')` loads under the webview jest transform
(`apps/ptah-extension-webview/jest.config.ts`) with no change to that config. Three tests pass and depend on it:

- "resolves apps to a real component class";
- "resolves apps to the Apps lib's AppsPageComponent";
- the Electron `loadApps` spy calls through to the real import.

`apps` is therefore NOT added to `JEST_UNRESOLVABLE_SURFACES`, and the fallback was not needed.

## R7 check

The VS Code host now accepts `initialView: 'apps'`, which is intended (D2). The change comes through the derived
`ACCEPTED_INITIAL_VIEWS`.

`apps/ptah-extension-vscode/src/services/webview-html-generator.initial-view.spec.ts` iterates that list, at `:79`
("accepts %s", which now includes `apps`) and at `:142` (drift gate). The spec file was not edited. It passes inside
`ptah-extension-vscode:test`: 9 suites, 102 tests, all passing.

On VS Code the renderer then refuses the `apps` match and lands on `chat`, which the VS Code pins above cover.

## Test counts

| Scope | Result |
| --- | --- |
| `webview-routing.spec.ts` | 61 passed. 17 are new or extended by this batch (44 before, derived from the added cases) |
| `@ptah-extension/shared:test` | 2116 passed |
| `@ptah-extension/core:test` | 33 suites, 900 passed. This includes B20's in-progress `electron-layout.service` change; no failures |
| `ptah-extension-webview:test` | 11 suites, 225 passed |
| `ptah-extension-vscode:test` | 9 suites, 102 passed |

## Verification tails

`npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared ptah-extension-webview @ptah-extension/core ptah-extension-vscode --skip-nx-cache --parallel=2 --output-style=static`
was run after the final code edit (the TS2554 fix):

```
> nx run @ptah-extension/shared:lint     ✖ 5 problems (0 errors, 5 warnings)
> nx run @ptah-extension/core:test       Tests: 900 passed, 900 total
> nx run @ptah-extension/core:lint       ✖ 13 problems (0 errors, 13 warnings)
> nx run ptah-extension-webview:test     Tests: 225 passed, 225 total
> nx run ptah-extension-webview:lint     (no problems)
> nx run ptah-extension-vscode:test      Tests: 102 passed, 102 total
> nx run ptah-extension-vscode:lint      ✖ 3 problems (0 errors, 3 warnings)
 NX   Successfully ran targets lint, typecheck, test for 4 projects and 26 tasks they depend on
EXIT 0
```

All lint warnings are pre-existing and none is in a file this batch touched:

- shared: `connectors/ptah-connectors.catalog.ts`, `types/rpc.types.ts`, `utils/json.utils.ts`,
  `mcp-apps-contracts/surface-data-model.ts`;
- core: `auth-state`, `command-discovery.facade.spec`, `electron-layout.service(.spec)` (B20's files), `message-router`,
  `providers-settings-state`, `vscode.service(.spec)`;
- vscode: `activation/post-init.ts`, `main.ts`.

`npx tsc -p libs/shared/tsconfig.spec.json --noEmit` exits 0.

`npx tsc -p apps/ptah-extension-webview/tsconfig.spec.json --noEmit` exits 2. All 9 remaining errors are pre-existing
baseline TS2352 errors outside this batch:

- `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts:110`
- `libs/frontend/core/src/testing/mock-rpc-service.ts:54,60,66,69`
- `libs/frontend/git-ui/src/lib/services/monaco-loader.service.ts:113,151,171,187`

This check caught two TS2554 errors in my own guard unit tests. Angular 22's `CanMatchFn` takes a third
`currentSnapshot` argument. I fixed this with a `matchApps()` helper that passes a `PartialMatchRouteSnapshot`, so this
batch adds 0 errors. The nx `typecheck` target does not cover spec files, so it could not have caught them.

Prettier was run on all five files after the nx run; only the spec changed, by line wrapping alone. The spec was re-run afterwards (`npx jest -c apps/ptah-extension-webview/jest.config.ts …/webview-routing.spec.ts --maxWorkers=2`): 61 passed.

## Notes for B17

- `ViewType` now includes `'apps'`, so the tab template in `electron-shell.component.ts` can compare
  `appState.currentView() === 'apps'` under `strictTemplates` and call `setCurrentView('apps')`. D-2 is unblocked.
- The Electron shell renders only on Electron, where the guard lets `apps` match. Clicking the tab should navigate to
  `/apps`, as the Electron pins show.
- B17 needs no router or guard change. If the B17 spec drives real navigation, it must stub `VSCodeService.isElectron`
  to `true` (see `hostIsElectron` here). Otherwise the `**` fallback lands on `chat`.
- The routing spec fixes the route order: `apps` sits immediately after `tasks` and before the fallbacks. Keep it there.
