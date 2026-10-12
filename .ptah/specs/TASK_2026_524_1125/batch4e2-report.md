# Batch 4e2 report — Thoth route-table wiring

Scope: project `ptah-extension-webview` only (implementation-plan.md §9, 4e2).
It builds on 4e, which exports `THOTH_ROUTES` from `@ptah-extension/thoth-shell`.
Both files were read fresh, after 4c landed. The following were left intact:

- 4c's `chat` children and initializer;
- 3b's comments.

## Files

- MODIFIED `apps/ptah-extension-webview/src/app/app.routes.ts`
  - The `thoth` entry now uses
    `loadChildren: () => import('@ptah-extension/thoth-shell').then((m) => m.THOTH_ROUTES)`
    instead of `loadComponent`. It keeps its `SURFACE_ACTIVE` provider.
  - It is the same chunk, because it uses the same dynamic import.
  - The file's doc comment now says that `marketplace` and `thoth` are the two
    `loadChildren` surfaces.
- MODIFIED `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`
  - `thoth` is removed from the "defers %s with loadComponent" list and from the
    "resolves %s to a real component class" list.
  - New test: "defers thoth as a lazily loaded route tree that resolves
    THOTH_ROUTES". It checks that:
    - the route has no `component` and no `loadComponent`;
    - it has one provider;
    - `loadChildren()` resolves to the barrel's `THOTH_ROUTES`;
    - `loaded[0].component` is `ThothShellComponent`.
  - New describe, "thoth tab routes (THOTH_ROUTES via loadChildren)". It uses the
    real app table and the real `AppStateManager`, and runs these cases:
    - a bare `/thoth` with nothing remembered → `/thoth/memory`;
    - a bare `/thoth` with `setThothActiveTab('cron')` → `/thoth/cron`;
    - `navigateToSurface('thoth', ['skills'])` → `/thoth/skills`;
    - `navigateToUrl('/thoth/bogus')` → `/thoth/memory`, reported as landed.

    Every case asserts `currentView() === 'thoth'`.

  - The existing "lands a %s deep link on its route" loop now expects
    `/thoth/memory` for `thoth`. A bare `/thoth` is now a restore redirect, exactly
    like `marketplace` → `/marketplace/overview`. The expectation is a small
    per-surface map instead of a nested ternary.
  - "declares exactly the surfaces in SURFACE_ROUTE_IDS, in the same order" is
    unchanged and passes.

## Design notes

- No outlet is rendered in this spec, so `ThothShellComponent` is never
  constructed. The routed cases pin where the real table settles: the redirect,
  canMatch, and `**`.
- The shell's settle-time memory write is covered in 4e
  (`thoth-shell.component.spec.ts`).
- None of these cases needed `whenStable`. They await the navigation promise and
  `settleSurfaceNavigation`, as the rest of the file does.

## Deviations

- The test plan did not list the deep-link loop expectation change
  (`/thoth` → `/thoth/memory`). It is a direct consequence of the redirect, and
  the existing loop failed without it.
- Everything else matches §9 and the coordinator's brief.

## Verification

1. `npx nx run-many -t test,typecheck,lint -p ptah-extension-webview --parallel=1`
   - First run: 1 failure, the deep-link loop case for `thoth`, which expected
     `/thoth`. That expectation was fixed as described above.
   - Second run: "Successfully ran targets test, typecheck, lint for project
     ptah-extension-webview". Test Suites 17/17 passed; Tests 413/413 passed.
2. **Worker warning.** The full project run prints "A worker process has failed to
   exit gracefully".
   - `npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/webview-routing.spec.ts --coverage=false --runInBand --detectOpenHandles`
     gave 64/64 passed and reported no open handles.
   - The leak is therefore in another suite of this project, not in the file this
     batch touched. It was not investigated further, because it is out of scope.

## Risks

- Once 4e and 4e2 land together, Thoth tab clicks work end to end. A tab switch
  replaces the URL (D6, 4e revise round 1).
- Batch 4f (`openSkillsDivergedClones` → `requestSurface('thoth', ['skills'])`) is
  still pending. Until it lands, the current
  `setCurrentView('thoth')` + `setThothActiveTab('skills')` pair works only because
  of ordering. The memory write happens synchronously, before the asynchronous
  redirect reads it.
