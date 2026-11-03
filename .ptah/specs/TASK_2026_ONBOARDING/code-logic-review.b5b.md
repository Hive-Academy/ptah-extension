# Code Logic Review — B5b (deletions, narrowed contracts, barrels, spec and e2e migration)

Scope: `git diff HEAD` on branch `feat/onboarding-module`, excluding the A5 page, `completion.component.ts(+spec)`, `onboarding-generate.fixtures.ts` and `onboarding-generate-visual.e2e.spec.ts`. Read-only. No checks were run.

## Verdict: REVISE — 6/10

Deletion and contract work is clean. Three e2e or shell defects need fixing before accept, and one e2e coverage reduction needs a decision.

| Metric | Value |
| --- | --- |
| Blocking | 0 |
| Major | 5 (F1-F5) |
| Minor | 5 (F6-F10) |

### Verified OK (with evidence)

- **Deleted list matches ledger.** 51 deletions = rows 1-48 and 52-53 minus the 2 `completion` files, plus the 3 e2e specs (rows 49-51). The rows 52-53 `generation-preview-modal` files are deleted.
- **No dangling references to deleted symbols.** A grep of every deleted symbol and selector over `apps` and `libs` leaves only comments, plus the stale string in F3. A relative-import resolution sweep over `setup-wizard`, `harness-builder` and `onboarding` finds nothing broken. Barrel export paths in `setup-wizard/src/{index,app}.ts` and `harness-builder/src/{index,services}.ts` all resolve.
- **Narrowed focus-router union.** `surface-focus-router.token.ts:5` is now `'onboarding' | 'mcp-apps'`. The only implementers are `OnboardingFocusRouter` and `AppsFocusRouter`. Both consumers in `chat-attention-host-message-handler.service.ts:277,409` map the legacy wire kind through `focusRouterKindFor`. No legacy `kind:` literal remains. VS Code and TUI do not use the union.
- **AD8 and AD9 hold.**
  - `PackHostScope` still has `'wizard'` (`pack-install.store.ts:21`).
  - `completionData` and `CompletionData.result` remain (`wizard-internal-state.ts:39`, `wizard-phase-generation.ts`).
  - Message handlers and `SetupGenerationOpenHandler` stay exported.
- **Dead-member sweep is safe.** It removed `activeStepConfig`, `canProceed`, `percentComplete`, `stepIndex` and `canJumpToStep`. The grep finds no other consumer: the other `stepIndex` hits are the provider wizard in `chat`. The `launchWizard` removal in `WizardRpcService` is safe. `SetupStatusStore.launchWizard`, `workspace-vitals.store` and the `setup-wizard:launch` RPC are untouched.
- **`harness:search-skills` and `create-skill` facades** (`HarnessRpcService`) are not in the diff.
- **`GenerationPreviewStore`.** `binding` is required (`generation-preview.store.ts:54,72`) and its only caller is `choose-agents.page.ts`. The unbound path and the create-only error branch are removed, matching addendum B5b additions. `previewGeneration` has no other caller.
- **`app.routes.ts`.**
  - The legacy `setup-wizard`, `harness-builder` and `setup-hub` paths are removed, and `**` redirects to chat.
  - Legacy saved routes are normalised to `/onboarding` by `SurfaceRouterService.normalizeRestoredRoute` (`surface-router.service.ts:236-246`).
  - `SWITCH_VIEW` and `initialView` go through `resolveSurfaceAlias` (`app-state.service.ts:642`, `initial-navigation.ts:126`; table at `webview-surface.types.ts:104-109`).
  - No orphaned path 404s.
- **Selectors checked against the onboarding templates.** All of these exist:
  - `ptah-onboarding-home`, `ptah-onboarding-shell`, `ptah-proposal-workspace-page`.
  - `onboarding-path-<analyze|new-project|team-builder>` and the `onboarding-path-link-*` ids (`path-tile.component.ts:48,67`).
  - `ready-claude-step`, `ready-continue-anyway`, `ready-settings-step`, `ready-settings-skip`, `onboarding-shell`, `onboarding-back-to-chat`.
  - `new-project-intake`, `proposal-workspace`, `details-log-summary`, `#project-what`.
  - `config-menu-item-setup-hub` (`electron-shell.component.ts:303`, `global-config-actions.component.ts:40`).
