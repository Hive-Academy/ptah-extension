# TASK_2026_524_1125 — batch 1 implementation note

Angular Router foundation for the shared webview. Branch
`refactor/task-524-webview-routing`, worktree
`.claude-worktrees/task-524-webview-routing`. Nothing was committed; the tree is
left dirty.

## Files changed

| Path                                                                                                                                                        | What changed                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/core/src/lib/routing/memory-platform-location.ts`                                                                                            | CREATED. `MemoryPlatformLocation extends PlatformLocation`; every member implemented over an internal entry stack plus a cursor. `window.history` and `window.location` are never touched; `getBaseHrefFromDOM()` returns `/`, not the document's `./`.                                                                                                                                                          |
| `libs/frontend/core/src/lib/routing/memory-platform-location.spec.ts`                                                                                       | CREATED. 24 tests. Every mutating test spies all five History API methods and asserts none was called.                                                                                                                                                                                                                                                                                                           |
| `libs/frontend/core/src/lib/routing/surface-routes.ts`                                                                                                      | CREATED. The ONE list: `SURFACE_ROUTE_IDS`, `DEFAULT_SURFACE_ID`, `isSurfaceRouteId`, `surfaceRoutePath`, `surfaceIdFromUrl`. `ViewType` was **moved here** from `app-state.service.ts`, minus `command-builder` and `context-tree`.                                                                                                                                                                             |
| `libs/frontend/core/src/lib/routing/surface-routes.spec.ts`                                                                                                 | CREATED. 36 tests, including a path round-trip over every id.                                                                                                                                                                                                                                                                                                                                                    |
| `libs/frontend/core/src/lib/routing/surface-router.service.ts`                                                                                              | CREATED. `currentSurface: Signal<ViewType>` from `NavigationEnd` via `toSignal`; `navigateToSurface(id): Promise<boolean>` that resolves `false` rather than rejecting.                                                                                                                                                                                                                                          |
| `libs/frontend/core/src/lib/routing/surface-router.service.spec.ts`                                                                                         | CREATED. 10 tests: memory location is the provided one, history untouched across all ten surfaces, back/forward round trip, failure leaves the surface alone.                                                                                                                                                                                                                                                    |
| `libs/frontend/core/src/lib/routing/index.ts`                                                                                                               | CREATED. Routing barrel. `ViewType` is deliberately not re-exported here (it still reaches consumers via `app-state.service.ts`).                                                                                                                                                                                                                                                                                |
| `libs/frontend/core/src/testing/surface-router-testing.ts`                                                                                                  | CREATED. `provideSurfaceRouterTesting()` / `surfaceTestRoutes()` — the Router wired with the app's exact features over component-less routes built from `SURFACE_ROUTE_IDS`, plus `MemoryPlatformLocation`.                                                                                                                                                                                                      |
| `libs/frontend/core/src/testing/index.ts`                                                                                                                   | MODIFIED. Exports the two helpers above.                                                                                                                                                                                                                                                                                                                                                                         |
| `libs/frontend/core/src/lib/services/app-state.service.ts`                                                                                                  | MODIFIED. `currentView` is a `computed` over `SurfaceRouterService.currentSurface`; `setCurrentView` / `handleViewSwitch` / `handleInitialData` / `closeView` / `switchWorkspace` delegate to `navigateToSurface`; the 13-entry `validViews` list is gone; `initialView` is no longer read here; added `normalizeInitialView` and `openSettingsTab`; `ViewType` is re-exported from `../routing/surface-routes`. |
| `libs/frontend/core/src/lib/services/app-state.service.spec.ts`                                                                                             | MODIFIED. View tests are async over a real Router; added `normalizeInitialView` and `openSettingsTab` blocks; two fake-timer tests now assert a return to the Router's timer baseline rather than absolute zero. 91 tests.                                                                                                                                                                                       |
| `libs/frontend/core/src/lib/services/webview-navigation.service.ts` + `.spec.ts`                                                                            | DELETED. Its class doc carried the false "avoids Angular Router … incompatible with VS Code webviews" claim.                                                                                                                                                                                                                                                                                                     |
| `libs/frontend/core/src/lib/services/lazy-view.service.ts` + `.spec.ts`                                                                                     | DELETED. Superseded by route-level `loadComponent`.                                                                                                                                                                                                                                                                                                                                                              |
| `libs/frontend/core/src/lib/services/index.ts`                                                                                                              | MODIFIED. Dropped both deleted services.                                                                                                                                                                                                                                                                                                                                                                         |
| `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts`                                                                                           | MODIFIED. Deleted `LazyViewLoader`, `HARNESS_BUILDER_COMPONENT`, `SETUP_HUB_COMPONENT`, `MARKETPLACE_COMPONENT`, `TRIBUNAL_COMPONENT`, `TASKS_VIEW_COMPONENT` and `WIZARD_VIEW_COMPONENT`. Only `ORCHESTRA_CANVAS_COMPONENT` remains.                                                                                                                                                                            |
| `libs/frontend/core/src/index.ts`                                                                                                                           | MODIFIED. Removed the deleted token exports, added `export * from './lib/routing'`.                                                                                                                                                                                                                                                                                                                              |
| `apps/ptah-extension-webview/src/app/app.routes.ts`                                                                                                         | CREATED. The route table: `chat` component-less, `setup-wizard` / `settings` / `analytics` eager, the other six `loadComponent`, plus `''` and `**` redirects to `DEFAULT_SURFACE_ID`.                                                                                                                                                                                                                           |
| `apps/ptah-extension-webview/src/app/app.config.ts`                                                                                                         | MODIFIED. Added `{ provide: PlatformLocation, useClass: MemoryPlatformLocation }` and `provideRouter(appRoutes, withComponentInputBinding(), withDisabledInitialNavigation())`; deleted the six view-component token providers; rewrote the `WebviewErrorHandler` pushState comment (it described the old rule).                                                                                                 |
| `apps/ptah-extension-webview/src/app/app.ts`                                                                                                                | MODIFIED. Injects `SurfaceRouterService` instead of `WebviewNavigationService`; `handleInitialView` reads `window.initialView ?? window.ptahConfig?.initialView` and calls `normalizeInitialView` + `navigateToSurface`; the 8-entry `VALID_VIEWS` list is gone; deleted the unreferenced `onViewChanged`.                                                                                                       |
| `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`                                                                                               | CREATED. 35 tests: the four mandated pins, per-id deep-link sweep, the route-table ↔ `SURFACE_ROUTE_IDS` gate, `loadComponent` resolution per lazy surface, and three `app.config.ts` source gates.                                                                                                                                                                                                              |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`                                                                                  | MODIFIED. The 114-line `@switch` (nine `@case` blocks, nine duplicated spinner branches) replaced by one `<router-outlet />` inside a sizing wrapper. −116/+17 lines. The shared-chrome `[class.hidden]` at the old line 135 and the canvas / single-chat toggle are byte-identical.                                                                                                                             |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`                                                                                    | MODIFIED. Added `RouterOutlet`; dropped `LazyViewService`, six tokens, five `resolveWhen` fields, the `STANDALONE_VIEWS` list and the now-unused `SettingsComponent` / `DashboardGridComponent` / `ThothShellComponent` template imports. `isStandaloneView()` is `currentView() !== DEFAULT_SURFACE_ID`.                                                                                                        |
| `libs/frontend/chat/src/lib/settings/settings.component.ts`                                                                                                 | MODIFIED. Comment only: the header claimed "Patterns: Signal-based navigation".                                                                                                                                                                                                                                                                                                                                  |
| `libs/frontend/chat/src/lib/settings/settings.component.spec.ts`                                                                                            | MODIFIED. `navigateToSettingsTab` → `openSettingsTab`; added `provideSurfaceRouterTesting()` to both TestBeds.                                                                                                                                                                                                                                                                                                   |
| `libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts`                                                                                 | MODIFIED. Added `provideSurfaceRouterTesting()` to both TestBeds and `settle()` awaits. Two of its view tests were passing **vacuously** on `chat` before (see Risks).                                                                                                                                                                                                                                           |
| `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.ts`                                                                     | MODIFIED. `navigation.navigateToView('tribunal')` → `appState.setCurrentView('tribunal')`.                                                                                                                                                                                                                                                                                                                       |
| `libs/frontend/dashboard/src/lib/components/harness-card/harness-card.spec.ts`                                                                              | MODIFIED. Dropped the navigation double.                                                                                                                                                                                                                                                                                                                                                                         |
| `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`                                                                        | MODIFIED. Two `navigateToView` call sites → `appState.setCurrentView`.                                                                                                                                                                                                                                                                                                                                           |
| `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`                                                                                   | MODIFIED. Five `navigateToView` call sites → `appState.setCurrentView`; injects `AppStateManager`.                                                                                                                                                                                                                                                                                                               |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts`                                                                        | MODIFIED. Injects `SurfaceRouterService`; a navigation that does not land now logs and raises `workflow.setError` instead of only catching a rejection.                                                                                                                                                                                                                                                          |
| `libs/frontend/harness-builder/src/lib/components/*.spec.ts`, `services/harness-workflow-message.handler.spec.ts`                                           | MODIFIED. Repointed; the handler spec gained a test for the new `landed === false` branch.                                                                                                                                                                                                                                                                                                                       |
| `libs/frontend/marketplace/src/lib/marketplace-hub.component.ts` + `.spec.ts`                                                                               | MODIFIED. `navigateToView('chat')` → `appState.setCurrentView('chat')`.                                                                                                                                                                                                                                                                                                                                          |
| `libs/frontend/tribunal-panel/src/lib/wizard/step-panel-preview.component.ts`, `step-pick-move.component.ts`, `step-role-roster.component.ts` (+ two specs) | MODIFIED. `navigateToSettingsTab(...)` → `appState.openSettingsTab(...)`.                                                                                                                                                                                                                                                                                                                                        |
| `apps/ptah-electron-e2e/src/specs/{marketplace,tribunal}/*.spec.ts`                                                                                         | MODIFIED. Two assertions watched for `'[LazyViewService] Failed to load'`, a string nothing can emit any more — they would have passed vacuously for ever. Repointed to `'[SurfaceRouterService] Navigation to'`. Headers updated.                                                                                                                                                                               |
| `apps/ptah-electron-e2e/src/specs/{harness/harness-builder,harness/new-project-question-routing,tasks/tasks-board,tasks/message-handlers-eager}.spec.ts`    | MODIFIED. Comments only — each described the deleted token/service mechanism.                                                                                                                                                                                                                                                                                                                                    |

