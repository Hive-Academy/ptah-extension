# Plan Review - TASK_2026_540_0940

Reviewer: internal software-architect subagent (independent review of the Glm-lane plans).
Inputs: `task-description.md` (21 criteria), `implementation-plan.md`, `context.md`, `TASK_2026_492_0bcc/design-spec.md:11-80`.
The code was checked in this worktree at `2f798f0d5` (clean tree). All paths are relative to the worktree root.

**Verdict: APPROVE WITH FIXES**

The architecture holds up: one global signal on the `_layoutMode` precedent, one settlement seam, a stay-branch in `switchWorkspace`, and a widened Electron gate. The cited contracts match the code. The exceptions are listed in finding 10. No finding blocks the work. Findings 1-3 are MAJOR, and the plan must absorb them before Batch A and Batch B are cut.

## Verified OK (no action)

- Settlement sites: the constructor effect is at `app-state.service.ts:399-409`, `recordSettledSurface` at `:442-458` and `openViewInActiveSlice` at `:639-647`. The `switchWorkspace` stamp, owner-null, bootstrap-migration and restore sequence is at `:660-717`. `canSwitchViews` is at `:527-529`, `handleViewSwitch` at `:810-814`, `openSettingsTab` at `:1110-1114` and `openSkillsDivergedClones` at `:835-840`. All match the plan.
- `currentSurface` follows `NavigationEnd` only and reads the first URL segment (`surface-router.service.ts:72-86, 150-155`). `pendingSurface()` exists (`:98-102`). `'already-there'` counts as landed (`:44-48`). Marketplace child routes are therefore covered by the stay-branch, as the orchestrator's correction says.
- Criterion 19 (VS Code): `openViews` has no production consumer. Outside `app-state.service.ts`, the only hit is a comment at `workspace-coordinator.service.ts:152`. `closeView` has no production caller. `AppStateManager.switchWorkspace` is reached only through `WorkspaceCoordinatorService` (`workspace-coordinator.service.ts:172`), which is Electron-driven. No part of the AppStateManager change is visible in VS Code.
- Decision 4 against the primitive: `NativeDropdownComponent` has no key handling. Its only host listener is `document:click` (`native-dropdown.component.ts:103`). Its `panelRole` is `'listbox' | null` (`:155-157`), and the backdrop emits `closed` (`:223-228`). The precedent is exactly as cited: `[panelRole]="null"`, `(opened)` focuses the first item, and the panel's `(keydown.escape)` closes and refocuses (`background-agent-strip.component.ts:292-321, 516-534`).
- Module boundaries: chat already imports `@ptah-extension/ui` (`chat/src/lib/components/molecules/chat-input/chat-input.component.ts`). The ui barrel re-exports native components (`ui/src/index.ts:32` → `native/index.ts:29`). The core barrel re-exports `app-state.service` (`core/src/lib/services/index.ts:7`, `core/src/index.ts:1`). No chat-ui → chat import is introduced.
- The e2e selector inventory is complete. I found no other nav-tab selectors in `apps/ptah-electron-e2e/src/{specs,support,docs-screenshots}` or `libs/frontend/webview-e2e-harness`. The `Orchestra Canvas` hits in `specs/git/hunk-revert-top-layer.spec.ts:198` and `showcase/landing-page-tour.scene.ts:242` are canvas headings, not tabs.
- Batches A, B, C1, C2 and C3 are file-disjoint and each has 6 files or fewer. No batch touches `webview-surface.types.ts` or `app.routes.ts`.

## Findings

### 1. MAJOR - The global open-surface write is gated on workspace ownership

**Evidence.** Decision 1 writes `openSurface` only inside `recordSettledView`, which runs only from the two existing settlement sites. Both sites apply per-workspace ownership guards:

- the effect drops the write when `_settlementOwner !== active` (`app-state.service.ts:406`);
- `recordSettledSurface` drops it on generation or workspace mismatch (`:449-450`).

The owner is `null` in two situations: after `switchWorkspace` until its restore navigation lands (`:683`, and forever if the restore fails, `:709-713`), and after `removeWorkspaceState` of the active workspace (`:741-743`).

Closing the last workspace calls `removeWorkspaceState` and then `coordinateWorkspaceCleared()`. It never calls `appState.switchWorkspace` (`electron-layout.service.ts:371-380`), so the owner stays `null` while the user is in the pre-workspace state.

