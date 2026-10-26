import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/fixtures';

/** Rail split selectors (R9x). Pane sides are stable ids: never assume `left` (NEW-6). */
const railBoard = (page: Page) => page.locator('ptah-canvas-rail-board:visible');
const railCards = (page: Page) => railBoard(page).locator('ptah-canvas-rail [data-rail-card]');
const paneContainer = (page: Page) => railBoard(page).locator('[data-testid="rail-pane-container"]');
const panes = (page: Page) => paneContainer(page).locator(':scope > [data-pane-side]');
/** The pane shown first (top when stacked, left side by side), whatever its stable side. */
const visualPane = async (page: Page, position: 0 | 1): Promise<Locator> => {
  const count = await panes(page).count();
  for (let index = 0; index < count; index++) {
    const pane = panes(page).nth(index);
    const order = await pane.evaluate((el) => (el as HTMLElement).style.order || '0');
    if (Number(order) === position) return pane;
  }
  throw new Error(`no pane at visual position ${position}`);
};

/**
 * Stable side of the pane at a visual position, or null while none is there.
 * Never throws, so `expect.poll` can retry it until Angular applies a CSS `order` change.
 */
const visualSide = (page: Page, position: 0 | 1): Promise<string | null> =>
  panes(page).evaluateAll(
    (nodes, wanted) => nodes.find((node) => Number((node as HTMLElement).style.order || '0') === wanted)?.getAttribute('data-pane-side') ?? null,
    position,
  );

async function addRailSessions(page: Page, count: number): Promise<void> {
  for (let created = 0; created < count; created++) {
    await page.locator(created === 0 ? '[data-testid="canvas-hero-new-session"]' : '[data-testid="canvas-footer-new-session"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(railCards(page)).toHaveCount(created + 1);
  }
}

async function cardAction(page: Page, card: Locator, action: 'Open beside' | 'Move up' | 'Move down'): Promise<void> {
  await card.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

async function headerAction(page: Page, pane: Locator, action: 'Swap panes' | 'Close pane' | 'Close split'): Promise<void> {
  await pane.getByRole('button', { name: 'More session actions' }).click();
  await pane.getByRole('menuitem', { name: action }).click();
}

async function openSplit(page: Page): Promise<void> {
  await addRailSessions(page, 2);
  await railCards(page).first().click();
  await cardAction(page, railCards(page).nth(1), 'Open beside');
  await expect(panes(page)).toHaveCount(2);
}

test.describe('Canvas Rail', () => {
  test('Electron ignores a stale ptah-layout-mode value and opens the Rail board', async ({ ui }) => {
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
    // The hero's heading is the workspace name; it labels the board landmark.
    const heading = empty.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).not.toHaveText('');
    await expect(empty.getByRole('button', { name: 'New session' })).toBeVisible();
    // While empty the Rail sits behind its Sessions tab, which opens it.
    const sessionsTab = page.locator('ptah-canvas-rail-board:visible [data-sessions-tab] button');
    await expect(sessionsTab).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-testid="canvas-footer-new-session"]:visible')).toHaveCount(0);
    await sessionsTab.click();
    await expect(sessionsTab).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-testid="canvas-footer-new-session"]:visible')).toHaveCount(1);
  });

  test('adds and focuses a Rail session across navigation', async ({ ui }) => {
    await ui.goto('canvas');
    const page = ui.page;
    await page.locator('[data-testid="canvas-hero-new-session"]').click();
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
    await page.locator('[data-testid="canvas-hero-new-session"]').click();
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
    await page.locator('[data-testid="canvas-hero-new-session"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const card = page.locator('ptah-canvas-rail [data-rail-card]');
    await expect(card).toHaveCount(1);
    await switchWorkspace(WS_B, 'ws-b');
    await expect(page.locator('[data-testid="canvas-rail-empty-board"]')).toBeVisible();
    await switchWorkspace(WS, 'ptah-e2e-ws');
    await expect(card).toHaveCount(1);
  });
});