Not touched, per the brief: the shared-chrome `[class.hidden]`, the canvas and
single-chat toggle and both of its bindings, `OrchestraCanvasComponent`,
`CanvasStore`, `ORCHESTRA_CANVAS_COMPONENT`, `TabManagerService`,
`ConversationRegistry`, `StreamRouter`, `libs/api`, `libs/web`,
`apps/ptah-landing-page`. `.ptah/specs/TASK_2026_524_1125/context.md` shows as
modified in `git status`; that change was already in the worktree when I
received it and I did not write to the task folder except for this note.

## Decisions

1. **`ViewType` moved into `libs/frontend/core/src/lib/routing/surface-routes.ts`,
   and is re-exported from `app-state.service.ts`.** The brief said to reuse the
   existing union and not invent a parallel one, which is what I did — but
   `surface-routes.ts` has to be importable **by** `app-state.service.ts`
   (for `isSurfaceRouteId` and `DEFAULT_SURFACE_ID`), so the union could not
   stay where it was without a real module cycle. Declaring it next to the id
   list it enumerates removes the cycle entirely: the dependency runs
   `services → routing`, never back. `export type { ViewType }` from
   `app-state.service.ts` keeps ~20 consumer imports untouched.

2. **`WIZARD_VIEW_COMPONENT` was deleted, though it appears on the "do not
   touch" list.** That list qualifies it — "_if they still serve a cycle
   break_". After batch 1 nothing in `@ptah-extension/chat` renders the wizard;
   `app.routes.ts` imports `WizardViewComponent` directly. Its only consumer was
   the `@case ('setup-wizard')` block this batch deletes, so keeping the token
   would have left a provider with zero readers. `ORCHESTRA_CANVAS_COMPONENT`
   **is** still a real cycle break (chat's template renders the canvas, and
   canvas imports chat) and is untouched. Flag this if you disagree — it is two
   lines to restore.

