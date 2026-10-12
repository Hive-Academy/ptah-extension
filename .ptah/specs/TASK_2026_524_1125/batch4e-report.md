# Batch 4e report — Thoth route tree (library side)

Scope: `@ptah-extension/thoth-shell` only (implementation-plan.md §9, 4e part).
`apps/ptah-extension-webview` (4e2), `libs/frontend/core` and `libs/frontend/chat`
are untouched.

## Files

- CREATED `libs/frontend/thoth-shell/src/lib/thoth.routes.ts`: `THOTH_ROUTES`,
  with the `restoreThothTab` RedirectFunction, the `thothTabSegment` canMatch, and
  `**` → `memory`.
- CREATED `libs/frontend/thoth-shell/src/lib/thoth.routes.spec.ts`: T1–T4 from the
  test plan, plus `isThothTabId` cases.
- MODIFIED `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts`:
  - adds `THOTH_TAB_IDS` and `isThothTabId`; `ThothActiveTabId` is now derived
    from `THOTH_TAB_IDS` and is the same union as before;
  - the active tab is read from the route;
  - memory is written at settle time;
  - `selectTab` navigates.
- MODIFIED `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts`:
  - adds a Router to every TestBed;
  - replaces the "click calls setThothActiveTab" test with three routed tests;
  - the tile-refresh test asserts the URL instead of the memory signal.
- MODIFIED `libs/frontend/thoth-shell/src/index.ts`: exports `THOTH_ROUTES`,
  `THOTH_TAB_IDS` and `isThothTabId`.

## Design notes

- **No circular import.** `THOTH_TAB_IDS` and `isThothTabId` sit next to
  `ThothActiveTabId` in `thoth-shell.component.ts`. `thoth.routes.ts` imports the
  component file. The component file never imports the routes file. This is the
  same direction as `marketplace.routes.ts` → `marketplace-shell.component.ts`.
- **No `<router-outlet>` in the template.**
  - The `:tab` child is component-less, with `children: []`, so nothing below the
    shell has a component to activate.
  - The Router does not need an outlet for a component-less leaf.
  - The shell renders the tab body itself through its existing `@switch` on
    `activeTab()`.
  - Adding an outlet would render nothing.
- **`activeTab`** is computed as `routeTab() ?? appState.thothActiveTab()`.
  - `routeTab` is a local signal holding the valid `tab` param of
    `ActivatedRoute.snapshot.firstChild`.
  - It is seeded synchronously at construction. This covers
    `remountActiveSurface`, which emits no `NavigationEnd`.
  - It is updated on each `NavigationEnd` whose `urlAfterRedirects` has `thoth` as
    its first primary segment. The URL is parsed with `router.parseUrl`, not by
    string surgery.
  - The fallback to memory applies only when the shell has no `:tab` child. That
    happens when a spec creates the shell directly, and in the gap between 4e and
    4e2, while the app still uses `loadComponent`. Under `THOTH_ROUTES` the
    redirects guarantee a valid `:tab`, so the fallback never decides what is
    shown in production.
- **Settle-time memory write (TASK_2026_317, L8).**
  - On each `NavigationEnd` under `/thoth`, the shell calls
    `appState.setThothActiveTab(tab)`. The subscription is made during
    construction, so the opening navigation's `NavigationEnd` is recorded too. This
    is the same pattern as `marketplace-shell.component.ts:185-201`.
  - A remount also writes the seeded tab, but only when
    `router.currentNavigation() === null`. With the Router idle, the snapshot is
    already settled. The write lands on the workspace the shell was re-created
    for, so that workspace's memory matches what it shows (P6f).
  - When the shell is constructed during a navigation, it does not write. The
    `NavigationEnd` does.
- **`selectTab(tab)`**
  - Calls `void surfaceRouter.navigateToSurface('thoth', [tab])` and then the
    existing `void thothStatus.refresh()`.
  - Re-clicking the active tab is still a no-op.
  - `activeTab` and memory change only when the navigation settles. A superseded
    navigation writes nothing, and a spec pins this.
- **`restoreThothTab`** returns the remembered tab as a relative redirect string.
  - It resolves under wherever the tree is mounted (`/thoth` → `/thoth/<tab>`).
  - If persisted memory were ever invalid, the redirect would hit `**` and land on
    `/thoth/memory`.

## Note from 4b: callers that rely on `already-there` for thoth

There are none. Grep over `apps/` and `libs/` (frontend) finds:

- No caller compares a result to `'already-there'` directly.
- Every consumer of a result uses `surfaceNavigationLanded`, which treats
  `navigated` and `already-there` alike:
  - `AppStateManager.recordSettledSurface` (`app-state.service.ts:630`);
  - `App.handleInitialView` (`app.ts:141`);
  - `HarnessWorkflowMessageHandler` (`harness-workflow-message.handler.ts:131`).
- The thoth navigations are:
  - `setCurrentView('thoth')` in `orchestra-canvas.component.ts:590`,
    `app-shell.component.ts:676` and `app-state.service.ts:1085`;
  - the specs in `surface-router.service.spec.ts:807` and
    `surface-route-persistence.spec.ts:107`.

  None of them branches on the result kind.

Once 4e2 lands, `setCurrentView('thoth')` while on `/thoth/<tab>` passes through
the redirect. It lands on the remembered tab, which equals the current one because
of the settle write, and reports `navigated`.

## Deviations