- **`onboarding.spec.ts` asserts what the addendum asks** (prereqs addendum `:1255`):
  - The first-run redirect lands on `/onboarding/ready`.
  - Continue anyway leads to `/onboarding/ready/settings`.
  - Skip for now reaches Home.
  - Menu re-entry lands on Home.
  - `localStorage` key `ptah.onboarding.v1` matches `ONBOARDING_FLAG_KEY`.

## Findings

### F1 (major) Showcase and pre-warm helpers target a hook that does not exist

- Evidence: `apps/ptah-electron-e2e/src/showcase/_harness/config-menu.ts:4,12-14` and `setup-wizard-tour.scene.ts:6`.
- `ConfigSurfaceId` became `'onboarding'`, but `itemFor()` builds `[data-test="config-menu-item-${id}"]`. The real hook stays `config-menu-item-setup-hub`, because the item has `id: 'onboarding', testId: 'setup-hub'` (`global-config-actions.component.ts:85`). Only `activeConfigSurface` was mapped correctly (`:61`).
- Scenario:
  - `openConfigSurface(page, director, 'onboarding')` waits for `config-menu-item-onboarding`, which never appears, so the tour scene times out.
  - `openConfigSurfaceSilently(page, 'onboarding')` returns `false`, so `prewarm.ts` origin restore silently skips Setup.
- Fix: add an `id -> hook` map in `config-menu.ts`, for example `onboarding: 'setup-hub'`, used by `itemFor`. Alternatively keep the ConfigSurfaceId as `'setup-hub'`.

### F2 (major) `new-project.spec.ts` asserts text the alert does not contain

- Evidence: `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:8-10` against `libs/frontend/onboarding/src/lib/proposal/new-project-intake.page.ts:79-92,107-110,259-263`.
- The spec expects `getByRole('alert')` to contain `'Describe what you want to build.'`. That string is a plain `<p id="project-what-error">`, not an alert. The `role="alert"` block lists `'What are you building is required.'`.
- Scenario: the first test fails as soon as it is run. `getByRole('alert')` may also hit more than one alert in strict mode.
- Fix: assert `locator('#project-what-error')` for the first message, or the alert for `'What are you building is required.'`. Scope the alert to `new-project-intake`.

### F3 (major) Stale string reference to the deleted `ptah-harness-builder-view` makes the leave dialog inert the whole app

- Evidence: `libs/frontend/harness-builder/src/lib/components/harness-builder-leave-dialog.component.ts:199`. The file was not touched by B5b.
- `ngAfterViewInit` walks up the DOM and sets `inert` on every sibling at each level, stopping only at a `ptah-harness-builder-view` ancestor. That element no longer exists. The dialog is now used by `proposal-workspace.page` and `new-project-intake.page`.
- Scenario:
  - The loop runs to `<html>`.
  - Every sibling of every ancestor is inerted: the Electron nav, config menu, toasts, other overlays.
  - Focus return is unchanged, but the user cannot reach anything outside the dialog.
  - The cleanup in `ngOnDestroy` only re-enables the elements it recorded.
  - Any sibling inerted earlier by another dialog is skipped by the `hasAttribute('inert')` check but is not restored.
- Fix:
  - Stop at the nearest `ptah-onboarding-shell` (or a `data-testid="proposal-workspace"` / intake host), and add a unit case for the boundary. This matches the old scope: "the builder view".
  - Alternatively inert only `host.closest('ptah-onboarding-shell')` descendants.

### F4 (major) New-project e2e coverage was cut to 2 tests plus 1 trivial test with no replacement elsewhere

- Evidence: `specs/harness/new-project*.spec.ts` (135 lines now, against about 1000 before) and `new-project-intake.page.spec.ts` (4 tests).
- Dropped without an equivalent unit or e2e test:
  - The `platform: 'dotnet'` wire payload.
  - The untouched-platform payload.
  - The "other" stack free-text gate. The page spec covers submit validation only.
  - Reload and route restore of a normal chat session.
  - Resume returning to the same tab.
  - TASK_2026_317 "a session this surface never claimed does not steal the panel".
  - The "resume navigates after a direct view switch" case.
  - The dotnet spec no longer submits anything. It only clicks chips and fills a textarea.