3. **`command-builder` and `context-tree` deleted from `ViewType`.** I searched
   every `.ts`, `.html` and `.json` in the repo: their only appearances were the
   two allow-lists this batch removes, a third allow-list in
   `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:108-110`,
   and one assertion in the deleted `webview-navigation.service.spec.ts`. No
   render branch, no navigation caller, no persisted value. So navigating to
   either could only ever have produced a blank shell.
   `surface-routes.spec.ts` now pins that both are rejected.

4. **The route table lives in the app, and the `chat` route is component-less.**
   `{ path: 'chat', children: [] }` — the same construct
   `apps/ptah-landing-page`'s `docs` route uses. It gives "no standalone surface
   is showing" a URL without putting the chat/canvas content area in the outlet,
   which is what protects `CanvasStore`.

5. **`<router-outlet />` is wrapped in a sizing div.** Each of the nine `@case`
   blocks carried its own `h-full w-full` box (and `overflow-y-auto` for the
   dashboard); a routed component is inserted as a _sibling_ of the outlet
   element, so the box must live on a parent. The wrapper is hidden with
   `[class.hidden]="!isStandaloneView()"` — an empty `h-full` box on chat would
   claim the viewport and push the shared chrome out of it.

6. **`AppStateManager.currentView` is a plain `computed`, with no optimistic
   local write.** A caller therefore reads the _previous_ surface until the
   navigation lands. That is deliberate and pinned by a test: a second,
   eagerly-written mirror of the view is precisely the bug TASK_2026_317 fixed in
   `WebviewNavigationService`, and re-introducing one would re-create it.
   `setCurrentView` stays `void`, because all ~20 callers are click handlers or
   effects that cannot act on a failure. The two call sites that can —
   `App.handleInitialView` and `HarnessWorkflowMessageHandler` — go through
   `SurfaceRouterService.navigateToSurface` and report the `false`.

7. **Per-workspace surface restore was preserved, and made a navigation.**
   `ViewSlice.currentView` is now a _memory_, not the truth: a constructor
   `effect` records the settled surface against the active workspace, and
   `switchWorkspace` navigates to the incoming workspace's remembered surface.
   Two details are load-bearing and commented in place:
   - the effect reads the workspace path through `untracked`, or a workspace
     switch would re-run it and stamp the outgoing workspace's surface onto the
     incoming one;
   - `switchWorkspace` _also_ stamps the outgoing surface synchronously before
     switching, because an effect is coalesced by change detection and this
     method reads the slice back one line later. Without that line the A→B→A
     restore depends on when the scheduler happens to run.

8. **`navigateToSettingsTab` became `AppStateManager.openSettingsTab`**, which
   was the only reason three Tribunal wizard steps injected the deleted service.
   It mirrors the existing `openSkillsDivergedClones` and — unlike the method it
   replaces — guards on `canSwitchViews()` **before** raising the pending-tab
   request, so a switch dropped while disconnected cannot leave a request that
   fires later against a different surface. Pinned by a test.

9. **`normalizeInitialView` lives on `AppStateManager`, not in `app.ts`.** The
   legacy `orchestra-canvas` value has to set grid layout as well as resolve to
   `chat`, and that side effect belongs to the state manager. `app.ts` keeps the
   single host read (`window.initialView ?? window.ptahConfig?.initialView` — the
   DevTools override is preserved) and the single navigation.

10. **`provideSurfaceRouterTesting()` added to `@ptah-extension/core/testing`.**
    Making the Router the owner means any TestBed that constructs
    `AppStateManager` needs a route table, and a lib cannot import the app's.
    The helper builds component-less routes from `SURFACE_ROUTE_IDS` with the
    app's exact Router features, so a spec cannot pass under a configuration
    production does not use. Without it such specs get a Router with no routes
    and pass vacuously on `chat` — which is exactly what two existing
    `workspace-coordinator.service.spec.ts` tests started doing, and why they
    were the only failures in the first full run.

11. **The two `[LazyViewService] Failed to load` e2e assertions were repointed
    rather than deleted.** Left as-is they would have kept passing for ever
    against a string no code emits. `'[SurfaceRouterService] Navigation to'` is
    the new unique failure signal and nothing else produces it.

