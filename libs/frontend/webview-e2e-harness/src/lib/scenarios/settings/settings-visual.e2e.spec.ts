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
const DRAWERS: readonly { readonly card: string; readonly name: string; readonly tab?: string }[] = [
  { card: 'Moonshot', name: 'drawer-moonshot' },
  { card: 'sovereigneg', name: 'drawer-sovereigneg' },
  { card: 'Moonshot', name: 'drawer-moonshot-credentials', tab: 'Credentials' },
  { card: 'Claude (Subscription)', name: 'drawer-claude-cli-credentials', tab: 'Credentials' },
];

/**
 * The drawer slides its panel in (translateX) and fades its backdrop in (`native-drawer.component.ts`
 * keyframes). Waits for those animations to finish, then asserts the panel sits fully inside the
 * viewport against the trailing edge, so a mid-slide frame is never captured and a real layout clip
 * fails here instead of passing as a screenshot.
 */
async function waitForDrawerOpened(page: Page): Promise<void> {
  const root = page.locator('[data-testid="native-drawer-root"]');
  await root.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
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
      const drawer = page.locator('[data-testid="connection-detail-drawer"]');
      for (const entry of DRAWERS) {
        await page.locator('[data-testid="provider-connection-card"]').filter({ hasText: entry.card })
          .locator('[data-testid="btn-manage"]').click();
        await expect(drawer).toBeVisible();
        if (entry.tab) await page.getByRole('tab', { name: entry.tab, exact: true }).click();
        await waitForSettled(page);
        await waitForDrawerOpened(page);
        await page.screenshot({ path: capturePath(entry.name, host, theme), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);
      }
    });
  }
}
