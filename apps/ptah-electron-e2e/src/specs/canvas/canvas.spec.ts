import { test, expect } from '../../support/fixtures';

test.describe('Canvas Rail', () => {
  test('Electron opens the Rail board after a persisted single-view preference', async ({ ui }) => {
    const page = ui.page;
    await page.evaluate(() => localStorage.setItem('ptah-layout-mode', 'single'));
    await ui.prepare();

    await expect(page.locator('ptah-canvas-rail-board:visible')).toBeVisible();
    await expect(page.locator('[data-testid="canvas-rail-empty-board"]')).toBeVisible();
    await expect(page.locator('ptah-tab-bar')).toHaveCount(0);
  });

  test('Rail shows its empty board and new-session action', async ({ ui }) => {
    await ui.goto('canvas');
    const page = ui.page;
    const empty = page.locator('[data-testid="canvas-rail-empty-board"]');
    await expect(empty).toBeVisible();
    await expect(empty.getByRole('heading', { name: 'No sessions on this board' })).toBeVisible();
    await expect(empty.getByRole('button', { name: 'New session' })).toBeVisible();
  });

  test('adds and focuses a Rail session across navigation', async ({ ui }) => {
    await ui.goto('canvas');
    const page = ui.page;
    await page.locator('[data-testid="canvas-new-session-anchor"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const card = page.locator('ptah-canvas-rail [data-rail-card]');
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.getByRole('region', { name: 'Focused session' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sessions' })).toBeVisible();

    await ui.goto('dashboard');
    await ui.goto('canvas');
    await expect(card).toHaveCount(1);
  });

  test('retains the Rail board and card across a settings round-trip', async ({ ui }) => {
    const page = ui.page;
    await ui.goto('canvas');
    await page.locator('[data-testid="canvas-new-session-anchor"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const board = page.locator('ptah-canvas-rail-board:visible');
    const card = board.locator('[data-rail-card]').first();
    await expect(card).toBeVisible();
    const marker = `retained-${Date.now()}`;
    await card.evaluate((el, value) => el.setAttribute('data-retained-marker', value), marker);

    await ui.goto('settings');
    await expect(page.locator('ptah-canvas-rail-board')).toHaveCount(0);
    await ui.goto('canvas');
    await expect(board).toBeVisible();
    await expect(card).toHaveAttribute('data-retained-marker', marker);
  });

  test('restores the Rail card across a workspace round-trip', async ({ ui }) => {
    const WS = 'C:\\ptah-e2e-ws';
    const WS_B = 'C:\\ptah-e2e-ws-b';
    const switchWorkspace = async (path: string, name: string) => {
      await ui.mockRpc({
        'workspace:getInfo': { folders: [path], activeFolder: path },
      });
      await ui.pushEvent({
        type: 'workspaceChanged',
        payload: { workspaceInfo: { path, name, type: 'workspace' } },
      });
    };
    await ui.mockRpc({ 'workspace:getInfo': { folders: [WS], activeFolder: WS } });
    await ui.goto('canvas');
    const page = ui.page;
    await page.locator('[data-testid="canvas-new-session-anchor"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const card = page.locator('ptah-canvas-rail [data-rail-card]');
    await expect(card).toHaveCount(1);
    await switchWorkspace(WS_B, 'ws-b');
    await expect(page.locator('[data-testid="canvas-rail-empty-board"]')).toBeVisible();
    await switchWorkspace(WS, 'ptah-e2e-ws');
    await expect(card).toHaveCount(1);
  });
});