12. **`WebviewErrorHandler`'s `SecurityError` branch was kept.** Its comment now
    says what it is: a tripwire for a third-party dependency calling `history`
    directly, not a workaround for this app, which cannot reach the API any
    more. The context notes the branch has no incident behind it; removing
    defensive code was not in this batch's scope.

## Verification

### `npx nx run-many -t typecheck -p ptah-extension-webview @ptah-extension/core @ptah-extension/chat`

```
 NX   Running target typecheck for 3 projects:

- ptah-extension-webview
- @ptah-extension/core
- @ptah-extension/chat


√  nx run @ptah-extension/core:typecheck
√  nx run ptah-extension-webview:typecheck
√  nx run @ptah-extension/chat:typecheck



 NX   Successfully ran target typecheck for 3 projects
```

Header reads 3 projects.

### `npx nx run-many -t lint -p ptah-extension-webview @ptah-extension/core @ptah-extension/chat`

```
 NX   Running target lint for 3 projects:

- ptah-extension-webview
- @ptah-extension/core
- @ptah-extension/chat

√  nx run @ptah-extension/core:lint
√  nx run ptah-extension-webview:lint
√  nx run @ptah-extension/chat:lint

 NX   Successfully ran target lint for 3 projects
```

Header reads 3 projects. 0 errors. Warnings are pre-existing (`max-lines`,
`no-non-null-assertion`, `no-empty-function`); the two my edits introduced
(`no-useless-assignment` on `savedLayoutMode`, unused `ViewType` import in
`app-shell.component.ts`) were fixed before this run, and I also removed the
pre-existing unused `SessionId` import in that same statement.

### `npx nx run-many -t test -p ptah-extension-webview @ptah-extension/core @ptah-extension/chat`

```
 NX   Running target test for 3 projects:

> nx run @ptah-extension/core:test
Test Suites: 31 passed, 31 total
Tests:       780 passed, 780 total

> nx run ptah-extension-webview:test
Test Suites: 10 passed, 10 total
Tests:       195 passed, 195 total

> nx run @ptah-extension/chat:test
Test Suites: 86 passed, 86 total
Tests:       2 skipped, 1344 passed, 1346 total

 NX   Successfully ran target test for 3 projects
```

Header reads 3 projects. The 2 skips are pre-existing.

### Additional projects this change affects

```
npx nx run-many -t typecheck test lint -p @ptah-extension/dashboard \
  @ptah-extension/harness-builder @ptah-extension/marketplace \
  @ptah-extension/tribunal-panel @ptah-extension/thoth-shell \
  @ptah-extension/tasks-ui @ptah-extension/setup-wizard @ptah-extension/canvas \
  ptah-electron-e2e
```

```
 NX   Running targets typecheck, test, lint for 9 projects:

marketplace       12 suites / 241 tests passed
canvas             9 suites / 172 tests passed
dashboard          8 suites /  71 tests passed
tribunal-panel    16 suites / 333 tests passed
harness-builder    5 suites / 113 tests passed
tasks-ui          19 suites / 611 tests passed
setup-wizard      12 suites / 321 tests passed
thoth-shell        1 suite  /   5 tests passed

 NX   Successfully ran targets typecheck, test, lint for 9 projects
```

All lint results were 0 errors; `ptah-electron-e2e` has no `test` target (its
Playwright specs are not run here — see Deferred).

### Production build

