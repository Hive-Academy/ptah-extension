/**
 * E2E: Settings smoke captures (TASK_2026_555 Batch 16, Task 16.1 — plan
 * Component 14, §6). Fold assertions are added in Batches 28/36 once the
 * redesigned tabs land (execution default 3) — this spec only captures the
 * page as it renders TODAY, both tabs, both hosts, both themes, at
 * 1024x768, so drift is visible at every later commit (execution default 9).
 *
 * Pattern followed: `../marketplace/marketplace-visual.e2e.spec.ts`
 * (`waitForSettled`, `useAppBuild: true`, captures written under
 * `.ptah/specs/<task>/screenshots/angular/`).
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { bootSettings, gotoSettingsTab, waitForSettled } from './settings.fixtures';

test.use({ useAppBuild: true });

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../../../../../../.ptah/specs/TASK_2026_555/screenshots/angular');

/**
 * Per-batch smoke captures are `current-*`. The `baseline-*` "before" images the visual gates
 * compare against are written only on an explicit `SETTINGS_CAPTURE_BASELINE=1` run.
 */
const CAPTURE_KIND = process.env['SETTINGS_CAPTURE_BASELINE'] === '1' ? 'baseline' : 'current';

function capturePath(tab: string, host: string, theme: string): string {
  return join(OUT_DIR, `${CAPTURE_KIND}-${tab}-${host}-${theme}-1024x768.png`);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

const TABS: readonly { readonly label: 'Providers' | 'Agent Orchestration'; readonly name: string }[] = [
  { label: 'Providers', name: 'providers' },
  { label: 'Agent Orchestration', name: 'orchestration' },
];

/**
 * Connection drawers compared with `prototypes/final/screenshots/interactions/drawer-*.png` (Batch 20)
 * and with the prototype's Credentials markup (`prototypes/final/index.html`, Batch 21). `tab` is the
 * drawer tab shown; Overview when absent.
 */
const DRAWERS: readonly { readonly card: string; readonly name: string; readonly tab?: string; readonly ready?: string }[] = [
  { card: 'Moonshot', name: 'drawer-moonshot' },
  { card: 'sovereigneg', name: 'drawer-sovereigneg' },
  { card: 'Moonshot', name: 'drawer-moonshot-credentials', tab: 'Credentials' },
  { card: 'Claude (Subscription)', name: 'drawer-claude-cli-credentials', tab: 'Credentials' },
  // Batch 22. `ready`: the pickers' catalogue has loaded (their tool-use summary renders).
  { card: 'Moonshot', name: 'drawer-moonshot-models', tab: 'Models & Tiers',
    ready: '[data-tier="haiku"] [data-testid="provider-model-picker-tooluse-summary"]' },
  { card: 'sovereigneg', name: 'drawer-sovereigneg-models', tab: 'Models & Tiers',
    ready: '[data-tier="haiku"] [data-testid="provider-model-picker-tooluse-summary"]' },
  { card: 'sovereigneg', name: 'drawer-sovereigneg-advanced', tab: 'Advanced', ready: '[data-testid="advanced-base-url"]' },
];

/**
 * The drawer slides its panel in (translateX) and fades its backdrop in (`native-drawer.component.ts`
 * keyframes). Waits for those two animations to finish, then asserts the panel sits fully inside the
 * viewport against the trailing edge, so a mid-slide frame is never captured and a real layout clip
 * fails here instead of passing as a screenshot.
 */
async function waitForDrawerOpened(page: Page): Promise<void> {
  const root = page.locator('[data-testid="native-drawer-root"]');
  // Only the drawer's own entry keyframes (`ptah-drawer-*`). Incidental tab colour transitions and
  // button pops started by the tab click could leave `finished` unsettled when read at once (Batch 22:
  // electron hung here intermittently; with a 5 s grace every animation had finished). The screenshot
  // disables animations anyway, and the box check below still catches a mid-slide panel.
  await root.evaluate((element) => Promise.all(element.getAnimations({ subtree: true })
    .filter((animation) => animation instanceof CSSAnimation && animation.animationName.includes('ptah-drawer-'))
    .map((animation) => animation.finished)));
  const box = await page.locator('[data-testid="native-drawer-panel"]').boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(Math.abs(box.x + box.width - viewport.width)).toBeLessThanOrEqual(1);
  // Every tab fits on one line inside the panel (the prototype's single-row tab strip).
  const tabs = page.locator('[data-testid="native-drawer-panel"] [role="tablist"]');
  expect(await tabs.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
}

for (const host of ['vscode', 'electron'] as const) {
  for (const theme of ['anubis', 'anubis-light'] as const) {
    test(`baseline smoke — both tabs (${host}, ${theme})`, async ({ page, fixtureServer }) => {
      await bootSettings(page, fixtureServer.url, host, theme);
      await page.setViewportSize({ width: 1024, height: 768 });
      for (const tab of TABS) {
        await gotoSettingsTab(page, tab.label);
        await waitForSettled(page);
        await page.screenshot({ path: capturePath(tab.name, host, theme) });
      }
      await gotoSettingsTab(page, 'Providers');
      // Batch 24: compact cards (plan: ≤ 80 px each) in a 1 / 2 / 3 column grid; measured here, per host.
      const cards = page.locator('[data-testid="provider-connection-card"]');
      await expect(cards.first()).toBeVisible();
      const heights = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
      const widths = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
      const columns = await page.locator('[data-testid="connections-grid"]').evaluate((grid) =>
        getComputedStyle(grid).gridTemplateColumns.split(' ').length);
      console.log(`B24 cards ${host}/${theme}: heights ${heights.join(',')} px, widths ${widths.join(',')} px, ${columns} columns`);
      expect(columns).toBe(3);
      // ≤ 80 px holds where the page is as wide as planned (VS Code: ~269 px cards). In Electron the shell's
      // sidebar leaves ~215 px cards at the same `lg` breakpoint and rows wrap: escalated (Q-extra-1,
      // batch-24-report.md), measured and logged here, asserted by the Batch 28 fold gate once decided.
      if (host === 'vscode') for (const height of heights) expect(height).toBeLessThanOrEqual(80);
      // Batch 25: the routing map's three work nodes (deferred chunk; wait for it, not its placeholder).
      const nodes = page.locator('[data-testid^="routing-node-"][data-testid$="agent"], [data-testid="routing-node-background-roles"], [data-testid="routing-node-cli-agents"]');
      await expect(page.locator('[data-testid="routing-map"]')).toBeVisible();
      await expect(nodes).toHaveCount(3);
      const nodeBoxes = await nodes.evaluateAll((all) => all.map((node) => {
        const box = node.getBoundingClientRect();
        return { w: Math.round(box.width), h: Math.round(box.height), top: Math.round(box.top) };
      }));
      const nodeColumns = await page.locator('[data-testid="routing-map-nodes"]').evaluate((grid) =>
        getComputedStyle(grid).gridTemplateColumns.split(' ').length);
      console.log(`B25 nodes ${host}/${theme}: ${nodeBoxes.map((b) => `${b.w}x${b.h}@${b.top}`).join(', ')}, ${nodeColumns} columns`);
      // Container-width columns (Q-extra-1 rule): 3 side by side in VS Code, 2 in Electron's narrower page.
      expect(nodeColumns).toBe(host === 'vscode' ? 3 : 2);
      // Node titles never wrap (one line of 16px at text-xs leading).
      for (const height of await page.locator('[data-testid="routing-map"] h3').evaluateAll((all) => all.map((h) => h.getBoundingClientRect().height))) {
        expect(height).toBeLessThanOrEqual(20);
      }
      // Batch 23 (D16): every scope badge names its field; the open popover is its own capture.
      const badges = page.locator('[data-testid="scope-badge"]');
      // The scopes read lands after the tab renders; the fixture overrides the effort key.
      await expect(badges.first()).toBeVisible();
      for (const field of await badges.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-field')))) {
        expect(field?.trim()).toBeTruthy();
      }
      await badges.first().click();
      await expect(page.locator('[data-testid="scope-popover"]')).toBeVisible();
      await waitForSettled(page);
      await page.screenshot({ path: capturePath('scope-popover', host, theme), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="scope-popover"]')).toHaveCount(0);
      const drawer = page.locator('[data-testid="connection-detail-drawer"]');
      for (const entry of DRAWERS) {
        // Batch 24: the card itself opens the drawer (a click on its name, clear of the inline action).
        await page.locator('[data-testid="provider-connection-card"]').filter({ hasText: entry.card })
          .locator('[data-testid="provider-name"]').click();
        await expect(drawer).toBeVisible();
        if (entry.tab) await page.getByRole('tab', { name: entry.tab, exact: true }).click();
        if (entry.ready) await expect(page.locator(entry.ready)).toBeVisible();
        await waitForSettled(page);
        await waitForDrawerOpened(page);
        await page.screenshot({ path: capturePath(entry.name, host, theme), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);
      }
    });
  }
}