- None from §9.
- One addition: the idle-router seed write on remount. §9 asks for a seed and for
  writes "on each settle". A remount is a settle with no `NavigationEnd`. Without
  this write, the new workspace's memory could disagree with the tab on screen.

## Risks and observations

- **Between 4e and 4e2 the app is broken for tab clicks.** `selectTab` navigates
  to `/thoth/<tab>`, which the current app table (`loadComponent`, no children)
  does not match, so it falls to chat. The plan already accepts this: both batches
  must ship in the same PR, with 4e2 directly after 4e.
- **4f interaction.** `openSkillsDivergedClones` still calls
  `setCurrentView('thoth')` and then `setThothActiveTab('skills')`.
  - After 4e2, it works only because the synchronous memory write happens before
    the asynchronous redirect reads it. That ordering is incidental.
  - On `/thoth/memory` it navigates `/thoth` → redirect → reads `skills`, so it
    probably lands on Skills. 4f replaces it with
    `requestSurface('thoth', ['skills'])`, as planned.
- **History (resolved in revise round 1, see below).** A Thoth tab switch used
  `navigateToSurface`, which pushes a history entry, exactly as §9 prescribes. D6 ("a tab switch replaces the URL") is written
  for chat tabs. If D6 was meant to cover Thoth tabs as well,
  `navigateToSurface` has no `replaceUrl` option. That needs a decision; this batch
  does not change it.
- **Specs touch real Router timing.**
  - The routed component specs use `RouterTestingHarness` and
    `fixture.whenStable()`.
  - The unrouted ones use `provideSurfaceRouterTesting()` and the existing
    `setTimeout(0)` flush.
  - If `whenStable` does not cover the navigation under the zone test environment,
    the two "settles" specs need an extra macrotask flush.
- **`README.md`** in `thoth-shell` is not updated (outside the 5-file scope). It
  says nothing about tab persistence, so nothing in it is stale.

## Revise round 1

Review: `batch4e-review.md`, defect 1 (D6 tab history). The coordinator decided
that D6 applies to Thoth tabs as well and takes precedence over §9's wording. That
resolves the "History" risk above.

- `thoth-shell.component.ts` `selectTab` now calls
  `void this.surfaceRouter.navigateToSurface('thoth', [tabId], { replaceUrl: true })`.
  Its doc comment cites D6: Back leaves Thoth instead of cycling through tabs.
- **Dependency.** This needs the optional third parameter
  `extras: { readonly replaceUrl?: boolean } = {}` on
  `SurfaceRouterService.navigateToSurface`, which the 4b lane is adding in
  `libs/frontend/core`. This batch does not touch that library. Until 4b lands,
  the thoth-shell typecheck fails with "Expected 1-2 arguments".
- **`thoth-shell.component.spec.ts`, routed click spec.** It now records
  `SpyLocation.urlChanges` before the click. `provideLocationMocks()` binds
  `Location` to `SpyLocation`, which logs a push as `<url>` and a replace as
  `replace: <url>`. After the navigation settles, the spec asserts that the only
  new entry is `'replace: /thoth/skills'`.
  - The spec uses the real `SurfaceRouterService` and the real Router, with no
    testing wrapper around `navigateToSurface`. The assertion therefore covers the
    whole path down to `Location`.
- Unchanged: the notes in the review (redirect context, canMatch with `**`, the
  `NavigationEnd` gate, the remount seed write, the import direction) needed no
  change.

## Verification

Code ready, checks not run. The orchestrator asked that no jest, nx, tsc or lint
command be run while another heavy check is in flight. Pending, in order:

1. `npx jest -c libs/frontend/thoth-shell/jest.config.ts libs/frontend/thoth-shell/src/lib/thoth.routes.spec.ts libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts --coverage=false --maxWorkers=2`
2. `npx nx typecheck @ptah-extension/thoth-shell --parallel=1`
3. `npx nx lint @ptah-extension/thoth-shell --parallel=1`

(Test results to be appended.)

## Verification results (revise round 1)

**Root cause of the 2 failures (29/31).** Both failing tests were in the routed
describe ("selectTab navigates…" and "writes no memory for a navigation that never
settles"). Each timed out at 5000 ms on `await harness.fixture.whenStable()`.

- With the real tab bodies mounted under `THOTH_ROUTES`, the zone never reports
  stable, so `whenStable()` never resolves.
- The "worker process failed to exit gracefully" warning came from those two hung
  tests. It went away once they were fixed.

**Fix.** The spec does not wait for zone stability any more. A helper,
`nextNavigationEnd()`, returns `firstValueFrom(router.events.pipe(filter(NavigationEnd)))`.
The spec subscribes before the click and awaits the `NavigationEnd` itself, which is
the event the assertions are about.

- No assertion was weakened, and none was removed.
- The supersede test now also asserts that the first `NavigationEnd` to arrive is
  `/thoth/cron`.
- No production code changed in this step.

**Results.**

1. `npx jest -c libs/frontend/thoth-shell/jest.config.ts libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts libs/frontend/thoth-shell/src/lib/thoth.routes.spec.ts --coverage=false --maxWorkers=2`
   → `Tests: 31 passed, 31 total`, with no worker-exit warning.
2. `npx nx run-many -t test,typecheck,lint -p @ptah-extension/thoth-shell --parallel=1`
   → "Successfully ran targets test, typecheck, lint for project
   @ptah-extension/thoth-shell".
   - The typecheck passing confirms that 4b's `navigateToSurface(…, extras)`
     parameter is present in the worktree.
