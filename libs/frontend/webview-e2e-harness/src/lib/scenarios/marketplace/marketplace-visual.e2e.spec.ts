/**
 * E2E: Marketplace parity screenshots (TASK_2026_533 Batch 25, Task 25.2).
 *
 * Captures `[data-testid=marketplace-shell]` at 720/1100/1750 in both hosts
 * (the Electron viewport is adjusted until the MEASURED shell width equals
 * the target — Electron chrome eats width the VS Code host does not), the six
 * restyled discovery views at the same three widths, the dashboard
 * skill-picker dialog, one `anubis-light` capture, and a 400px compact
 * capture. Written to
 * `.ptah/specs/TASK_2026_533_marketplace_redesign/screenshots/angular/`
 * (THIS worktree's copy — the team-leader copies them into the shared specs
 * folder per the task brief).
 *
 * Same real-bundle host/RPC mechanism as `./marketplace-routes.e2e.spec.ts`.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import {
  baseMarketplaceFixtures,
  installHost,
  installRpcAutoResponder,
  waitForAnimationsSettled,
  waitForCatalogCardMarkResolved,
} from './marketplace.fixtures';

test.use({ useAppBuild: true });

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(
  HERE,
  '../../../../../../../.ptah/specs/TASK_2026_533_marketplace_redesign/screenshots/angular',
);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

const WIDTHS = [720, 1100, 1750] as const;

/** Views navigated by nav id, name matched to the report's naming rule. */
const DISCOVERY_VIEWS: readonly { readonly navId: string; readonly name: string }[] =
  [
    { navId: 'smithery', name: 'smithery' },
    { navId: 'registry', name: 'registry' },
    { navId: 'custom-url', name: 'custom-url' },
    { navId: 'marketplaces', name: 'external-marketplaces' },
    { navId: 'community', name: 'skills-sh' },
    { navId: 'ptah-plugins', name: 'ptah-plugins' },
  ];

/**
 * Boots to chat and enters the Marketplace via SWITCH_VIEW, then waits for
 * the shell. Booting directly on `initialView: 'marketplace'` races
 * Electron's own startup — see `./marketplace-routes.e2e.spec.ts`'s
 * `bootMarketplace` doc comment for the mechanism; the same fix applies here.
 */
async function boot(
  page: Page,
  fixtureUrl: string,
  host: 'electron' | 'vscode',
): Promise<void> {
  await installCspStub(page);
  const bridge = await installPostMessageBridge(page);
  await installHost(page, host, 'chat');
  await installRpcAutoResponder(page, baseMarketplaceFixtures());
  await page.goto(fixtureUrl);
  const readySelector = host === 'electron' ? 'ptah-electron-shell' : 'ptah-app-shell';
  await expect(page.locator(readySelector).first()).toBeVisible();
  await bridge.inject({ type: 'switchView', payload: { view: 'marketplace' } });
  await expect(page.locator('[data-testid="marketplace-shell"]')).toBeVisible();
}

/** Every `<h1>` rendered by a marketplace PAGE (never chat's mounted-hidden one). */
function pageH1(page: Page) {
  return page.locator('[data-testid="marketplace-content"] h1');
}

/**
 * Replaces the fixed `waitForTimeout(150)` "settle" wait (code-logic-review
 * Serious #1, Revise round 1 item 3). Fails the test — rather than silently
 * capturing whatever is on screen — if a skeleton, spinner or `aria-busy`
 * region is still present after Playwright's default assertion timeout, so a
 * genuine RPC-race regression shows up as a RED test instead of a green run
 * with an unrepresentative screenshot.
 *
 * `[aria-busy="true"]` and `ptah-catalog-card-skeleton` are the app's two
 * skeleton-grid conventions (`plugin-catalog-panel.component.ts:355`,
 * `mcp-directory-browser.component.ts:135`, `skill-sh-browser.component.ts:134,159`,
 * `catalog-card-skeleton.component.ts:51`); `.loading-spinner` is the daisyUI
 * spinner convention used by views that gate on a single boolean rather than a
 * card grid (e.g. `SmitherySurfaceComponent`'s "resolving key status" spinner,
 * `smithery-surface.component.ts:166-170`). Together they cover every
 * discovery view and the dashboard dialog without a per-view selector list.
 */
async function waitForSettled(page: Page, scope = page.locator('body')): Promise<void> {
  await expect(
    scope.locator('[aria-busy="true"], ptah-catalog-card-skeleton, .loading-spinner'),
  ).toHaveCount(0);
}

/**
 * For VS Code the viewport IS the shell width (no host chrome). For Electron,
 * the workspace sidebar and window chrome eat width, so the viewport is
 * widened until the measured shell matches the target — per the plan's B10
 * row ("viewport adjusted until the shell's measured width equals the
 * target").
 */
