/**
 * E2E: TASK_2026_540 criterion 19 — under the real VS Code webview host,
 * SWITCH_VIEW host messages still route to the Settings and Thoth surfaces
 * without spawning a configuration menu.
 *
 * Split out of `./config-menu-absent.e2e.spec.ts` (harness rule: one
 * assertion target per spec file). Same host setup as that spec: the REAL
 * `ptah-extension-webview` bundle with `installVSCodeHost`
 * (`./vscode-host.ts`) injecting the VS Code host config (no `isElectron`).
 */
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import { installVSCodeHost } from './vscode-host';

test.use({ useAppBuild: true });

test.describe('webview > vscode-shell > switch view navigation', () => {
  test('SWITCH_VIEW messages still route to Settings and Thoth', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    const bridge = await installPostMessageBridge(page);
    await installVSCodeHost(page);
    await page.goto(fixtureServer.url);

    // Same boot conditions as `./config-menu-absent.e2e.spec.ts`: no
    // `boot:readinessChanged` push (VS Code never receives one,
    // `app.ts:50-53`), so the shell is interactive as soon as
    // `handleInitialView()` resolves.
    await expect(page.locator('ptah-app-shell')).toBeVisible();

    // Navigation entry points VS Code depends on
    // (`app-shell.component.ts:336-364`) still work: the SWITCH_VIEW wire
    // contract is unconditional in `AppStateManager.handleMessage`
    // (`app-state.service.ts:307-317`), so it must still land Settings —
    // and still without a configuration menu.
    await bridge.inject({ type: 'switchView', payload: { view: 'settings' } });
    await expect(page.locator('ptah-app-shell ptah-settings')).toBeVisible();
    await expect(
      page.locator('[data-test="config-menu-trigger"]'),
    ).toHaveCount(0);

    await bridge.inject({ type: 'switchView', payload: { view: 'thoth' } });
    await expect(page.locator('ptah-app-shell ptah-thoth-shell')).toBeVisible();
  });
});
