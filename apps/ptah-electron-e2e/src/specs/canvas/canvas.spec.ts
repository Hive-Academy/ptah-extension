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

  test('keeps a tile mounted (no remount) across a workspace round-trip', async ({
    ui,
  }) => {
    const WS = 'C:\\ptah-e2e-ws';
    const WS_B = 'C:\\ptah-e2e-ws-b';

    // The frontend resolves the active workspace from the backend (workspace:getInfo),
    // not from the pushed event payload — the `workspaceChanged` message is only a
    // nudge to re-sync. So each switch mocks the backend to report the target folder
    // as active, then pushes the event to trigger the re-sync.
    const switchWorkspace = async (path: string, name: string) => {
      await ui.mockRpc({
        'workspace:getInfo': { folders: [path], activeFolder: path },
      });
      await ui.pushEvent({
        type: 'workspaceChanged',
        payload: { workspaceInfo: { path, name, type: 'workspace' } },
      });
    };

    // Seed the original workspace so the tile is created under a real path
    // (not the implicit-bootstrap bucket, which would migrate on the first switch).
    await ui.mockRpc({
      'workspace:getInfo': { folders: [WS], activeFolder: WS },
    });
    await ui.goto('canvas');

    const page = ui.page;

    await page.getByRole('button', { name: 'Create new session' }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const tile = page.locator('[data-testid="canvas-tile"]');
    await expect(tile).toHaveCount(1);

    // Stamp a unique marker on the live tile DOM node. If a workspace switch
    // tears the tile down and rebuilds it, the node (and marker) is gone.
    const marker = `keepalive-${Date.now()}`;
    await tile
      .first()
      .evaluate(
        (el, value) => el.setAttribute('data-keepalive-marker', value),
        marker,
      );

    // Switch to a different (empty) workspace — the current grid hides but stays
    // mounted — then switch back to the original workspace.
    await switchWorkspace(WS_B, 'ws-b');
    await expect(page.locator('ptah-canvas-empty-state')).toBeVisible();

    await switchWorkspace(WS, 'ptah-e2e-ws');

    // The same DOM node survived the round-trip → the tile was never rebuilt.
    await expect(tile.first()).toHaveAttribute('data-keepalive-marker', marker);
  });
});