test.describe('Canvas Rail split focus and reorder', () => {
  test('Open beside shows two live panes with Details in the pane header, clear of the lane tabs', async ({ ui }) => {
    await ui.goto('canvas');
    const page = ui.page;
    await openSplit(page);

    await expect(railBoard(page)).toHaveAttribute('data-canvas-live-views', '2');
    await expect(railBoard(page).locator('ptah-chat-view')).toHaveCount(2);
    await expect(panes(page).first()).toHaveAttribute('aria-label', /^(Left|Top) session: /);
    await expect(paneContainer(page).locator('[data-pane-side][aria-label$=", active"]')).toHaveCount(1);
    for (const index of [0, 1]) {
      const pane = panes(page).nth(index);
      const details = pane.locator('ptah-canvas-focus-header').getByRole('button', { name: 'Open details' });
      const laneTabs = pane.locator('ptah-canvas-lane-tabs');
      await expect(details).toBeVisible();
      const detailsBox = await details.boundingBox();
      const tabsBox = await laneTabs.boundingBox();
      expect(detailsBox && tabsBox && detailsBox.y + detailsBox.height <= tabsBox.y + 1).toBe(true);
    }

    const active = paneContainer(page).locator('[data-pane-side][aria-label$=", active"]');
    await active.locator('ptah-canvas-focus-header').getByRole('button', { name: 'Open details' }).click();
    const dialog = active.getByRole('dialog', { name: 'Session details' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(active.getByRole('button', { name: 'Open details' })).toBeFocused();
  });

  test('Swap panes changes only the visual order; Close split keeps the active tab in one pane', async ({ ui }) => {
    await ui.goto('canvas');
    const page = ui.page;
    await openSplit(page);

    await panes(page).evaluateAll((nodes) =>
      nodes.forEach((node) => node.querySelector('ptah-chat-view')?.setAttribute('data-e2e-host', node.getAttribute('data-pane-side') ?? '')),
    );
    const firstBefore = await visualSide(page, 0);
    const activeSide = await paneContainer(page).locator('[data-pane-side][aria-label$=", active"]').getAttribute('data-pane-side');
    // Open the menu on the ACTIVE pane. Interacting with an inactive pane's header
    // activates that pane (click and focusin on the wrapper), which would change the
    // active side this case asserts is untouched by Swap.
    await headerAction(page, paneContainer(page).locator(`[data-pane-side="${activeSide}"]`), 'Swap panes');

    // Swap only flips a signal; Angular applies the CSS `order` on its next render, so poll for it.
    await expect.poll(() => visualSide(page, 0)).not.toBe(firstBefore);
    await expect(railBoard(page).locator('ptah-chat-view')).toHaveCount(2);
    for (const side of ['left', 'right']) {
      await expect(paneContainer(page).locator(`[data-pane-side="${side}"] ptah-chat-view`)).toHaveAttribute('data-e2e-host', side);
    }
    await expect(paneContainer(page).locator('[data-pane-side][aria-label$=", active"]')).toHaveAttribute('data-pane-side', activeSide ?? '');
    await expect(await visualPane(page, 0)).toHaveAttribute('aria-label', /^(Left|Top) session: /);
    await expect(railBoard(page).locator('[aria-live="polite"]').last()).toContainText('Panes swapped');

    const active = paneContainer(page).locator('[data-pane-side][aria-label$=", active"]');
    const activeTitle = await active.getAttribute('aria-label');
    await headerAction(page, active, 'Close split');
    await expect(panes(page)).toHaveCount(1);
    await expect(panes(page).first()).toHaveAttribute('aria-label', `Focused session: ${activeTitle?.replace(/^\w+ session: /, '').replace(/, active$/, '')}`);
    await expect(panes(page).first().locator('ptah-chat-view')).toHaveAttribute('data-e2e-host', activeSide ?? '');
  });

  test('stacked split after a swap tabs from the Rail into the visual top pane first', async ({ electronApp, ui }) => {
    // The split stacks below a 1440 px canvas: force a narrow window so the case never depends on the host screen.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setMinimumSize(300, 300);
      win?.setBounds({ x: 100, y: 50, width: 1280, height: 900 });
    });
    await ui.goto('canvas');
    const page = ui.page;
    await openSplit(page);
    await expect(paneContainer(page)).toHaveClass(/\bflex-col\b/);

    const topBefore = await visualSide(page, 0);
    await headerAction(page, await visualPane(page, 0), 'Swap panes');
    await expect.poll(() => visualSide(page, 0)).not.toBe(topBefore);
    const top = await visualPane(page, 0);
    // Tab from New session reaches Previous sessions, then hands off from the Rail to the panes.
    await railBoard(page)
      .getByRole('button', { name: 'New session', exact: true })
      .focus();
    await page.keyboard.press('Tab');
    await expect(
      railBoard(page).getByRole('button', { name: 'Previous sessions', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(top.locator(':focus')).toHaveCount(1);
  });

  test('Close pane on the active pane keeps the other session focused in its own pane', async ({ ui }) => {
    await ui.goto('canvas');
    const page = ui.page;
    await openSplit(page);
    const active = paneContainer(page).locator('[data-pane-side][aria-label$=", active"]');
    const activeSide = await active.getAttribute('data-pane-side');
    await headerAction(page, active, 'Close pane');

    await expect(panes(page)).toHaveCount(1);
    await expect(panes(page).first()).not.toHaveAttribute('data-pane-side', activeSide ?? '');
    await expect(railCards(page)).toHaveCount(2);
    await expect(panes(page).first().getByRole('button', { name: 'More session actions' })).toBeFocused();
  });

  test('Move down reorders the Rail cards and announces the new position', async ({ ui }) => {
    await ui.goto('canvas');
    const page = ui.page;
    await addRailSessions(page, 2);
    const order = () => railCards(page).evaluateAll((cards) => cards.map((card) => card.getAttribute('data-tab-id')));
    const before = await order();

    await railCards(page).first().click();
    await cardAction(page, railCards(page).first(), 'Move down');

    await expect.poll(order).toEqual([...before].reverse());
    await expect(railBoard(page).locator('[aria-live="polite"]').last()).toContainText('moved to position 2 of 2');
  });
});