async function fitShellWidth(
  page: Page,
  host: 'electron' | 'vscode',
  target: number,
): Promise<void> {
  const shell = page.locator('[data-testid="marketplace-shell"]');
  if (host === 'vscode') {
    await page.setViewportSize({ width: target, height: 1000 });
    return;
  }
  let viewport = target + 260; // seed above the known sidebar width
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.setViewportSize({ width: viewport, height: 1000 });
    const box = await shell.boundingBox();
    const measured = Math.round(box?.width ?? 0);
    if (Math.abs(measured - target) <= 2) return;
    viewport += target - measured;
  }
}

for (const host of ['vscode', 'electron'] as const) {
  test.describe(`webview > marketplace > visual parity (${host})`, () => {
    test('marketplace-shell at 720/1100/1750', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, host);
      const shell = page.locator('[data-testid="marketplace-shell"]');

      for (const width of WIDTHS) {
        await fitShellWidth(page, host, width);
        await waitForSettled(page, shell);
        await shell.screenshot({
          path: join(OUT_DIR, `marketplace-shell-${host}-${width}.png`),
        });
      }
    });

    test('six discovery views at 720/1100/1750', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, host);
      const shell = page.locator('[data-testid="marketplace-shell"]');

      for (const view of DISCOVERY_VIEWS) {
        await page.locator(`a[data-nav-id="${view.navId}"]`).click();
        await expect(pageH1(page)).toHaveCount(1);
        if (view.navId === 'registry') {
          // `waitForSettled`'s skeleton/spinner/aria-busy selectors do not
          // cover the vendor mark's `@defer` placeholder
          // (`mcp-directory-browser.component.ts:166-182`) — wait for every
          // card's mark to resolve, the same way the registry vendor-mark
          // functional test does (Revise round 2 item A1, code-logic-review
          // round-1 Moderate finding). One wait per card, done once per view
          // visit — the cards persist across the width loop below, so their
          // `@defer` chunk does not re-fire on resize.
          const cards = page.locator('[data-testid="catalog-card"]');
          const cardCount = await cards.count();
          for (let i = 0; i < cardCount; i += 1) {
            await waitForCatalogCardMarkResolved(cards.nth(i));
          }
        }
        for (const width of WIDTHS) {
          await fitShellWidth(page, host, width);
          await waitForSettled(page, shell);
          await shell.screenshot({
            path: join(OUT_DIR, `${view.name}-${host}-${width}.png`),
          });
        }
      }
    });
  });
}

/**
 * Management-page captures added in Revise round 1 item 5
 * (visual-review.md Moderate — "missing page captures for the plan's own
 * management-page inventory"): Connectors, Installed Servers (the three
 * captures above only exercised DISCOVERY views), and Server Detail in both
 * its wide-tier ≥1400 placement (`DockedInspectorComponent`) and its
 * regular/compact overlay placement (`NativeDrawerComponent`) — the one
 * structural difference D3 draws between discovery and management pages.
 */
