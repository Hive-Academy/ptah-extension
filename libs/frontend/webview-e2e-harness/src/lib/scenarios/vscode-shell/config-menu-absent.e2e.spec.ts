/**
 * E2E: TASK_2026_540 criterion 19 — the VS Code webview shows no
 * configuration menu and its navigation is unchanged.
 *
 * Uses the REAL `ptah-extension-webview` Angular bundle, the same artifact
 * both VS Code and Electron load, following `boot-progress.e2e.spec.ts` and
 * `../thoth/skills-lane-pickers.e2e.spec.ts` (read their doc comments before
 * changing the `ptahConfig` shape below).
 *
 * HOST CONFIG NOTE. `ptahConfig.isElectron` is left OUT below, matching the
 * "HOST CONFIG NOTE" in `skills-lane-pickers.e2e.spec.ts`: a real VS Code
 * webview host (`webview-html-generator.ts`) never sets it, and
 * `vscode.service.ts`'s default config has `isElectron: false` (`:82`). With
 * that, `app.html`'s `@if (isElectron()) { <ptah-electron-shell /> } @else {
 * <ptah-app-shell /> }` (`:54-58`) takes the VS Code branch — the same
 * branch this task's Electron-only change (context.md scope, task-
 * description.md "Out of scope") must not have touched.
 *
 * `GlobalConfigMenuComponent` is mounted only inside
 * `electron-shell.component.ts`'s `no-drag` cluster (Batch 4), never inside
 * `app-shell.component.ts` (guard verified by the team-leader's branch-guard
 * greps in `batches.md`, "no diff in app-shell.component.*"). This spec
 * proves that boundary holds against the real bundle, not just by grep.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';

async function installVSCodeHost(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      acquireVsCodeApi?: () => {
        postMessage: (msg: unknown) => void;
        getState: () => unknown;
        setState: (s: unknown) => void;
      };
      ptahConfig?: unknown;
    };
    if (typeof w.acquireVsCodeApi !== 'function') {
      return;
    }
    // Exact shape a real VS Code webview host injects: no `isElectron`.
    w.ptahConfig = {
      isVSCode: true,
      theme: 'dark',
      extensionUri: '',
      baseUri: '',
      iconUri: '',
      userIconUri: '',
      panelId: 'e2e-harness',
      platform: 'win32',
      initialView: 'chat',
    };
  });
}

test.use({ useAppBuild: true });

test.describe('webview > vscode-shell > no configuration menu', () => {
  test('the VS Code shell renders with no configuration menu, and SWITCH_VIEW navigation still works', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    const bridge = await installPostMessageBridge(page);
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

    // Navigation entry points VS Code depends on
    // (`app-shell.component.ts:336-364`) still work: the SWITCH_VIEW wire
    // contract is unconditional in `AppStateManager.handleMessage`
    // (`app-state.service.ts:307-317`), so it must still land Settings.
    await bridge.inject({ type: 'switchView', payload: { view: 'settings' } });
    await expect(page.locator('ptah-app-shell ptah-settings')).toBeVisible();
    await expect(
      page.locator('[data-test="config-menu-trigger"]'),
    ).toHaveCount(0);

    await bridge.inject({ type: 'switchView', payload: { view: 'thoth' } });
    await expect(page.locator('ptah-app-shell ptah-thoth-shell')).toBeVisible();
  });
});
