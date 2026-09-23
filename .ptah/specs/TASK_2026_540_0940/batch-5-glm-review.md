# Batch 5 - Glm review

Verdict: ACCEPT

Score: 9/10

Scope reviewed: `git diff -- apps/ptah-electron-e2e` (prewarm.ts, ui-driver.ts, thoth-tour.scene.ts, skills-tour.scene.ts, memory-recall.scene.ts), the new `apps/ptah-electron-e2e/src/showcase/_harness/config-menu.ts`, and the contracts they depend on: the committed `libs/frontend/chat/src/lib/components/molecules/global-config-menu.component.ts`, the working-tree `electron-shell.component.ts` (tab titles, tablist visibility, back-to-welcome button), `libs/frontend/core/src/lib/services/app-state.service.ts` (`currentView`, `openConfigurationSurface`), and `libs/frontend/core/src/lib/routing/surface-router.service.ts` (`currentSurface`). Runtime scene playback was not executed; the assessment is static.

## What was verified correct

- Selectors match the committed component exactly. `data-test="config-menu-trigger"` and `config-menu-item-<id>` (global-config-menu.component.ts:41, :67); ids `thoth | setup-hub | marketplace | settings` match the component's item list and the helper's `ConfigSurfaceId` union (config-menu.ts:4). `aria-current="true"` binds only on the active item (global-config-menu.component.ts:69-71), so `[data-test^="config-menu-item-"][aria-current="true"]` (config-menu.ts:70) identifies it. The `^="config-menu-item-"` prefix does not match `config-menu-trigger` or `config-back-to-welcome`.
- Recorded vs silent separation holds. `openConfigSurface` routes both clicks through `director.click` (config-menu.ts:16, :19), which records the camera beat (director.ts:480-488). Both silent helpers use raw Playwright actions only (config-menu.ts:23-90) and prewarm keeps raw clicks (prewarm.ts:68, :103) — the SILENT rule at prewarm.ts:16-21 is not violated.
- The silent helpers do not leave the menu open. `openConfigSurfaceSilently` and `activeConfigSurface` close any remaining visible menu in `finally` (config-menu.ts:59-61, :87-89). After a successful item click the component itself closes the menu (`selectItem` → `closeMenu`, global-config-menu.component.ts:150-154), so the cleanup `item.isVisible()` check is false and no Escape leaks into the destination surface.
- Restore preference order is correct. `currentView` comes from the router (`currentSurface`, app-state.service.ts:580-582), and the shell binds `aria-selected` only for `chat | tasks | tribunal | analytics` (electron-shell.component.ts:127-161). On a configuration surface no top-nav tab is selected, so `activeNavTitle` returns null (prewarm.ts:33-39) and the captured configuration id is used; on a nav tab the title is used. The two captures are mutually exclusive, so the `if (original) … else if (originalConfig)` order (prewarm.ts:75-79, :111-115) restores the true origin. The `surfaceOf` fix (surface-router.service.ts:185-189) rules out the old matrix-params misreport that would have broken this.
- No remaining clicks on removed tabs in the six files. `grep` for `name: 'Thoth'`, `name: 'Canvas'`, and `Orchestra Canvas` returned no matches in the six in-scope files. Remaining obsolete selectors live only in batch-6 files (cron-tour.scene.ts:64-65, gateway-tour.scene.ts:86, chat-code-edit.scene.ts:179-181, canvas-orchestra.scene.ts:44-45, landing-page-tour.scene.ts:242) — expected, out of scope.
- No `as any`, `@ts-ignore`, `@ts-expect-error`, or dead code in the diff. `prewarmNavSurface` has no callers but had none at HEAD either and is documented harness API (video-showcase scene-authoring.md), so keeping it is correct.
- Task 5.3 rename is exact: `getByRole('tab', { name: 'Chat' })` with `[title="Chat"]` fallback (ui-driver.ts:325-326) matches the shell tab (electron-shell.component.ts:124-128), and only the chat/canvas branch changed.
- Scene edits keep their downstream waits: thoth-tour keeps `#thoth-tab-memory` (thoth-tour.scene.ts:109), skills-tour keeps the skills-tab wait, Director click and panel wait (skills-tour.scene.ts:69-73), memory-recall keeps the memory-tab click and panel wait (memory-recall.scene.ts:66-69).
- Scoped typecheck and lint pass (orchestrator-run, confirmed in batch-5-report.md).

## Numbered findings

1. MINOR — `apps/ptah-electron-e2e/src/showcase/_harness/config-menu.ts:16-19`
   Failure scenario: the recorded `openConfigSurface` assumes the menu starts closed. The trigger is a toggle (global-config-menu.component.ts:112-114). If the menu is already open — possible only when a silent helper's Escape cleanup failed silently (`closeMenuSilently` swallows the press failure, config-menu.ts:41) — `director.click(TRIGGER)` closes it, and the following `item.waitFor({ state: 'visible' })` hangs for the default 30 s and fails the scene. The silent path already guards this case (config-menu.ts:25-26); the recorded path does not.
   Fix: before the trigger click, check whether an item is already visible and skip the trigger click in that case (mirror `openMenuSilently`), or press Escape first when the menu is open. Probability is low because it needs a double silent failure; severity stays MINOR.

2. MINOR — `apps/ptah-electron-e2e/src/showcase/_harness/prewarm.ts:92-94,111-115`
   Failure scenario: `prewarmThoth` can now navigate away from the no-workspace welcome screen. The menu trigger renders without workspace folders (electron-shell.component.ts:198) and Thoth mounts through the router outlet (electron-shell.component.ts:205-211). On the welcome screen both captures return null — `activeNavTitle` (no tablist) and `activeConfigSurface` (welcome is not a configuration surface) — so nothing is restored and the shell stays on Thoth. At HEAD this state was an unreachable no-op because the Thoth tab lived inside the workspace tablist. The current caller (thoth-tour.scene.ts:175) proceeds into Thoth on camera anyway, so the visible impact is nil today; the hazard is latent for future callers.
   Fix: when neither capture succeeds and the menu trigger is reachable, record a "welcome origin" and restore through `data-test="config-back-to-welcome"` (electron-shell.component.ts:184-197).

## Residual uncertainty

Runtime Electron scene playback and camera output were not executed for this review; the behavioural claims above rest on static tracing through the committed component and the working-tree shell, and on the passing scoped typecheck and lint.