/**
 * E2E: Marketplace shell — routing, header/breadcrumb rules, keyboard scope,
 * drawer/docked detail placement and the real-host container tier (TASK_2026_533
 * Batch 25, Task 25.1; plan D1/D3, C6, C7).
 *
 * Uses the REAL `ptah-extension-webview` Angular bundle, following
 * `../thoth/skills-lane-pickers.e2e.spec.ts` and `../vscode-shell/*` (read
 * `../marketplace.fixtures.ts`'s doc comment before changing the host/RPC
 * shapes below).
 *
 * SCOPE NOTE (host coverage). Route resolution and the header/back-button/h1
 * rule are asserted in BOTH hosts (`marketplaceShellSmoke`) because C6 branches
 * on `VSCodeService.isElectron`. Keyboard scope, the drawer focus trap, the
 * docked-inspector-does-not-steal-focus rule and the real-host container tier
 * resize are Angular/CSS mechanics that do not branch on the host flag, so
 * they run once (VS Code — simplest viewport-equals-shell-width host) rather
 * than doubling every test for a distinction that carries no behavioural risk.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge, type PostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import {
  baseMarketplaceFixtures,
  installHost,
  installRpcAutoResponder,
  MARKETPLACE_NAV_IDS,
} from './marketplace.fixtures';

test.use({ useAppBuild: true });

/** Nav id -> the breadcrumb's last-crumb label (`marketplace-nav.component.ts`). */
const NAV_LABELS: Readonly<Record<(typeof MARKETPLACE_NAV_IDS)[number], string>> =
  {
    overview: 'Overview',
    connectors: 'Connectors',
    servers: 'MCP Servers',
    skills: 'Skills & Plugins',
    smithery: 'Smithery',
    registry: 'MCP Registry',
    'custom-url': 'Custom URL',
    'ptah-plugins': 'Ptah Plugins',
    community: 'Community',
    marketplaces: 'Marketplaces',
  };

/**
 * Boots to the DEFAULT surface (chat) and enters the Marketplace through the
 * SWITCH_VIEW wire contract, exactly like a real menu/tab click would.
 *
 * Booting directly on `initialView: 'marketplace'` races Electron's own
 * startup: `ElectronLayoutService` gates content on `workspace:getInfo`
 * resolving, and `WorkspaceCoordinatorService`'s first `switchWorkspace` (from
 * the bootstrap sentinel path to the real workspace path) can settle AFTER
 * `App.handleInitialView()`'s marketplace navigation, whose "never-visited
 * workspace has no slice -> opens on chat" default then overwrites it — a
 * real race in the app's own boot sequence, not a harness artifact (this is
 * exactly why the thoth and vscode-shell scenarios never boot directly onto a
 * non-chat `initialView` either; they always switchView after readiness).
 */
async function bootMarketplace(
  page: Page,
  fixtureUrl: string,
  host: 'electron' | 'vscode',
): Promise<PostMessageBridge> {
  await installCspStub(page);
  const bridge = await installPostMessageBridge(page);
  await installHost(page, host, 'chat');
  await installRpcAutoResponder(page, baseMarketplaceFixtures());
  await page.goto(fixtureUrl);
  const readySelector =
    host === 'electron' ? 'ptah-electron-shell' : 'ptah-app-shell';
  await expect(page.locator(readySelector).first()).toBeVisible();

  await bridge.inject({ type: 'switchView', payload: { view: 'marketplace' } });
  await expect(page.locator('[data-testid="marketplace-shell"]')).toBeVisible();
  return bridge;
}

/** Every `<h1>` actually rendered by a marketplace PAGE (never chat's, which stays mounted-hidden). */
function pageH1(page: Page) {
  return page.locator('[data-testid="marketplace-content"] h1');
}

for (const host of ['vscode', 'electron'] as const) {
  test.describe(`webview > marketplace > shell (${host})`, () => {
    test(`every route resolves, the header/back-button/h1 rule holds, and the breadcrumb names the page`, async ({
      page,
      fixtureServer,
    }) => {
      await bootMarketplace(page, fixtureServer.url, host);

      // C6: header renders in BOTH hosts; back button only in VS Code; no <h1>
      // in the shell (each page owns its own single <h1>).
      await expect(page.locator('[data-testid="marketplace-header"]')).toBeVisible();
      if (host === 'vscode') {
        await expect(page.locator('[data-testid="marketplace-back"]')).toBeVisible();
      } else {
        await expect(page.locator('[data-testid="marketplace-back"]')).toHaveCount(0);
      }

      for (const navId of MARKETPLACE_NAV_IDS) {
        await page.locator(`a[data-nav-id="${navId}"]`).click();
        await expect(page.locator('[data-testid="marketplace-content"]')).toBeVisible();
        // Exactly one <h1>, rendered by the page — never by the shell. Scoped
        // to marketplace-content: chat stays mounted-hidden behind it
        // (`app.routes.ts`'s "chat is deliberately NOT in the outlet" note)
        // and `ChatEmptyStateComponent` renders its own `<h1>Ptah</h1>`.
        await expect(pageH1(page)).toHaveCount(1);
        // The breadcrumb's last crumb names the current page.
        await expect(
          page.locator('[data-testid="marketplace-breadcrumb"] [aria-current="page"]'),
        ).toHaveText(NAV_LABELS[navId]);
        // Exactly one item carries aria-current="page" in the nav itself.
        await expect(
          page.locator('ptah-marketplace-nav a[aria-current="page"]'),
        ).toHaveCount(1);
        await expect(
          page.locator(`a[data-nav-id="${navId}"][aria-current="page"]`),
        ).toHaveCount(1);
      }
    });
  });
}

