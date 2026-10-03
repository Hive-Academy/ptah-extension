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
    // The landing (default) tab is the consolidated Providers page: tab id
    // `claude-auth` is retained, but it renders `ptah-providers-settings`,
    // whose "Your connections" section carries `providers-connections-heading`.
    // (`assignments-heading` moved to the Orchestration tab in Batch 18, inside
    // the closed roles <details> since Batch 33; it is asserted below.)
    await expect(page.locator('ptah-providers-settings')).toBeVisible();
    await expect(page.locator('#providers-connections-heading')).toBeVisible();
    // Give the page's async section reads a beat to land so the shot shows
    // content, not skeletons. Best-effort: a profile with no configured
    // connection still shoots the page.
    await page
      .locator('[data-testid="provider-connection-card"]')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined);
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

      // The Background models heading lives inside the roles <details>, which is
      // closed by default (Batch 33). Open it before looking for the heading.
      await page.locator('[data-testid="background-roles-summary"]').click();
      await expect(
        page.locator('[data-testid="assignments-heading"]'),
      ).toBeVisible();
    }

    // NOT captured: `ptah-browser-settings` was deleted (Batch 44) and folded
    // into the MCP & browser card as "Allow localhost", while browser-automation/
    // launching-a-browser.mdx describes an executable path, a headless toggle and
    // a user-data dir. Shipping the panel under that prose would document three
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
