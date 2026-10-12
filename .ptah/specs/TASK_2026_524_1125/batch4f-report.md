# Batch 4f report: diverged-clones deep link

## Files changed

- MODIFIED `libs/frontend/core/src/lib/services/app-state.service.ts`: `openSkillsDivergedClones` now keeps the `canSwitchViews()` guard, calls `this.requestSurface('thoth', ['skills'])`, then `this._skillsDivergedRequest.set(this._activeWorkspacePath())`. It no longer calls `setCurrentView('thoth')` or `setThothActiveTab('skills')`. The doc comment was updated to match.
- MODIFIED `libs/frontend/core/src/lib/services/app-state.service.spec.ts` (the `openSkillsDivergedClones` tests in the view-switch describe block, about lines 392-445):
  - "opens Skills with a one-shot diverged-clones request": checks `navigateToSurface('thoth', ['skills'])` is called, `router.url === '/thoth/skills'`, `currentView() === 'thoth'`, and the request is one-shot. The old `thothActiveTab() === 'skills'` assertion is removed.
  - NEW "lands /thoth/skills even when Thoth is already open on another tab": starts at `/thoth/memory` with the tab memory set to `cron`. Checks the method lands `/thoth/skills`, never calls `setThothActiveTab`, leaves `thothActiveTab()` at `cron`, and the request is consumed for the workspace that raised it.
  - "raises no diverged-clones request while view switches are blocked": with `canSwitchViews() === false`, checks there is no navigation, no `setThothActiveTab` call, the view stays `chat`, the tab stays `memory`, and no request is raised.
  - The existing test for a request dropped on a workspace switch, and the `openConfigurationSurface` test (around line 1031), are unchanged and still pass.
  - The tab tests at about lines 1161-1234 (TASK_2026_228 pointer memory) only exercise `setThothActiveTab` directly, so they needed no change.

## Behaviour summary

The method now always navigates to `/thoth/skills` through the single write path, `requestSurface`. That signature is `(surface: ViewType, subPath: readonly string[] = [])` and passes `subPath` to `SurfaceRouterService.navigateToSurface`, so it already accepts a child-segment array and no new API was needed. Because of this, the deep link works even when Thoth is already open on another tab. The tab memory is no longer written here: the Thoth shell records it once the route settles. The guard still blocks both the navigation and the one-shot request while the app is disconnected or loading.

## Check results

- `npx nx run-many -t test,typecheck,lint -p @ptah-extension/core --parallel=1`
  - Header: `Running targets test, typecheck, lint for project @ptah-extension/core:` (exactly one project)
  - Result: `Successfully ran targets test, typecheck, lint for project @ptah-extension/core`. The only other line was an informational "Nx Cloud encountered some problems".
- Changed spec only: `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/app-state.service.spec.ts --coverage=false --maxWorkers=2`
  - `Test Suites: 1 passed, 1 total`; `Tests: 138 passed, 138 total`
- Typecheck: passed. Lint: passed.

## Assumptions

- The shared testing table (`libs/frontend/core/src/testing/surface-router-testing.ts`) already gives `thoth` a `:tab` child, so `/thoth/skills` resolves in the service specs without 4e2's production table.
- Dropping `setCurrentView('thoth')` is intended. The plan names `requestSurface` directly, and the same-surface short-circuit in `setCurrentView` would have stopped a tab change when Thoth was already open, which is the defect this batch fixes.
- No component-level test of the shell recording the tab on settle was added here, because that belongs to the Thoth shell's batch.

## Revision r1 (review round 1: REVISE)

Both fixes are in the same two core files only. No webview file was touched.

### Defect 1 (major): a navigation that does not land left the request pending

- `app-state.service.ts`:
  - New module-private `interface SkillsDivergedRequest { readonly workspacePath: string | null }`. `_skillsDivergedRequest` is now `signal<SkillsDivergedRequest | null>`, so each request is an object token compared by identity.
  - `requestSurface` now returns the `Promise<SurfaceNavigationResult>` from `navigateToSurface`. The settlement recording is still attached to that promise, unchanged. The existing statement callers ignore the return value; `no-floating-promises` is not enabled, per a comment in `eslint.config.mjs:472`.
  - `openSkillsDivergedClones`: the `canSwitchViews()` guard is unchanged. The method creates a token, sets it, then calls `requestSurface('thoth', ['skills'])`. When `surfaceNavigationLanded(result)` is false (`cancelled` or `failed`), it clears the signal, but only if the signal still holds that same token. `already-there` counts as landed (see `surface-router.service.ts:41-45`), so it keeps the request. A newer deep link holds a different token, so an older navigation's cancellation cannot clear it.
  - `consumeSkillsDivergedRequest` now compares `request.workspacePath` with the active workspace path. Its one-shot, workspace-bound behaviour is unchanged.
- New tests in `app-state.service.spec.ts`:
  - `it.each(['failed', 'cancelled'])`: the request is cleared when the navigation does not land. A later ordinary visit to `/thoth/skills` then consumes `false`.
  - `already-there`: the request is kept and consumes `true`.
  - A real Router supersede, where `setCurrentView('analytics')` runs while the deep link is in flight: the view ends on `analytics` and the request is cleared.
  - An older deep link that is cancelled after a newer one was raised (deferred first navigation) does not clear the newer request, which consumes `true`.

### Defect 2 (minor): what the already-open test covers

- Added a comment to the already-open test. It says the test covers only the service's URL/request contract, because the testing route is component-less. The shell's tab settle and the Skills filter are covered by the thoth-shell and skill-synthesis-tab component specs. No integration test was added.

### Checks (r1)

- `npx nx run-many -t test,typecheck,lint -p @ptah-extension/core --parallel=1`
  - Header: `Running targets test, typecheck, lint for project @ptah-extension/core:` (exactly one project)
  - Result: `Successfully ran targets test, typecheck, lint for project @ptah-extension/core`
- `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/app-state.service.spec.ts --coverage=false --maxWorkers=2`
  - `Test Suites: 1 passed, 1 total`; `Tests: 143 passed, 143 total` (138 before, plus 5 new)