- Scenario: the intake/wire-contract and ownership-routing regressions these specs pinned can return unnoticed. The B5b report's old-spec-migration row implies they were migrated.
- Fix: restore at least the dotnet submit payload and the foreign-session-not-stolen cases against the new pages. Alternatively add unit cases in `new-project-intake.page.spec.ts` and `proposal-flow.store.spec.ts`. Record in the report which behaviours are intentionally dropped.

### F5 (major, unverified without a run) Electron e2e suite has no first-run flag seed

- Evidence:
  - `support/fixtures.ts:58` launches with a fresh user-data dir (`support/electron-launcher.ts:126-127`).
  - The `ui` fixture only calls `prepare()` and never seeds `ptah.onboarding.v1` (`grep onboarding` in `support/` finds only `ui-driver.ts` surface ids).
  - `onboardingFirstRunGuard` redirects an eligible Electron boot from `/chat` to `/onboarding/ready` (`onboarding-first-run.guard.ts`).
- Scenario: specs that boot and expect chat or welcome without a `goto`, such as `config-menu-welcome-gate.spec.ts` (expects `ptah-electron-welcome` after `setState({})` and reload), land on Get ready instead. Specs using `ui.goto('chat')` recover because `shownAt` is now written.
- Fix:
  - Seed `localStorage['ptah.onboarding.v1']` with a written flag in the `ui` fixture or `launchPtah` init script by default.
  - `onboarding.spec.ts` then opts out by removing it.
  - Confirm with one scoped e2e run, with user permission.

### F6 (minor) Layout regression guard dropped

- Evidence: `apps/ptah-extension-webview/src/app/app.routes.spec.ts` (removed block "bounds the Electron outer row and configuration host").
- It asserted `min-h-0` on the shell's row and `configuration-surface-host`, which is a general guard not tied to the deleted builder. The remaining shell specs (`electron-shell.config-gate`, `view-transition`) do not assert those classes (grep).
- The route-state round trip (`navigateByUrl` and restore) for parameterised routes was also dropped. `surface-route-persistence.spec` / `boot-navigation.spec` cover the generic case.
- Fix: move the class assertion into an `electron-shell` spec.

### F7 (minor) Bundle-boundary specs are source-text only

- `unit5-message-routing.spec.ts` ("initial setup bundle boundary") reads `app.routes.ts` and the harness-builder barrel and checks that the three names are absent. It would not catch an eager import added to `app.config.ts` or another file. The text check also passes trivially.
- `setup-wizard-entry.spec.ts` dropped `app.routes.ts` from the narrow-entry guard (`it.each(['app.config.ts'])`). Reintroducing a wide-barrel import there is no longer caught.
- Fix: keep `app.routes.ts` in the list. Optionally add `app.config.ts` to the harness-builder barrel check.

### F8 (minor) Showcase narration is stale for the new scene

- `showcase/scripts/setup-wizard-tour.json` is unchanged. It has 13 lines, so the indexes line up. The text still narrates the old wizard ("seven guided steps", "choose which model runs your analysis", "one click kicks off the pipeline") while `setup-wizard-tour.scene.ts` highlights the three Home tiles.
- Fix: rewrite the lines to match the tiles, or note that the video is deferred.

### F9 (minor) `onboarding.spec.ts` hardening

- Line 20: `toHaveURL(/\/chat(?:[?#]|$)/)` fails if `setCurrentView('chat')` restores `/chat/<tabId>`.
- The Get ready state depends on unmocked `agent:detectClis` and `provider:getAmbientClaudeStatus`. They return the fixture default `{}`, so "Continue anyway" depends on a not-ready derivation. Mock them explicitly.
- The "redirect once" claim is not asserted. After Home, reload and expect no redirect.

### F10 (minor) Stale comments naming deleted components

