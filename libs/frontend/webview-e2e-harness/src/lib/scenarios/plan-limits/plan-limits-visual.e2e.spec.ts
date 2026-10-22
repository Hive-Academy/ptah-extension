/**
 * Visual capture for TASK_2026_596 (Phase 6 visual review): the session stats
 * inspector with plan-limit and lane tiles, and the dashboard provider account
 * card, through the REAL ptah-extension-webview bundle in `anubis` and
 * `anubis-light` at 280, 360 and 440 px.
 *
 * Run (cwd libs/frontend/webview-e2e-harness; needs
 * dist/apps/ptah-extension-webview built from the tree under review):
 *   SHOT_DIR=<abs dir> npx playwright test --config=playwright.config.ts \
 *     plan-limits-visual --workers=2
 *
 * Files are named `<surface>-<state>-<theme>-<width>.png`. The clock is fixed
 * at {@link NOW} and the zone at {@link TIME_ZONE}, so every reset time and
 * "in 3h 10m" text is the same on every run.
 *
 * Flow per theme and width: boot on the pop-out session path, which loads one
 * session through `session:load` + `chat:resume` (two restored lane runs);
 * push three live lane runs over `agent-monitor:*`; capture the inspector's
 * "Near" alert from the `provider:getPlanLimits` answer; push one
 * `planLimits:changed` (the session moves to Opus, whose weekly window is at
 * its limit) and capture the "At limit" alert; open one plan
 * tile and one lane tile. Last, the next `provider:getPlanLimits` pull fails
 * while the snapshot is held: the inspector and dashboard card each show the
 * neutral "Refresh failed — showing last observed data" notice
 * (`*-refresh-failed-*`).
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import { installRpcAutoResponder } from '../marketplace/marketplace.fixtures';
import {
  CLAUDE_A,
  DASHBOARD_SNAPSHOT,
  EXPECTED_LANE_TILES,
  LIVE_LANE_MESSAGES,
  LOCALE,
  NOW,
  PULL_TRIGGER_MESSAGE,
  PUSHED_SNAPSHOT,
  RPC_SNAPSHOT,
  TIME_ZONE,
  installTheme,
  installWorkspaceHost,
  planLimitsFixtures,
  type PlanLimitsRpcControl,
} from './plan-limits.fixtures';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR =
  process.env['SHOT_DIR'] ??
  resolve(HERE, '../../../../../../../.ptah/specs/TASK_2026_596_0a19/screenshots');

const WIDTHS = [280, 360, 440] as const;
const HEIGHT = 900;
const THEMES = ['anubis', 'anubis-light'] as const;

test.use({ useAppBuild: true, timezoneId: TIME_ZONE, locale: LOCALE });

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

function shotPath(surface: string, state: string, theme: string, width: number): string {
  return join(SHOT_DIR, `${surface}-${state}-${theme}-${width}.png`);
}

/**
 * Grows the viewport until `target` fits below its scroll container's top.
 * Both surfaces live in an inner scroll container, so an element screenshot
 * of anything taller than the viewport is clipped blank at the bottom. Width
 * never changes, so the layout under review is the same; only the height
 * grows, never shrinks.
 */
async function fitViewportHeight(page: Page, target: Locator, width: number): Promise<void> {
  const needed = await target.evaluate((el) => {
    let scrolled = 0;
    for (let p = el.parentElement; p; p = p.parentElement) scrolled += p.scrollTop;
    const rect = el.getBoundingClientRect();
    return Math.ceil(rect.top + scrolled + rect.height + 48);
  });
  const current = page.viewportSize()?.height ?? HEIGHT;
  if (needed > current) await page.setViewportSize({ width, height: needed });
}

async function capture(target: Locator, path: string): Promise<void> {
  await target.screenshot({ path, animations: 'disabled' });
}

/** Common page setup: fixed clock, CSP stub, bridge, theme. */
async function preparePage(page: Page, theme: string, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await page.clock.setFixedTime(new Date(NOW));
  await installCspStub(page);
  const bridge = await installPostMessageBridge(page);
  await installTheme(page, theme);
  return bridge;
}

