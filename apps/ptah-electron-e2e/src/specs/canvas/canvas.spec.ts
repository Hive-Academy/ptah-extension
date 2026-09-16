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

    // Layout controls are disabled as inapplicable for singleton session
    await expect(
      page
        .locator('[data-testid="canvas-dock"]')
        .getByRole('button', {
          name: 'Layout controls not applicable for a single session',
          exact: true,
        }),
    ).toBeDisabled();

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

  test('real Gridstack drag keeps an explicit 2+1 row through resize and workspace switch', async ({
    ui,
  }) => {
    const page = ui.page;
    const WS_A = 'C:\\ptah-e2e-ws';
    const WS_B = 'C:\\ptah-e2e-ws-row-b';
    await page.setViewportSize({ width: 2600, height: 1200 });
    await ui.goto('canvas');

    const createTile = async (): Promise<void> => {
      const priorCount = await page
        .locator('[data-testid="canvas-tile"]')
        .count();
      if (priorCount === 0) {
        await page.getByRole('button', { name: 'Create new session' }).click();
      } else {
        await page
          .getByRole('button', { name: 'Add new session tile' })
          .click();
      }
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.locator('[data-testid="canvas-tile"]')).toHaveCount(
        priorCount + 1,
      );
    };
    await createTile();
    await createTile();
    await createTile();

    const items = page.locator('gridstack-item');
    const grid = page.locator('ptah-canvas-workspace-grid:visible');
    type Geometry = Array<{
      x: string | null;
      y: string | null;
      w: string | null;
      h: string | null;
    }>;
    const readGeometry = (): Promise<Geometry> =>
      items.evaluateAll((nodes) =>
        nodes.map((node) => ({
          x: node.getAttribute('gs-x'),
          y: node.getAttribute('gs-y'),
          w: node.getAttribute('gs-w'),
          h: node.getAttribute('gs-h'),
        })),
      );
    const metric = async (name: string): Promise<number> =>
      Number((await grid.getAttribute(name)) ?? '-1');
    const resizeAndAwaitLayout = async (
      width: number,
      height: number,
      expected: Geometry,
    ): Promise<void> => {
      const priorWidth = await metric('data-canvas-measured-width');
      const priorComputations = await metric('data-canvas-layout-computations');
      await page.setViewportSize({ width, height });
      await expect
        .poll(() => metric('data-canvas-measured-width'))
        .not.toBe(priorWidth);
      await expect
        .poll(() => metric('data-canvas-layout-computations'))
        .toBeGreaterThan(priorComputations);
      await expect.poll(readGeometry).toEqual(expected);
    };
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveAttribute('gs-y', '0');
    await expect(items.nth(1)).toHaveAttribute('gs-y', '0');
    await expect(items.nth(2)).toHaveAttribute('gs-y', '0');
    const updatesAtMount = Number(
      (await grid.getAttribute('data-canvas-grid-updates')) ?? '-1',
    );

    const firstBox = await items.nth(0).boundingBox();
    const thirdHandle = items.nth(2).locator('.tile-header');
    const thirdBox = await thirdHandle.boundingBox();
    if (!firstBox || !thirdBox)
      throw new Error('Canvas tile handles are not measurable');
    await page.mouse.move(
      thirdBox.x + thirdBox.width / 2,
      thirdBox.y + thirdBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      // Land at grid x=2 in the next row: the tile overlaps both first-row
      // tiles if gravity tries to lift it, so Gridstack retains the gap. Move
      // the pointer beyond the first row to make the row transition decisive.
      firstBox.x + firstBox.width,
      firstBox.y + firstBox.height + thirdBox.height / 2,
      { steps: 32 },
    );
    await page.mouse.up();

    await expect
      .poll(async () => (await readGeometry()).map(({ y }) => y))
      .toEqual(['0', '0', '6']);

    // Real east-handle resize: shrink the half-width tile by roughly two grid
    // units. The intent writer snaps it to the nearest named span (third), and
    // the auto neighbour fills the remaining two-thirds of the 12-unit row.
    await items.nth(0).hover();
    const eastHandle = items.nth(0).locator('.ui-resizable-e');
    await expect(eastHandle).toBeVisible();
    const resizeBox = await items.nth(0).boundingBox();
    const handleBox = await eastHandle.boundingBox();
    if (!resizeBox || !handleBox) {
      throw new Error('Gridstack east resize handle is not measurable');
    }
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      resizeBox.x + resizeBox.width - firstBox.width / 2,
      handleBox.y + handleBox.height / 2,
      { steps: 16 },
    );
    await page.mouse.up();
    await expect
      .poll(async () => {
        const widths = await items.evaluateAll((nodes) =>
          nodes.slice(0, 2).map((node) => Number(node.getAttribute('gs-w'))),
        );
        return {
          unequal: widths[0] !== widths[1],
          total: widths[0] + widths[1],
        };
      })
      .toEqual({ unequal: true, total: 12 });
    const wideGeometry = await readGeometry();

    const marker = `row-intent-${Date.now()}`;
    await items.nth(2).evaluate((element, value) => {
      element.setAttribute('data-row-intent-marker', value);
    }, marker);

    await resizeAndAwaitLayout(900, 1000, [
      { x: '0', y: '0', w: '12', h: '6' },
      { x: '0', y: '6', w: '12', h: '6' },
      { x: '0', y: '12', w: '12', h: '6' },
    ]);
    await resizeAndAwaitLayout(2600, 1200, wideGeometry);

    const switchWorkspace = async (path: string, name: string) => {
      await ui.mockRpc({
        'workspace:getInfo': { folders: [path], activeFolder: path },
      });
      await ui.pushEvent({
        type: 'workspaceChanged',
        payload: { workspaceInfo: { path, name, type: 'workspace' } },
      });
    };
    await switchWorkspace(WS_B, 'row-b');
    await switchWorkspace(WS_A, 'row-a');
    await expect(items.nth(2)).toHaveAttribute(
      'data-row-intent-marker',
      marker,
    );
    await expect
      .poll(async () =>
        items.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('gs-y')),
        ),
      )
      .toEqual(['0', '0', '6']);

    // Move a first-row tile into the explicit second row. C currently spans
    // that row, so this also exercises Gridstack collision/gravity projection.
    const firstHeaderBox = await items
      .nth(0)
      .locator('.tile-header')
      .boundingBox();
    const secondRowBox = await items.nth(2).boundingBox();
    if (!firstHeaderBox || !secondRowBox) {
      throw new Error('Gridstack rows are not measurable for the second drag');
    }
    await page.mouse.move(
      firstHeaderBox.x + firstHeaderBox.width / 2,
      firstHeaderBox.y + firstHeaderBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      secondRowBox.x + secondRowBox.width / 3,
      secondRowBox.y + secondRowBox.height - 12,
      { steps: 24 },
    );
    await page.mouse.up();
    await expect
      .poll(async () => items.nth(0).getAttribute('gs-y'))
      .not.toBe('0');
    await expect(grid).toHaveAttribute('data-canvas-gesture-commits', '3');

    // A real pointer gesture cancelled by locking must settle the engine back
    // to current intent, disable every row preference, and commit nothing.
    const beforeCancellation = await readGeometry();
    const commitsBeforeCancellation = await metric(
      'data-canvas-gesture-commits',
    );

    // Reserved dock assertions: dock is visible and does not overlap tile close or composer send
    const dock = page.locator('[data-testid="canvas-dock"]');
    await expect(dock).toBeVisible();
    const dockBox = await dock.boundingBox();
    if (!dockBox) throw new Error('Canvas dock is not measurable');

    const firstCloseBtn = page
      .getByRole('button', { name: 'Close tile' })
      .first();
    await expect(firstCloseBtn).toBeVisible();
    const closeBox = await firstCloseBtn.boundingBox();
    expect(closeBox).not.toBeNull();
    if (!closeBox) throw new Error('Tile close button is not measurable');
    // Dock stays above tile close control.
    expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(closeBox.y + 1);

    const sendBtn = page.locator('[data-testid="chat-send-btn"]').first();
    await expect(sendBtn).toBeVisible();
    const sendBox = await sendBtn.boundingBox();
    expect(sendBox).not.toBeNull();
    if (!sendBox) throw new Error('Composer send button is not measurable');
    // Dock stays above composer send control.
    expect(dockBox.y + dockBox.height).toBeLessThan(sendBox.y);

    const cancelHandle = items.nth(2).locator('.tile-header');
    const cancelBox = await cancelHandle.boundingBox();
    if (!cancelBox)
      throw new Error('Cancellation drag handle is not measurable');
    await page.mouse.move(
      cancelBox.x + cancelBox.width / 2,
      cancelBox.y + cancelBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(cancelBox.x + 80, cancelBox.y - 80, { steps: 8 });

    // Open expandable layout controls and lock layout while drag is active
    const layoutTrigger = dock.getByRole('button', {
      name: 'Layout options',
      exact: true,
    });
    await expect(layoutTrigger).toBeEnabled();
    await layoutTrigger.evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

    const lockBtn = page.getByRole('button', { name: /Lock (tiles|layout)/i });
    await lockBtn.evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await page.mouse.up();

    // With layout locked, every dock preset and tile span action is disabled.
    const presetButtons = dock.locator(
      '[role="group"][aria-label="Layout presets"] button[data-preset]',
    );
    await expect(presetButtons).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(presetButtons.nth(index)).toBeDisabled();
    }

    await page.keyboard.press('Escape');
    const tileLayoutTrigger = items
      .nth(0)
      .locator('[data-testid="tile-layout-trigger"]');
    await tileLayoutTrigger.click();
    const spanButtons = items.nth(0).locator('button[data-span]');
    await expect(spanButtons).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      await expect(spanButtons.nth(index)).toBeDisabled();
    }
    await page.keyboard.press('Escape');

    await expect.poll(readGeometry).toEqual(beforeCancellation);
    expect(await metric('data-canvas-gesture-commits')).toBe(
      commitsBeforeCancellation,
    );

    // Unlock layout
    await layoutTrigger.click();
    const unlockBtn = dock.getByRole('button', {
      name: 'Unlock tiles',
      exact: true,
    });
    await expect(unlockBtn).toBeEnabled();
    await unlockBtn.click();

    // After unlocking, dock presets and tile span actions become enabled again.
    for (let index = 0; index < 3; index += 1) {
      await expect(presetButtons.nth(index)).toBeEnabled();
    }
    await page.keyboard.press('Escape');
    await tileLayoutTrigger.click();
    for (let index = 0; index < 4; index += 1) {
      await expect(spanButtons.nth(index)).toBeEnabled();
    }
    await page.keyboard.press('Escape');

    await expect(grid.locator('gridstack')).not.toHaveClass(
      /grid-stack-static/,
    );

    // Pointer down/up in place can produce either an accepted semantic no-op
    // or no Gridstack change event. Both paths must clear the latch, preserve
    // intent, and leave the complete engine geometry settled.
    const beforeNoop = await readGeometry();
    const noopBox = await items.nth(1).locator('.tile-header').boundingBox();
    if (!noopBox) throw new Error('No-op drag handle is not measurable');
    await page.mouse.move(
      noopBox.x + noopBox.width / 2,
      noopBox.y + noopBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(readGeometry).toEqual(beforeNoop);

    const settledAfterGestures = await readGeometry();
    const updatesBefore = await metric('data-canvas-grid-updates');
    await resizeAndAwaitLayout(2599, 1200, settledAfterGestures);
    const updatesAfterFirstNoopResize = await metric(
      'data-canvas-grid-updates',
    );
    await resizeAndAwaitLayout(2600, 1200, settledAfterGestures);
    const updatesAfter = await metric('data-canvas-grid-updates');
    expect(updatesAfterFirstNoopResize).toBe(updatesBefore);
    expect(updatesAfter).toBe(updatesBefore);
    await expect(grid).toHaveAttribute('data-canvas-gesture-commits', '3');
    console.log(
      `[canvas-metrics] ${JSON.stringify({
        updatesAtMount,
        updatesAfterGestures: updatesBefore,
        updatesAfterFirstNoopResize,
        updatesAfterNoopResize: updatesAfter,
      })}`,
    );
  });

  test('compact tile shrinks to two units and neighbours reflow into the freed space', async ({
    ui,
  }) => {
    const page = ui.page;
    await page.setViewportSize({ width: 2600, height: 1200 });
    await ui.goto('canvas');

    const createTile = async (): Promise<void> => {
      const priorCount = await page
        .locator('[data-testid="canvas-tile"]')
        .count();
      if (priorCount === 0) {
        await page.getByRole('button', { name: 'Create new session' }).click();
      } else {
        await page
          .getByRole('button', { name: 'Add new session tile' })
          .click();
      }
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.locator('[data-testid="canvas-tile"]')).toHaveCount(
        priorCount + 1,
      );
    };
    for (let index = 0; index < 4; index += 1) {
      await createTile();
    }

    const items = page.locator('gridstack-item');
    await expect(items).toHaveCount(4);

    // Deterministic third spans for every tile: the projector reproduces their
    // fixed four-unit widths exactly, so the reflow below depends only on the
    // compact view tier.
    const setSpanToThird = async (index: number): Promise<void> => {
      await items
        .nth(index)
        .locator('[data-testid="tile-layout-trigger"]')
        .click();
      await items.nth(index).locator('button[data-span="third"]').click();
    };
    for (let index = 0; index < 4; index += 1) {
      await setSpanToThird(index);
    }

    type Geometry = Array<{
      x: string | null;
      y: string | null;
      w: string | null;
      h: string | null;
    }>;
    const readGeometry = (): Promise<Geometry> =>
      items.evaluateAll((nodes) =>
        nodes.map((node) => ({
          x: node.getAttribute('gs-x'),
          y: node.getAttribute('gs-y'),
          w: node.getAttribute('gs-w'),
          h: node.getAttribute('gs-h'),
        })),
      );
    const fullThirds: Geometry = [
      { x: '0', y: '0', w: '4', h: '6' },
      { x: '4', y: '0', w: '4', h: '6' },
      { x: '8', y: '0', w: '4', h: '6' },
      { x: '0', y: '6', w: '4', h: '6' },
    ];
    await expect.poll(readGeometry).toEqual(fullThirds);

    // Compact the second tile: two height units, responsive minimum width, and
    // the fourth tile rises into the hole under it.
    await items
      .nth(1)
      .locator('[data-testid="tile-view-mode-toggle"]')
      .click();
    await expect.poll(readGeometry).toEqual([
      { x: '0', y: '0', w: '4', h: '6' },
      { x: '4', y: '0', w: '4', h: '2' },
      { x: '8', y: '0', w: '4', h: '6' },
      { x: '4', y: '2', w: '4', h: '6' },
    ]);

    // A compact tile carries no resize handle.
    const compactResizeHandles = items
      .nth(1)
      .locator('.ui-resizable-handle');
    await expect(compactResizeHandles).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      await expect(compactResizeHandles.nth(index)).toBeHidden();
    }

    // Back to full: the stored third span returns untouched and the fourth
    // tile leaves the hole.
    await items
      .nth(1)
      .locator('[data-testid="tile-view-mode-toggle"]')
      .click();
    await expect.poll(readGeometry).toEqual(fullThirds);
  });

  test('locked canvas reflows for a view-mode change but commits no gesture', async ({
    ui,
  }) => {
    const page = ui.page;
    await page.setViewportSize({ width: 2600, height: 1200 });
    await ui.goto('canvas');

    const createTile = async (): Promise<void> => {
      const priorCount = await page
        .locator('[data-testid="canvas-tile"]')
        .count();
      if (priorCount === 0) {
        await page.getByRole('button', { name: 'Create new session' }).click();
      } else {
        await page
          .getByRole('button', { name: 'Add new session tile' })
          .click();
      }
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.locator('[data-testid="canvas-tile"]')).toHaveCount(
        priorCount + 1,
      );
    };
    for (let index = 0; index < 4; index += 1) {
      await createTile();
    }

    const items = page.locator('gridstack-item');
    const grid = page.locator('ptah-canvas-workspace-grid:visible');
    const dock = page.locator('[data-testid="canvas-dock"]');
    await expect(items).toHaveCount(4);

    // Named third spans must be committed before locking — the store refuses
    // span writes while locked.
    const setSpanToThird = async (index: number): Promise<void> => {
      await items
        .nth(index)
        .locator('[data-testid="tile-layout-trigger"]')
        .click();
      await items.nth(index).locator('button[data-span="third"]').click();
    };
    for (let index = 0; index < 4; index += 1) {
      await setSpanToThird(index);
    }

    type Geometry = Array<{
      x: string | null;
      y: string | null;
      w: string | null;
      h: string | null;
    }>;
    const readGeometry = (): Promise<Geometry> =>
      items.evaluateAll((nodes) =>
        nodes.map((node) => ({
          x: node.getAttribute('gs-x'),
          y: node.getAttribute('gs-y'),
          w: node.getAttribute('gs-w'),
          h: node.getAttribute('gs-h'),
        })),
      );
    const fullThirds: Geometry = [
      { x: '0', y: '0', w: '4', h: '6' },
      { x: '4', y: '0', w: '4', h: '6' },
      { x: '8', y: '0', w: '4', h: '6' },
      { x: '0', y: '6', w: '4', h: '6' },
    ];
    await expect.poll(readGeometry).toEqual(fullThirds);

    // Lock the layout.
    const layoutTrigger = dock.getByRole('button', {
      name: 'Layout options',
      exact: true,
    });
    await expect(layoutTrigger).toBeEnabled();
    await layoutTrigger.evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    const lockBtn = page.getByRole('button', { name: /Lock (tiles|layout)/i });
    await lockBtn.evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await expect(grid.locator('gridstack')).toHaveClass(/grid-stack-static/);

    // Every dock preset is disabled while locked.
    const presetButtons = dock.locator(
      '[role="group"][aria-label="Layout presets"] button[data-preset]',
    );
    await expect(presetButtons).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(presetButtons.nth(index)).toBeDisabled();
    }
    await page.keyboard.press('Escape');

    // Every tile layout menu item is disabled while locked; the adjacent
    // view-mode toggle is the deliberate exception.
    await items
      .nth(0)
      .locator('[data-testid="tile-layout-trigger"]')
      .click();
    const menuButtons = items.nth(0).locator('[data-layout-item]');
    await expect(menuButtons).toHaveCount(6);
    for (let index = 0; index < 6; index += 1) {
      await expect(menuButtons.nth(index)).toBeDisabled();
    }
    const viewToggle = items
      .nth(0)
      .locator('[data-testid="tile-view-mode-toggle"]');
    await expect(viewToggle).toBeEnabled();
    await page.keyboard.press('Escape');

    const commitsBefore = Number(
      (await grid.getAttribute('data-canvas-gesture-commits')) ?? '-1',
    );

    // A view-mode change on a locked grid still reflows the geometry — the
    // narrow lock exception — and never commits a store gesture.
    await items
      .nth(1)
      .locator('[data-testid="tile-view-mode-toggle"]')
      .click();
    await expect.poll(readGeometry).toEqual([
      { x: '0', y: '0', w: '4', h: '6' },
      { x: '4', y: '0', w: '4', h: '2' },
      { x: '8', y: '0', w: '4', h: '6' },
      { x: '4', y: '2', w: '4', h: '6' },
    ]);
    expect(await grid.getAttribute('data-canvas-gesture-commits')).toBe(
      String(commitsBefore),
    );

    // Exiting compact restores the frozen arrangement exactly.
    await items
      .nth(1)
      .locator('[data-testid="tile-view-mode-toggle"]')
      .click();
    await expect.poll(readGeometry).toEqual(fullThirds);
    expect(await grid.getAttribute('data-canvas-gesture-commits')).toBe(
      String(commitsBefore),
    );

    // Unlock returns the grid to an interactive state.
    await layoutTrigger.click();
    const unlockBtn = dock.getByRole('button', {
      name: 'Unlock tiles',
      exact: true,
    });
    await expect(unlockBtn).toBeEnabled();
    await unlockBtn.click();
    await expect(grid.locator('gridstack')).not.toHaveClass(
      /grid-stack-static/,
    );
  });

  test('a compact singleton keeps two height units instead of filling the grid', async ({
    ui,
  }) => {
    const page = ui.page;
    await page.setViewportSize({ width: 2600, height: 1200 });
    await ui.goto('canvas');

    await page.getByRole('button', { name: 'Create new session' }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const items = page.locator('gridstack-item');
    await expect(items).toHaveCount(1);

    await items
      .nth(0)
      .locator('[data-testid="tile-view-mode-toggle"]')
      .click();

    // Two height units at the responsive minimum width — not the expanded
    // singleton that stretches to the whole grid.
    await expect(items.nth(0)).toHaveAttribute('gs-h', '2');
    await expect(items.nth(0)).toHaveAttribute('gs-w', '4');

    const visibleGrid = page.locator(
      'ptah-canvas-workspace-grid:visible gridstack',
    );
    await expect(visibleGrid).not.toHaveClass(/singleton-expanded/);
    await expect
      .poll(async () => {
        const [gridBox, itemBox] = await Promise.all([
          visibleGrid.boundingBox(),
          items.nth(0).boundingBox(),
        ]);
        return Boolean(gridBox && itemBox && itemBox.height < gridBox.height);
      })
      .toBe(true);
  });
});
