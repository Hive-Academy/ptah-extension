import { test, expect } from '../../support/fixtures';

test.describe('Canvas', () => {
  test('grid renders in grid mode', async ({ ui }) => {
    await ui.goto('canvas');

    const page = ui.page;

    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();
    await expect(page.locator('ptah-canvas-empty-state')).toBeVisible();
  });

  test('add + focus a tile', async ({ ui }) => {
    await ui.goto('canvas');

    const page = ui.page;

    await page.getByRole('button', { name: 'Create new session' }).click();

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const tile = page.locator('[data-testid="canvas-tile"]');
    await expect(tile).toHaveCount(1);

    const tileShell = tile.locator('.canvas-tile');
    await tileShell.click();
    await expect(tileShell).toHaveAttribute('data-focused', 'true');

    await ui.goto('chat');
    await ui.goto('canvas');

    await expect(page.locator('[data-testid="canvas-tile"]')).toHaveCount(1);
  });
});