External navigations reach only the effect: `HarnessWorkflowMessageHandler` (`harness-workflow-message.handler.ts:129`), `App.handleInitialView` (`app.ts:140`) and `Location.back()`.

The design requires the state to be "independent of `_activeWorkspacePath`" (`design-spec.md`, Navigation sets). Criterion 16 requires it to update "regardless of the active workspace".

**Failure scenario.** The last workspace is closed while Settings is open. The owner becomes `null`, `openSurface` stays `'settings'`, and the gate keeps the 3-panel area. The host then pushes a harness workflow, and the Router lands on `harness-builder`. The effect drops the write, so `openSurface` stays `'settings'`: the menu highlights Settings while Harness Builder is on screen, and the welcome gate never reopens.

The pattern is the same whenever an external navigation lands during an owner-null window. The plan's own rejected-alternative rule ("the menu would highlight a surface that is not on screen") is violated.

**Fix.** Split the seam into its two concerns:

- In the constructor effect, write `_configurationSurfaces.openSurface = isConfigurationSurface(surface) ? surface : null` **before** the ownership check. The global state follows the Router and is never ownership-gated.
- Keep slice stamping behind the existing guards, and make the slice path refuse configuration ids. The simplest form is an early return in `openViewInActiveSlice` or its replacement, which also covers the synchronous outgoing stamp at `:678`.
- `recordSettledSurface` keeps only the slice stamp and the owner re-grant at `:456`.

The effect is a root effect (it is created in a root service constructor), so it flushes before the view refresh. The Electron gate then flips in the same tick as the navigation. This also supports finding 2.

Update the TASK_2026_533 note in "Extension points" item 2: the global write now lives in the constructor effect, and the owner mechanics are unchanged.

### 2. MAJOR - Assumption A1 is under-scoped: mounting `ptah-app-shell` without a workspace mounts more than services

**Evidence.**

- `app-shell.component.html:52` always renders the shared chrome (hidden with `[class.hidden]`, not destroyed). That includes the canvas behind `:608-611` (`*ngComponentOutlet="orchestraCanvasComponent"`, grid mode, which Electron pins at `electron-shell.component.ts:341`).
- The canvas constructor calls `canvasStore.hydrateWorkspace(tabManager.activeWorkspacePath$(), …)` (`orchestra-canvas.component.ts:334-338`). That method activates a partition and "only then are storage writes enabled for the partition" (`canvas.store.ts:378-410`).
- `AppShellComponent` also arms the auth redirect. It fires on the first `chat` view and calls `setCurrentView('settings')` when `!hasAnyAuth()` (`app-shell.component.ts:292-323`).

Today none of this ever runs in Electron without a workspace, because the welcome gate (`electron-shell.component.ts:232`) keeps `ptah-app-shell` unmounted.

**Failure scenarios.**

- (a) A user with no auth and no workspace opens Settings from the menu and then presses Settings' own back button (`settings.component.ts:182`, `setCurrentView('chat')`) or "Back to welcome". If one change-detection pass sees `currentView() === 'chat'` while `ptah-app-shell` is still mounted, the auth effect fires and sends the user back to Settings. The user cannot get back to the welcome screen. Under the plan's write path, `openSurface` is cleared in a `.then` microtask after navigation (`app-state.service.ts:423-427`), so this ordering is not guaranteed. Finding 1's root-effect write makes it very unlikely, but that is still an assumption until a test pins it.
- (b) After the last workspace is closed, the canvas hydrates against whatever `activeWorkspacePath$` still holds (possibly the closed path) and enables storage writes for it.
- (c) Opening a folder while on a configuration surface before any workspace exists (through the Electron app menu) is a construction order that has never been exercised: `ptah-app-shell` and the canvas exist before the first workspace. The stay-branch then runs the bootstrap migration.

The plan's A1 check ("confirm no console errors from session/boot RPCs") covers none of the three. Its risk statement ("exposure is limited to logged RPC failures") is not supported by the code.

**Fix.**

- Make A1 a gated verification with three named checks: (a), (b) and (c) above. Add a unit or harness test for (a): no auth, no workspace, open Settings, go back to chat, and assert that the welcome screen stays.
- Pre-authorise one fallback, in this order, if a check fails:
  1. The widened gate stays, and the pre-workspace branch renders a bare `<div class="h-full w-full"><router-outlet /></div>` instead of `ptah-app-shell`. The rejection "two outlets in one tree" does not apply to mutually exclusive `@if`/`@else` branches: a newly created `RouterOutlet` re-activates the route already stored in its outlet context on init, so only one primary outlet exists at a time.
  2. An Electron-only guard in the auth effect. This edits `app-shell.component.ts`, which the plan promises not to touch, so it needs the user's approval.