test.describe('plan limits > session inspector', () => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`session inspector ${theme} ${width}`, async ({ page, fixtureServer }) => {
        const bridge = await preparePage(page, theme, width);
        await installWorkspaceHost(page, 'chat');
        const rpc: PlanLimitsRpcControl = { failPulls: false };
        await installRpcAutoResponder(page, planLimitsFixtures(RPC_SNAPSHOT, rpc));
        await page.goto(fixtureServer.url);

        // The session loads through session:load + chat:resume into the Rail
        // board's focused pane (`ptah-canvas-focus-area`, rendered only for a
        // visible board); the main panel's own chat view stays mounted but hidden.
        const tile = page.locator('ptah-canvas-focus-area');
        const board = page.locator('ptah-canvas-rail-board:visible').first();
        const inspectorToggle = tile.locator('ptah-canvas-focus-header [data-details]');

        for (const message of LIVE_LANE_MESSAGES) {
          await bridge.inject(message);
        }
        // Restored and live runs auto-open the agent panel, which overlays
        // the whole tile at these widths. Close it as a user would.
        const agentPanel = tile.locator('ptah-agent-monitor-panel');
        await agentPanel.locator('button[title="Close panel"]').click();
        // ChatView keeps the panel host mounted so its sidebar tab can reopen it;
        // closing collapses the panel's inner surface instead of hiding the host.
        await expect(agentPanel.locator('aside')).toHaveClass(/\bw-0\b/);

        if (await inspectorToggle.isVisible()) {
          if (await inspectorToggle.getAttribute('aria-expanded') === 'false') {
            await inspectorToggle.click();
          }
        } else {
          // At 440px the board is at least 400px wide, so there is no compact
          // sheet and the header has no Details toggle. The band is 'sm', where
          // the side dock starts closed; the Stats tab opens it.
          const statsTab = board.locator('[data-stats-tab] button');
          if (await statsTab.getAttribute('aria-expanded') === 'false') {
            await statsTab.click();
          }
        }
        const inspector = board.locator('ptah-session-inspector:visible').first();
        const stats = inspector.locator('[data-testid="inspector-session-stats"]');
        const limits = inspector.locator('ptah-inspector-limits-lanes');
        await expect(stats).toBeVisible({ timeout: 15_000 });

        // (a) RPC snapshot: Sonnet session, 5-hour window at 94%.
        await expect(stats).toContainText('5-hour 94%');
        await expect(limits.locator('ptah-lane-usage-tile')).toHaveCount(EXPECTED_LANE_TILES);
        await capture(stats, shotPath('session-inspector', 'near', theme, width));

        // Push path: one planLimits:changed replaces the snapshot.
        await bridge.inject({ type: 'planLimits:changed', payload: PUSHED_SNAPSHOT });
        await expect(stats).toContainText('Weekly');
        await capture(stats, shotPath('session-inspector', 'at-limit', theme, width));
        await capture(tile, shotPath('chat-tile', 'at-limit', theme, width));

        // (b) Plan tiles, lane tiles, and subtotal in the inspector.
        const planTiles = limits.locator('ptah-plan-limit-tile');
        const laneTiles = limits.locator('ptah-lane-usage-tile');
        await expect(laneTiles).toHaveCount(EXPECTED_LANE_TILES);
        await expect(planTiles.first()).toBeVisible();
        await expect(limits.locator('ptah-lane-subtotal-tile')).toBeVisible();
        await fitViewportHeight(page, limits, width);
        await capture(limits, shotPath('session-limits', 'all-tiles', theme, width));

        // (c) One plan tile (the Opus window at its limit) and one lane tile
        // (Codex review: a different owner with an estimated-limit note).
        const opusTile = limits.locator(
          `ptah-plan-limit-tile[data-tile-id="plan:${CLAUDE_A.key}:weekly_model:opus"]`,
        );
        await opusTile.locator('[data-testid="plan-limit-tile"]').click();
        await expect(opusTile.locator('[data-testid="plan-limit-panel"]')).toBeVisible();

        const reviewTile = limits.locator(
          'ptah-lane-usage-tile[data-tile-id="lane:codex:review"]',
        );
        await reviewTile.locator('[data-testid="lane-usage-tile"]').click();
        const reviewPanel = reviewTile.locator('[data-testid="lane-usage-panel"]');
        await expect(reviewPanel).toBeVisible();
        await expect(
          reviewPanel.locator('[data-testid="lane-subgroup"]').first(),
        ).toHaveAttribute('data-owner-status', 'different');

        await fitViewportHeight(page, limits, width);
        await capture(limits, shotPath('session-limits', 'tiles-open', theme, width));
        await capture(opusTile, shotPath('plan-tile', 'open-at-limit', theme, width));
        await capture(reviewTile, shotPath('lane-tile', 'open-different-owner', theme, width));

        // (d) A failed pull while the pushed snapshot is held. A run on a new
        // owner widens this surface's scope, so the store pulls once more.
        const refreshNotice = limits.locator('[role="status"]');
        await expect(refreshNotice).toHaveCount(0);
        rpc.failPulls = true;
        await bridge.inject(PULL_TRIGGER_MESSAGE);
        await expect(refreshNotice).toHaveAttribute('role', 'status');
        await expect(refreshNotice).toContainText(
          'Refresh failed — showing last observed data',
        );
        await expect(stats).toContainText('Weekly');
        await expect(refreshNotice).toBeVisible();
        await capture(limits, shotPath('session-limits', 'refresh-failed', theme, width));
      });
    }
  }
});

test.describe('plan limits > dashboard provider account card', () => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`provider account card ${theme} ${width}`, async ({ page, fixtureServer }) => {
        await preparePage(page, theme, width);
        await installWorkspaceHost(page, 'analytics');
        const rpc: PlanLimitsRpcControl = { failPulls: false };
        await installRpcAutoResponder(page, planLimitsFixtures(DASHBOARD_SNAPSHOT, rpc));
        await page.goto(fixtureServer.url);

        const card = page.locator('ptah-provider-account-card');
        const tiles = card.locator('[data-testid="provider-account-tile"]');
        await expect(tiles).toHaveCount(DASHBOARD_SNAPSHOT.owners.length, {
          timeout: 15_000,
        });
        await expect(
          card
            .locator('[data-testid="tile-detail"]')
            .filter({ hasText: 'a retry delay, not a plan reset' }),
        ).toBeVisible();
        await fitViewportHeight(page, card, width);
        await capture(card, shotPath('dashboard-card', 'owners', theme, width));

        // A failed Refresh keeps every tile and says so, neutrally.
        const refreshNotice = card.locator('[data-testid="refresh-failed"]');
        await expect(refreshNotice).toHaveCount(0);
        rpc.failPulls = true;
        await tiles.first().getByRole('button', { name: /^Refresh / }).click();
        await expect(refreshNotice).toHaveAttribute('role', 'status');
        await expect(refreshNotice).toContainText(
          'Refresh failed — showing last observed data',
        );
        await expect(tiles).toHaveCount(DASHBOARD_SNAPSHOT.owners.length);
        await fitViewportHeight(page, card, width);
        await capture(card, shotPath('dashboard-card', 'refresh-failed', theme, width));
      });
    }
  }
});
