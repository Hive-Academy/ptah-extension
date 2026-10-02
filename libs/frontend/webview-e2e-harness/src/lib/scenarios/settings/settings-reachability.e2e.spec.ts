/**
 * E2E: Settings Gate G — reachability (TASK_2026_555 Batch 16, Task 16.1;
 * plan D14, Component 14, implementation-plan.md:797-820, §6 rule 6).
 *
 * Runs against the REAL `ptah-extension-webview` build (`useAppBuild: true`),
 * exactly like `../marketplace/marketplace-routes.e2e.spec.ts`. Frozen here
 * as the S4 baseline: every `present` entry in
 * `settings-reachability.table.ts` must pass in BOTH hosts, the entry count
 * must equal `EXPECTED_CAPABILITY_COUNT`, and no entry that was `present` in
 * this commit may regress to `pending` in a later one (D14 rules 1-3). This
 * spec runs at the end of every batch from Batch 16 on (execution default 7),
 * backend batches included — a red run here blocks the commit even when the
 * batch's own tests are green.
 */
import { test, expect } from '../../test-fixtures';
import { bootSettings, gotoSettingsTab, waitForSettled } from './settings.fixtures';
import {
  BASELINE_PRESENT_IDS,
  EXPECTED_CAPABILITY_COUNT,
  KEPT_SELECTORS,
  REACHABILITY_TABLE,
} from './settings-reachability.table';

test.use({ useAppBuild: true });

const HOSTS = ['vscode', 'electron'] as const;

test.describe('webview > settings > reachability > guards', () => {
  test('the capability count never drops (D14 rule 2)', () => {
    expect(REACHABILITY_TABLE.length).toBe(EXPECTED_CAPABILITY_COUNT);
  });

  test('every baseline id exists in the table and is present or restored, never pending or missing (D14 rule 3)', () => {
    // code-logic-review Blocking #1: `byId.get(id)` returning `undefined`
    // (a deleted or renamed id) used to satisfy `.not.toBe('pending')`
    // silently. `toBeDefined()` closes that hole; `toContain` then pins the
    // only two statuses a baseline id may legitimately carry.
    const byId = new Map(REACHABILITY_TABLE.map((entry) => [entry.id, entry.status]));
    for (const id of BASELINE_PRESENT_IDS) {
      const status = byId.get(id);
      expect(status, `${id} is missing from REACHABILITY_TABLE`).toBeDefined();
      expect(['present', 'restored'], `${id} regressed to ${status}`).toContain(status);
    }
  });

  test('every table id is unique', () => {
    const ids = REACHABILITY_TABLE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the guard covers exactly 64 frozen baseline ids', () => {
    expect(BASELINE_PRESENT_IDS.length).toBe(64);
    expect(new Set(BASELINE_PRESENT_IDS).size).toBe(64);
  });

  test('both hosts are actually run (moderate #6)', () => {
    // A regression here (e.g. someone "temporarily" commenting out
    // 'electron' to speed up a local run) would otherwise pass Gate G while
    // only ever exercising one host.
    expect(HOSTS).toEqual(['vscode', 'electron']);
  });
});

for (const host of HOSTS) {
  test.describe(`webview > settings > reachability (${host})`, () => {
    test('every present/restored capability is reachable', async ({ page, fixtureServer }) => {
      // 64 sequential real-click entries in one session (each opens and
      // closes its own control) comfortably exceed the 30s default. Batch 49
      // added the Advanced and Search & Voice entries (about 2 minutes more,
      // and the base entries alone took up to 3.4 minutes under load).
      test.setTimeout(600_000);
      await bootSettings(page, fixtureServer.url, host);
      await waitForSettled(page);

      const failures: string[] = [];
      for (const entry of REACHABILITY_TABLE) {
        if (entry.status === 'pending') continue;
        await test.step(`${entry.id} ${entry.capability}`, async () => {
          try {
            await entry.reach(page);
          } catch (error) {
            failures.push(`${entry.id} (${entry.capability}): ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            // code-logic-review Serious #4 / FM-4: a step that throws
            // before its own cleanup ran (or whose cleanup itself failed
            // inside a crashed wizard) must not leave a stray overlay open
            // for the NEXT 63 entries to collide with. Each `reach` already
            // closes what it opens on the happy path; this is the backstop
            // for the unhappy one. Every recovery action is best-effort —
            // only the NEXT entry's own assertion is allowed to fail loudly.
            if (await page.locator('[data-testid="wizard-body"]').count()) {
              await page.locator('[data-testid="wizard-cancel"]').click({ timeout: 3000 }).catch(() => undefined);
              await page.keyboard.press('Escape').catch(() => undefined);
            }
            if (await page.locator('[data-testid="wizard-body"]').count()) {
              // Still stuck: force a remount by leaving and re-entering
              // Providers (`ProvidersSettingsComponent` is torn down by the
              // `@if` in settings.component.html on tab switch).
              await page.getByRole('button', { name: 'Advanced', exact: true }).click().catch(() => undefined);
            }
          }
        });
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });

    test('kept selectors survive (settings-tour.scene.ts, workspace-settings.shot.ts)', async ({
      page,
      fixtureServer,
    }) => {
      await bootSettings(page, fixtureServer.url, host);
      await waitForSettled(page);
      for (const { selector, tab, reveal } of KEPT_SELECTORS) {
        await gotoSettingsTab(page, tab);
        if (reveal) await page.locator(reveal).click();
        await expect(page.locator(selector).first()).toBeVisible();
      }
      // Tab buttons by role and name (plan §6 finding 7's fourth kept item).
      for (const label of ['Providers', 'Agent Orchestration', 'Advanced', 'Search & Voice']) {
        await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
      }
      await page.getByRole('button', { name: 'Advanced', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Export settings' })).toBeVisible();
      await page.getByRole('button', { name: 'Search & Voice', exact: true }).click();
      await expect(page.locator('[data-testid^="settings-toggle-web-search-provider"]').first()).toBeVisible();
    });
  });
}