```
npx nx build ptah-extension-webview
…
Application bundle generation complete. [36.918 seconds]
 NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

`ls dist/apps/ptah-extension-webview/browser/chunk-*.js | wc -l` → **17**, which
matches the 17 chunk files recorded as the baseline in `context.md` finding 7.
The chunk count did not fall. The
`bundle initial exceeded maximum budget` warning is pre-existing (no before/after
measurement was taken — see Risks).

### Environment note

The worktree had no `node_modules`. I ran `npm ci --prefer-offline --no-audit
--no-fund` inside it (exit 0) rather than symlinking the main repo's, so nothing
outside this worktree was read or written.

## Deferred

- **Playwright e2e was not executed.** `ptah-electron-e2e` needs a packaged
  Electron build and a real workspace; only its `lint` and `typecheck` targets
  ran. The six spec files I edited there are comment changes plus two assertion
  repoints, and they compile and lint clean, but nobody has run them against a
  renderer since this change.
- **No live-host verification.** Acceptance criteria 1-2 are covered by unit and
  composition tests, but nobody has opened the real VS Code webview or the
  Electron renderer to confirm there is no `SecurityError` in practice. The
  `host-constraints.md` argument plus `MemoryPlatformLocation`'s "history never
  called" tests are the evidence, not a live session.
- **The `tribunal` route's `loadComponent` is not resolution-tested under the
  webview app's jest config.** `TribunalPageComponent` imports
  `gridstack/dist/angular`, which ships ESM that
  `apps/ptah-extension-webview/jest.config.ts` does not transform, so
  `import('@ptah-extension/tribunal-panel')` throws there. The spec excludes it
  from the resolution sweep and the per-id deep-link sweep via a named,
  documented `JEST_UNRESOLVABLE_SURFACES` constant; the other five lazy routes
  are resolved for real. Widening that project's `transformIgnorePatterns` is a
  build-config change and was out of scope.
- **Batch 1 items only.** `SURFACE_ACTIVE` and the five consumer branches
  (batch 2), the workspace-keyed `RouteReuseStrategy` (batch 3), child routes
  for the Thoth sub-tab and Marketplace provider, `vscode.setState` URL
  persistence and `registerWebviewPanelSerializer` (batch 4) are all untouched,
  so acceptance criteria 3 and 4 are not met by this batch and are not claimed.
- **`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:105-112`
  keeps a third `initialView` allow-list.** It is host-side (Node, not the
  webview) and in a project outside this batch, so I left it. It still lists
  `command-builder` and `context-tree`, which no longer exist, and it still
  omits `harness-builder` / `setup-hub` / `thoth` / `marketplace` / `tribunal` /
  `tasks` — so it _throws_ for those. Consequence today: a host caller that
  tries to open a panel deep-linked to one of the six newly routable surfaces
  gets an exception from the generator, exactly as before this batch. Nothing
  regressed, but the "one list of surface ids" goal is only complete once this
  file reads `SURFACE_ROUTE_IDS` too. Worth its own batch or a follow-up carrier.

## Risks for the reviewer

1. **The `overflow-y-auto` on the outlet wrapper is the one styling judgment I
   could not verify in a browser.** Eight of the nine old `@case` blocks used
   `h-full w-full` with no overflow; only `analytics` added `overflow-y-auto`. I
   put it on the shared wrapper so the dashboard still scrolls. Every other
   surface roots at `h-full` with its own internal scroll container, so the
   outer box should never overflow — but a surface whose content genuinely
   exceeds `h-full` would now gain an outer scrollbar it did not have. Please
   click through settings, setup-hub, harness-builder, thoth, marketplace,
   tribunal and tasks in a real host.

2. **Two tests in `workspace-coordinator.service.spec.ts` were passing
   vacuously the moment `currentView` became Router-derived**, before I added
   `provideSurfaceRouterTesting()` to that file. The Router is root-provided in
   Angular 22 (`@Service`, no `providedIn` needed), so a TestBed without
   `provideRouter` silently gets an empty route table, every navigation fails to
   match, and `currentView()` stays `chat` — which several assertions expect.
   I added a positive pre-assertion to the one such test that could still read
   green ("drops the view slice of a workspace that is closed"), but **any spec
   elsewhere in the repo that constructs `AppStateManager` and asserts
   `currentView()` is `'chat'` without the helper is now a false positive.** I
   swept the 46 spec files that name `AppStateManager` by running every affected
   project's test target, and all pass — but "passes" is exactly the symptom
   here. A reviewer grepping for `currentView()` in specs without
   `provideSurfaceRouterTesting` is the cheapest second check.

3. **`switchWorkspace` now issues a navigation.** It is called from
   `WorkspaceCoordinatorService`'s synchronous fan-out alongside the tab, session
   and picker resets. The navigation is fire-and-forget (`void`), so if it fails
   the workspace state has already switched while the surface has not. Electron
   is the only host that switches workspaces; the spec covers A→B→A and the
   never-visited and removed cases, but not a failed navigation mid-switch.

4. **Effect-flush timing.** `openViews` and the per-workspace surface memory are
   written by a constructor `effect`, which change detection coalesces. Two
   navigations inside one CD cycle record only the second, so `openViews` can
   miss an intermediate surface. Nothing reads `openViews` today except its own
   specs (the view-pill UI is gone), and `switchWorkspace` is protected by the
   synchronous stamp described in decision 7 — but if a future consumer needs
   every visited surface, the effect is the wrong mechanism.

5. **No before/after bundle measurement.** I verified the chunk _count_ is still
   17 and the build succeeds, but I did not build the pre-change tree to compare
   initial-bundle size, because that would have meant creating another worktree
   or touching the main checkout. Moving `SettingsComponent` /
   `DashboardGridComponent` / `WizardViewComponent` from template imports to
   route `component:` entries should be byte-neutral (all three were already
   eager), and `thoth` moved from `@defer` to a lazy route, which should be
   neutral-to-better — but that is reasoning, not a measurement.

6. **`MemoryPlatformLocation.pathname` has no setter.** `BrowserPlatformLocation`
   defines `set pathname`, but the abstract class only declares the getter and no
   Angular strategy assigns it. If a future dependency does, it will fail
   silently in strict mode or throw in a getter-only assignment. I chose not to
   add a setter with no caller; say the word if you would rather have one that
   throws explicitly.

7. **The `settle()` helper pattern.** The three spec files that need a navigation
   to land use `await setTimeout(0)` followed by `TestBed.tick()`. One of the
   sub-agents that repointed the harness-builder specs demonstrated that
   `await fixture.whenStable()` also works where a fixture exists, which is
   tidier. Both appear in the tree now. A follow-up could standardise on one; I
   did not, because the service specs have no fixture.

---

# Revision round 1

All six findings accepted and fixed. None is wrong; F4 is broader than the
review stated and the extra part is fixed too. Two of my own risks are closed
here as well (risk 3, risk 7), and two were cleared by the independent check
(the `[class.hidden]` bindings, and router providers in the five specs that
assert `currentView()`).

**One architectural change to note up front: `libs/shared` now owns the surface
ids.** `ViewType`, `SURFACE_ROUTE_IDS`, `ACCEPTED_INITIAL_VIEWS`,
`LEGACY_SURFACE_ALIASES`, `DEFAULT_SURFACE_ID` and the predicates live in
`libs/shared/src/lib/types/webview-surface.types.ts`.
`libs/frontend/core/src/lib/routing/surface-routes.ts` is now a re-export, so
every frontend consumer and all ~20 `ViewType` importers are unchanged. The
move is what F4 requires: `WebviewHtmlGenerator` is extension-host code and
cannot import `@ptah-extension/core`.

## F1 — workspace surface memory stamped under the wrong identity

**Fix.** Settlement now carries ownership and a generation.
`libs/frontend/core/src/lib/services/app-state.service.ts`:

- `_settlementOwner` (`:339`) — the workspace the displayed surface belongs to,
  or `null` when it belongs to nobody. `_navigationGeneration` (`:357`).
- `requestSurface` (`:381`) — the single write path. Captures the active
  workspace and a generation before navigating.
- `recordSettledSurface` (`:405`) — drops the write on any of four conditions:
  the navigation did not land, a newer one superseded it, the workspace is no
  longer active, or (through `_settlementOwner`) it no longer owns the surface.
  On a successful record it re-grants ownership, which is how a `switchWorkspace`
  restore hands ownership to the incoming workspace.
- `switchWorkspace` (`:597`) — the synchronous outgoing stamp is now gated on
  `_settlementOwner === previousPath`, and sets `_settlementOwner = null` for
  the duration of the restore navigation.
- `removeWorkspaceState` (`:657`) — revokes ownership when the removed
  workspace is the active one. That is what makes removal stick:
  `updateActiveViewSlice` seeds a missing slice by design, so removal has to
  invalidate later writes rather than rely on them noticing the absence.
  `ElectronLayoutService` runs this cleanup before it switches away.

`setCurrentView`, `handleViewSwitch`, `closeView`, `handleInitialData` and
`switchWorkspace` all go through `requestSurface`.

**Tests** — `libs/frontend/core/src/lib/services/app-state.service.spec.ts`,
new describe `surface memory is owned by the workspace that earned it`:

| Test                                                                                 | Pins                              |
| ------------------------------------------------------------------------------------ | --------------------------------- |
| `does not stamp the outgoing surface onto a workspace whose restore has not settled` | the A to B to A reproduction      |
| `does not resurrect a slice removed while its workspace was active`                  | the close/reopen reproduction     |
| `keeps recording after a NON-active workspace is removed`                            | that revocation is not over-broad |
| `drops a superseded navigation rather than recording it`                             | the generation check              |
| `records nothing when a workspace restore navigation fails`                          | my own risk 3, now deterministic  |

Verified by neutering the fix (always stamp, no generation check, no
revocation): **3 failed, 93 passed**. With the fix: **96 passed**.

## F2 — the post-auth redirect cancels a newer user navigation

**Fix.** `SurfaceRouterService.pendingSurface()`
(`libs/frontend/core/src/lib/routing/surface-router.service.ts:99`) reports the
in-flight destination from `Router.currentNavigation()`.
`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:308`
bails when a navigation is in flight to anything other than chat. No optimistic
mirror of the view was added — `currentView()` still follows `NavigationEnd`
only, so the TASK_2026_317 defect cannot come back.

**Tests** — new file
`libs/frontend/chat/src/lib/components/templates/app-shell.auth-redirect.spec.ts`.
It drives the REAL `AppShellComponent` with `TestBed.overrideComponent`
replacing the template, so the real constructor effect, the real
`AppStateManager` and the real Router run without Monaco or an RPC bridge. Three
cases: the suppressed redirect (a `thoth` route whose chunk never arrives), the
redirect that must still fire when nothing was superseded, and no redirect when
a credential exists. `SurfaceRouterService.pendingSurface` is unit-tested in
core too (`reports the in-flight destination while currentSurface still lags`).

Verified by deleting the two guard lines: **1 failed, 2 passed**. With the fix:
**3 passed**. The second case is what stops the fix degenerating into "never
redirect".

## F3 — a same-URL navigation reported as a failure

**Fix.** `navigateToSurface` returns
`SurfaceNavigationResult = 'navigated' | 'already-there' | 'cancelled' | 'failed'`
(`surface-router.service.ts:39`), with the exported predicate
`surfaceNavigationLanded` so no caller can treat `already-there` as a failure
again. `already-there` is decided by reading `router.url` **before**
navigating — after the call the URL looks identical whether the navigation was
skipped or completed.

Both callers updated:

- `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts:121`
  — reports only `failed`. `cancelled` is also silent: it means the user asked
  for something else.
- `apps/ptah-extension-webview/src/app/app.ts:141` — warns only when the
  initial navigation did not land.

**Tests** — `surface-router.service.spec.ts`, describe `result semantics (F3)`:
two awaited `navigateToSurface('harness-builder')` calls now return
`'navigated'` then `'already-there'` (this was `true` then `false`); plus
`failed` vs `cancelled` separation and the `surfaceNavigationLanded` truth
table. `harness-workflow-message.handler.spec.ts` gains
`reports NO error when the builder is already open (F3)` and
`reports NO error when a newer navigation superseded the request`; the existing
failure test now uses `'failed'`.

## F4 — the host allow-list becomes the one list

**Fix.** Two files plus the shared move:

- `libs/shared/src/lib/types/webview-surface.types.ts` — NEW. Owns `ViewType`
  and the four lists. No Angular, no Node, no `vscode`, because both the
  renderer and the extension host import it.
- `libs/shared/src/index.ts` — exports it.
- `libs/frontend/core/src/lib/routing/surface-routes.ts` — now a pure re-export.
- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:114` —
  validates against `isAcceptedInitialView`, deleting the six-entry array.
- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:341` —
  the fallback document's root element was `<app-root>`; the app declares
  `selector: 'ptah-root'`. **That is why the broken command rendered an empty
  panel rather than an error**, so fixing the allow-list without this would
  have left the fallback silently blank for any future throw.
- `libs/frontend/core/src/lib/services/app-state.service.ts` — `handleMessage`
  now validates with `isAcceptedInitialView` rather than
  `isSurfaceRouteId(view) || view === 'orchestra-canvas'`, so the legacy alias
  is named in one place.
- `__mocks__/vscode.ts` — additive: `Uri.joinPath`, `window.activeColorTheme`,
  `ColorThemeKind`. Without them any spec touching webview HTML generation
  threw `Uri.joinPath is not a function` before it could assert anything.

`orchestra-canvas` is accepted as a legacy alias and `normalizeInitialView`
still rewrites it to chat plus grid. `command-builder` and `context-tree` are
rejected everywhere.

**Tests** — new file
`apps/ptah-extension-vscode/src/services/webview-html-generator.initial-view.spec.ts`
(27 tests). Validation runs before the `index.html` read, so the logged error
message separates the outcomes at the public boundary: a rejected view logs
`Invalid initialView`, an accepted one gets as far as
`Angular index.html not found`. Plus a `<ptah-root>` assertion on the fallback.

Verified by restoring the old six-entry array and `<app-root>`:
**18 failed, 9 passed**. With the fix: **27 passed**.

A drift gate sits on the other side:
`apps/ptah-extension-webview/src/app/webview-routing.spec.ts` →
`cannot drift from the HOST allow-list (F4)` asserts
`ACCEPTED_INITIAL_VIEWS` equals the route table plus `LEGACY_SURFACE_ALIASES`.
That one is a regression guard for the future, not a reproduction of the past.

## F5 — matrix parameters break surface parsing

**Fix.** Parsing moved out of string surgery and into Angular's own grammar.
`surface-router.service.ts:150` (`surfaceOf`) reads
`UrlTree.root.children[PRIMARY_OUTLET].segments[0].path` — the segment path
WITHOUT its matrix parameters — and hands it to `surfaceIdFromSegment`. Both
`currentSurface` and `pendingSurface` use it. `surfaceIdFromUrl` is deleted;
its replacement in `libs/shared` takes a parsed segment, which is a contract
the shared spec documents.

**Test** — `surface-router.service.spec.ts`, describe
`URL parsing agrees with Angular (F5)`:
`Router.navigateByUrl('/settings;panel=auth')` gives `router.url` of
`/settings;panel=auth` and `currentSurface()` of `settings` (it was `chat`).
Query/fragment and unknown-URL cases are alongside it.

## F6 — a non-integer history offset poisons the cursor

**Fix.** `libs/frontend/core/src/lib/routing/memory-platform-location.ts`:
`historyGo` (`:176`) rejects a non-integer offset with a warning and no state
change, and the private `go` (`:213`) repeats the `Number.isInteger` check
because it is the only place the cursor is assigned and `back`/`forward` reach
it too.

**Tests** — `memory-platform-location.spec.ts`, describe
`invalid offsets leave the cursor usable (F6)`: `-0.5`, `1.5`, `NaN`, positive
and negative `Infinity`, each asserting that `pathname`, `getState` and `href`
still read afterwards (the old behaviour threw on all three, permanently), that
normal traversal still works after an ignored offset, and that no popstate
listener fires.

## Closed from my own risk list

- **Risk 3 (failed navigation during `switchWorkspace`)** — now covered by
  `records nothing when a workspace restore navigation fails`, and F1's
  ownership model is what makes the outcome deterministic.
- **Risk 7 (two settle helpers)** — one rule, written down once.
  `settleSurfaceNavigation()` in
  `libs/frontend/core/src/testing/surface-router-testing.ts` is the helper for
  fixture-less specs; a spec that HAS a fixture awaits `fixture.whenStable()`,
  because `TestBed.tick()` underneath a fixture raises
  `NG0101: ApplicationRef.tick is called recursively` (reproduced while writing
  the F2 spec). The three service specs that had local copies now import the
  shared one. The F2 spec needs a third form for one stretch — a bare macrotask
  flush — because a deliberately-hanging lazy route means `whenStable()` would
  never resolve; that is commented where it is used.

## Files changed in this round

| Path                                                                                      | Change                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `libs/shared/src/lib/types/webview-surface.types.ts`                                      | CREATED — the id contract, owned here so the extension host can read it.                         |
| `libs/shared/src/lib/types/webview-surface.types.spec.ts`                                 | CREATED — 30 tests over the four lists and their relationships.                                  |
| `libs/shared/src/index.ts`                                                                | MODIFIED — exports the new module.                                                               |
| `libs/frontend/core/src/lib/routing/surface-routes.ts`                                    | REWRITTEN as a re-export of the shared contract.                                                 |
| `libs/frontend/core/src/lib/routing/surface-routes.spec.ts`                               | DELETED — its cases moved to the shared spec and (for URL parsing) to the service spec.          |
| `libs/frontend/core/src/lib/routing/surface-router.service.ts`                            | MODIFIED — F3 result type plus `surfaceNavigationLanded`, F5 `surfaceOf`, F2 `pendingSurface()`. |
| `libs/frontend/core/src/lib/routing/surface-router.service.spec.ts`                       | MODIFIED — F3, F5 and F2 describes; 26 tests.                                                    |
| `libs/frontend/core/src/lib/routing/memory-platform-location.ts`                          | MODIFIED — F6 integer validation in `historyGo` and `go`.                                        |
| `libs/frontend/core/src/lib/routing/memory-platform-location.spec.ts`                     | MODIFIED — F6 describe.                                                                          |
| `libs/frontend/core/src/lib/routing/index.ts`                                             | MODIFIED — exports the result type, the predicate and the new shared names.                      |
| `libs/frontend/core/src/lib/services/app-state.service.ts`                                | MODIFIED — F1 ownership/generation model; `handleMessage` uses the shared predicate.             |
| `libs/frontend/core/src/lib/services/app-state.service.spec.ts`                           | MODIFIED — F1 describe; uses the shared settle helper.                                           |
| `libs/frontend/core/src/testing/surface-router-testing.ts`                                | MODIFIED — adds `settleSurfaceNavigation` and the one rule.                                      |
| `libs/frontend/core/src/testing/index.ts`                                                 | MODIFIED — exports it.                                                                           |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`                  | MODIFIED — F2 guard; injects `SurfaceRouterService` for the read only.                           |
| `libs/frontend/chat/src/lib/components/templates/app-shell.auth-redirect.spec.ts`         | CREATED — F2, driving the real component.                                                        |
| `libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts`               | MODIFIED — uses the shared settle helper.                                                        |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts`      | MODIFIED — F3 result handling.                                                                   |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.spec.ts` | MODIFIED — F3 cases.                                                                             |
| `apps/ptah-extension-webview/src/app/app.ts`                                              | MODIFIED — F3 result handling in `handleInitialView`.                                            |
| `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`                             | MODIFIED — F4 drift gate; shared settle helper; asserts the landed result.                       |
| `apps/ptah-extension-vscode/src/services/webview-html-generator.ts`                       | MODIFIED — F4 shared allow-list; `<ptah-root>` in the fallback.                                  |
| `apps/ptah-extension-vscode/src/services/webview-html-generator.initial-view.spec.ts`     | CREATED — F4, 27 tests.                                                                          |
| `__mocks__/vscode.ts`                                                                     | MODIFIED — additive `Uri.joinPath`, `window.activeColorTheme`, `ColorThemeKind`.                 |