### 3. MAJOR - The stay-branch keeps a configuration surface mounted across a workspace switch, and some of these surfaces render per-workspace content without reacting to the switch

**Evidence.** The plan says installed content is per-workspace (it cites `app-state.service.ts:517-524`), yet the stay-branch keeps Marketplace mounted across a switch.

Some panes do reload on a switch: Thoth's Memory tab reloads on `workspaceInfo` changes (`memory-curator-tab.component.ts:418-428`), as do the cron tab and the skill-diagnostics state (`cron-scheduler-ui/.../cron-scheduler-tab.component.ts`, `skill-synthesis-ui/.../skill-diagnostics-state.service.ts`).

A grep over `marketplace/src`, `setup-hub.component.ts`, `thoth-shell/src` and `chat/src/lib/settings` for `workspaceInfo()`, `activeWorkspacePath` and `WorkspaceScope` finds no switch reaction. Provider settings guard *writes* by scope (`providers-settings-state.service.ts:1060-1065`) but can still *display* stale values.

Today a surface survives a switch only when both workspaces remembered the same surface (`navigateToSurface` returns `'already-there'`, `surface-router.service.ts:131-133`). The stay-branch makes that the default for all four surfaces.

**Failure scenario.** Marketplace is open on workspace A with plugin X installed, and the user switches to B. Marketplace stays mounted and still shows X as installed. Any action is then resolved by the host against B.

**Fix.** Add Assumption A2 to the plan: "each configuration surface either renders workspace-independent data or reloads on a workspace change". Before Batch B is accepted, audit every surface and every Thoth sub-tab.

- For each pane that does not reload, either add the memory-tab reload pattern in a separate batch owned by that pane's lib, or record it as a known limitation in the plan.
- If Marketplace's installed state turns out to be stale, raise it with the user. The fix is either reload work or leaving the configuration surface on a switch, and the second option changes the approved Decision 1.

### 4. MINOR - An in-flight navigation started under the outgoing workspace is stamped onto the incoming one after the stay-branch

**Evidence.** `ElectronLayoutService.switchWorkspace` coordinates after a debounced RPC (`electron-layout.service.ts:386-394`). A tab click in that window starts a navigation with `workspacePath = A` (`app-state.service.ts:421`). The stay-branch then sets the owner to `newPath` and bumps no generation. When the navigation lands, `recordSettledSurface` drops it (`:450`), but the effect stamps it onto B (`:406-407`).

**Scenario.** The user is on Settings in A, clicks workspace B, then clicks Tasks within the debounce window. B's slice records `tasks`. This is arguably what the user wanted, and it is better than the normal branch, whose restore navigation cancels the click.

**Fix.** No design change. Add a spec that pins this behaviour, so that a later change to it is deliberate.

### 5. MINOR - After the last workspace closes, pre-workspace navigations re-create the closed workspace's slice

**Evidence.** Closing the last workspace leaves `_activeWorkspacePath` at the closed path: `coordinateWorkspaceCleared` does not call `AppStateManager` (`electron-layout.service.ts:377-380`). `recordSettledSurface` re-grants ownership to that path (`app-state.service.ts:456`), and `updateActiveViewSlice` seeds the missing slice (`:629-635`).

Before 540 this was unreachable, because Electron had no navigation UI without a workspace. The menu and "Back to welcome" make it reachable.

**Impact.** A closed workspace that is re-opened later restores `chat`, the default, so the outcome is benign.

**Fix.** Accept it and pin it with a spec (close the last workspace, open Settings, go back to chat, and read the slices). Mention it in the plan's failure section.

### 6. MINOR - Pre-workspace, Setup hub's navigation buttons send the user to the welcome screen

**Evidence.** Setup hub navigates to `setup-wizard`, `harness-builder` and `tribunal` (`setup-hub.component.ts:1296, 1300, 1304, 1317`). With no workspace, any non-configuration settlement clears `openSurface`, and the gate shows the welcome screen. The Router stays on the target, and the bootstrap migration (`app-state.service.ts:686-701`) restores that target when a folder is opened.

