/**
 * E2E: Orchestration tab interaction scenes (TASK_2026_555). Batch 32 starts this file with the Batch 14 review's
 * carry-forward (finding 3) for the two CLI-matrix modals: focus moves into the dialog on open, stays inside it on Tab,
 * and returns to the opener (the "Add Ptah CLI Instance" button / Glm's Tiers) after Esc, a backdrop click and a
 * submit. Batch 36 adds the tab's remaining scenes here.
 *
 * Runs against the real `ptah-extension-webview` build in both hosts. Each scene boots fresh, so the fixture state
 * starts from the BRIEF baseline.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { bootSettings, getFixtureState, waitForSettled } from './settings.fixtures';
import { expectCall, orchestrationTab } from './settings-drawer.reach';

test.use({ useAppBuild: true });

const HOSTS = ['vscode', 'electron'] as const;
const GLM_ID = 'glm-instance-1';

interface ModalCase {
  readonly name: string;
  readonly testid: string;
  readonly opener: (page: Page) => Locator;
}

const MODALS: readonly ModalCase[] = [
  { name: 'add-instance modal', testid: 'add-cli-instance-modal', opener: (page) => page.locator('[data-testid="cli-matrix-add"]') },
  { name: 'tier-mapping modal', testid: 'cli-tier-mapping-modal', opener: (page) => page.locator(`[data-testid="cli-matrix-tiers-${GLM_ID}"]`) },
];

const dialogOf = (page: Page, testid: string): Locator => page.locator(`dialog:has([data-testid="${testid}"])`);

async function open(page: Page, modal: ModalCase): Promise<Locator> {
  await modal.opener(page).click();
  const dialog = dialogOf(page, modal.testid);
  await expect(dialog).toHaveAttribute('open', '');
  // showModal() moves focus into the dialog.
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  return dialog;
}

async function expectClosedToOpener(page: Page, modal: ModalCase): Promise<void> {
  await expect(dialogOf(page, modal.testid)).not.toHaveAttribute('open');
  await expect(modal.opener(page)).toBeFocused();
}

for (const host of HOSTS) {
  test.describe(`webview > settings > orchestration scenes (${host})`, () => {
    test.beforeEach(async ({ page, fixtureServer }) => {
      await bootSettings(page, fixtureServer.url, host);
      await waitForSettled(page);
      await orchestrationTab(page);
      await expect(page.locator('[data-testid="cli-matrix"]')).toBeVisible();
    });

    for (const modal of MODALS) {
      test(`${modal.name} (Batch 14 finding 3): focus moves in, Tab stays inside, Esc returns focus to the opener`, async ({ page }) => {
        const dialog = await open(page, modal);
        for (let i = 0; i < 14; i += 1) {
          await page.keyboard.press('Tab');
          expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
        }
        // A tier field opens its list on focus, and its Esc closes only that list (the shared search field's rule);
        // the dialog stays open and the next Esc closes it.
        if (await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded') === 'true')) {
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveAttribute('open', '');
          await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))).toBe('false');
        }
        await page.keyboard.press('Escape');
        await expectClosedToOpener(page, modal);
      });

      test(`${modal.name}: a backdrop click closes it and focus returns to the opener`, async ({ page }) => {
        await open(page, modal);
        // The backdrop is the dialog's own ::backdrop area: a click outside the panel.
        await page.mouse.click(5, 5);
        await expectClosedToOpener(page, modal);
      });
    }

    test('add-instance modal: a create closes it and focus returns to Add', async ({ page }) => {
      const modal = MODALS[0];
      const dialog = await open(page, modal);
      const before = getFixtureState(page).calls.length;
      await dialog.locator('[data-testid="add-cli-instance-name"]').fill('Llama-Local');
      // A local provider needs no key (#48).
      await dialog.locator('[data-testid="add-cli-instance-provider"]').selectOption('ollama');
      await expect(dialog.locator('[data-testid="add-cli-instance-key-help"]')).toContainText('No API key needed');
      await dialog.locator('[data-testid="add-cli-instance-submit"]').click();
      await expectCall(page, before, 'ptahCli:create', { name: 'Llama-Local', providerId: 'ollama', apiKey: '' });
      await expectClosedToOpener(page, modal);
      await expect(page.locator('[data-testid="settings-toast-message"]').last()).toContainText('Saved Ptah CLI instance Llama-Local');
      await expect(page.locator('[data-testid^="cli-matrix-row-created-"]')).toContainText('Llama-Local');
    });

    test('tier-mapping modal: "Done" closes it and focus returns to Tiers', async ({ page }) => {
      const modal = MODALS[1];
      const dialog = await open(page, modal);
      await dialog.locator('[data-testid="cli-tier-mapping-done"]').click();
      await expectClosedToOpener(page, modal);
    });

    test('edit modal (#50): a rename sends ptahCli:update with the new name only', async ({ page }) => {
      const edit = page.locator(`[data-testid="cli-matrix-edit-${GLM_ID}"]`);
      await edit.click();
      const dialog = dialogOf(page, 'add-cli-instance-modal');
      await expect(dialog).toHaveAttribute('open', '');
      await expect(dialog.locator('[data-testid="add-cli-instance-provider-fixed"]')).toHaveText('Ollama Cloud');
      const before = getFixtureState(page).calls.length;
      await dialog.locator('[data-testid="add-cli-instance-name"]').fill('Glm-Main');
      await dialog.locator('[data-testid="add-cli-instance-submit"]').click();
      await expectCall(page, before, 'ptahCli:update', { id: GLM_ID, name: 'Glm-Main' });
      await expect(dialog).not.toHaveAttribute('open');
      await expect(edit).toBeFocused();
    });
  });
}