- `apps/ptah-electron/src/services/electron-setup-wizard.service.ts:56` (WizardViewComponent).
- `libs/frontend/core/src/lib/services/app-state.service.ts:684` (HarnessBuilderViewComponent).
- `libs/frontend/mcp-apps-page/src/lib/components/apps-transcript.component.ts:44`.
- `libs/frontend/setup-wizard/src/lib/services/generation-preview.store.ts:39` ("provided by AgentSelectionComponent").
- `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts:17` (ScanProgressComponent).
- `apps/ptah-electron-e2e/src/specs/tasks/message-handlers-eager.spec.ts:11`.
- Several explanatory barrel and route comments (TASK_2026_701 deferral rationale) were collapsed to one line.

## Parity walk (deleted file to new home)

Spot-checked against the code, not only the report table. Each has a live owner:

- **Saved analyses list and use:** `analysis-step.store.ts`, `analyze-workspace.page.ts`, `choose-agents.page.ts`.
- **Host close message:** `SETUP_WIZARD_COMPLETE` is now posted at `analyze-done.page.ts:286`, and still at `completion.component.ts:460` until that file is deleted.
- **Notification focus:** `OnboardingFocusRouter` plus `focusRouterKindFor`.
- **Builder leave and stop dialog:** `HarnessBuilderLeaveDialogComponent`, reused (see F3).
- **Sidebar sections:** the kept sections have live consumers in `proposal-workspace.page`, `proposal-panel`, `details-log` and `review-apply.page`. Nothing is orphaned.
- **Report parity table:** 88 mapped rows against 145 + 38 table lines in the two inventories. I could not verify every row. No capability in the deleted files without a home was found beyond F4's e2e behaviours.
- **P17-P19 / P22 gap:** acknowledged and excluded as a parallel lane (the `completion.component.ts` retention is correct meanwhile).

## Five logic questions (short)

1. **Silent failure:** the F1 selector mismatch makes the pre-warm skip silently (`false`). F3 fails silently as an over-broad `inert`.
2. **Unexpected user action:** opening the leave dialog freezes all app chrome (F3).
3. **Wrong answer:** F2 asserts the wrong text. F4 removes the check on `platform` payload.
4. **Dependency failure:** the Get ready spec depends on unmocked CLI detection RPCs (F9).
5. **Missing:** a first-run flag seed for the rest of the e2e suite (F5). A real bundle-boundary test (F7).

## Recommendation

REVISE. Fix F1-F3, decide F4 and F5, and tidy F6-F10 opportunistically. After that this batch is acceptable. The non-test code deletions and contract narrowing are correct as reviewed.

## Round 2

Scope: the fix lane's changes (codex implementer, reviewed in-process by Claude opus). Static read only; no checks run. The e2e specs were never executed, so selector correctness was verified by reading the onboarding templates.

### Verdict: APPROVE — 8/10

0 blocking, 0 major, 3 minor, plus 2 accepted deferrals.

### F1-F10 disposition

