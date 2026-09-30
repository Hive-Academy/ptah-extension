/**
 * E2E: Providers tab interaction scenes (TASK_2026_555 Batch 28, Task 28.1 "Validation notes").
 *
 * Runs against the real `ptah-extension-webview` build in both hosts, like the reachability spec. Each scene
 * boots fresh, so the fixture state (`getFixtureState`) starts from the BRIEF baseline and every RPC a scene
 * asserts was sent by that scene's own clicks.
 *
 * Two validation-note scenes cannot run here and are `fixme` with the reason:
 * - the popover model search: FLAGGED for the user at Gate V 28 (the popover's model control is a plain select);
 * - the `main-model` deep link: its only in-app trigger is the Setup Wizard's "Manage model in Providers", a
 *   separate webview surface this harness does not boot. `settings.component.spec.ts` (section routing) and
 *   `providers-settings.component.spec.ts` ("the %s deep link opens the popover focused on that control") cover it.
 */
import { test, expect } from '../../test-fixtures';
import { bootSettings, getFixtureState, waitForSettled } from './settings.fixtures';
import {
  catalogDialog, closeConnectionDrawer, confirmWrite, connectProviderButton, credentialsOf, expectCall, expectCatalogOpen,
  openCardDrawer, openCatalog, openMainAgentPopover, providersTab, visibleEnabled, withAuthStatus,
} from './settings-drawer.reach';

test.use({ useAppBuild: true });

const HOSTS = ['vscode', 'electron'] as const;

/** One card per connection kind in the fixture; tabs as `connection-kind.ts` TABS_BY_KIND (Advanced is custom-only). */
const BASE_TABS = ['Overview & Used By', 'Credentials', 'Models & Tiers'];
const KINDS: readonly { readonly kind: string; readonly card: string; readonly tabs: readonly string[] }[] = [
  { kind: 'claude-cli', card: 'Claude (Subscription)', tabs: BASE_TABS },
  { kind: 'api-key', card: 'Moonshot', tabs: BASE_TABS },
  { kind: 'oauth', card: 'OpenAI Codex', tabs: BASE_TABS },
  { kind: 'custom', card: 'sovereigneg', tabs: [...BASE_TABS, 'Advanced'] },
];

