/**
 * E2E: TASK_2026_540 criterion 19 — the VS Code webview shows no
 * configuration menu. (The SWITCH_VIEW navigation checks that used to live
 * here were split into `./switch-view-navigation.e2e.spec.ts` — harness
 * rule: one assertion target per spec file.)
 *
 * Uses the REAL `ptah-extension-webview` Angular bundle, the same artifact
 * both VS Code and Electron load, following `boot-progress.e2e.spec.ts` and
 * `../thoth/skills-lane-pickers.e2e.spec.ts` (read their doc comments before
 * changing the `ptahConfig` shape in `./vscode-host.ts`).
 *
 * HOST CONFIG NOTE. `installVSCodeHost` (`./vscode-host.ts`) leaves
 * `ptahConfig.isElectron` out, so `app.html`'s
 * `@if (isElectron()) { <ptah-electron-shell /> } @else { <ptah-app-shell /> }`
 * (`:54-58`) takes the VS Code branch — the same branch this task's
 * Electron-only change (context.md scope, task-description.md "Out of
 * scope") must not have touched.
 *
 * `GlobalConfigMenuComponent` is mounted only inside
 * `electron-shell.component.ts`'s `no-drag` cluster (Batch 4), never inside
 * `app-shell.component.ts` (guard verified by the team-leader's branch-guard
 * greps in `batches.md`, "no diff in app-shell.component.*"). This spec
 * proves that boundary holds against the real bundle, not just by grep.
 */
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import { installVSCodeHost } from './vscode-host';

test.use({ useAppBuild: true });

test.describe('webview > vscode-shell > no configuration menu', () => {
  test('the VS Code shell renders with no configuration menu', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    // The bridge must still be installed before `installVSCodeHost` (the
    // app's boot needs the `acquireVsCodeApi` stub, and the host config is
    // only injected once that stub exists) — this spec just never injects.
    await installPostMessageBridge(page);
    await installVSCodeHost(page);
    await page.goto(fixtureServer.url);

    // No `boot:readinessChanged` push here, unlike the Electron
    // `boot-progress.e2e.spec.ts`: `app.ts:50-53` documents that VS Code
    // never receives one, so `bootStatus.isBlockingBoot()` stays false by
    // default and `isReady()` flips as soon as `handleInitialView()`
    // resolves (pure Router navigation, no RPC involved, `app.ts:131-148`).
    await expect(page.locator('ptah-app-shell')).toBeVisible();
    await expect(page.locator('ptah-electron-shell')).toHaveCount(0);
    await expect(
      page.locator('[data-test="config-menu-trigger"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-test^="config-menu-item-"]'),
    ).toHaveCount(0);
  });
});
