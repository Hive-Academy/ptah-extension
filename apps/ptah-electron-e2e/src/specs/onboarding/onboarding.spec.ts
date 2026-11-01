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

  await expect(page).toHaveURL(/\/onboarding\/ready(?:[?#]|$)/);
  await expect(page.getByTestId('ready-claude-step')).toBeVisible();
  await page.getByTestId('ready-continue-anyway').click();

  await expect(page).toHaveURL(/\/onboarding\/ready\/settings(?:[?#]|$)/);
  await expect(page.getByTestId('ready-settings-step')).toBeVisible();
  await page.getByTestId('ready-settings-skip').click();

  await expect(page).toHaveURL(/\/onboarding(?:[?#]|$)/);
  await expect(page.getByTestId('onboarding-shell')).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/onboarding(?:[?#]|$)/);

  await page.getByTestId('onboarding-back-to-chat').click();
  await expect(page).toHaveURL(/\/chat(?:\/[^?#]+)?(?:[?#]|$)/);
  await page.locator('[data-test="config-menu-item-setup-hub"]').click();
  await expect(page).toHaveURL(/\/onboarding(?:[?#]|$)/);
  await expect(page.locator('ptah-onboarding-home')).toBeVisible();
});