| Finding | Status | Evidence |
| --- | --- | --- |
| F1 | Fixed | `config-menu.ts:14-16` maps `onboarding` to the `setup-hub` hook in `itemFor`. `activeConfigSurface` (`:62`) maps it back. Both directions agree with `config-menu-item-setup-hub`. |
| F2 | Fixed | `new-project.spec.ts:9-13` scopes the alert to `new-project-intake` and expects the string rendered in the `role="alert"` summary (`new-project-intake.page.ts:79-92`, `errors()` at `:258-264`). |
| F3 | Fixed | `harness-builder-leave-dialog.component.ts:215` breaks at `ptah-onboarding-shell`. The unit case (`.spec.ts:149-169`) proves chrome outside the shell stays interactive and the inerted sibling is restored on destroy. All three users (intake, proposal workspace, team-builder-start) render inside the onboarding routes, so the boundary always exists. |
| F4 | Fixed | The coverage map in the fix report is backed by specs: dotnet payload (`new-project.spec.ts:49-82`), Other-stack gate (`:84-101`), reload restore (`:103-130`), resume after direct switch (`:132-165`), foreign-session isolation (`:167-end`). The old untouched-platform case is validly narrowed to `node-ts`. |
| F5 | Fixed | `fixtures.ts:49,127-133` seeds `{shownAt: <iso>}` by default. The payload matches the strict `onboardingFlagSchema` (`onboarding-flag.service.ts:15-22`) and key `ptah.onboarding.v1`. `onboarding.spec.ts:5` opts out with `test.use`. |
| F6 | Fixed | `app.routes.spec.ts:11-27`. The host regex hits the template element at `electron-shell.component.ts:459-462`, which has `min-h-0`. The row regex hits `:436-437`. Both are non-vacuous. |
| F7 | Partly fixed, accepted | Both `app.config.ts` and `app.routes.ts` are now in the narrow-entry guard (`setup-wizard-entry.spec.ts:27-40`), and `config` is added to the removed-view check (`unit5-message-routing.spec.ts:127-137`). A source-text guard remains. A full dependency-graph guard is a hardening item, not a defect. |
| F8 | Fixed on text, see R2-3 | `setup-wizard-tour.json` is rewritten, 13 lines, indexes intact. |
| F9 | Fixed | `onboarding.spec.ts` mocks both readiness RPCs, accepts a `/chat/<tab>` URL, and asserts reload stays on Home. |
| F10 | Deferred, accepted | Comment-only drift in files outside this round's scope. It does not change behaviour. Track it in the final cleanup batch (see R2-2). |

### Selector and route verification

All of these exist in the onboarding templates:

- `new-project-intake` (`new-project-intake.page.ts:43`), `#project-what`, `#project-stack-other`, `#project-stack-other-error`, and the fieldsets whose legends are `Platform` and `Stack`.
- The `Continue` submit button, the `.NET` option, and the `ASP.NET Core API only` label (`libs/shared/.../stack-profiles.ts:136`).
- `onboarding-resume-banners` (`onboarding-home.component.ts:111`). The `Continue new project` title and the `Resume` button live in the same `<section>` in `resume-banner.component.ts`, so the `..`/`..` hop used in `new-project.spec.ts` resolves to that section.
- Alert strings, `onboarding-path-link-new-project`, and the `ready-*` ids (verified in round 1).

The `Continue` button name does not collide in a fresh profile. It would collide with the "Continue your draft" button (`new-project-intake.page.ts:67`) if a draft existed. The specs always start clean, so that is not an issue today.

### Findings

1. **R2-1 (minor) Redundant and order-fragile setup in `onboarding.spec.ts:21-22`.** The fixture already ran `prepare()` with the flag unset. The test then sets mocks, removes the flag again, and calls `prepare()` again. That is harmless, but the first boot renders Get ready with the default `{}` RPC mocks, and the second reload relies on `mockRpc` statics persisting in the main process. Prefer a fixture hook to pre-register the mocks. Not blocking.
2. **R2-2 (minor) F10 comments remain.** They sit at `electron-setup-wizard.service.ts:56`, `app-state.service.ts:684`, `apps-transcript.component.ts:44`, `generation-preview.store.ts:39`, `wizard-analysis-runner.service.ts:17` and `message-handlers-eager.spec.ts:11`. Comment-only, so this is not blocking. Record it so a later batch removes it.
3. **R2-3 (minor) Tour narration and spotlight are off by one.** `setup-wizard-tour.scene.ts:17-25` pairs line 4 ("New project begins...") and line 5 ("Choose a platform and stack...") with the `analyze` tile. It pairs line 7 ("Team builder helps...") with the `newProject` tile, and line 8 ("You can move between these paths") with `teamBuilder`. The video would highlight the wrong tile. Realign to 3=analyze, 4-5=newProject, 7=teamBuilder, 8=home. This is cosmetic and the scene is unrun.

### Regressions from the fix

None found. The leave-dialog change narrows the inert scope. A user of the dialog outside an onboarding shell would again inert everything, but no such user exists (grep: only the three onboarding pages).

### Verification evidence

The fix report records the scoped verify runs: harness-builder passes, the webview test passes after the route guard correction, and e2e lint fails only on the accepted `git-watcher.spec.ts` `fs.watch` errors. I ran no checks myself.

### Residual uncertainty

