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
    await ui.pushEvent({
      type: 'workspaceChanged',
      payload: {
        workspaceInfo: {
          path: 'C:\\ptah-e2e-ws-b',
          name: 'ws-b',
          type: 'workspace',
        },
      },
    });
    await expect(page.locator('ptah-canvas-empty-state')).toBeVisible();

    await ui.pushEvent({
      type: 'workspaceChanged',
      payload: {
        workspaceInfo: {
          path: 'C:\\ptah-e2e-ws',
          name: 'ptah-e2e-ws',
          type: 'workspace',
        },
      },
    });

    // The same DOM node survived the round-trip → the tile was never rebuilt.
    await expect(tile.first()).toHaveAttribute('data-keepalive-marker', marker);
  });
});
