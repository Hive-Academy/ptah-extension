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
    });
  }
}