**Fix.** State this behaviour in Decision 2 as designed, and add one gate test. Disabling those buttons without a workspace is out of scope; if it is wanted, record it as a follow-up.

### 7. MINOR - Decision 1 misstates what happens after the stay-branch

**Evidence.** The plan says: "When the user next clicks Chat/Tasks/Tribunal/Analytics … the new workspace's slice memory is served from then on." In fact, clicking a tab navigates to the clicked surface (`setCurrentView`, `:754-758`), and the configuration surfaces' own back buttons go to `chat` (`settings.component.ts:182`, `thoth-shell.component.ts:273`, `marketplace-hub.component.ts:159`). B's remembered surface is restored only on a later switch *into* B (`:714-716`).

**Fix.** Correct the wording so that the team-leader and the testers do not assert a restore that does not happen.

### 8. MINOR - The extension-point typing does not deliver a "field addition" for TASK_2026_533

**Evidence.** The plan defines `perSurface: Record<ConfigurationSurfaceId, ConfigurationSurfaceSlot>`, where `ConfigurationSurfaceSlot = Readonly<Record<string, unknown>>`. To type `marketplaceRoute`, 533 would have to reshape this into a per-key type. The `updateConfigurationSurfaceSlot` writer is untyped and has no caller in 540.

**Fix.** Declare a per-key interface, `ConfigurationSurfaceSlots { thoth: …; 'setup-hub': …; marketplace: …; settings: … }` (empty object types for now), so that 533 adds one member to `marketplace`. Then either:

- type the writer as `<K extends ConfigurationSurfaceId>(id: K, patch: Partial<ConfigurationSurfaceSlots[K]>)`, or
- drop it and let 533 add it with its first caller, in line with the rule against speculative APIs.

### 9. MINOR - The test seams in Component 3 are mis-described

**Evidence.**

- `electron-shell.activity-placement.spec.ts` contains no tab-count or geometry assertions; its three cases are at `:130, 135, 142`. The "re-pin from 8 tabs to 4" task does not exist.
- The real break is elsewhere: the spec's `appStateStub` (`:86-92`) has no `openConfigurationSurface`, so the widened gate at `:232` throws in every existing case.
- `electron-shell.notification-center.spec.ts` is a source-grep spec (`:5-15`) and is unaffected.
- The core test plan lacks two cases: a navigation that the service did not start (`navigateToSurface` called directly, which is the `initialView` and harness path) updating the global state (criterion 18), and finding 1's owner-null case.

**Fix.**

- Extend the stub with signal-backed `openConfigurationSurface` and `hasWorkspaceFolders`.
- Put the criterion 4 and 5 cases in a new `electron-shell.config-gate.spec.ts`. Batch B becomes 6 files, and the notification-center spec leaves the batch.
- Add the two missing core cases.

### 10. MINOR - Citation corrections

**Evidence.**

- The lucide imports are at `electron-shell.component.ts:30` (Settings), `:37` (Wrench), `:38` (Store) and `:39` (RadioTower), not `:30,34,36,37`.
- The ui barrel export is at `ui/src/index.ts:32`; line `:25` is a doc comment.
- `openViews` is not "the VS Code tab-pill source": it has no production consumer.
- `ZapIcon`, `BotIcon`, `GitBranchIcon` and `SparklesIcon` (`electron-shell.component.ts:368-371`) are already unused in the template.
- The spec re-pin list omits nothing material: `:408` and `:919-928` stay valid.

**Fix.** Correct the citations. Under the replace-not-accumulate rule, delete the four already-unused icon fields together with the three that become unused.

### 11. MINOR - Gaps in the keyboard and focus contract

**Evidence.**

- `opened` is emitted only after Floating UI positioning resolves (`native-dropdown.component.ts:192-205`). In jsdom it may never fire, and the precedent's spec does not test focus.
- Activating an item closes the panel. The focused item is destroyed and focus falls to `<body>`.
- The backdrop is `fixed inset-0` (`:65-72`). On macOS it lies over the `titlebar-drag` navbar (`electron-shell.component.ts:101`), so a click on the navbar while the menu is open may drag the window instead of closing the menu.
- The trigger icon the plan proposes (`Settings`) is the same glyph as the Settings item.

**Fix.** See the implementer instructions below. The macOS backdrop check goes into the manual checklist next to criterion 8.

## Instructions for implementers

