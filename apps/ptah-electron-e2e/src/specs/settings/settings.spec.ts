import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';

async function openWebSearchSection(ui: UiDriver): Promise<void> {
  const page = ui.page;
  await page.getByRole('button', { name: 'Search & Voice' }).click();
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
      'webSearch:getConfig': { providers: ['tavily'], maxResults: 5 },
      'webSearch:getApiKeyStatus': { configured: false },
      'webSearch:setConfig': { success: true },
    });

    await ui.goto('settings');
    await openWebSearchSection(ui);

    const tavilyCheckbox = ui.page.locator(
      '[data-testid="settings-toggle-web-search-provider-tavily"]',
    );
    const serperCheckbox = ui.page.locator(
      '[data-testid="settings-toggle-web-search-provider-serper"]',
    );
    await expect(tavilyCheckbox).toBeVisible();
    await expect(tavilyCheckbox).toBeChecked();
    await expect(serperCheckbox).toBeVisible();
    await expect(serperCheckbox).not.toBeChecked();

    await serperCheckbox.check();

    const observed = await ui.waitForObservedCall('webSearch:setConfig');
    const params = observed.params as { providers?: string[] };
    expect(params.providers).toEqual(['tavily', 'serper']);

    await ui.mockRpc({
      'webSearch:getConfig': {
        providers: ['tavily', 'serper'],
        maxResults: 5,
      },
    });

    await expect(serperCheckbox).toBeChecked();
    await expect(tavilyCheckbox).toBeChecked();
  });

  test('two providers can be selected at once', async ({ ui }) => {
    await ui.mockRpc({
      'webSearch:getConfig': {
        providers: ['tavily', 'serper'],
        maxResults: 5,
      },
      'webSearch:getApiKeyStatus': { configured: false },
      'webSearch:setConfig': { success: true },
    });

    await ui.goto('settings');
    await openWebSearchSection(ui);

    const tavilyCheckbox = ui.page.locator(
      '[data-testid="settings-toggle-web-search-provider-tavily"]',
    );
    const serperCheckbox = ui.page.locator(
      '[data-testid="settings-toggle-web-search-provider-serper"]',
    );
    const exaCheckbox = ui.page.locator(
      '[data-testid="settings-toggle-web-search-provider-exa"]',
    );

    await expect(tavilyCheckbox).toBeVisible();
    await expect(tavilyCheckbox).toBeChecked();
    await expect(serperCheckbox).toBeVisible();
    await expect(serperCheckbox).toBeChecked();
    await expect(exaCheckbox).toBeVisible();
    await expect(exaCheckbox).not.toBeChecked();
  });
});