test.describe('webview > marketplace > route memory', () => {
  test('a bare re-entry to the Marketplace restores the remembered page, not Overview', async ({
    page,
    fixtureServer,
  }) => {
    const bridge = await bootMarketplace(page, fixtureServer.url, 'vscode');

    // Land on a non-default page so a remembered route actually differs from
    // the Overview default.
    await page.locator('a[data-nav-id="smithery"]').click();
    await expect(
      page.locator('a[data-nav-id="smithery"][aria-current="page"]'),
    ).toHaveCount(1);

    // Leave the Marketplace and come back through the SAME SWITCH_VIEW wire
    // contract `../vscode-shell/switch-view-navigation.e2e.spec.ts` uses —
    // host-agnostic, so this is a fair re-entry point in either host. (The
    // Router runs on `MemoryPlatformLocation` — `app.config.ts`'s "THE
    // ROUTER'S HOST SEAM" note — so the browser address bar never reflects
    // the route; every assertion here is DOM state, never `page.url()`.)
    await bridge.inject({ type: 'switchView', payload: { view: 'chat' } });
    await expect(page.locator('[data-testid="marketplace-shell"]')).toHaveCount(0);

    await bridge.inject({ type: 'switchView', payload: { view: 'marketplace' } });
    await expect(page.locator('[data-testid="marketplace-shell"]')).toBeVisible();
    await expect(
      page.locator('a[data-nav-id="smithery"][aria-current="page"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="marketplace-breadcrumb"] [aria-current="page"]'),
    ).toHaveText('Smithery');
  });
});

/**
 * NOT COVERED: the `'**' -> redirectTo 'overview'` route (plan D1). The
 * Router runs on `MemoryPlatformLocation` (see the note above), which never
 * reads `window.location`/`history` at all, so the usual "drive a bookmark or
 * typed URL via `history.pushState` + `popstate`" e2e technique cannot reach
 * it — that event never reaches this app's location strategy. The ONLY way to
 * reach an unparsable Marketplace sub-path is a raw `Router.navigateByUrl`
 * call, which is not reachable through any real UI seam: `MarketplaceRoute`
 * (D2) is a closed union, `marketplaceRouteCommands` only ever emits its
 * members, and `MarketplaceNavComponent`'s `routerLink`s are the fixed table
 * in `marketplace-nav.component.ts` — nothing in the app ever constructs an
 * arbitrary Marketplace URL. Driving the router directly from the test would
 * be asserting against Router internals, not the seam this architecture
 * exposes. The route is defensive dead code from the user's perspective; a
 * unit spec on `marketplaceRouteFromSegments` (already in the plan's
 * verification seam) is the right place to pin its "unknown segments -> null"
 * contract.
 */

test.describe('webview > marketplace > keyboard scope', () => {
  test('`/` focuses the page search field, never while typing, and arrow keys/Enter open a row', async ({
    page,
    fixtureServer,
  }) => {
    await bootMarketplace(page, fixtureServer.url, 'vscode');
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('a[data-nav-id="servers"]').click();
    await expect(page.locator('[data-testid="provider-list-rows"]')).toBeVisible();

    // `/` focuses the page's search field (a `type="search"` input, C6). The
    // keydown handler is on the shell HOST element (`onKeyDown`, C6), so focus
    // must be on an element INSIDE the shell for the event to reach it —
    // clicking outside the shell would bubble the keydown past it, never
    // through it. The just-clicked nav link is already inside the shell.
    await page.locator('a[data-nav-id="servers"]').focus();
    await page.keyboard.press('/');
    const active = page.locator(':focus');
    await expect(active).toHaveAttribute('type', 'search');

    // `/` must stay a literal character while typing (never intercepted once
    // focus is inside an editable field) — `pressSequentially` simulates real
    // keystrokes, unlike `.fill()`, which bypasses the keydown handler.
    await active.pressSequentially('sentry/');
    await expect(active).toHaveValue('sentry/');
    await active.fill('');

    // Arrow-key navigation and Enter inside the rows region.
    const firstRow = page
      .locator('[data-list-rows] button[data-testid="provider-row-open"]')
      .first();
    await firstRow.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // A detail is now open (drawer at 1100px — regular tier, per D3).
    await expect(page.locator('[data-testid="provider-detail-drawer"]')).toBeVisible();
  });
});