1. **Batch A (core).**
   - Implement finding 1: the global write lives in the constructor effect, unconditionally, before the owner check.
   - Slice stamping refuses configuration ids at the single slice write path. That covers `switchWorkspace`'s outgoing stamp at `app-state.service.ts:678` as well.
   - Keep `setCurrentView` byte-identical. TASK_2026_533 folds its no-op rule into it.
   - Keep `_settlementOwner` granted at `:456` exactly as today.
2. **Stay-branch.** Condition it on `isConfigurationSurface(this.currentView())`, the Router truth, not on the stored signal. Keep the bootstrap migration (`:686-701`) verbatim inside it. Set `_settlementOwner = newPath`. Do not call `requestSurface`.
3. **Batch A specs.** Re-pin the plan's list (`:289-308, 328-370, 542-549, 636-651, 735-756, 808-813`) to `analytics`, `tasks` or `tribunal`, keeping each assertion's meaning. Add these cases:
   - a configuration settlement leaves every slice untouched;
   - the global state is identical before and after `switchWorkspace`;
   - `switchWorkspace` while on `settings` starts no navigation (spy `navigateToSurface`);
   - `SWITCH_VIEW`, `openSettingsTab`, `openSkillsDivergedClones` and a direct `navigateToSurface` each update the global state;
   - owner `null` (after `removeWorkspaceState` of the active path) followed by an external navigation still updates the global state;
   - finding 4's in-flight case;
   - finding 5's closed-workspace case.
4. **Batch B (menu).**
   - Place `data-test="config-menu-trigger"` and `data-test="config-menu-item-<id>"` in the menu component.
   - Use `[panelRole]="null"` and `aria-expanded`, and give the trigger the accessible name "Configuration".
   - Handle arrow-key roving on the panel container with wrap and `preventDefault()`.
   - Escape and item activation both close the panel and return focus to the trigger.
   - Before `setCurrentView('thoth')`, call `dismissThothFirstRun()` when the hint is not yet dismissed (`app-state.service.ts:873`), exactly as the removed handler did at `electron-shell.component.ts:394-399`.
   - Pick a trigger glyph that is already imported somewhere in the repo; verify it by grep and do not name an unverified lucide export.
   - In the spec, fire `opened` through the dropdown's `DebugElement.triggerEventHandler('opened')` rather than relying on Floating UI.
5. **Batch B (shell).**
   - Keep the `electron-tabs` class and `role="tablist"` on the row: `activity-ticker.e2e.spec.ts:126` selects `[role="tablist"].electron-tabs`.
   - The tab titles become "Chat" and "Analytics".
   - Mark the Apps slot with the comment only.
   - Gate the two sidebar tabs, the sidebar, its resize handle and the git dock on `layout.hasWorkspaceFolders()`, per Decision 2.
   - Do not add `[class.hidden]` anywhere.
6. **Before accepting Batch B, run A1 and A2** (findings 2 and 3) in the Electron app and record the results in the batch report:
   - no folder open → Settings, back → welcome stays (also with no auth);
   - close the last workspace while on Settings → welcome and menu behave;
   - open a folder while on a configuration surface before any workspace exists;
   - switch workspace on each of the four surfaces and note which panes show stale data.
7. **E2e batches.**
   - The new menu helper must restore the originating surface. When the original was a configuration surface, `activeNavTitle` returns `null` (`prewarm.ts:32-39`), so restore through the menu.
   - Keep prewarm's silent, guarded no-op rules (`prewarm.ts:15-25`).
   - `chat-code-edit.scene.ts:179-181` includes a `[title="Orchestra Canvas"]` locator. Rename it with the rest.
8. **Guard greps must look at added lines only.** `app-shell.component.html:47, 52` already contain `[class.hidden]`:
   - `git diff origin/main...HEAD -U0 | grep '^+' | grep -E 'class\.hidden|retain: *true'` must return nothing;
   - `git diff --name-only origin/main...HEAD` must not list `webview-surface.types.ts` or `app.routes.ts`.
9. **Verification.**
   - Per batch, run `npx nx run-many -t typecheck,test,lint -p <project>`. `ptah-electron-e2e` has only the `lint`, `typecheck`, `e2e`, `showcase` and `e2e:nightly` targets.
   - Run the harness scenarios `boot-progress` and `activity-ticker` with `npx nx run @ptah-extension/webview-e2e-harness:e2e`, because both mount `ElectronShellComponent`.
   - Tell TASK_2026_533 where the global write lives (finding 1) before it rebases.