for (const host of HOSTS) {
  test.describe(`webview > settings > providers scenes (${host})`, () => {
    test.beforeEach(async ({ page, fixtureServer }) => {
      await bootSettings(page, fixtureServer.url, host);
      await waitForSettled(page);
      await providersTab(page);
    });

    for (const { kind, card, tabs } of KINDS) {
      test(`card -> drawer (${kind}): the card opens its own drawer with its tabs`, async ({ page }) => {
        await openCardDrawer(page, card);
        await expect(page.locator('[data-testid="connection-drawer-title"]')).toContainText(card);
        // The tab strip belongs to the drawer panel (`NativeDrawerComponent`), not to the drawer's body content.
        await expect(page.locator('[data-testid="native-drawer-panel"]').getByRole('tab')).toHaveText(tabs);
        await closeConnectionDrawer(page);
      });
    }

    test('drawer Credentials: Delete key sends auth:deleteStoredKey after the inline confirm', async ({ page }) => {
      await credentialsOf(page, 'Moonshot');
      await confirmWrite(page, 'credentials-delete', 'credentials-delete-confirm-button', 'auth:deleteStoredKey', { providerId: 'moonshot' });
      await closeConnectionDrawer(page);
    });

    test('drawer Credentials: GitHub Copilot Sign out sends auth:copilotLogout after the inline confirm', async ({ page }) => {
      await withAuthStatus(page, { copilotAuthenticated: true }, async () => {
        await credentialsOf(page, 'GitHub Copilot');
        await confirmWrite(page, 'credentials-sign-out', 'credentials-sign-out-confirm-button', 'auth:copilotLogout', {});
      });
    });

    test('catalog -> wizard: choosing a provider closes the modal and opens setup preselected on it', async ({ page }) => {
      const dialog = await openCatalog(page);
      await dialog.getByRole('button', { name: 'Connect OpenRouter', exact: true }).click();
      await expectCatalogOpen(page, false);
      await expect(page.locator('[data-testid="wizard-body"]')).toBeVisible();
      await expect(page.locator('[data-testid="wizard-step-provider"] input[type="radio"]:checked')).toHaveCount(1);
      await page.locator('[data-testid="wizard-cancel"]').click();
      // A preselected provider is a draft, so Cancel asks to discard it. Wait for that review to render
      // (an instant visibility check races it, as `closeWizard` in the reachability table explains).
      const discard = page.locator('[data-testid="wizard-discard-confirm"]');
      await discard.waitFor({ state: 'visible', timeout: 2000 }).then(() => discard.click()).catch(() => undefined);
      await expect(page.locator('[data-testid="wizard-body"]')).toHaveCount(0);
    });

    test('catalog modal (Batch 14 finding 3): Tab stays inside; the backdrop closes it and focus returns to the opener', async ({ page }) => {
      const dialog = await openCatalog(page);
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      }
      // The backdrop is the dialog's own ::backdrop area: a click outside the panel.
      await page.mouse.click(5, 5);
      await expectCatalogOpen(page, false);
      await expect(connectProviderButton(page)).toBeFocused();
      await expect(catalogDialog(page)).not.toHaveAttribute('open');
    });

    test('popover model: a save shows a toast, and Undo sends a second config:model-switch with the previous model', async ({ page }) => {
      const popover = await openMainAgentPopover(page);
      const select = popover.locator('[data-testid="main-agent-model"]');
      await expect(select).toBeEnabled();
      const models = (await select.locator('option').evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value)))
        .filter((value) => value && value !== '__manual__');
      expect(models.length).toBeGreaterThanOrEqual(2);
      const state = getFixtureState(page);
      // The fixture starts on the provider default (''), which has nothing to undo to: set a first model.
      await select.selectOption(models[0]);
      await expect.poll(() => state.model).toBe(models[0]);
      const before = state.calls.length;
      await expect(select).toBeEnabled();
      await select.selectOption(models[1]);
      await expectCall(page, before, 'config:model-switch', expect.objectContaining({ model: models[1] }));
      const toast = page.locator('[data-testid="settings-toast"]');
      await expect(toast.locator('[data-testid="settings-toast-message"]')).toContainText('Saved main agent model');
      await visibleEnabled(toast.locator('[data-testid="settings-toast-undo"]'));
      await toast.locator('[data-testid="settings-toast-undo"]').click();
      await expect.poll(() => state.calls.slice(before).filter((call) => call.method === 'config:model-switch').length).toBe(2);
      await expectCall(page, before, 'config:model-switch', expect.objectContaining({ model: models[0] }));
      await expect.poll(() => state.model).toBe(models[0]);
    });

    test('popover provider: a change asks first (D6 copy) and writes nothing until confirmed', async ({ page }) => {
      const popover = await openMainAgentPopover(page);
      const before = getFixtureState(page).calls.length;
      await popover.locator('[data-testid="main-agent-provider"]').selectOption('moonshot');
      await expect(popover.locator('[data-testid="main-agent-provider-copy"]'))
        .toHaveText('New main-agent requests use Moonshot (Kimi). Changing the provider ends running chat sessions.');
      await visibleEnabled(popover.getByRole('button', { name: 'Use for main agent', exact: true }));
      expect(getFixtureState(page).calls.slice(before).some((call) => call.method === 'auth:saveSettings')).toBe(false);
      await popover.getByRole('button', { name: 'Cancel provider change', exact: true }).click();
      await expect(popover.locator('[data-testid="main-agent-provider-confirm"]')).toHaveCount(0);
      expect(getFixtureState(page).calls.slice(before).some((call) => call.method === 'auth:saveSettings')).toBe(false);
    });

    test.fixme('deep link main-model opens the popover on the model control', () => {
      // No in-app trigger inside the settings harness (see the file header); covered by unit specs.
    });

    test.fixme('popover model search filters the models', () => {
      // FLAGGED at Gate V 28: the popover's model control is a plain select (no compact searchable picker).
    });
  });
}