## Verification

`npx nx reset` first, as instructed.

```
npx nx run-many -t typecheck lint test -p ptah-extension-webview \
  @ptah-extension/core @ptah-extension/chat @ptah-extension/shared \
  @ptah-extension/dashboard @ptah-extension/harness-builder \
  @ptah-extension/marketplace @ptah-extension/tribunal-panel \
  @ptah-extension/thoth-shell @ptah-extension/tasks-ui \
  @ptah-extension/setup-wizard @ptah-extension/canvas ptah-extension-vscode
```

```
 NX   Running targets typecheck, lint, test for 13 projects and 26 tasks they depend on:

- ptah-extension-webview
- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/shared
- @ptah-extension/dashboard
- @ptah-extension/harness-builder
- @ptah-extension/marketplace
- @ptah-extension/tribunal-panel
- @ptah-extension/thoth-shell
- @ptah-extension/tasks-ui
- @ptah-extension/setup-wizard
- @ptah-extension/canvas
- ptah-extension-vscode

...

 NX   Successfully ran targets typecheck, lint, test for 13 projects and 26 tasks they depend on
```

Header reads **13 projects**, exit code 0. The shared move pulled 26 dependency
build tasks in, as expected. Per-project test totals from the same run:

| Project                           | Suites | Tests                                 |
| --------------------------------- | ------ | ------------------------------------- |
| `@ptah-extension/shared`          | 61     | 1619 passed                           |
| `@ptah-extension/core`            | 30     | 764 passed                            |
| `@ptah-extension/chat`            | 87     | 1347 passed, 2 skipped (pre-existing) |
| `ptah-extension-webview`          | 10     | 196 passed                            |
| `ptah-extension-vscode`           | 7      | 92 passed                             |
| `@ptah-extension/marketplace`     | 12     | 241 passed                            |
| `@ptah-extension/tribunal-panel`  | 16     | 333 passed                            |
| `@ptah-extension/tasks-ui`        | 19     | 611 passed                            |
| `@ptah-extension/setup-wizard`    | 12     | 321 passed                            |
| `@ptah-extension/canvas`          | 9      | 172 passed                            |
| `@ptah-extension/dashboard`       | 8      | 71 passed                             |
| `@ptah-extension/harness-builder` | 5      | 115 passed                            |
| `@ptah-extension/thoth-shell`     | 1      | 5 passed                              |