Nothing in the e2e specs has been executed. RPC mock persistence across `prepare()` reloads, and the exact resume-banner population after a chat round trip (`new-project.spec.ts:132-165`), are the likeliest runtime surprises. One scoped e2e run, with user permission, would settle both.

## Restore-wait fix review

Review family: claude (implementer: codex)

Verdict: APPROVE, 8/10. Test run: `npm run verify -- -t test -p ptah-extension-webview -- --testPathPatterns=webview-routing` passed (exit 0, 1 task succeeded).

Findings

1. Hang analysis (Serious-to-Moderate, no blocker). `workspaceResolved` is set in the `finally` of `syncFromBackend` (electron-layout.service.ts:897-899), so it flips on success, failed RPC result, throw, no-workspace (`getInfo` empty), and a user-switch supersede. A newer sync (WORKSPACE_CHANGED during the first sync, handleMessage:~155-166) takes over the flip through `_latestSyncId`, so one sync always settles. The constructor calls `restoreLayout()` -> `syncFromBackend` (line ~164/804) and `initial-navigation.ts:58` injects the service, which instantiates it before the wait, so there is no ordering gap. The wait is bounded only by the RPC timeouts (`workspace:getInfo` then `workspace:switch`, up to about 30 s each, plus the persisted-folder fallback switch), so the worst case is longer than 30 s. `initial-navigation.ts:122` has no timeout of its own. During the wait `app.html` shows the boot spinner (`isInitializing()`), not the electron shell, so there is no blank or chat flash. Recommend an own cap (for example 35 s race, then proceed to `navigateToUrl`, which falls back to the host view) as defence in depth.
2. 'cancelled' on `router.navigated` (Moderate). Correct for a host SWITCH_VIEW or notification focus that landed during the wait, and `app.ts:114-116` ignores the result, so 'cancelled' is harmless to the caller. Residual risk: `router.navigated` is true after any navigation attempt, including one that failed or was rejected. In that case the boot returns 'cancelled' with nothing settled and the outlet could stay empty. `supersededByNewerNavigation()` already covers the in-flight case, so the `router.navigated` clause is only needed for the landed case. Suggest tightening: if `router.navigated` and the router URL is still the empty/initial URL, fall through to `navigateToHostSurface` instead of returning 'cancelled'. Low probability.
3. Validator after the flip (OK). `syncFromBackend` calls `coordinateWorkspaceSwitch` (electron-layout.service.ts:~516-584) before the `finally`. `WorkspaceCoordinator.switchWorkspace` runs `tabManager.switchWorkspace` in its synchronous prefix (workspace-coordinator.service.ts:~178, before the first `await`). `TabWorkspacePartitionService.switchWorkspace` (tab-workspace-partition.service.ts:194-213) sets `activeWorkspacePath` and the tab signals synchronously from already-held tab sets. So `findTabByIdAcrossWorkspaces` and `activeWorkspacePath` are current when the signal flips. If `workspace:switch` fails, `activeWorkspacePath` stays null, the validator still accepts a tab found in any set, and otherwise it returns 'failed' and the boot degrades to the host view. That is acceptable.
4. VS Code host (OK). `ElectronLayoutService` is `providedIn: 'root'` and already referenced via `useExisting` at app.config.ts:375. Its constructor is gated on `isElectron`, and `_workspaceResolved` starts true outside Electron. Minor: `toObservable` emits through an effect flush, so a VS Code saved onboarding `?tab` route waits one change-detection tick unnecessarily. Add `if (!layout.workspaceResolved())` before the `await` to short-circuit. No test covers the VS Code path.
5. Tests (OK, small gaps). The three new specs (webview-routing.spec.ts:~517-590) would fail before the fix: the first asserts the validator is not called before the flip, the third expects 'cancelled' where the old code navigated. The second is a regression guard for non-onboarding routes. Missing: a case where `workspaceResolved` flips and the tab is still absent (should fall back to the host view), and a VS Code (already-resolved) case with a tab route.

No blocking issues. Recommended follow-ups: own timeout for the wait (finding 1), short-circuit when already resolved (finding 4), tighten the `router.navigated` clause (finding 2).
