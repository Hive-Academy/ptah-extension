/**
 * E2E: Orchestration tab interaction scenes (TASK_2026_555). Batch 32 started this file with the Batch 14 review's
 * carry-forward (finding 3) for the two CLI-matrix modals: focus moves into the dialog on open, stays inside it on Tab,
 * and returns to the opener (the "Add Ptah CLI Instance" button / Glm's Tiers) after Esc, a backdrop click and a
 * submit. Batch 36 adds the tab's validation-note scenes (batches.md Task 36.1): a matrix cell pick, on/off, the full
 * tier object, the Copilot sign-in gate, the roles collapsed by default, the `judge` deep link, the role's provider
 * setup link, and the preferred-order popover. Batch 36c adds the "More actions" menu bounds and the repeated `judge`
 * deep link.
 *
 * Runs against the real `ptah-extension-webview` build in both hosts. Each scene boots fresh, so the fixture state
 * starts from the BRIEF baseline and every RPC a scene asserts was sent by that scene's own clicks.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { bootSettings, getFixtureState, SKILL_LANES_FIXTURE, waitForSettled } from './settings.fixtures';
import { expectCall, openCardDrawer, orchestrationTab, providersTab, visibleEnabled } from './settings-drawer.reach';

test.use({ useAppBuild: true });

const HOSTS = ['vscode', 'electron'] as const;
const GLM_ID = 'glm-instance-1';
/** Glm's saved tier mapping (`PTAH_CLI_AGENTS_SETTING_FIXTURE`). */
const GLM_TIERS = { sonnet: 'glm-5.3:cloud', opus: 'glm-5.3:cloud', haiku: 'glm-5.3:cloud' };

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
const toastMessage = (page: Page): Locator => page.locator('[data-testid="settings-toast-message"]').last();
const toastUndo = (page: Page): Locator => page.locator('[data-testid="settings-toast-undo"]').last();
const rolesDetails = (page: Page): Locator => page.locator('[data-testid="background-roles-details"]');

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

/** Boots Settings on the Agent Orchestration tab with its matrix rendered (the deferred chunk). */
async function bootOrchestration(page: Page, url: string, host: (typeof HOSTS)[number], overrides: Record<string, unknown> = {}): Promise<void> {
  await bootSettings(page, url, host, 'anubis', overrides);
  await waitForSettled(page);
  await orchestrationTab(page);
  await expect(page.locator('[data-testid="cli-matrix"]')).toBeVisible();
}

/** Glm's tier-mapping modal, open with its saved mapping read. */
async function openGlmTiers(page: Page): Promise<Locator> {
  const dialog = await open(page, MODALS[1]);
  await expect(dialog.locator('[data-testid="cli-tier-source-haiku"]')).toContainText('This instance: glm-5.3:cloud');
  return dialog;
}

