import { test, expect } from '../../support/fixtures';

test.describe('Canvas', () => {
  test('Electron forces grid layout even when a persisted preference requests single mode', async ({
    ui,
  }) => {
    // Moved here from the retired canvas-lazy-load.spec.ts (TASK_2026_187) —
    // this is the empirical proof behind the finding that single layout mode
    // is not a reachable state in Electron: `ElectronShellComponent`'s
    // constructor calls `setLayoutMode('grid')` unconditionally, every launch
    // (`electron-shell.component.ts:296-299`, "Electron uses the canvas as
    // its sole chat surface"), and again on the "Canvas" tab click
    // (`:327-328`). `toggleLayoutMode()` has zero call sites anywhere under
    // `electron-shell.component.ts`. `AppStateManager.initializeState()`
    // restores a persisted `'single'` preference from `localStorage` first
    // (`app-state.service.ts:331-335`), but the shell's constructor runs
    // immediately after in the same synchronous chain and overwrites it back
    // to `'grid'` before any template renders — this is unrelated to whether
    // canvas is eager or lazy (it was true before, during, and after the R14
    // lazy-load experiment; see e2e-validation-report.md §§3.3,6-8), so it
    // keeps failing loudly if anyone ever reintroduces single-mode to
    // Electron without accounting for it. This is what makes the "canvas is
    // the launch surface in Electron" claim (R15) checkable, not just a
    // code-reading.
    const page = ui.page;

    // Seed a 'single' preference exactly as a returning VS Code user's
    // profile would carry it, then reload through the same boot path every
    // other Electron e2e test uses.
    await page.evaluate(() => {
      localStorage.setItem('ptah-layout-mode', 'single');
    });
    await ui.prepare();

    // No single-chat tab strip exists in Electron; the canvas grid is the
    // only content surface, and it must be showing.
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();
    await expect(page.locator('ptah-tab-bar')).toHaveCount(0);
  });

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

    // Navigate away to a different view and back — the tile must persist.
    await ui.goto('dashboard');
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
