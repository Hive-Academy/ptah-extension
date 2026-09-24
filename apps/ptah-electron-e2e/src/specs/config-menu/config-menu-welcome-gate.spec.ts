import { test, expect } from '../../support/fixtures';

/**
 * TASK_2026_540 — the three-branch gate in `electron-shell.component.ts`
 * (welcome / bare `<router-outlet>` / 3-panel area) and the global
 * configuration menu that reaches it. These flows were "carried to QA" in
 * `batches.md` (Batch 4 outcome, items 1-3): the unit-level
 * `electron-shell.config-gate.spec.ts` pins the gate with stubbed services,
 * but nothing before this file drove the real Electron renderer through the
 * gate flips against a real `AppStateManager` and a real
 * `ElectronLayoutService`.
 *
 * Starting from "no workspace" reuses the same two steps every first-launch
 * spec in this suite uses (`setup-wizard.spec.ts`): clear the persisted
 * webview state via `rpcBridge.setState({})` so `restoreLayout()`'s
 * `cachedState` fallback (`electron-layout.service.ts:701-712`) cannot
 * resurrect the `ui` fixture's default folder, then remock
 * `workspace:getInfo` to zero folders and reload via `ui.prepare()`.
 */
test.describe('Global configuration menu — welcome gate', () => {
  test('no folder open: Settings via the menu, then Back to welcome returns to the welcome screen', async ({
    ui,
    rpcBridge,
  }) => {
    await rpcBridge.setState({});
    await ui.mockRpc({
      'workspace:getInfo': { folders: [], activeFolder: null },
    });
    await ui.prepare();

    const page = ui.page;
    await expect(page.locator('ptah-electron-welcome')).toBeVisible();

    const trigger = page.locator('[data-test="config-menu-trigger"]');
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page.locator('[data-test="config-menu-item-settings"]').click();

    await expect(page.locator('ptah-settings')).toBeVisible();
    await expect(page.locator('ptah-electron-welcome')).toHaveCount(0);
    const back = page.locator('[data-test="config-back-to-welcome"]');
    await expect(back).toBeVisible();

    await back.click();

    await expect(page.locator('ptah-electron-welcome')).toBeVisible();
    await expect(page.locator('ptah-settings')).toHaveCount(0);
    await expect(back).toHaveCount(0);
  });

  test('no folder open, no auth: Settings via the menu, then Back to welcome still returns to welcome', async ({
    ui,
    rpcBridge,
  }) => {
    await rpcBridge.setState({});
    await ui.mockRpc({
      'workspace:getInfo': { folders: [], activeFolder: null },
      'auth:getAuthStatus': {
        authMethod: null,
        hasApiKey: false,
        availableProviders: [],
        anthropicProviderId: null,
      },
    });
    await ui.prepare();

    const page = ui.page;
    await expect(page.locator('ptah-electron-welcome')).toBeVisible();

    await page.locator('[data-test="config-menu-trigger"]').click();
    await page.locator('[data-test="config-menu-item-settings"]').click();
    await expect(page.locator('ptah-settings')).toBeVisible();

    await page.locator('[data-test="config-back-to-welcome"]').click();
    await expect(page.locator('ptah-electron-welcome')).toBeVisible();
  });

  test('closing the last workspace while on Settings keeps Settings open and shows Back to welcome', async ({
    ui,
  }) => {
    // The `ui` fixture already boots with one workspace folder
    // ('C:\ptah-e2e-ws') and the 3-panel layout (fixtures.ts:107-110).
    const page = ui.page;
    await expect(page.locator('ptah-app-shell')).toBeVisible();

    await page.locator('[data-test="config-menu-trigger"]').click();
    await page.locator('[data-test="config-menu-item-settings"]').click();
    await expect(page.locator('ptah-settings')).toBeVisible();

    await page.getByRole('button', { name: 'Remove workspace' }).click();

    // Gate flip 3 -> 2 (electron-shell.config-gate.spec.ts case 7): the bare
    // outlet replaces the 3-panel area, Settings stays mounted, and the
    // welcome screen does NOT show because a configuration surface is open.
    await expect(page.locator('ptah-settings')).toBeVisible();
    await expect(page.locator('[data-test="config-back-to-welcome"]')).toBeVisible();
    await expect(page.locator('ptah-app-shell')).toHaveCount(0);
    await expect(page.locator('ptah-electron-welcome')).toHaveCount(0);
  });

  test('opening the first folder while a configuration surface is open moves the surface into the 3-panel area', async ({
    ui,
    rpcBridge,
  }) => {
    await rpcBridge.setState({});
    await ui.mockRpc({
      'workspace:getInfo': { folders: [], activeFolder: null },
    });
    await ui.prepare();

    const page = ui.page;
    await expect(page.locator('ptah-electron-welcome')).toBeVisible();

    await page.locator('[data-test="config-menu-trigger"]').click();
    await page.locator('[data-test="config-menu-item-marketplace"]').click();
    await expect(page.locator('ptah-marketplace-hub')).toBeVisible();
    await expect(page.locator('ptah-app-shell')).toHaveCount(0);

    // Simulate the first folder landing from outside the app (Explorer/
    // Finder "Open Folder", or the OS-level open dialog) the same way
    // `ui-driver.ts`'s private `syncWorkspace()` does for every other spec:
    // remock the backend answer, then push the WORKSPACE_CHANGED broadcast
    // (`electron-layout.service.ts:96-113`) that makes the renderer re-fetch it.
    await ui.mockRpc({
      'workspace:getInfo': {
        folders: ['C:\\ptah-e2e-ws'],
        activeFolder: 'C:\\ptah-e2e-ws',
      },
      'workspace:switch': { success: true },
    });
    await ui.pushEvent({ type: 'workspaceChanged', payload: {} });

    // Gate flip 2 -> 3 (RB, electron-shell.config-gate.spec.ts case 6): the
    // 3-panel area replaces the bare outlet, the surface stays (no error,
    // no fall-back to chat), and the back button disappears with it.
    await expect(page.locator('ptah-app-shell')).toBeVisible();
    await expect(page.locator('ptah-app-shell ptah-marketplace-hub')).toBeVisible();
    await expect(
      page.locator('[data-test="config-back-to-welcome"]'),
    ).toHaveCount(0);
  });
});