for (const host of HOSTS) {
  test.describe(`webview > settings > orchestration scenes (${host})`, () => {
    test.beforeEach(async ({ page, fixtureServer }) => {
      await bootOrchestration(page, fixtureServer.url, host);
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
      await expect(toastMessage(page)).toContainText('Saved Ptah CLI instance Llama-Local');
      await expect(page.locator('[data-testid^="cli-matrix-row-created-"]')).toContainText('Llama-Local');
    });

    test('tier-mapping modal: "Done" closes it and focus returns to Tiers', async ({ page }) => {
      const modal = MODALS[1];
      const dialog = await open(page, modal);
      await dialog.locator('[data-testid="cli-tier-mapping-done"]').click();
      await expectClosedToOpener(page, modal);
    });

    test('edit modal (#50): a rename sends ptahCli:update with the new name only', async ({ page }) => {
      // V36-7: Edit sits in the row's "More actions" popover; focus returns to that trigger.
      const more = page.locator(`[data-testid="cli-matrix-more-${GLM_ID}"]`);
      await more.click();
      await page.locator(`[data-testid="cli-matrix-edit-${GLM_ID}"]`).click();
      const dialog = dialogOf(page, 'add-cli-instance-modal');
      await expect(dialog).toHaveAttribute('open', '');
      await expect(dialog.locator('[data-testid="add-cli-instance-provider-fixed"]')).toHaveText('Ollama Cloud');
      const before = getFixtureState(page).calls.length;
      await dialog.locator('[data-testid="add-cli-instance-name"]').fill('Glm-Main');
      await dialog.locator('[data-testid="add-cli-instance-submit"]').click();
      await expectCall(page, before, 'ptahCli:update', { id: GLM_ID, name: 'Glm-Main' });
      await expect(dialog).not.toHaveAttribute('open');
      await expect(more).toBeFocused();
    });

    // ----- Batch 36 -----

    test('cell pick: the Codex model cell, then a model, sends one agent:setConfig; Undo writes the previous model back', async ({ page }) => {
      const state = getFixtureState(page);
      const cell = page.locator('[data-testid="cli-matrix-model-codex"]');
      await cell.click();
      const popover = page.locator('[data-testid="cli-matrix-popover"]');
      const search = popover.locator('input[role="combobox"]');
      await expect(search).toBeFocused();
      const listbox = page.locator(`[id="${await search.getAttribute('aria-controls')}"]`);
      await expect(listbox).toBeVisible();
      const before = state.calls.length;
      await listbox.getByRole('option', { name: /^Provider default/ }).click();
      await expectCall(page, before, 'agent:setConfig', { codexModel: '' });
      // Two clicks: the cell, then the value. The popover closes on the save and focus returns to the cell.
      await expect(popover).toHaveCount(0);
      await expect(cell).toBeFocused();
      expect(state.calls.slice(before).filter((call) => call.method === 'agent:setConfig')).toHaveLength(1);
      await expect(toastMessage(page)).toContainText('Saved');
      await toastUndo(page).click();
      await expectCall(page, before, 'agent:setConfig', { codexModel: 'gpt-5.5-codex' });
      await expect.poll(() => state.agentConfig.codexModel).toBe('gpt-5.5-codex');
    });

    test('on/off: a system CLI writes disabledClis and its cells turn to plain text; an instance writes ptahCli:update', async ({ page }) => {
      const state = getFixtureState(page);
      const codex = page.locator('[data-testid="cli-matrix-toggle-codex"]');
      await expect(codex).toBeChecked();
      let before = state.calls.length;
      await codex.click();
      await expectCall(page, before, 'agent:setConfig', { disabledClis: expect.arrayContaining(['copilot', 'codex']) });
      await expect(codex).not.toBeChecked();
      // A turned-off row shows its values as plain text: no model or effort trigger (#71).
      await expect(page.locator('[data-testid="cli-matrix-model-codex"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="cli-matrix-row-codex"]')).toHaveAttribute('data-dimmed', 'true');
      await toastUndo(page).click();
      await expectCall(page, before, 'agent:setConfig', { disabledClis: ['copilot'] });
      await expect(codex).toBeChecked();
      await visibleEnabled(page.locator('[data-testid="cli-matrix-model-codex"]'));
      // A Ptah CLI instance's on/off is its own `enabled` field.
      const glm = page.locator(`[data-testid="cli-matrix-toggle-${GLM_ID}"]`);
      before = state.calls.length;
      await glm.click();
      await expectCall(page, before, 'ptahCli:update', { id: GLM_ID, enabled: false });
      await expect(glm).not.toBeChecked();
      await expect(toastMessage(page)).toContainText('Saved Glm off');
    });

    test('Tiers: a tier pick sends ptahCli:update with the full {sonnet, opus, haiku} object (D5)', async ({ page }) => {
      const dialog = await openGlmTiers(page);
      const before = getFixtureState(page).calls.length;
      const search = dialog.locator('[data-tier="sonnet"] input[role="combobox"]');
      await visibleEnabled(search);
      await search.click();
      const listbox = page.locator(`[id="${await search.getAttribute('aria-controls')}"]`);
      // A compact field names each option by its ID, then its display name.
      await listbox.getByRole('option', { name: 'kimi-k2.5 Kimi K2.5', exact: true }).click();
      await expectCall(page, before, 'ptahCli:update', { id: GLM_ID, tierMappings: { ...GLM_TIERS, sonnet: 'kimi-k2.5' } });
      const updates = getFixtureState(page).calls.slice(before).filter((call) => call.method === 'ptahCli:update');
      expect(updates).toHaveLength(1);
    });

    test('Tiers: "Use inherited" sends the full object without that tier', async ({ page }) => {
      const dialog = await openGlmTiers(page);
      const before = getFixtureState(page).calls.length;
      await dialog.locator('[data-testid="cli-tier-inherit-haiku"]').click();
      await expectCall(page, before, 'ptahCli:update', { id: GLM_ID, tierMappings: { sonnet: GLM_TIERS.sonnet, opus: GLM_TIERS.opus } });
    });

    test('roles are collapsed by default: the summary shows, the roles table does not', async ({ page }) => {
      const details = rolesDetails(page);
      await expect(details).not.toHaveAttribute('open');
      await expect(page.locator('[data-testid="background-roles-summary"]')).toBeVisible();
      await expect(page.locator('[data-testid="background-roles-summary"]')).toContainText('6 roles');
      await expect(page.locator('[data-testid="consumer-table"]')).toBeHidden();
      // Leaving the tab and coming back keeps them closed.
      await providersTab(page);
      await orchestrationTab(page);
      await expect(rolesDetails(page)).not.toHaveAttribute('open');
    });

    test('a role\'s "Set up {provider}" (setupProviderRequested) lands on Providers with the setup wizard open', async ({ page }) => {
      await page.locator('[data-testid="background-roles-summary"]').click();
      await expect(rolesDetails(page)).toHaveAttribute('open', '');
      await page.locator('[data-testid="consumer-edit-judge"]').click();
      const popover = page.locator('[data-testid="consumer-editor-judge"]');
      await expect(popover).toBeVisible();
      const before = getFixtureState(page).calls.length;
      // Ollama Cloud is unreachable in the fixture route: the choice is blocked, nothing is written.
      await popover.locator('[data-testid="provider-model-picker-provider"]').selectOption('ollama-cloud');
      const alert = popover.locator('[data-testid="readiness-alert-judge"]');
      await expect(alert).toHaveAttribute('role', 'alert');
      await expect(alert.locator('[data-testid="readiness-message-judge"]')).toContainText('Not saved.');
      expect(getFixtureState(page).calls.slice(before).some((call) => call.method === 'skillSynthesis:setLanes')).toBe(false);
      await popover.locator('[data-testid="readiness-setup-judge"]').click();
      await expect(page.getByRole('button', { name: 'Providers', exact: true })).toHaveClass(/tab-active/);
      await expect(page.locator('[data-testid="wizard-body"]')).toBeVisible();
      await expect(page.locator('[data-testid="wizard-step-provider"] input[type="radio"]:checked')).toHaveCount(1);
      await page.locator('[data-testid="wizard-cancel"]').click();
      const discard = page.locator('[data-testid="wizard-discard-confirm"]');
      await discard.waitFor({ state: 'visible', timeout: 2000 }).then(() => discard.click()).catch(() => undefined);
      await expect(page.locator('[data-testid="wizard-body"]')).toHaveCount(0);
    });

    test('More actions (visual re-check N1): the open menu\'s items sit inside the panel box and the viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.locator(`[data-testid="cli-matrix-more-${GLM_ID}"]`).click();
      const menu = page.locator('[data-testid="cli-matrix-more-menu"]');
      await expect(menu).toBeVisible();
      const panel = await menu.boundingBox();
      if (!panel) throw new Error('No More actions panel box');
      const items = menu.locator('button');
      await expect(items).toHaveCount(2);
      for (const item of await items.all()) {
        const box = await item.boundingBox();
        if (!box) throw new Error('No More actions item box');
        expect(box.x).toBeGreaterThanOrEqual(panel.x - 0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
        expect(box.y).toBeGreaterThanOrEqual(panel.y - 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height + 0.5);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1024);
        expect(box.y + box.height).toBeLessThanOrEqual(768);
      }
      // A column: Delete sits under Edit, not beside it.
      const [edit, remove] = [await items.nth(0).boundingBox(), await items.nth(1).boundingBox()];
      expect(remove?.y ?? 0).toBeGreaterThan(edit?.y ?? 0);
    });

    test('order popover: a move writes the whole order, focus stays on the moved row, Esc returns focus, Undo restores', async ({ page }) => {
      const bar = page.locator('[data-testid="orchestration-policy-bar"]');
      const trigger = bar.locator('[data-testid="policy-order-edit"]');
      const chips = bar.locator('[data-testid^="policy-order-chip-"]');
      await expect(chips.first()).toHaveText('1. Codex');
      await trigger.click();
      const popover = page.locator('[data-testid="policy-order-popover"]');
      await expect(popover).toBeVisible();
      await expect(popover.getByRole('button', { name: 'Move Codex up' })).toBeDisabled();
      const before = getFixtureState(page).calls.length;
      const down = popover.getByRole('button', { name: 'Move Codex down' });
      await down.click();
      await expectCall(page, before, 'agent:setConfig', { preferredAgentOrder: ['antigravity', 'codex', 'glm-instance-1', 'copilot', 'opencode'] });
      // Focus never leaves the popover: during the save the move buttons are aria-disabled, not disabled (Batch 36 fix),
      // so Esc closes the popover at any moment.
      await expect(down).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(chips.first()).toHaveText('1. Antigravity');
      await toastUndo(page).click();
      await expectCall(page, before, 'agent:setConfig', { preferredAgentOrder: ['codex', 'antigravity', 'glm-instance-1', 'copilot'] });
      await expect(chips.first()).toHaveText('1. Codex');
    });
  });

  test.describe(`webview > settings > orchestration scenes, changed reads (${host})`, () => {
    test('adding a Copilot-backed instance requires a GitHub sign-in before Create is enabled', async ({ page, fixtureServer }) => {
      // The shared fixture answers no Copilot login: this boot does, and the next auth read reports the sign-in.
      await bootOrchestration(page, fixtureServer.url, host, {
        'auth:copilotLogin': () => {
          getFixtureState(page).authStatus.copilotAuthenticated = true;
          return { success: true };
        },
      });
      const modal = MODALS[0];
      const dialog = await open(page, modal);
      await dialog.locator('[data-testid="add-cli-instance-name"]').fill('Copilot-agent');
      await dialog.locator('[data-testid="add-cli-instance-provider"]').selectOption('github-copilot');
      const create = dialog.locator('[data-testid="add-cli-instance-submit"]');
      const signIn = dialog.locator('[data-testid="add-cli-instance-copilot-state"]');
      await expect(signIn).toHaveText('Awaiting sign-in');
      await expect(create).toBeDisabled();
      await dialog.locator('[data-testid="add-cli-instance-copilot-login"]').click();
      await expect(signIn).toHaveText('Signed in');
      await expect(create).toBeEnabled();
      const before = getFixtureState(page).calls.length;
      await create.click();
      await expectCall(page, before, 'ptahCli:create', expect.objectContaining({ name: 'Copilot-agent', providerId: 'github-copilot' }));
      await expectClosedToOpener(page, modal);
    });

    test('deep link judge (a drawer\'s "Follows main agent →"): the roles open with the Judge lane popover', async ({ page, fixtureServer }) => {
      // Judge lane follows the main agent here, so Claude (Subscription)'s drawer lists it with the deep link.
      const lanes = { ...SKILL_LANES_FIXTURE.lanes, judge: { ...SKILL_LANES_FIXTURE.lanes.judge, provider: '', model: '' } };
      await bootSettings(page, fixtureServer.url, host, 'anubis', { 'skillSynthesis:getLanes': { lanes } });
      await waitForSettled(page);
      await providersTab(page);
      await openCardDrawer(page, 'Claude (Subscription)');
      const link = page.locator('[data-used-by="judge"] [data-testid="connection-follows-main"]');
      await visibleEnabled(link);
      await link.click();
      await expect(page.getByRole('button', { name: 'Agent Orchestration', exact: true })).toHaveClass(/tab-active/);
      await expect(rolesDetails(page)).toHaveAttribute('open', '');
      const popover = page.locator('[data-testid="consumer-editor-judge"]');
      await expect(popover).toBeVisible();
      await visibleEnabled(popover.locator('[data-testid="provider-model-picker-provider"]'));
      await expect(page.locator('[data-testid="consumer-summary-judge"]')).toHaveText('Follows main agent → Claude (Subscription)');
      // Esc closes the popover and focus lands on the Judge lane's cell (a deep-linked popover had no opener).
      await popover.locator('[data-testid="provider-model-picker-provider"]').focus();
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect(page.locator('[data-testid="consumer-edit-judge"]')).toBeFocused();
    });

    test('repeated deep link judge (Gate V 36 M-1): the same role deep-linked again after Esc opens its popover again', async ({ page, fixtureServer }) => {
      const lanes = { ...SKILL_LANES_FIXTURE.lanes, judge: { ...SKILL_LANES_FIXTURE.lanes.judge, provider: '', model: '' } };
      await bootSettings(page, fixtureServer.url, host, 'anubis', { 'skillSynthesis:getLanes': { lanes } });
      await waitForSettled(page);
      const popover = page.locator('[data-testid="consumer-editor-judge"]');
      // The only routes that raise a role deep link live on Providers (the drawer's "Follows main agent →"); no
      // Orchestration control raises one, so the repeat goes through that route twice. Jest pins the in-tab repeat.
      for (const pass of [1, 2]) {
        await providersTab(page);
        await openCardDrawer(page, 'Claude (Subscription)');
        const link = page.locator('[data-used-by="judge"] [data-testid="connection-follows-main"]');
        await visibleEnabled(link);
        await link.click();
        await expect(page.getByRole('button', { name: 'Agent Orchestration', exact: true }), `pass ${pass}`).toHaveClass(/tab-active/);
        await expect(rolesDetails(page), `pass ${pass}`).toHaveAttribute('open', '');
        await expect(popover, `pass ${pass}: the popover opens`).toBeVisible();
        await popover.locator('[data-testid="provider-model-picker-provider"]').focus();
        await page.keyboard.press('Escape');
        await expect(popover, `pass ${pass}: Esc closes it`).toHaveCount(0);
        await expect(page.locator('[data-testid="consumer-edit-judge"]')).toBeFocused();
      }
    });
  });
}
