import type { Locator, Page } from '@playwright/test';
import type { Director } from './_harness/director';
import { test } from './_harness/showcase-fixtures';

/** Live PR #580 review. Real authenticated Electron/provider runs; no mocks or VO. */
const PROMPT =
  process.env['PTAH_LANE_REVIEW_PROMPT'] ??
  'Call ptah_agent_list, then use ptah_agent_spawn to start two DIFFERENT ' +
    'installed CLI lanes in parallel, in the background. Lane 1: list the 5 ' +
    'largest source files under src and explain what each does. Lane 2: ' +
    'summarise the scripts in package.json. Both lanes must be READ-ONLY and ' +
    'must not modify any file or run package scripts. Ask each lane to report ' +
    'its findings incrementally as it reads. Wait for both, then give a short recap.';

function warn(label: string, error: unknown): void {
  console.warn(
    `[lane-review] ${label}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** Each optional interaction is independent, so one absent control skips only itself. */
async function attempt(
  label: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    warn(label, error);
  }
}

async function visible(locator: Locator): Promise<boolean> {
  return locator
    .first()
    .isVisible()
    .catch(() => false);
}

// Local copies of the canvas-orchestra navigation/create/send/cleanup patterns.
// The shell keeps one canvas per workspace mounted but hidden, so every
// canvas-level locator is narrowed to the visible (active-workspace) copy.
async function goToCanvas(page: Page, director: Director): Promise<void> {
  const grid = page
    .locator('[data-testid="canvas-grid"]')
    .filter({ visible: true });
  if (!(await visible(grid))) {
    await director.click(
      page.getByRole('button', {
        name: 'Toggle canvas grid / single chat',
        exact: true,
      }),
    );
  }
  await grid.waitFor({ state: 'visible', timeout: 30_000 });
}

async function createTile(page: Page, director: Director): Promise<void> {
  // Wait for the app to finish booting: either the dock's New Session button
  // (tiles exist) or the empty-state New Session CTA (no tiles yet).
  const newSession = page
    .locator('[title="Add new session tile"]')
    .or(page.getByRole('button', { name: 'Create new session', exact: true }))
    .filter({ visible: true })
    .first();
  await newSession.waitFor({ state: 'visible', timeout: 90_000 });
  await director.click(newSession);

  const nameInput = page
    .locator('input[placeholder*="session name" i]')
    .filter({ visible: true })
    .last();
  await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
  await director.type(nameInput, 'lane-review');

  const create = page
    .getByRole('button', { name: 'Create', exact: true })
    .filter({ visible: true })
    .first();
  await create.waitFor({ state: 'visible', timeout: 15_000 });
  await director.click(create);
}

async function sendPromptToTile(
  director: Director,
  tile: Locator,
): Promise<void> {
  const input = tile.locator('ptah-chat-input textarea[role="combobox"]');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await director.type(input, PROMPT);
  await director.click(tile.locator('[data-testid="chat-send-btn"]'));
}

function reviewTile(page: Page): Locator {
  return page
    .locator('[data-testid="canvas-tile"]')
    .filter({
      has: page.locator('.tile-header span', { hasText: /^lane-review$/ }),
    })
    .filter({ visible: true })
    .first();
}

async function closeStale(page: Page, director: Director): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const stale = reviewTile(page);
    if (!(await visible(stale))) return;
    await director.click(stale.locator('[title="Close tile"]'));
    await director.hold(400);
  }
  if (await visible(reviewTile(page)))
    throw new Error('Stale lane-review tiles remain');
}

async function setWidth(
  page: Page,
  director: Director,
  tile: Locator,
  width: 'one third' | 'full',
): Promise<void> {
  await director.click(tile.locator('[data-testid="tile-layout-trigger"]'));
  // NativePopover content can be portalled outside the tile; scope by menu name.
  const menu = page.getByRole('menu', {
    name: 'Layout for lane-review',
    exact: true,
  });
  try {
    const item = menu.getByRole('menuitemradio', {
      name: `Set tile width to ${width}`,
      exact: true,
    });
    await item.waitFor({ state: 'visible' });
    if (!(await item.isEnabled())) throw new Error('Tile width is locked');
    await director.click(item);
    await director.hold(900);
  } finally {
    if (await visible(menu)) await page.keyboard.press('Escape');
  }
}

/** Real pointer events: 12 paced moves, with release even if the UI disappears. */
async function drag(
  page: Page,
  director: Director,
  handle: Locator,
  delta: number,
): Promise<void> {
  await handle.waitFor({ state: 'visible' });
  await handle.scrollIntoViewIfNeeded();
  await director.moveTo(handle);
  const box = await handle.boundingBox();
  if (!box) throw new Error('Resize handle has no bounding box');
  const horizontal =
    (await handle.getAttribute('aria-orientation')) === 'horizontal';
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(
        x + (horizontal ? 0 : (delta * step) / 12),
        y + (horizontal ? (delta * step) / 12 : 0),
      );
      await director.hold(90);
    }
  } finally {
    await page.mouse.up();
  }
  await director.hold(700);
}

async function reset(director: Director, handle: Locator): Promise<void> {
  await handle.waitFor({ state: 'visible' });
  await director.moveTo(handle);
  await handle.dblclick();
  await director.hold(900);
}

async function warnIfNotLive(tile: Locator, label: string): Promise<void> {
  const indicator = tile.locator('ptah-tile-agent-indicator button');
  const summary = await indicator.getAttribute('title').catch(() => null);
  if (!summary || !/\b[1-9]\d* running\b/.test(summary)) {
    warn(
      label,
      'No running CLI lane observed; this portion may show completed output',
    );
  }
}

test('PR #580 — live resizable lane console review (TASK_2026_534)', async ({
  page,
  director,
}, testInfo) => {
  // Manual mode: record while a person drives the app; ends when the window closes.
  if (process.env['PTAH_LANE_REVIEW_MANUAL'] === '1') {
    test.setTimeout(0);
    await page.waitForEvent('close', { timeout: 0 });
    return;
  }
  test.setTimeout(20 * 60_000);
  page.setDefaultTimeout(8_000);
  const tile = reviewTile(page);
  const panel = tile.locator('ptah-agent-monitor-panel');
  const compactHandle = tile.locator(
    'ptah-split-handle[data-testid="cs-split-handle"] [role="separator"]',
  );
  let ready = false;
  let sent = false;

  async function beat(
    index: number,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    await attempt(`beat ${index}: ${label}`, async () => {
      await director.caption(`${index}. ${label}`);
      await action();
    });
    await attempt(`beat ${index} screenshot`, async () => {
      await page.screenshot({
        path: testInfo.outputPath(`beat-${index}.png`),
        timeout: 10_000,
      });
    });
  }

  await beat(1, 'Create the lane-review session', async () => {
    await goToCanvas(page, director);
    await closeStale(page, director);
    await createTile(page, director);
    await tile.waitFor({ state: 'visible', timeout: 30_000 });
    ready = true;
    await attempt('Initial full view for prompt input', async () => {
      const toggle = tile.locator('button[title="Switch to full view"]');
      if (await visible(toggle)) await director.click(toggle);
    });
    await attempt('Initial full width', () =>
      setWidth(page, director, tile, 'full'),
    );
    await director.hold(1_000);
  });

  await beat(2, 'Start two parallel read-only CLI lanes', async () => {
    if (!ready) throw new Error('Session creation unavailable; prompt skipped');
    await sendPromptToTile(director, tile);
    sent = true;
  });

  await beat(
    3,
    'Live compact wire stream — resize, reset, expand a row',
    async () => {
      if (!sent) throw new Error('No submitted turn; live review unavailable');
      await attempt('First agent badge (three-minute cap)', async () => {
        await tile.locator('ptah-tile-agent-indicator button').waitFor({
          state: 'visible',
          timeout: 3 * 60_000,
        });
      });
      await attempt('Switch to compact', () =>
        director.click(tile.locator('button[title="Switch to compact view"]')),
      );
      await warnIfNotLive(tile, 'Compact streaming hold');
      await director.hold(20_000);
      await attempt('Widen recap', () =>
        drag(page, director, compactHandle, 110),
      );
      await attempt('Narrow recap', () =>
        drag(page, director, compactHandle, -180),
      );
      await attempt('Reset recap split', () => reset(director, compactHandle));
      await attempt('Expand and collapse wire detail', async () => {
        const row = tile.locator('.cs-row-line[role="button"]').last();
        await row.waitFor({ state: 'visible' });
        // Re-query by stable mark identity; new rows may arrive during the hold.
        const detailId = await row.getAttribute('aria-controls');
        if (!detailId) throw new Error('Wire row has no detail identity');
        const stableRow = tile.locator('.cs-row-line[role="button"]');
        // Attribute values are escaped as CSS strings, not interpreted as selectors.
        const selected = stableRow.and(
          tile.locator(`[aria-controls=${JSON.stringify(detailId)}]`),
        );
        await director.hover(selected, 500);
        await director.click(selected);
        await director.hold(2_500);
        await director.click(selected);
      });
    },
  );

  await beat(
    4,
    'Agents panel — live columns, divider, single/side-by-side toggle',
    async () => {
      if (!sent)
        throw new Error('No submitted turn; agent panel review unavailable');
      await attempt('Open Agents sidebar tab', async () => {
        const tab = tile.getByRole('button', {
          name: 'Toggle Agents panel',
          exact: true,
        });
        if ((await tab.getAttribute('title')) === 'Show Agents')
          await director.click(tab);
      });
      const grid = panel.locator('ptah-agent-lane-grid');
      // Only the chat-view's own separator (a direct child of its root row);
      // the inner split handles share its title.
      const panelHandle = tile.locator(
        'ptah-chat-view > div > div[role="separator"]',
      );
      await attempt('Widen Agents panel', async () => {
        const tileBox = await tile.boundingBox();
        const panelBox = await panel.locator('aside').boundingBox();
        if (!tileBox || !panelBox)
          throw new Error('Panel geometry unavailable');
        const desired = Math.min(900, tileBox.width * 0.75);
        await drag(
          page,
          director,
          panelHandle,
          -Math.max(100, desired - panelBox.width),
        );
      });
      await attempt('Restore columns if previously forced single', async () => {
        const toggle = panel.locator(
          'button[title="Show agents side by side"]',
        );
        if (await visible(toggle)) await director.click(toggle);
      });
      await attempt('Wait for two visible agent columns', async () => {
        await grid
          .locator('section[data-lane-id]')
          .nth(1)
          .waitFor({ state: 'visible', timeout: 30_000 });
      });
      await warnIfNotLive(tile, 'Columns streaming hold');
      if ((await grid.locator('[title="running"]').count()) < 2) {
        warn(
          'Columns streaming hold',
          'Fewer than two running columns; live parallelism is unverified',
        );
      }
      await director.hold(20_000);
      const divider = grid
        .locator('ptah-split-handle [role="separator"]')
        .first();
      await attempt('Drag column divider', () =>
        drag(page, director, divider, 85),
      );
      await attempt('Reset column divider', () => reset(director, divider));
      await attempt('Show one agent', () =>
        director.click(panel.locator('button[title="Show one agent"]')),
      );
      await director.hold(2_500);
      await attempt('Show agents side by side', () =>
        director.click(
          panel.locator('button[title="Show agents side by side"]'),
        ),
      );
      await director.hold(2_000);
    },
  );

  await beat(
    5,
    'Narrow tile: stacked recap/wire stream, then full width',
    async () => {
      if (!ready) throw new Error('Review tile unavailable');
      await attempt('Close Agents panel for compact layout', () =>
        director.click(panel.locator('button[title="Close panel"]')),
      );
      await attempt('Narrowest tile width', () =>
        setWidth(page, director, tile, 'one third'),
      );
      await attempt('Check stacked layout', async () => {
        const body = await tile.locator('.cs-body-host').boundingBox();
        if (!body || body.width > 600)
          warn('Stacked layout', 'Compact body did not reach <= 600 CSS px');
      });
      await director.hold(4_000);
      await attempt('Stacked layout screenshot', async () => {
        await page.screenshot({
          path: testInfo.outputPath('beat-5-stacked.png'),
          timeout: 10_000,
        });
      });
      await attempt('Restore full tile width', () =>
        setWidth(page, director, tile, 'full'),
      );
      await director.hold(2_000);
    },
  );

  await beat(6, 'Full session view and final recap', async () => {
    if (!ready) throw new Error('Review tile unavailable');
    // Compact unmounts chat-input, so its missing stop button is NOT turn completion.
    // Restore full view BEFORE using the Director's stop-button-based wait.
    await attempt('Restore full view', async () => {
      const toggle = tile.locator('button[title="Switch to full view"]');
      if (await visible(toggle)) await director.click(toggle);
    });
    await attempt(
      'Wait for session turn (Director cap: 20s + 6min)',
      async () => {
        if (!sent) throw new Error('No submitted turn');
        await tile.locator('ptah-chat-input').waitFor({ state: 'visible' });
        await director.waitForAgentTurn(tile);
      },
    );
    await director.caption(
      'Review complete — inspect warnings for skipped or non-live beats',
    );
    await director.hold(5_000);
  });
});