## Re-review (revision 2)

Scope: `implementation-plan.md` revision 2, which applies findings 1-11 and user decisions A (bare pre-workspace outlet) and B (stay on the surface and re-create it). The worktree is still clean at `2f798f0d5`: no production code has been written yet. Angular Router in `node_modules` is 22.1.7.

**Verdict: APPROVE WITH FIXES**

The fixes are two MAJOR items. R2-1 must be applied before the Electron-shell batch is cut. R2-2 must be applied before Batch 1 continues. Everything else in revision 2 is sound, and the Router claims check out (R2-3).

### R2-1. MAJOR - Keying the whole `ptah-app-shell` host re-creates the always-mounted chat/canvas chrome, not only the configuration surface

**Evidence.**

The plan's Decision 2 item 5 (`implementation-plan.md:287-302`) wraps `<ptah-app-shell>` (`electron-shell.component.ts:264`) in `@for (k of [tick]; track k)`. Every bump therefore destroys the whole `AppShellComponent` tree, and not only the outlet's routed component:

- **(1) Canvas state.** `CanvasStore` is component-scoped, not `providedIn: 'root'` (`canvas.store.ts:64, 79`; `orchestra-canvas.component.ts:44, 63`). It holds the live tile state of **every** mounted workspace ("background workspaces keep their own live tile state", `canvas.store.ts:74-77`). That includes the in-memory partitions `_workspaceTiles`, `_workspaceFocusedTabId`, `_workspaceLayoutFocus` and `_workspaceRevisions` (`:92-104`), and the transient layout-focus overlay, which is never persisted (`:166`).
  - Tile *intent* survives, because `ngOnDestroy` flushes persistence (`orchestra-canvas.component.ts:586-588`). The re-created canvas also hydrates the new workspace correctly: `WorkspaceCoordinatorService` calls `tabManager.switchWorkspace` before `appState.switchWorkspace` (`workspace-coordinator.service.ts:167, 172`), so the new canvas reads the new path at `orchestra-canvas.component.ts:334-338`. Other workspaces re-hydrate lazily on their next switch.
  - What is lost: the layout-focus overlay and the focused tile for every workspace, every mounted grid (gridstack is rebuilt), and all per-tile component state.
  - The design says the opposite: `chat` is "Stays mounted: **Yes** … leaving it never tears down `CanvasStore`" (`design-spec.md:39`, also `:34`). The plan's risk row (`implementation-plan.md:494`) justifies the loss with the configuration surfaces' "Stays mounted: No". That is the wrong row: the canvas belongs to `chat`.
- **(2) One-shot effects re-arm.** The auth redirect is guarded by the per-instance `authCheckDone` flag (`app-shell.component.ts:282, 292-323`), so every remount re-arms it.
  - **Scenario:** a user with no auth is on Settings in workspace A. They switch to B (stay-branch, remount), then click the Chat tab. The new instance's effect fires on `chat` and redirects to Settings again (`:318-319`). Today, the redirect fires once per shell instance.
  - Component-local UI state also resets: `_sidebarOpen` (`:188`), the session search and date filters (`:222-225`), and the name-editing popovers (`:215-221`).
  - `KeyboardShortcutsService` is root and binds once (`keyboard-shortcuts.service.ts:21, 26-35`), so it does not double-bind.
- **(3) Streams.** Streams are **not** torn down. Stream, tab and session state lives in root services. Tile teardown only calls `unregisterVisibleTab` (`canvas-tile.component.ts:505-508`), which switches `BatchedUpdateService` to its background batching (`batched-update.service.ts:102, 176`) until the new tiles register again.
  - There is one path to check. `NotificationFocusCoordinator.run` switches workspace, then immediately calls `setCurrentView('chat')` and `requestCanvasFocus` (`notification-focus-coordinator.service.ts:41-47`). From a configuration surface, the stay-branch bumps the tick in the same synchronous sequence, so the canvas is rebuilt at exactly the moment a focus request is queued for it. The request sits in a root signal, and the new canvas's effect consumes it (`orchestra-canvas.component.ts:368-394`). So this probably works, but it is untested and pointless churn.