for (const host of ['vscode', 'electron'] as const) {
  test.describe(`webview > marketplace > visual parity, management pages (${host})`, () => {
    test('connectors and installed servers at 720/1100/1750', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, host);
      const shell = page.locator('[data-testid="marketplace-shell"]');

      for (const view of [
        { navId: 'connectors', name: 'connectors' },
        { navId: 'servers', name: 'installed-servers' },
      ]) {
        await page.locator(`a[data-nav-id="${view.navId}"]`).click();
        await expect(pageH1(page)).toHaveCount(1);
        for (const width of WIDTHS) {
          await fitShellWidth(page, host, width);
          await waitForSettled(page, shell);
          await shell.screenshot({
            path: join(OUT_DIR, `${view.name}-${host}-${width}.png`),
          });
        }
      }
    });

    test('server detail — drawer (regular) and docked inspector (wide)', async ({
      page,
      fixtureServer,
    }) => {
      await boot(page, fixtureServer.url, host);
      const shell = page.locator('[data-testid="marketplace-shell"]');
      await page.locator('a[data-nav-id="servers"]').click();
      const firstRowOpen = page
        .locator('[data-list-rows] button[data-testid="provider-row-open"]')
        .first();

      // Regular tier (900-1399): overlay drawer.
      await fitShellWidth(page, host, 1100);
      await firstRowOpen.click();
      await expect(page.locator('[data-testid="provider-detail-drawer"]')).toBeVisible();
      await waitForSettled(page, shell);
      // Revise round 2 item B1: the panel's 180ms slide-in
      // (`native-drawer.component.ts:134-158`) was firing this capture
      // mid-animation (Batch 25b's finding — a test-timing bug, not the
      // product overflow this was originally reported as). Wait for the
      // backdrop fade + panel slide (both live under `shell`) to actually
      // finish, THEN fail loudly rather than silently capture if the panel
      // is not fully inside the viewport — the exact symptom of a capture
      // still mid-slide.
      const drawerPanel = page.locator('[data-testid="native-drawer-panel"]');
      await waitForAnimationsSettled(shell);
      const drawerBox = await drawerPanel.boundingBox();
      const drawerViewport = page.viewportSize();
      expect(drawerBox, 'drawer panel has no bounding box — not actually open').not.toBeNull();
      expect(drawerViewport).not.toBeNull();
      expect(
        drawerBox!.x >= 0 && drawerBox!.x + drawerBox!.width <= drawerViewport!.width + 1,
        `drawer panel is not fully inside the viewport (still animating?): x=${drawerBox!.x}, width=${drawerBox!.width}, viewport=${drawerViewport!.width}`,
      ).toBe(true);
      await shell.screenshot({
        path: join(OUT_DIR, `server-detail-drawer-${host}-1100.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="native-drawer-panel"]')).toHaveCount(0);

      // Wide tier (>=1400): docked inspector.
      await fitShellWidth(page, host, 1750);
      await firstRowOpen.click();
      await expect(page.locator('[data-testid="provider-detail-docked"]')).toBeVisible();
      await waitForSettled(page, shell);
      await shell.screenshot({
        path: join(OUT_DIR, `server-detail-docked-${host}-1750.png`),
      });
    });
  });
}

/**
 * A tall Overview capture (Revise round 1 item 5) — the other visual-review
 * Minor finding: every existing Overview capture used the harness's fixed
 * 1000px viewport HEIGHT, which put `CoverageMatrixComponent` below the fold
 * in all of them. This one raises the height so the full page — KPI cards,
 * Needs Attention, provider table AND the coverage matrix — is visible in
 * one capture at the wide (1750px) tier.
 */
test('overview, tall capture at 1750x2200 (wide tier, full page)', async ({
  page,
  fixtureServer,
}) => {
  await installCspStub(page);
  await installPostMessageBridge(page);
  await installHost(page, 'vscode', 'marketplace');
  await installRpcAutoResponder(page, baseMarketplaceFixtures());
  await page.goto(fixtureServer.url);
  const shell = page.locator('[data-testid="marketplace-shell"]');
  await expect(shell).toBeVisible();
  await page.setViewportSize({ width: 1750, height: 2200 });
  await expect(shell).toHaveAttribute('data-tier', 'wide');
  await waitForSettled(page, shell);
  await shell.screenshot({
    path: join(OUT_DIR, 'marketplace-shell-tall-vscode-1750.png'),
  });
});

test.describe('webview > marketplace > visual parity (theme + compact + dialog)', () => {
  test('anubis-light at 1100px', async ({ page, fixtureServer }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    await installRpcAutoResponder(page, baseMarketplaceFixtures());
    await page.addInitScript(() => {
      localStorage.setItem('ptah-theme', 'anubis-light');
    });
    await page.goto(fixtureServer.url);
    const shell = page.locator('[data-testid="marketplace-shell"]');
    await expect(shell).toBeVisible();
    await page.setViewportSize({ width: 1100, height: 1000 });
    await waitForSettled(page, shell);
    await shell.screenshot({
      path: join(OUT_DIR, 'marketplace-shell-anubis-light-vscode-1100.png'),
    });
  });

  test('400px compact capture', async ({ page, fixtureServer }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    await installRpcAutoResponder(page, baseMarketplaceFixtures());
    await page.goto(fixtureServer.url);
    const shell = page.locator('[data-testid="marketplace-shell"]');
    await expect(shell).toBeVisible();
    await page.setViewportSize({ width: 400, height: 900 });
    await expect(shell).toHaveAttribute('data-tier', 'compact');
    await waitForSettled(page, shell);
    await shell.screenshot({
      path: join(OUT_DIR, 'marketplace-shell-compact-vscode-400.png'),
    });
  });

  test('dashboard skill-picker dialog at 1100px', async ({ page, fixtureServer }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'analytics');
    await installRpcAutoResponder(page, baseMarketplaceFixtures());
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 1000 });
    const chooseButton = page.locator('[data-testid="skill-selection-card-choose"]');
    await expect(chooseButton).toBeVisible();
    await chooseButton.click();
    const dialog = page.locator('dialog.modal.modal-open');
    await expect(dialog).toBeVisible();
    await waitForSettled(page, dialog);
    // Revise round 2 item B1: daisyUI's ~200ms modal fade-in was firing this
    // capture at opacity 0-0.59 (Batch 25b's finding — a test-timing bug,
    // not the product backdrop defect this was originally reported as).
    // Wait for the transition to actually finish, THEN fail loudly rather
    // than silently capture if the dialog has not reached full opacity —
    // the exact symptom of a capture still mid-fade.
    await waitForAnimationsSettled(dialog);
    const dialogOpacity = await dialog.evaluate(
      (el) => getComputedStyle(el).opacity,
    );
    expect(
      dialogOpacity,
      `dialog has not finished fading in (opacity=${dialogOpacity}, still animating?)`,
    ).toBe('1');
    await dialog.screenshot({
      path: join(OUT_DIR, 'dashboard-skill-picker-vscode-1100.png'),
      animations: 'disabled',
    });
  });
});
