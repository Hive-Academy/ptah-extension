/**
 * E2E: Providers tab interaction scenes (TASK_2026_555 Batch 28, Task 28.1 "Validation notes").
 *
 * Runs against the real `ptah-extension-webview` build in both hosts, like the reachability spec. Each scene
 * boots fresh, so the fixture state (`getFixtureState`) starts from the BRIEF baseline and every RPC a scene
 * asserts was sent by that scene's own clicks.
 *
 * One validation-note scene cannot run here and is `fixme` with the reason (the popover model search runs since
 * Batch 28b, the compact searchable control):
 */
import { test, expect } from '../../test-fixtures';
import {
  bootSettings,
  getFixtureState,
  waitForSettled,
} from './settings.fixtures';
import {
  card,
  catalogDialog,
  chooseMainAgentModel,
  closeConnectionDrawer,
  confirmWrite,
  connectProviderButton,
  credentialsOf,
  expectCall,
  expectCatalogOpen,
  mainAgentModelInput,
  openCardDrawer,
  openCatalog,
  openMainAgentPopover,
  providersTab,
  visibleEnabled,
  withAuthStatus,
} from './settings-drawer.reach';

test.use({ useAppBuild: true });

const HOSTS = ['vscode', 'electron'] as const;

/** One card per connection kind in the fixture; tabs as `connection-kind.ts` TABS_BY_KIND (Advanced is custom-only). */
const BASE_TABS = ['Overview & Used By', 'Credentials', 'Models & Tiers'];
const KINDS: readonly {
  readonly kind: string;
  readonly card: string;
  readonly tabs: readonly string[];
}[] = [
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
      test(`card -> drawer (${kind}): the card opens its own drawer with its tabs`, async ({
        page,
      }) => {
        await openCardDrawer(page, card);
        await expect(
          page.locator('[data-testid="connection-drawer-title"]'),
        ).toContainText(card);
        // The tab strip belongs to the drawer panel (`NativeDrawerComponent`), not to the drawer's body content.
        await expect(
          page.locator('[data-testid="native-drawer-panel"]').getByRole('tab'),
        ).toHaveText(tabs);
        await closeConnectionDrawer(page);
      });
    }

    test('drawer Credentials: Delete key sends auth:deleteStoredKey after the inline confirm', async ({
      page,
    }) => {
      await credentialsOf(page, 'Moonshot');
      await confirmWrite(
        page,
        'credentials-delete',
        'credentials-delete-confirm-button',
        'auth:deleteStoredKey',
        { providerId: 'moonshot' },
      );
      await closeConnectionDrawer(page);
    });

    test('drawer Credentials: GitHub Copilot Sign out sends auth:copilotLogout after the inline confirm', async ({
      page,
    }) => {
      await withAuthStatus(page, { copilotAuthenticated: true }, async () => {
        await credentialsOf(page, 'GitHub Copilot');
        await confirmWrite(
          page,
          'credentials-sign-out',
          'credentials-sign-out-confirm-button',
          'auth:copilotLogout',
          {},
        );
      });
    });

    test('catalog -> wizard: choosing a provider closes the modal and opens setup preselected on it', async ({
      page,
    }) => {
      const dialog = await openCatalog(page);
      await dialog
        .getByRole('button', { name: 'Connect OpenRouter', exact: true })
        .click();
      await expectCatalogOpen(page, false);
      await expect(page.locator('[data-testid="wizard-body"]')).toBeVisible();
      await expect(
        page.locator(
          '[data-testid="wizard-step-provider"] input[type="radio"]:checked',
        ),
      ).toHaveCount(1);
      await page.locator('[data-testid="wizard-cancel"]').click();
      // A preselected provider is a draft, so Cancel asks to discard it. Wait for that review to render
      // (an instant visibility check races it, as `closeWizard` in the reachability table explains).
      const discard = page.locator('[data-testid="wizard-discard-confirm"]');
      await discard
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => discard.click())
        .catch(() => undefined);
      await expect(page.locator('[data-testid="wizard-body"]')).toHaveCount(0);
    });

    test('catalog modal (Batch 14 finding 3): Tab stays inside; the backdrop closes it and focus returns to the opener', async ({
      page,
    }) => {
      const dialog = await openCatalog(page);
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        expect(
          await dialog.evaluate((node) =>
            node.contains(document.activeElement),
          ),
        ).toBe(true);
      }
      // The backdrop is the dialog's own ::backdrop area: a click outside the panel.
      await page.mouse.click(5, 5);
      await expectCatalogOpen(page, false);
      await expect(connectProviderButton(page)).toBeFocused();
      await expect(catalogDialog(page)).not.toHaveAttribute('open');
    });

    test('popover model: nothing is written before Save; Save shows a toast, and Undo sends a second config:model-switch with the previous model', async ({
      page,
    }) => {
      const state = getFixtureState(page);
      // Batch 4 (TASK_PROVIDER_SCOPE): a choice is a draft; Save writes it and closes the popover.
      const saveModel = async (option: string) => {
        const popover = await openMainAgentPopover(page);
        const start = state.calls.length;
        await chooseMainAgentModel(page, popover, option);
        expect(
          state.calls
            .slice(start)
            .some((call) => call.method === 'config:model-switch'),
        ).toBe(false);
        await popover.locator('[data-testid="main-agent-save"]').click();
        await expect(popover).toHaveCount(0);
      };
      // The fixture starts on the provider default (''), which has nothing to undo to: set a first model.
      await saveModel('Kimi K2.5 [Tool: Yes]');
      await expect.poll(() => state.model).toBe('kimi-k2.5');
      const before = state.calls.length;
      await saveModel('Kimi Lite [Tool: No]');
      await expectCall(
        page,
        before,
        'config:model-switch',
        expect.objectContaining({ model: 'kimi-lite' }),
      );
      const toast = page.locator('[data-testid="settings-toast"]');
      await expect(
        toast.locator('[data-testid="settings-toast-message"]'),
      ).toContainText('Saved main agent model');
      await visibleEnabled(
        toast.locator('[data-testid="settings-toast-undo"]'),
      );
      await toast.locator('[data-testid="settings-toast-undo"]').click();
      await expect
        .poll(
          () =>
            state.calls
              .slice(before)
              .filter((call) => call.method === 'config:model-switch').length,
        )
        .toBe(2);
      await expectCall(
        page,
        before,
        'config:model-switch',
        expect.objectContaining({ model: 'kimi-k2.5' }),
      );
      await expect.poll(() => state.model).toBe('kimi-k2.5');
    });

    test('popover provider: a change asks first (D6 copy) and writes nothing until confirmed', async ({
      page,
    }) => {
      const popover = await openMainAgentPopover(page);
      const before = getFixtureState(page).calls.length;
      await popover
        .locator('[data-testid="main-agent-provider"]')
        .selectOption('moonshot');
      await expect(
        popover.locator('[data-testid="main-agent-provider-copy"]'),
      ).toHaveText(
        'New main-agent requests use Moonshot (Kimi). Changing the provider ends running chat sessions in this workspace.',
      );
      await visibleEnabled(
        popover.getByRole('button', {
          name: 'Use for main agent',
          exact: true,
        }),
      );
      expect(
        getFixtureState(page)
          .calls.slice(before)
          .some((call) => call.method === 'auth:saveSettings'),
      ).toBe(false);
      await popover
        .getByRole('button', { name: 'Cancel provider change', exact: true })
        .click();
      await expect(
        popover.locator('[data-testid="main-agent-provider-confirm"]'),
      ).toHaveCount(0);
      expect(
        getFixtureState(page)
          .calls.slice(before)
          .some((call) => call.method === 'auth:saveSettings'),
      ).toBe(false);
    });

    test.fixme('deep link main-model opens the popover on the model control', () => {
      // No in-app trigger inside the settings harness (see the file header); covered by unit specs.
    });

    test('popover model search filters the models; keys move, Enter picks, Esc closes the list before the popover', async ({
      page,
    }) => {
      const popover = await openMainAgentPopover(page);
      const input = mainAgentModelInput(popover);
      await visibleEnabled(input);
      await expect(input).toHaveAttribute('role', 'combobox');
      await expect(input).toHaveAccessibleName('Main agent model');
      await input.click();
      await expect(input).toHaveAttribute('aria-expanded', 'true');
      const listbox = page.locator(
        `[id="${await input.getAttribute('aria-controls')}"]`,
      );
      // Unfiltered: the catalogue (each with its tool-use marker), then the pinned "Enter a model ID…".
      await expect(listbox.getByRole('option')).toHaveText([
        'Default (chosen by Claude)',
        'Kimi K2.5 [Tool: Yes]',
        'Kimi K2.7 Code [Tool: Yes]',
        'Kimi Lite [Tool: No]',
        'Enter a model ID…',
      ]);
      await input.fill('lite');
      await expect(listbox.getByRole('option')).toHaveText([
        'Kimi Lite [Tool: No]',
        'Enter a model ID…',
      ]);
      await input.fill('no-such-model');
      await expect(listbox.getByRole('option')).toHaveText([
        'Enter a model ID…',
      ]);
      // Esc closes the list only; the popover stays; the next Esc closes the popover.
      await page.keyboard.press('Escape');
      await expect(input).toHaveAttribute('aria-expanded', 'false');
      await expect(popover).toBeVisible();
      // Keyboard pick: filter, Home to the first row (aria-activedescendant follows), Enter saves it.
      const before = getFixtureState(page).calls.length;
      await input.fill('k2.7');
      await page.keyboard.press('Home');
      // The attribute follows the next render, so it is polled, never read once (Batch 36c.j): the active row's text,
      // through whatever id the attribute names at each read.
      await expect
        .poll(async () => {
          const active = await input.getAttribute('aria-activedescendant');
          return active
            ? ((await page.locator(`[id="${active}"]`).textContent())?.trim() ??
                null)
            : null;
        })
        .toBe('Kimi K2.7 Code [Tool: Yes]');
      // Batch 4 (TASK_PROVIDER_SCOPE): Enter picks the model into the draft; nothing is written yet.
      await page.keyboard.press('Enter');
      await expect(input).toHaveValue('Kimi K2.7 Code [Tool: Yes]');
      await expect(input).toBeFocused();
      expect(
        getFixtureState(page)
          .calls.slice(before)
          .some((call) => call.method === 'config:model-switch'),
      ).toBe(false);
      // ArrowDown reopens the list; Esc closes the list only.
      await page.keyboard.press('ArrowDown');
      await expect(input).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(input).toHaveAttribute('aria-expanded', 'false');
      await expect(popover).toBeVisible();
      // Save writes the drafted model and closes the popover.
      await popover.locator('[data-testid="main-agent-save"]').click();
      await expectCall(
        page,
        before,
        'config:model-switch',
        expect.objectContaining({ model: 'kimi-k2.7-code' }),
      );
      await expect(popover).toHaveCount(0);
    });

    test('popover Cancel discards the draft: nothing is written and the popover closes', async ({
      page,
    }) => {
      const popover = await openMainAgentPopover(page);
      const before = getFixtureState(page).calls.length;
      await chooseMainAgentModel(page, popover, 'Kimi Lite [Tool: No]');
      await popover
        .locator('[data-testid="main-agent-effort"] [data-effort="high"]')
        .click();
      await visibleEnabled(popover.locator('[data-testid="main-agent-save"]'));
      await popover.locator('[data-testid="main-agent-cancel"]').click();
      await expect(popover).toHaveCount(0);
      expect(
        getFixtureState(page)
          .calls.slice(before)
          .some(
            (call) =>
              call.method === 'config:model-switch' ||
              call.method === 'config:effort-set' ||
              call.method === 'auth:saveSettings',
          ),
      ).toBe(false);
    });
  });

  test.describe(`webview > settings > providers, the drawer check keeps focus (Batch 54.1, ${host})`, () => {
    test('N1: while the drawer check runs, Check connection keeps focus; Esc after the check closes the drawer and focus returns to the card', async ({
      page,
      fixtureServer,
    }) => {
      // The host answers the check only when the test releases it, so the running state can be observed.
      let release: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        release = resolve;
      });
      await bootSettings(page, fixtureServer.url, host, 'anubis', {
        'auth:checkConnection': async (params: unknown) => {
          const state = getFixtureState(page);
          state.calls.push({ method: 'auth:checkConnection', params });
          await answered;
          const check = {
            status: 'verified' as const,
            reason: null,
            latencyMs: 92,
            checkedAt: new Date().toISOString(),
          };
          state.connectionChecks.set('moonshot', check);
          return check;
        },
      });
      await waitForSettled(page);
      await providersTab(page);
      await openCardDrawer(page, 'Moonshot');
      const check = page.locator('[data-testid="connection-check"]');
      await check.focus();
      await page.keyboard.press('Enter');
      // Running: aria-disabled, never natively disabled, and the focus stays on the button.
      await expect(check).toHaveAttribute('aria-disabled', 'true');
      // (Playwright's toBeEnabled counts aria-disabled as disabled; the native property is what drops focus.)
      expect(
        await check.evaluate((node) => (node as HTMLButtonElement).disabled),
      ).toBe(false);
      await expect(check).toBeFocused();
      release();
      await expect(
        page.locator('[data-testid="connection-status"]'),
      ).toContainText('Connected & verified');
      await expect(check).not.toHaveAttribute('aria-disabled', 'true');
      await expect(check).toBeFocused();
      // Esc still reaches the drawer, and focus returns to the card that opened it.
      await page.keyboard.press('Escape');
      await expect(
        page.locator('[data-testid="connection-detail-drawer"]'),
      ).toHaveCount(0);
      await expect(
        card(page, 'Moonshot').locator('[role="button"]').first(),
      ).toBeFocused();
    });
  });

  test.describe(`webview > settings > providers, the card's own check (Batch 53, ${host})`, () => {
    test('a failed drawer check shows on the card; the card Retry checks only that connection, and a verified result clears it', async ({
      page,
      fixtureServer,
    }) => {
      // The host rejects Moonshot's key on the first check and verifies it on the next one.
      let calls = 0;
      await bootSettings(page, fixtureServer.url, host, 'anubis', {
        'auth:checkConnection': (params: unknown) => {
          const state = getFixtureState(page);
          state.calls.push({ method: 'auth:checkConnection', params });
          calls += 1;
          const check =
            calls === 1
              ? {
                  status: 'failed' as const,
                  reason: 'credential-rejected' as const,
                  latencyMs: null,
                  checkedAt: new Date().toISOString(),
                }
              : {
                  status: 'verified' as const,
                  reason: null,
                  latencyMs: 92,
                  checkedAt: new Date().toISOString(),
                };
          state.connectionChecks.set('moonshot', check);
          return check;
        },
      });
      await waitForSettled(page);
      await providersTab(page);
      const moonshot = card(page, 'Moonshot');
      await expect(moonshot).toHaveAttribute('data-state', 'connected');
      // B38-1: the drawer's failed check is the card's state too ("Check failed" + Retry, no host text).
      await openCardDrawer(page, 'Moonshot');
      let before = getFixtureState(page).calls.length;
      await page.locator('[data-testid="connection-check"]').click();
      await expectCall(page, before, 'auth:checkConnection', {
        providerId: 'moonshot',
      });
      await expect(
        page.locator('[data-testid="connection-status"]'),
      ).toHaveText('Check failed');
      await closeConnectionDrawer(page);
      await expect(moonshot).toHaveAttribute('data-state', 'check-failed');
      await expect(moonshot.locator('[data-testid="status-copy"]')).toHaveText(
        'Check failed',
      );
      await expect(moonshot).not.toContainText('rejected');
      // B38-2: the card's Retry runs auth:checkConnection for Moonshot alone, not a page refresh.
      before = getFixtureState(page).calls.length;
      await moonshot.locator('[data-testid="btn-retry"]').click();
      await expectCall(page, before, 'auth:checkConnection', {
        providerId: 'moonshot',
      });
      await expect(moonshot).toHaveAttribute('data-state', 'connected');
      expect(
        getFixtureState(page)
          .calls.slice(before)
          .filter((call) => call.method === 'auth:checkConnection'),
      ).toHaveLength(1);
      // Focus stays on the card (its action left the face while it read "Checking…").
      await expect(moonshot.locator('[role="button"]').first()).toBeFocused();
    });
  });
}
