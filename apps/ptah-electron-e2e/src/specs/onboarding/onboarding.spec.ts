import { test, expect } from '../../support/fixtures';

test.use({ onboardingAlreadyShown: false });

test('first run reaches Ready, can be skipped, and the menu reopens Home', async ({
  ui,
}) => {
  const page = ui.page;
  await ui.mockRpc({
    'agent:detectClis': {
      clis: [{ cli: 'claude', installed: false, messagingMode: 'none' }],
    },
    'provider:getAmbientClaudeStatus': {
      ok: true,
      status: {
        state: 'unknown',
        checkedAt: '2026-10-29T09:00:00.000Z',
        reason: 'cli-missing',
      },
    },
  });
  await page.evaluate(() => localStorage.removeItem('ptah.onboarding.v1'));
  await ui.prepare();

  await expect(page.getByTestId('ready-claude-step')).toBeVisible();
  await page.getByTestId('ready-continue-anyway').click();

  await expect(page.getByTestId('ready-settings-step')).toBeVisible();
  await page.getByTestId('ready-settings-skip').click();

  // Reload proves skipping was persisted: the first-run Ready step stays gone.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('ptah-orchestra-canvas')).toBeVisible();
  await expect(page.getByTestId('ready-claude-step')).toHaveCount(0);

  // Home is deliberately not persisted; reopen it through the shell menu.
  await page.locator('[data-test="config-menu-item-setup-hub"]').click();
  await expect(page.getByTestId('onboarding-shell')).toBeVisible();

  await page.getByTestId('onboarding-back-to-chat').click();
  await expect(page.getByTestId('onboarding-shell')).toHaveCount(0);
  await expect(page.locator('ptah-orchestra-canvas')).toBeVisible();
  await page.locator('[data-test="config-menu-item-setup-hub"]').click();
  await expect(page.locator('ptah-onboarding-home')).toBeVisible();
});
