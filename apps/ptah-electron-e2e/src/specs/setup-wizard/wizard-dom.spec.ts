import { test, expect } from '../../support/fixtures';

test.describe('Setup wizard (DOM)', () => {
  test('first step renders', async ({ ui }) => {
    await ui.mockRpc({
      'license:getStatus': { isPremium: true },
      'wizard:list-analyses': { analyses: [] },
    });

    await ui.goto('setup-wizard');

    const page = ui.page;

    const step = page.locator('[data-testid="wizard-step"]');
    await expect(step).toBeVisible();
    await expect(step).toHaveAttribute('data-step', 'welcome');
    await expect(page.locator('ptah-welcome')).toBeVisible();
  });

  test('advance one step', async ({ ui }) => {
    await ui.mockRpc({
      'license:getStatus': { isPremium: true },
      'wizard:list-analyses': { analyses: [] },
    });

    await ui.goto('setup-wizard');

    const page = ui.page;

    const step = page.locator('[data-testid="wizard-step"]');
    await expect(step).toHaveAttribute('data-step', 'welcome');

    await page.getByRole('button', { name: 'Project Analysis' }).click();

    await page.locator('[data-testid="wizard-next-btn"]').click();

    await expect(step).toHaveAttribute('data-step', 'scan');
    await expect(page.locator('ptah-scan-progress')).toBeVisible();
  });
});