Lint: **0 errors** across all 13. The warnings shown (`max-lines`,
`no-non-null-assertion`, `no-empty-function`, `explicit-member-accessibility`,
`preserve-caught-error`) are pre-existing and none is in a file this round
created.

### Production build, re-measured after the shared move

```
npx nx build ptah-extension-webview --skip-nx-cache
Application bundle generation complete. [31.437 seconds]
 NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

`ls dist/apps/ptah-extension-webview/browser/chunk-*.js | wc -l` gives **17**,
unchanged from both the recorded baseline and round 1. The
`bundle initial exceeded maximum budget` warning is pre-existing.

## Still open after this round

- **No live-host run.** Nothing in this round changes that: acceptance criteria
  1 and 2 rest on unit and composition tests, and nobody has opened the real VS
  Code webview or the Electron renderer. In particular the F4 fix means
  `ptah.openOrchestraCanvas` should now render the canvas rather than an empty
  panel — that is the single most valuable thing to click before merge, and it
  is not something I can prove from here.
- **Playwright e2e was not executed** (needs a packaged Electron build); only
  `lint` and `typecheck` ran for `ptah-electron-e2e`.
- **`tribunal`'s `loadComponent` is still not resolution-tested** under the
  webview app's jest transform, for the gridstack ESM reason documented in the
  spec's `JEST_UNRESOLVABLE_SURFACES`.
- **Batch 1 scope only** — `SURFACE_ACTIVE`, the `RouteReuseStrategy`, child
  routes and URL persistence remain batches 2-4.
- **A late settlement for a workspace whose active path never changes.** If
  `removeWorkspaceState` revokes ownership of the active workspace and no
  workspace switch follows, that workspace records nothing further. The close
  flow always switches away (`ElectronLayoutService`), and with no workspace
  there is nothing to record against, so I left it rather than adding a
  re-grant path that would reopen the resurrection hole. Called out because it
  is the one asymmetry in the ownership model.
