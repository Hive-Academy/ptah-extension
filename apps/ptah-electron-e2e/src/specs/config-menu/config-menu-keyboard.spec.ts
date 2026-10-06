import { test, expect } from '../../support/fixtures';

/**
 * Keyboard operation of the global configuration entry points, driven against
 * the real renderer: the Thoth / Marketplace / Settings icon buttons
 * (`GlobalConfigActionsComponent`) and the Setup hub navbar tab. They are
 * native `<button>`s, so Enter and Space activation run for real here.
 */
test.describe('Global configuration actions — keyboard operation', () => {
  test('Enter on the focused Setup hub tab opens it and marks it current', async ({
    ui,
  }) => {
    const page = ui.page;
    const setupHub = page.locator('[data-test="config-menu-item-setup-hub"]');

    await setupHub.focus();
    await expect(setupHub).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('ptah-app-shell ptah-setup-hub')).toBeVisible();
    await expect(setupHub).toHaveAttribute('aria-current', 'true');
    await expect(
      page.locator('[data-test="config-menu-item-thoth"]'),
    ).not.toHaveAttribute('aria-current', 'true');
  });

  test('Space on the focused Settings icon button opens Settings and marks it current', async ({
    ui,
  }) => {
    const page = ui.page;
    const settings = page.locator('[data-test="config-menu-item-settings"]');

    await settings.focus();
    await expect(settings).toBeFocused();
    await page.keyboard.press('Space');

    await expect(settings).toHaveAttribute('aria-current', 'true');
    await expect(settings).toBeFocused();
  });
});