test.describe('webview > marketplace > drawer focus trap and docked inspector', () => {
  test('the drawer traps focus and moves it in on open; the docked inspector does not steal it', async ({
    page,
    fixtureServer,
  }) => {
    await bootMarketplace(page, fixtureServer.url, 'vscode');

    // Regular tier (900-1399): overlay drawer.
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('a[data-nav-id="servers"]').click();
    const firstRowOpen = page
      .locator('[data-list-rows] button[data-testid="provider-row-open"]')
      .first();
    await firstRowOpen.click();

    const drawerPanel = page.locator('[data-testid="native-drawer-panel"]');
    await expect(drawerPanel).toBeVisible();
    // Focus moved into the panel on open (first focusable, else the panel).
    await expect(
      page.evaluate(() =>
        document
          .querySelector('[data-testid="native-drawer-panel"]')
          ?.contains(document.activeElement),
      ),
    ).resolves.toBe(true);

    // Tab cycles WITHIN the panel (focus trap): Shift+Tab from the first
    // focusable wraps to the last, never escaping to page chrome behind it.
    const closeButton = page.locator('[data-testid="native-drawer-close"]');
    await closeButton.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(
      page.evaluate(() =>
        document
          .querySelector('[data-testid="native-drawer-panel"]')
          ?.contains(document.activeElement),
      ),
    ).resolves.toBe(true);

    // Escape requests closure -> back to the list route.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="native-drawer-panel"]')).toHaveCount(0);

    // Wide tier (>=1400): docked inspector. Opening a row must NOT steal
    // focus away from where the user was.
    await page.setViewportSize({ width: 1500, height: 900 });
    await expect(page.locator('[data-testid="marketplace-shell"]')).toHaveAttribute(
      'data-tier',
      'wide',
    );
    // Same row as `firstRowOpen` above (`.first()` again, not a different
    // row) — re-named from `secondRowOpen` in Revise round 1
    // (code-logic-review Moderate #1): the docked-inspector-no-steal-focus
    // assertion below holds for any row, so this re-uses the one already on
    // screen rather than claiming coverage of a second, distinct row.
    const rowOpenButton = page
      .locator('[data-list-rows] button[data-testid="provider-row-open"]')
      .first();
    await rowOpenButton.focus();
    await rowOpenButton.click();
    await expect(page.locator('[data-testid="provider-detail-docked"]')).toBeVisible();
    await expect(page.evaluate(() => document.activeElement?.tagName)).resolves.toBe(
      'BUTTON',
    );
    await expect(
      page.evaluate(() =>
        document
          .querySelector('[data-testid="provider-detail-docked"]')
          ?.contains(document.activeElement),
      ),
    ).resolves.toBe(false);
  });
});

test.describe('webview > marketplace > real-host container tier', () => {
  test('resizing the SHELL HOST across 900/1400 flips the tier with NO manual change detection, and an open detail survives the flip', async ({
    page,
    fixtureServer,
  }) => {
    await bootMarketplace(page, fixtureServer.url, 'vscode');
    const shell = page.locator('[data-testid="marketplace-shell"]');

    // VS Code: the webview panel IS the shell host, so viewport width is the
    // container width the real `ResizeObserver` (`chat-view.component.ts`
    // pattern, D3) measures — no jsdom fallback involved, this is a real
    // browser layout.
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(shell).toHaveAttribute('data-tier', 'compact');
    await expect(page.locator('[data-testid="marketplace-nav"]')).toHaveAttribute(
      'data-variant',
      'rail',
    );

    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(shell).toHaveAttribute('data-tier', 'regular');
    await expect(page.locator('[data-testid="marketplace-nav"]')).toHaveAttribute(
      'data-variant',
      'sidebar',
    );

    // Open a detail at regular (overlay drawer), then flip past 1400 and
    // confirm the SAME detail survives as a docked inspector (D1 assumption
    // A1: the outlet re-activates the current child route across the branch
    // switch, it does not lose the selection).
    await page.locator('a[data-nav-id="servers"]').click();
    await page
      .locator('[data-list-rows] button[data-testid="provider-row-open"]')
      .first()
      .click();
    const titleBefore = await page
      .locator('[data-testid="server-detail-title"]')
      .textContent();
    await expect(page.locator('[data-testid="provider-detail-drawer"]')).toBeVisible();

    await page.setViewportSize({ width: 1500, height: 900 });
    await expect(shell).toHaveAttribute('data-tier', 'wide');
    await expect(page.locator('[data-testid="provider-detail-docked"]')).toBeVisible();
    await expect(page.locator('[data-testid="server-detail-title"]')).toHaveText(
      titleBefore ?? '',
    );

    // Back down across 900 restores the rail without losing the route.
    await page.setViewportSize({ width: 700, height: 900 });
    await expect(shell).toHaveAttribute('data-tier', 'compact');
  });
});
