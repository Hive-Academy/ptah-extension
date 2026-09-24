import { test, expect } from '../../support/fixtures';

/**
 * TASK_2026_540 — full keyboard operation of `GlobalConfigMenuComponent`
 * (criterion 6), driven against the real renderer instead of jsdom.
 *
 * `global-config-menu.component.spec.ts` already pins every one of these
 * behaviours with a stubbed `AppStateManager` and a synthetic
 * `triggerEventHandler('opened')` — the component spec's own comment notes
 * Floating UI does not run in jsdom, so `(opened)` never fires for real
 * there. This file is the "in a real browser/Electron" proof the batch
 * report carried to QA: Floating UI positioning, native `<button>` Enter/
 * Space activation, and focus movement all run for real here.
 */
test.describe('Global configuration menu — keyboard operation', () => {
  test('Enter opens the trigger, focuses the first item, and arrow keys move focus with wrap', async ({
    ui,
  }) => {
    const page = ui.page;
    const trigger = page.locator('[data-test="config-menu-trigger"]');
    const thoth = page.locator('[data-test="config-menu-item-thoth"]');
    const setupHub = page.locator('[data-test="config-menu-item-setup-hub"]');
    const marketplace = page.locator(
      '[data-test="config-menu-item-marketplace"]',
    );
    const settings = page.locator('[data-test="config-menu-item-settings"]');

    await trigger.focus();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(thoth).toBeVisible();
    await expect(thoth).toBeFocused();

    // Down wraps forward through all four items.
    await page.keyboard.press('ArrowDown');
    await expect(setupHub).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(marketplace).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(settings).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(thoth).toBeFocused();

    // Up from the first item wraps to the last.
    await page.keyboard.press('ArrowUp');
    await expect(settings).toBeFocused();
  });

  test('Space opens the trigger', async ({ ui }) => {
    const page = ui.page;
    const trigger = page.locator('[data-test="config-menu-trigger"]');
    await trigger.focus();

    await page.keyboard.press('Space');

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-test="config-menu-item-thoth"]')).toBeVisible();
  });

  test('Escape closes the menu and returns focus to the trigger', async ({
    ui,
  }) => {
    const page = ui.page;
    const trigger = page.locator('[data-test="config-menu-trigger"]');
    await trigger.click();
    const firstItem = page.locator('[data-test="config-menu-item-thoth"]');
    await expect(firstItem).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(firstItem).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('Enter on a focused item activates it, closes the menu, returns focus to the trigger, and sets aria-current', async ({
    ui,
  }) => {
    const page = ui.page;
    const trigger = page.locator('[data-test="config-menu-trigger"]');
    await trigger.click();

    await page.keyboard.press('ArrowDown'); // thoth -> setup-hub
    await expect(page.locator('[data-test="config-menu-item-setup-hub"]')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('ptah-app-shell ptah-setup-hub')).toBeVisible();
    await expect(page.locator('[data-test="config-menu-item-thoth"]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(
      page.locator('[data-test="config-menu-item-setup-hub"]'),
    ).toHaveAttribute('aria-current', 'true');
    await expect(
      page.locator('[data-test="config-menu-item-thoth"]'),
    ).not.toHaveAttribute('aria-current', 'true');
  });
});