- **(4) A narrower key exists without touching `app-shell.component.html`.** Angular's public Router API can re-create only the routed component:
  - `ChildrenOutletContexts` and `OutletContext` are public exports (`@angular/router/fesm2022/router.mjs:7`).
  - `OutletContext.outlet`, `.route` and `.injector` are public fields. `injector` is the route's own `_environmentInjector`, which is the lazy-loaded one for `loadComponent`/`loadChildren` (`_router-chunk.mjs:1249-1261`).
  - `RouterOutlet.deactivate()` destroys the activated component (`:1795-1803`), and `activateWith(route, injector)` creates a fresh instance at the same `ActivatedRoute` (`:1804-1822`).

**Fix: replace the keyed `@for` host.**

- Keep `_configurationSurfaceRemountTick` in `AppStateManager`, bumped in the stay-branch as planned.
- Add `remountActiveSurface()` to `SurfaceRouterService` (`libs/frontend/core/src/lib/routing/surface-router.service.ts`), which already owns the Router. It works as follows:
  1. `const ctx = inject(ChildrenOutletContexts).getContext(PRIMARY_OUTLET)`.
  2. If `ctx?.outlet?.isActivated && ctx.route`, keep `route = ctx.route` and `injector = ctx.injector`.
  3. Call `ctx.outlet.deactivate()`, then `ctx.outlet.activateWith(route, injector)`.
  4. Otherwise do nothing: there is no outlet in the welcome branch, and branch flips already create a fresh component.
- In `ElectronShellComponent`, an effect reads the tick. It skips `0` and calls `remountActiveSurface()` from `untracked`.
- Do **not** call it synchronously inside `switchWorkspace`. `ElectronLayoutService` sets `workspaceInfo` and `updateWorkspaceRoot` only **after** `coordinator.switchWorkspace` returns (`electron-layout.service.ts:486-503`). A synchronous remount would construct the surface while `workspaceInfo` still names workspace A. The effect runs in the next change-detection pass, after both are set.

This mechanism:

- re-creates only the configuration surface, so `CanvasStore`, the auth flag and the shell UI state survive;
- also works for the bare outlet (branch 2);
- touches neither `app-shell.*` nor a `RouteReuseStrategy`;
- keeps criterion 21 clean;
- moves one file into core: `surface-router.service.ts` and its spec join Batch 1, which becomes 4 files.

Update Decision 2 item 5, the Risks row at `:494`, the Data-flow step 5 (`:423`) and the TASK_2026_533 note (`:473`): the remount is an outlet re-activation, and the child-route URL is still preserved.

Spec coverage for this change:

- `surface-router.service.spec.ts`, using the repository's `surface-router-testing.ts` harness: assert a new component instance, the same URL, and no `NavigationStart` event.
- A child-route variant with a component-bearing parent and a child `<router-outlet>`, to prove that child outlets re-activate from their retained `children` contexts.

### R2-2. MAJOR - `batches.md` still encodes revision 1, and Batch 1 is marked IN_PROGRESS

**Evidence.** `batches.md:6-8` says it was written before `plan-review.md` existed. Task 1.1 (`batches.md:102-116`) still specifies revision 1's design:

- `recordSettledView` routing from both sites;
- the untyped `updateConfigurationSurfaceSlot`;
- `ConfigurationSurfaceSlot` as `Record<string, unknown>`;
- a stay-branch with no remount tick.

Revision 2 removed or replaced all four (`implementation-plan.md:134-215`). Batch 3 lists no `electron-shell.config-gate.spec.ts` and still frames R1 around `ptah-app-shell` mounting pre-workspace (`batches.md:63, 199`), which decision A removed.

**Failure scenario.** The Batch 1 executor implements the superseded seam. Batch 3 then compiles against exports that the revised plan no longer defines.

**Fix.** The team-leader re-derives `batches.md` from revision 2 plus this section before any executor runs. Revision 1 R1 is resolved by decision A; this section's R2-1 replaces the remount task.

### R2-3. OK (verified) - The Angular Router claims hold, including `loadChildren` child routes

- A destroyed outlet keeps `context.route` and only nulls `outlet` and `attachRef` (`_router-chunk.mjs:1277-1283`, called from `ngOnDestroy` at `:1738-1743`).
- A new outlet's `ngOnInit` calls `initializeOutletWithName`, which calls `activateWith(context.route, context.injector)` when a route is stored and nothing is attached (`:1747-1763`).
- A navigation that lands while no outlet exists stores `context.route` and activates only `if (context.outlet)` (`:2315-2318`).
- The injector comes from the route snapshot's `_environmentInjector` (`:1255-1257`), so lazy chunks resolve correctly.
- Child contexts live in `context.children`, which outlet destruction never clears. Re-created child outlets therefore re-activate their stored child routes, including a 533 `loadChildren` tree.
- The app has exactly one `<router-outlet>`, in `app-shell.component.html:48`. After decision A the bare outlet is the second, in a mutually exclusive `@if` branch, so there is never more than one primary outlet at a time.

