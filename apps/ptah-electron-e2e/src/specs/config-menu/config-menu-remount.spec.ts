import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/fixtures';

/**
 * TASK_2026_540 — "switch the active workspace while a configuration
 * surface is open" (implementation-plan.md Finding 3 / Revision 3
 * overrides): the surface stays on screen AND its component is re-created
 * (`SurfaceRouterService.remountActiveSurface()`, an outlet
 * deactivate/activateWith at the same URL) so it is built fresh against the
 * new workspace. `electron-shell.config-gate.spec.ts` cases 9-11 pin the
 * tick-to-remount wiring with a stubbed `SurfaceRouterService`; nothing
 * before this file proved the real `RouterOutlet` actually swaps the DOM
 * node in a live renderer. This was "carried to QA" as Batch 4 outcome item
 * 4 (RD/RJ).
 *
 * Recreation is proven the same way any black-box test proves DOM identity
 * changed: grab an `ElementHandle` to the surface's root element before the
 * switch, then confirm it has left `document` afterwards while a new
 * element matching the same locator has taken its place. This needs no
 * production-code hook and survives a refactor of the remount mechanism
 * itself.
 *
 * What this file does NOT prove: that every surface's own service-level
 * cache actually re-reads the NEW workspace's data (risk RD in
 * `batches.md`, e.g. `providers-settings-state.service.ts:1060-1065`). That
 * remains a per-surface manual spot check — see the "Remaining manual
 * checks" section of `test-report.md`.
 */

const SECOND_FOLDER = 'C:\\ptah-e2e-ws-2';

async function proveRecreated(
  page: Page,
  locator: Locator,
  switchToSecondFolder: () => Promise<void>,
): Promise<void> {
  await expect(locator).toBeVisible();
  const before = await locator.elementHandle();
  expect(before).not.toBeNull();

  await switchToSecondFolder();

  // The switch is debounced (SWITCH_DEBOUNCE_MS) and then awaits the
  // workspace:switch RPC, so the old element is still attached right after the
  // click. Poll until the remount has detached it.
  await expect
    .poll(() => page.evaluate((el) => document.contains(el), before))
    .toBe(false);
  await expect(locator).toBeVisible();
}

test.describe('Global configuration menu — remount on workspace switch', () => {
  test.beforeEach(async ({ ui }) => {
    // Seed a second workspace folder so there is somewhere to switch to.
    // `ui.prepare()` re-seeds startup config and reloads; `workspace:switch`
    // is already mocked `{ success: true }` by the `ui` fixture default.
    await ui.mockRpc({
      'workspace:getInfo': {
        folders: ['C:\\ptah-e2e-ws', SECOND_FOLDER],
        activeFolder: 'C:\\ptah-e2e-ws',
      },
    });
    await ui.prepare();
  });

  async function switchToSecondFolder(page: Page): Promise<void> {
    await page.getByTitle(SECOND_FOLDER).click();
  }

  test('Thoth: the surface stays and its component is re-created on a workspace switch', async ({
    ui,
  }) => {
    const page = ui.page;
    await page.locator('[data-test="config-menu-trigger"]').click();
    await page.locator('[data-test="config-menu-item-thoth"]').click();

    await proveRecreated(
      page,
      page.locator('ptah-app-shell ptah-thoth-shell'),
      () => switchToSecondFolder(page),
    );
    await expect(
      page.locator('[data-test="config-back-to-welcome"]'),
    ).toHaveCount(0);
  });

  test('Setup hub: the surface stays and its component is re-created on a workspace switch', async ({
    ui,
  }) => {
    const page = ui.page;
    await page.locator('[data-test="config-menu-trigger"]').click();
    await page.locator('[data-test="config-menu-item-setup-hub"]').click();

    await proveRecreated(
      page,
      page.locator('ptah-app-shell ptah-setup-hub'),
      () => switchToSecondFolder(page),
    );
  });

  test('Marketplace: the surface stays and its component is re-created on a workspace switch', async ({
    ui,
  }) => {
    const page = ui.page;
    await page.locator('[data-test="config-menu-trigger"]').click();
    await page.locator('[data-test="config-menu-item-marketplace"]').click();

    await proveRecreated(
      page,
      page.locator('ptah-app-shell ptah-marketplace-hub'),
      () => switchToSecondFolder(page),
    );
  });

  test('Settings: the surface stays and its component is re-created on a workspace switch', async ({
    ui,
  }) => {
    const page = ui.page;
    await page.locator('[data-test="config-menu-trigger"]').click();
    await page.locator('[data-test="config-menu-item-settings"]').click();

    await proveRecreated(
      page,
      page.locator('ptah-app-shell ptah-settings'),
      () => switchToSecondFolder(page),
    );
  });

  test('switching workspace while on a code-workspace surface (Chat) does not bump the remount tick or touch the router', async ({
    ui,
  }) => {
    // Negative control for app-state.service.spec.ts case 3 ("a later switch
    // with a code-workspace surface on screen does not bump the tick"):
    // the canvas grid stays mounted and no configuration surface appears.
    const page = ui.page;
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();

    await switchToSecondFolder(page);

    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();
    await expect(page.locator('[data-test="config-back-to-welcome"]')).toHaveCount(
      0,
    );
  });
});
