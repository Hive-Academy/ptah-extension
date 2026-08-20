import { test, expect } from './_harness/docs-fixtures';
import { shoot } from './_harness/shooter';

/**
 * Workspace, settings and setup shots (TASK_2026_260).
 *
 * These surfaces are read-only to look at, so they are captured against a real
 * project — the workspace rail, settings sections and Setup Hub all read better
 * with a real folder name in them than with a temp directory.
 */
test.use({
  extraWorkspaceFolders: ['D:\\projects\\ptah-extension'],
});

test.describe('docs screenshots — workspace, settings, setup', () => {
  test('workspace rail and recent workspaces', async ({ page }) => {
    test.setTimeout(300_000);
    const rail = page.locator('ptah-workspace-sidebar');
    await expect(rail).toBeVisible();
    await page.waitForTimeout(1_000);

    await shoot(page, 'workspace-switcher', { crop: rail });
    // Same rail, same run: it IS the recent-workspaces list — the folders the
    // app restores on boot, with the active one highlighted.
    await shoot(page, 'recent-workspaces', { crop: rail });
  });

  test('settings landing page and theme picker', async ({ ui, page }) => {
    test.setTimeout(300_000);
    await ui.goto('settings');
    const settings = page.locator('ptah-settings');
    await expect(settings).toBeVisible();
    await expect(
      page.locator('[data-testid="settings-section-auth"]'),
    ).toBeVisible();
    await page.waitForTimeout(1_500);
    await shoot(page, 'settings-overview');

    // Agent Orchestration is a settings section, and the only surface in the
    // app that shows orchestration configuration.
    const orchestration = page.getByRole('button', {
      name: 'Agent Orchestration',
    });
    if (
      await orchestration
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await orchestration.first().click();
      // The section detects installed CLIs before it can render them; shooting
      // on the click captures "Loading agent config…".
      await expect(settings).not.toContainText('Loading agent config', {
        timeout: 30_000,
      });
      await page.waitForTimeout(1_500);
      await shoot(page, 'agents-orchestration', { crop: settings });
    }

    // NOT captured: `ptah-browser-settings` (Advanced tab) exists, but it holds
    // a single "Allow Localhost" toggle, while browser-automation/launching-a-
    // browser.mdx describes an executable path, a headless toggle and a
    // user-data dir. Shipping the panel under that prose would document three
    // controls the app does not have — the reference was removed instead, and
    // the prose drift left for a docs pass.

    // Theme picker, open, over the settings page.
    await page.locator('[aria-label="Change theme"]').first().click();
    const dropdown = page.locator('div.dropdown-content').first();
    await expect(dropdown).toBeVisible();
    await page.waitForTimeout(500);
    // Crop the open picker, not the 24px trigger: the list of themes is what
    // the page is describing.
    await shoot(page, 'theme-toggle', { crop: dropdown });
  });

  test('setup hub new project card', async ({ ui, page }) => {
    test.setTimeout(300_000);
    await ui.goto('setup-hub');
    await expect(page.locator('ptah-setup-hub')).toBeVisible();
    await page.waitForTimeout(1_500);

    const card = page.locator('[data-testid="new-project-card"]');
    await expect(card).toBeVisible();
    await shoot(page, 'setup-new-project', { crop: card });
  });
});
