import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';

async function openWebSearchSection(ui: UiDriver): Promise<void> {
  const page = ui.page;
  await page.getByRole('button', { name: 'Ptah AI' }).click();
  await page.getByRole('button', { name: 'Pro Features' }).click();
  await expect(page.locator('ptah-web-search-config')).toBeVisible();
}

test.describe('Settings', () => {
  test('settings renders', async ({ ui }) => {
    await ui.goto('settings');

    const page = ui.page;

    await expect(page.locator('ptah-settings')).toBeVisible();
    await expect(
      page.locator('[data-testid="settings-section-auth"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="settings-back"]')).toBeVisible();
  });

  test('toggle persists (round-trip)', async ({ ui }) => {
    await ui.mockRpc({
      'webSearch:getConfig': { provider: 'tavily', maxResults: 5 },
      'webSearch:getApiKeyStatus': { configured: false },
      'webSearch:setConfig': { success: true },
    });

    await ui.goto('settings');
    await openWebSearchSection(ui);

    const select = ui.page.locator(
      '[data-testid="settings-toggle-web-search-provider"]',
    );
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('tavily');

    await select.selectOption('serper');

    const observed = await ui.waitForObservedCall('webSearch:setConfig');
    const params = observed.params as { provider?: string };
    expect(params.provider).toBe('serper');

    await ui.mockRpc({
      'webSearch:getConfig': { provider: 'serper', maxResults: 5 },
    });

    await expect(select).toHaveValue('serper');
  });
});