### R2-4. MINOR - The focus effect steals focus from the control that caused the switch

**Evidence.** Decision 2 item 6 (`implementation-plan.md:305-321`) focuses the host on every tick change. Switches come from a workspace-sidebar button (`workspace-sidebar.component.ts:62`) or from a notification in the navbar (`notification-focus-coordinator.service.ts:41`). In both cases focus is on a live control, not lost. The design's focus rule applies when a navigation removes the focused element (`design-spec.md:63-68`).

**Fix.**

- Move focus to the host only when `document.activeElement` is `document.body` or is no longer connected, or when it was inside the destroyed surface (record `host.contains(activeElement)` before the remount).
- Add `outline-none` (or `focus:outline-none`) to the `tabindex="-1"` wrapper, so mouse clicks in empty canvas space do not paint a ring.
- With R2-1, the host wrapper stays. It just no longer wraps a keyed block.

### R2-5. MINOR - The activity-placement spec instruction is still wrong

**Evidence.** `implementation-plan.md:408, 451` still says "re-pin the three tab-count cases (`:130, 135, 142`) from 8 to 4". Those three cases assert that there is no activity ticker, no toast and no toast-width variable (`electron-shell.activity-placement.spec.ts:130, 135, 142`). There are no tab counts to re-pin.

**Fix.** Delete the re-pin instruction. The only required edit is the stub extension (`:86-92`): `openConfigurationSurface`, `configurationSurfaceRemountTick`, and a `hasWorkspaceFolders` backed by a writable signal.

### R2-6. MINOR - The finding 5 test pins the wrong case

**Evidence.** The plan's test case "`removeWorkspaceState`, then a configuration-surface settlement does not re-create the deleted slice" (`implementation-plan.md:448`) passes trivially, because `openViewInActiveSlice` refuses configuration ids. Finding 5 was about a **non**-configuration settlement, such as "Back to welcome" going to `chat`, which re-grants the owner at `app-state.service.ts:456` and re-seeds the slice at `:629-635`.

**Fix.** Pin the `chat` case as accepted behaviour. Keep the configuration-surface case as a second assertion.

### Rest of revision 2 (brief check)

- **Finding 1 write seam.** Correct. The constructor effect writes `openSurface` first, inside `untracked`, before the owner check (`implementation-plan.md:141-156`). `openViewInActiveSlice` refuses configuration ids, which covers all three callers (`:162-172`). `recordSettledSurface` performs no global write (`:175`). `setCurrentView` is byte-identical.
  - Optional: skip the `update` when `openSurface` is unchanged, to avoid a new state object on every navigation.
- **Three-branch gate** (`implementation-plan.md:257-279`). Correct and mutually exclusive. `RouterOutlet` must be added to the shell's `imports`: the shell has no `@angular/router` import today (`electron-shell.component.ts:18-58`).
  - The spec override `set: { imports: [] }` in `activity-placement.spec.ts:117-119` turns `<router-outlet>` into a custom element. The new gate spec that asserts branch 2 must either keep the real import or provide `provideRouter([])`.
- **First folder opened while the bare outlet shows a surface** (`:281`). The branch flip creates `ptah-app-shell` with a fresh outlet that re-activates the stored route (verified in R2-3). The stay-branch bump that follows (the coordinator runs after the folder list updates) then triggers one more remount.
  - With R2-1 that remount is only the surface component, so it is cheap.
  - With the plan's keyed host, the just-built canvas is torn down and rebuilt within the same user action.
  - Pin the flip in the gate spec either way.
- **Close the last workspace while a surface is open** (`:283`). Correct: only `hasWorkspaceFolders()` flips, and the bare outlet re-activates the stored route.
- **Batches.** Revision 2's suggested batches are file-disjoint and 6 files or fewer: A has 2 files, or 4 with R2-1; B has 5; C1 has 6; C2 has 5; C3 has 2. `batches.md` does not reflect them yet (R2-2).
