/**
 * Gate G entries for the CLI matrix on the Orchestration tab (Batch 30): the restored #43, #44, #54, #70 and #71, and
 * the regressed-UX fixes RUX-8 and RUX-11. Batch 31 re-pointed #63 (Copilot auto-approve) and #64 (Cursor key) here;
 * Batch 32 added #47 and #53 (the add-instance and tier modals) and moved #49 here with its CLI-form half. Batch 34
 * retired the old Ptah CLI instance manager and re-pointed its entries here (#39, #42, #45, #46, #48, #50-#52, #55-#57,
 * and the delegated #59-#62, #65-#69). Kept apart from the table, which is over its `max-lines` budget (the
 * `settings-routing-map.entries.ts` precedent); `REACHABILITY_TABLE` spreads them in and `EXPECTED_CAPABILITY_COUNT`
 * counts them.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { ReachabilityEntry } from './settings-reachability.table';
import {
  bootVariant, closeConnectionDrawer, credentialsOf, expectCall, orchestrationTab, throughVariantBoot, visibleEnabled,
} from './settings-drawer.reach';
import { AGENT_CONFIG_FIXTURE, AUTH_STATUS_FIXTURE, getFixtureState } from './settings.fixtures';

/** Opens a matrix modal (`NativeModalComponent`, a native `<dialog>`) from `opener`; returns its dialog. */
async function openMatrixModal(page: Page, opener: Locator, testid: string): Promise<Locator> {
  await visibleEnabled(opener);
  await opener.click();
  const dialog = page.locator(`dialog:has([data-testid="${testid}"])`);
  // daisyUI keeps a closed `.modal` laid out at opacity 0: the `open` attribute is the real state.
  await expect(dialog).toHaveAttribute('open', '');
  return dialog;
}

/** Closes a matrix modal with Esc; focus returns to `opener` (native `<dialog>`). */
async function closeMatrixModal(page: Page, dialog: Locator, opener: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open');
  await expect(opener).toBeFocused();
}

/** The fixture's one Ptah CLI instance, "Glm" (BRIEF:66-67). */
const GLM_ID = 'glm-instance-1';

/** System CLIs the shared fixture reports as not installed: their rows sit in the Uninstalled group. */
const UNINSTALLED_IN_FIXTURE: ReadonlySet<string> = new Set(['cursor', 'pi']);

/**
 * Gate V 36 decision 1: the Uninstalled group is collapsed by default behind its disclosure button. Expands it when it
 * is collapsed (the tab keeps its state between entries); returns the toggle.
 */
export async function expandUninstalled(page: Page): Promise<Locator> {
  const toggle = page.locator('[data-testid="cli-matrix-uninstalled-toggle"]');
  await visibleEnabled(toggle);
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return toggle;
}

/** The CLI matrix (deferred chunk) on the Orchestration tab; returns the row of `id` (`cli-matrix-row-<id>`). */
async function matrixRow(page: Page, id: string): Promise<Locator> {
  await orchestrationTab(page);
  const row = page.locator(`[data-testid="cli-matrix-row-${id}"]`);
  if (UNINSTALLED_IN_FIXTURE.has(id) && !(await row.count())) await expandUninstalled(page);
  await expect(row).toBeVisible();
  return row;
}

/**
 * V36-7: an instance's Edit and Delete live in its "More actions" popover. Opens it and returns the trigger (focus
 * returns there when the popover, or a modal opened from it, closes).
 */
async function openMoreActions(page: Page, row: Locator, id: string): Promise<Locator> {
  const more = row.locator(`[data-testid="cli-matrix-more-${id}"]`);
  await visibleEnabled(more);
  await more.click();
  await expect(page.locator('[data-testid="cli-matrix-more-menu"]')).toBeVisible();
  return more;
}

/**
 * Opens a matrix popover from `trigger`, runs `body` on it, then closes it: Esc when focus is still inside it, else
 * its own Close button (a body that clicked outside it, e.g. the toast's Undo, moved focus out, and the popover takes
 * Esc only from inside). Left open, its backdrop would block every later entry's clicks.
 */
async function throughMatrixPopover(page: Page, trigger: Locator, popover: string, body: (panel: Locator) => Promise<void>): Promise<void> {
  await visibleEnabled(trigger);
  await trigger.click();
  const panel = page.locator(`[data-testid="${popover}"]`);
  await expect(panel).toBeVisible();
  try {
    await body(panel);
  } finally {
    const focusInside = await panel.evaluate((node) => node.contains(document.activeElement)).catch(() => false);
    if (focusInside) await page.keyboard.press('Escape');
    else if (await panel.count()) await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toHaveCount(0);
  }
}

/** Opens a matrix cell's popover from `trigger`, runs `body`, then closes it with its own Close button. */
async function throughCellPopover(page: Page, trigger: Locator, body: (panel: Locator) => Promise<void>): Promise<void> {
  await visibleEnabled(trigger);
  await trigger.click();
  const panel = page.locator('[data-testid="cli-matrix-popover"]');
  await expect(panel).toBeVisible();
  try {
    await body(panel);
  } finally {
    // Not Esc: the model search opens its list on focus, and its first Esc closes only the list.
    if (await panel.count()) await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toHaveCount(0);
  }
}

/** Glm's Model cell: the per-instance model popover (the old manager's "Edit Glm model" picker, #39 and #45). */
async function throughInstanceModel(page: Page, body: (panel: Locator) => Promise<void>): Promise<void> {
  const glm = await matrixRow(page, GLM_ID);
  await throughCellPopover(page, glm.locator(`[data-testid="cli-matrix-model-${GLM_ID}"]`), body);
}

/** System CLIs whose cells are live in the shared fixture (installed and on). */
const LIVE_IN_FIXTURE: ReadonlySet<string> = new Set(['codex', 'antigravity', 'opencode']);
/**
 * Every system CLI installed and none turned off. The shared fixture has Copilot off and Cursor and Pi not installed,
 * and the matrix shows those rows' cells as plain text (#71), so their delegated settings are reached on this variant.
 */
const ALL_CLIS_LIVE = {
  'agent:getConfig': {
    ...AGENT_CONFIG_FIXTURE, disabledClis: [], detectedClis: AGENT_CONFIG_FIXTURE.detectedClis.map((cli) => ({ ...cli, installed: true })),
  },
};

/**
 * One ALL_CLIS_LIVE page per shared session page, booted on first use and reused by every delegated entry that needs it
 * (one boot instead of five: each boot costs seconds of the 180 s budget). The browser context's teardown closes it.
 */
const liveVariants = new WeakMap<Page, Page>();
async function liveVariant(page: Page): Promise<Page> {
  const existing = liveVariants.get(page);
  if (existing && !existing.isClosed()) return existing;
  const variant = await bootVariant(page, ALL_CLIS_LIVE, 'Agent Orchestration');
  liveVariants.set(page, variant);
  return variant;
}

/** #59-#69: one delegated CLI's Model or Effort cell opens its popover with a live control (Batch 34). */
async function throughDelegatedCell(page: Page, cli: string, field: 'model' | 'effort'): Promise<void> {
  const target = LIVE_IN_FIXTURE.has(cli) ? page : await liveVariant(page);
  const row = await matrixRow(target, cli);
  await throughCellPopover(target, row.locator(`[data-testid="cli-matrix-${field}-${cli}"]`), async (panel) => {
    await expect(panel).toHaveAttribute('data-row', cli);
    await expect(panel).toHaveAttribute('data-field', field);
    await visibleEnabled(field === 'model'
      ? panel.locator('input[role="combobox"]')
      : panel.locator('[data-testid="cli-matrix-effort-options"] [data-effort="default"]'));
  });
}

/** Batch 34: the old manager's capabilities, re-pointed to the matrix, its modals and its popovers (D14). */
const INSTANCE_ENTRIES: readonly ReachabilityEntry[] = [
  { id: '#39', capability: 'Refresh the model list (Retry on error)', status: 'present',
    // The harness RPC auto-responder always answers `success: true`, so the Retry branch is pinned in unit specs. What is
    // reachable: each Ptah CLI instance's own model picker (a distinct catalogue fetch from the main-agent one, #35).
    reach: (page) => throughInstanceModel(page, async (panel) => {
      await expect(panel.locator('ptah-provider-model-picker')).toBeVisible();
    }) },
  { id: '#42', capability: 'List Ptah CLI agents with name and provider badge', status: 'present',
    reach: async (page) => {
      const glm = await matrixRow(page, GLM_ID);
      await expect(glm).toHaveAttribute('data-kind', 'instance');
      await expect(glm.getByText('Ptah CLI', { exact: true })).toBeVisible();
      // The Provider column in a wide box; under the name in a narrow one (Electron).
      await expect(glm.getByText('Ollama Cloud', { exact: true }).filter({ visible: true })).toHaveCount(1);
    } },
  { id: '#45', capability: 'Model count', status: 'present',
    reach: (page) => throughInstanceModel(page, async (panel) => {
      await expect(panel.locator('[data-testid="cli-matrix-model-count"]')).toHaveText('12 models available from Ollama Cloud.');
    }) },
  { id: '#46', capability: 'Add agent: name, provider, key', status: 'present',
    reach: async (page) => {
      await orchestrationTab(page);
      const add = page.locator('[data-testid="cli-matrix-add"]');
      const dialog = await openMatrixModal(page, add, 'add-cli-instance-modal');
      try {
        await visibleEnabled(dialog.locator('[data-testid="add-cli-instance-name"]'));
        await dialog.locator('[data-testid="add-cli-instance-provider"]').selectOption('moonshot');
        await visibleEnabled(dialog.locator('[data-testid="add-cli-instance-key"]'));
        await expect(dialog.locator('[data-testid="add-cli-instance-submit"]')).toHaveText('Create Instance');
      } finally {
        await closeMatrixModal(page, dialog, add);
      }
    } },
  { id: '#48', capability: 'Keyless / optional-key hints', status: 'present',
    reach: async (page) => {
      await orchestrationTab(page);
      const add = page.locator('[data-testid="cli-matrix-add"]');
      const dialog = await openMatrixModal(page, add, 'add-cli-instance-modal');
      try {
        await dialog.locator('[data-testid="add-cli-instance-provider"]').selectOption('ollama-cloud');
        await expect(dialog.locator('[data-testid="add-cli-instance-key-help"]')).toContainText('run ollama signin');
      } finally {
        await closeMatrixModal(page, dialog, add);
      }
    } },
  { id: '#50', capability: 'Edit name / replace key inline', status: 'present',
    // Batch 32: Edit opens the add modal in edit mode (name and a replacement key; the provider is fixed).
    reach: async (page) => {
      // V36-7: More actions → Edit; focus returns to the More trigger when the modal closes.
      const glm = await matrixRow(page, GLM_ID);
      const more = await openMoreActions(page, glm, GLM_ID);
      const dialog = await openMatrixModal(page, page.locator(`[data-testid="cli-matrix-edit-${GLM_ID}"]`), 'add-cli-instance-modal');
      try {
        await expect(dialog.locator('[data-testid="add-cli-instance-name"]')).toHaveValue('Glm');
        await visibleEnabled(dialog.locator('[data-testid="add-cli-instance-key"]'));
        await expect(dialog.locator('[data-testid="add-cli-instance-submit"]')).toHaveText('Save changes');
      } finally {
        await closeMatrixModal(page, dialog, more);
      }
    } },
  { id: '#51', capability: 'Enable/disable agent toggle', status: 'present',
    reach: async (page) => {
      const glm = await matrixRow(page, GLM_ID);
      const toggle = glm.locator(`[data-testid="cli-matrix-toggle-${GLM_ID}"]`);
      await visibleEnabled(toggle);
      await expect(toggle).toBeChecked();
    } },
  { id: '#52', capability: 'Test connection', status: 'present',
    // RUX-11 clicks it and checks the inline result.
    reach: async (page) => {
      const glm = await matrixRow(page, GLM_ID);
      await visibleEnabled(glm.getByRole('button', { name: 'Test Glm', exact: true }));
    } },
  { id: '#55', capability: 'Delete with confirmation', status: 'present',
    reach: async (page) => {
      // V36-7: More actions → Delete → the inline confirm (focus on its Cancel) → Cancel → focus back on More.
      const glm = await matrixRow(page, GLM_ID);
      const more = await openMoreActions(page, glm, GLM_ID);
      const remove = page.locator(`[data-testid="cli-matrix-delete-${GLM_ID}"]`);
      await visibleEnabled(remove);
      await remove.click();
      await visibleEnabled(glm.getByRole('button', { name: 'Confirm delete Glm', exact: true }));
      const cancel = glm.getByRole('button', { name: 'Cancel', exact: true });
      await expect(cancel).toBeFocused();
      await cancel.click();
      await expect(more).toBeFocused();
    } },
  { id: '#56', capability: 'Success/error commit feedback', status: 'present',
    // Glm's on/off (a real `ptahCli:update` write): the toast says it saved, and the read-back moves the checkbox. The
    // toggle is put back in `finally`, so later entries see Glm enabled even when an assertion fails.
    reach: async (page) => {
      const glm = await matrixRow(page, GLM_ID);
      const state = getFixtureState(page);
      const toggle = glm.locator(`[data-testid="cli-matrix-toggle-${GLM_ID}"]`);
      const message = page.locator('[data-testid="settings-toast-message"]');
      try {
        await visibleEnabled(toggle);
        const before = state.calls.length;
        await toggle.click();
        await expectCall(page, before, 'ptahCli:update', { id: GLM_ID, enabled: false });
        await expect(message).toContainText('Saved Glm off');
        await expect(toggle).not.toBeChecked();
        expect(state.ptahCliAgents.find((agent) => agent.id === GLM_ID)?.enabled).toBe(false);
      } finally {
        if (state.ptahCliAgents.find((agent) => agent.id === GLM_ID)?.enabled === false) {
          await visibleEnabled(toggle);
          await toggle.click();
          await expect(message).toContainText('Saved Glm on');
          await expect(toggle).toBeChecked();
        }
      }
    } },
  { id: '#57', capability: 'Empty state with Add link', status: 'present',
    // A second page with no Ptah CLI instance: the matrix's "No Ptah CLI instance yet." row carries its own Add.
    reach: (page) => throughVariantBoot(page, { 'ptahCli:list': { agents: [] } }, 'Agent Orchestration', async (variant) => {
      const empty = variant.locator('[data-testid="cli-matrix-no-instances"]');
      await expect(empty).toContainText('No Ptah CLI instance yet.');
      await visibleEnabled(empty.getByRole('button', { name: 'Add Ptah CLI Instance', exact: true }));
    }) },
  { id: '#59', capability: 'Codex model (delegated)', status: 'present', reach: (page) => throughDelegatedCell(page, 'codex', 'model') },
  { id: '#60', capability: 'Codex reasoning effort (delegated)', status: 'present', reach: (page) => throughDelegatedCell(page, 'codex', 'effort') },
  { id: '#61', capability: 'Copilot model (delegated)', status: 'present', reach: (page) => throughDelegatedCell(page, 'copilot', 'model') },
  { id: '#62', capability: 'Copilot reasoning effort (delegated)', status: 'present', reach: (page) => throughDelegatedCell(page, 'copilot', 'effort') },
  { id: '#65', capability: 'Cursor model (delegated)', status: 'present', reach: (page) => throughDelegatedCell(page, 'cursor', 'model') },
  { id: '#66', capability: 'Antigravity model (delegated)', status: 'present', reach: (page) => throughDelegatedCell(page, 'antigravity', 'model') },
  { id: '#67', capability: 'opencode model (delegated)', status: 'present', reach: (page) => throughDelegatedCell(page, 'opencode', 'model') },
  { id: '#68', capability: 'Pi model (delegated)', status: 'present', reach: (page) => throughDelegatedCell(page, 'pi', 'model') },
  { id: '#69', capability: 'Pi reasoning effort (delegated)', status: 'present', reach: (page) => throughDelegatedCell(page, 'pi', 'effort') },
];

export const CLI_MATRIX_ENTRIES: readonly ReachabilityEntry[] = [
  ...INSTANCE_ENTRIES,
  { id: '#47', capability: 'Inline GitHub login when adding a Copilot-backed CLI agent', status: 'restored',
    // Batch 32: Add → GitHub Copilot → "Login with GitHub" (`auth:copilotLogin`, then `auth:getAuthStatus`); Create stays
    // disabled until the sign-in is confirmed. The shared fixture answers no Copilot login, so a variant page does.
    reach: (page) => throughVariantBoot(page, {
      'auth:copilotLogin': { success: true },
      'auth:getAuthStatus': { ...AUTH_STATUS_FIXTURE, copilotAuthenticated: true },
    }, 'Agent Orchestration', async (variant) => {
      const dialog = await openMatrixModal(variant, variant.locator('[data-testid="cli-matrix-add"]'), 'add-cli-instance-modal');
      await dialog.locator('[data-testid="add-cli-instance-name"]').fill('Copilot-agent');
      // Gate V 36 M6: choosing Copilot re-reads the sign-in (this variant's host says signed in), never trusting an
      // earlier read; the inline login stays reachable (disabled once signed in).
      await dialog.locator('[data-testid="add-cli-instance-provider"]').selectOption('github-copilot');
      const create = dialog.locator('[data-testid="add-cli-instance-submit"]');
      await expect(dialog.locator('[data-testid="add-cli-instance-copilot-state"]')).toHaveText('Signed in');
      await expect(dialog.locator('[data-testid="add-cli-instance-copilot-login"]')).toBeVisible();
      await expect(create).toBeEnabled();
    }).then(() => throughVariantBoot(page, {
      'auth:copilotLogin': { success: true },
      'auth:getAuthStatus': { ...AUTH_STATUS_FIXTURE, copilotAuthenticated: false },
    }, 'Agent Orchestration', async (variant) => {
      // Signed out: Create stays disabled; "Login with GitHub" runs the login and the re-read still says not signed in.
      const dialog = await openMatrixModal(variant, variant.locator('[data-testid="cli-matrix-add"]'), 'add-cli-instance-modal');
      await dialog.locator('[data-testid="add-cli-instance-name"]').fill('Copilot-agent');
      await dialog.locator('[data-testid="add-cli-instance-provider"]').selectOption('github-copilot');
      const create = dialog.locator('[data-testid="add-cli-instance-submit"]');
      await expect(dialog.locator('[data-testid="add-cli-instance-copilot-state"]')).toHaveText('Awaiting sign-in');
      await expect(create).toBeDisabled();
      const login = dialog.locator('[data-testid="add-cli-instance-copilot-login"]');
      await visibleEnabled(login);
      await login.click();
      await expect(dialog.locator('[data-testid="add-cli-instance-copilot-message"]')).toContainText('Login has not been confirmed');
      await expect(create).toBeDisabled();
    })) },
  { id: '#49', capability: 'Show/hide API key in CLI agent add/edit forms', status: 'restored',
    // Batch 21 restored the drawer Credentials half (the Replace key field); Batch 32 adds the CLI-instance add form.
    reach: async (page) => {
      try {
        await credentialsOf(page, 'Moonshot');
        await page.locator('[data-testid="credentials-replace"]').click();
        const key = page.locator('[data-testid="credentials-new-key"]');
        await expect(key).toHaveAttribute('type', 'password');
        await page.locator('[data-testid="credentials-toggle-visibility"]').click();
        await expect(key).toHaveAttribute('type', 'text');
      } finally {
        await closeConnectionDrawer(page);
      }
      await orchestrationTab(page);
      const add = page.locator('[data-testid="cli-matrix-add"]');
      const dialog = await openMatrixModal(page, add, 'add-cli-instance-modal');
      try {
        await dialog.locator('[data-testid="add-cli-instance-provider"]').selectOption('moonshot');
        const key = dialog.locator('[data-testid="add-cli-instance-key"]');
        await key.fill('sk-e2e-reach-key');
        await expect(key).toHaveAttribute('type', 'password');
        await dialog.locator('[data-testid="add-cli-instance-toggle-visibility"]').click();
        await expect(key).toHaveAttribute('type', 'text');
      } finally {
        await closeMatrixModal(page, dialog, add);
      }
    } },
  { id: '#53', capability: 'CLI-agent tier mapping (cliAgent scope)', status: 'restored',
    // Batch 32: Glm's Tiers → its own mapping; a pick sends `ptahCli:update` with the FULL tier object (D5). The
    // shared fixture's `settings:get` is static, so the read-back cannot confirm the write: the entry asserts the
    // write, and that the toast does not claim it was saved (D15).
    reach: async (page) => {
      const glm = await matrixRow(page, GLM_ID);
      const tiers = glm.locator(`[data-testid="cli-matrix-tiers-${GLM_ID}"]`);
      const dialog = await openMatrixModal(page, tiers, 'cli-tier-mapping-modal');
      try {
        await expect(dialog.locator('[data-testid="cli-tier-source-opus"]')).toContainText('This instance: glm-5.3:cloud');
        const before = getFixtureState(page).calls.length;
        // The compact field's last row, "Enter a model ID…", swaps in a model-ID field.
        const search = dialog.locator('[data-tier="opus"] input[role="combobox"]');
        await visibleEnabled(search);
        await search.click();
        await page.locator(`[id="${await search.getAttribute('aria-controls')}"]`).getByRole('option', { name: 'Enter a model ID…', exact: true }).click();
        const manual = dialog.locator('[data-testid="cli-tier-manual-opus"]');
        await expect(manual).toBeFocused();
        await manual.fill('glm-4.7');
        await dialog.locator('[data-testid="cli-tier-manual-apply-opus"]').click();
        await expectCall(page, before, 'ptahCli:update',
          { id: GLM_ID, tierMappings: { sonnet: 'glm-5.3:cloud', opus: 'glm-4.7', haiku: 'glm-5.3:cloud' } });
        await expect(dialog.locator('[data-testid="settings-toast-message"]')).toBeVisible();
        await expect(dialog.locator('[data-testid="settings-toast-message"]')).not.toContainText('Saved Glm');
      } finally {
        await closeMatrixModal(page, dialog, tiers);
      }
    } },
  { id: '#63', capability: 'Copilot auto-approve toggle', status: 'present',
    // Batch 31: Copilot's permission ℹ holds the moved toggle. A real write through state.saveSettings (the fixture
    // stores `copilotAutoApprove: false`), read back into the toggle, then Undo writes the value back.
    reach: async (page) => {
      const copilot = await matrixRow(page, 'copilot');
      await throughMatrixPopover(page, copilot.locator('[data-testid="cli-matrix-permission-info-copilot"]'), 'cli-permission-popover', async (panel) => {
        const toggle = panel.locator('[data-testid="copilot-auto-approve"]');
        await visibleEnabled(toggle);
        await expect(toggle).not.toBeChecked();
        const before = getFixtureState(page).calls.length;
        await toggle.click();
        await expectCall(page, before, 'agent:setConfig', { copilotAutoApprove: true });
        await expect(toggle).toBeChecked();
        await expect(page.locator('[data-testid="cli-matrix-row-copilot"] [data-testid="cli-matrix-permission"]')).toHaveText('Auto-approve: On');
        const undo = page.locator('[data-testid="settings-toast-undo"]');
        await visibleEnabled(undo);
        await undo.click();
        await expectCall(page, before, 'agent:setConfig', { copilotAutoApprove: false });
        await expect(toggle).not.toBeChecked();
      });
    } },
  { id: '#64', capability: 'Cursor API key input + Save', status: 'present',
    // Batch 31: Cursor's Credentials (on its Uninstalled row: it installs once a key resolves). Masked key with
    // show/hide and the "Set" status; nothing is saved here (the fixture has no stored-key read-back).
    reach: async (page) => {
      const cursor = await matrixRow(page, 'cursor');
      await throughMatrixPopover(page, cursor.locator('[data-testid="cli-matrix-credentials-cursor"]'), 'cursor-credential-popover', async (panel) => {
        await expect(panel.locator('[data-testid="cursor-credential-status"]')).toHaveText('Not set');
        await expect(panel.locator('[data-testid="cursor-credential-help"]')).toContainText('cursor.com → Dashboard → Integrations');
        const key = panel.locator('[data-testid="cursor-credential-key"]');
        await expect(key).toBeFocused();
        await key.fill('crsr_e2e_reach_key');
        await expect(key).toHaveAttribute('type', 'password');
        await panel.locator('[data-testid="cursor-credential-toggle-visibility"]').click();
        await expect(key).toHaveAttribute('type', 'text');
        await visibleEnabled(panel.locator('[data-testid="cursor-credential-save"]'));
      });
    } },
  { id: '#43', capability: 'Ptah CLI agent status (Ready/Error/Init/No Key)', status: 'restored',
    // The matrix Status column (`cliMatrixRows`; every status is pinned in `cli-matrix-rows.spec.ts`).
    reach: async (page) => {
      const row = await matrixRow(page, GLM_ID);
      await expect(row.locator('[data-testid="cli-matrix-status"]')).toContainText('Ready');
    } },
  { id: '#44', capability: 'Ptah CLI agent key status (Key set/No key/Cloud signin)', status: 'restored',
    reach: async (page) => {
      const row = await matrixRow(page, GLM_ID);
      await expect(row.locator('[data-testid="cli-matrix-key-status"]')).toHaveText('Key set');
    } },
  { id: '#54', capability: 'Tier-mapping badges on CLI agent cards', status: 'restored',
    reach: async (page) => {
      const row = await matrixRow(page, GLM_ID);
      for (const tier of ['Sonnet', 'Opus', 'Haiku']) {
        await expect(row.locator(`[data-tier="${tier.toLowerCase()}"]`)).toHaveText(`${tier}: glm-5.3:cloud`);
      }
    } },
  { id: '#70', capability: 'Per-CLI permission and safety notes', status: 'restored',
    // Badge + ℹ popover per row: the old wording for Codex; Copilot's badge reads its saved auto-approve.
    reach: async (page) => {
      const codex = await matrixRow(page, 'codex');
      await expect(codex.locator('[data-testid="cli-matrix-permission"]')).toHaveText('Full auto');
      const info = codex.locator('[data-testid="cli-matrix-permission-info-codex"]');
      await throughMatrixPopover(page, info, 'cli-permission-popover', async (panel) => {
        await expect(panel).toContainText('Full auto — Codex runs headless with full access.');
      });
      await expect(info).toBeFocused();
      await expect(page.locator('[data-testid="cli-matrix-row-copilot"] [data-testid="cli-matrix-permission"]')).toHaveText('Auto-approve: Off');
    } },
  { id: '#71', capability: 'Per-CLI grouping of delegated settings, hidden when not installed', status: 'restored',
    // Installed rows first; Cursor and Pi in the "Uninstalled" group, as plain text, with an install guide.
    reach: async (page) => {
      // Gate V 36 decision 1: the group is a disclosure ("Uninstalled CLI agents (2)"), collapsed by default.
      await orchestrationTab(page);
      const uninstalled = page.locator('[data-testid="cli-matrix-uninstalled"]');
      const toggle = await expandUninstalled(page);
      await expect(toggle).toHaveText('Uninstalled CLI agents (2)');
      await expect(uninstalled.locator('tr[data-testid^="cli-matrix-row-"]')).toHaveCount(2);
      await expect(uninstalled.locator('[data-testid="cli-matrix-row-cursor"]')).toBeVisible();
      await expect(uninstalled.locator('[data-testid="cli-matrix-row-pi"]')).toBeVisible();
      await expect(page.locator('[data-testid="cli-matrix-model-pi"]')).toHaveCount(0);
      await throughMatrixPopover(page, uninstalled.locator('[data-testid="cli-matrix-install-pi"]'), 'cli-install-popover', async (panel) => {
        await expect(panel).toContainText('npm install -g @earendil-works/pi-coding-agent');
      });
    } },
  { id: 'RUX-8', capability: 'Delegated CLI model/effort changed in place: 2 clicks (cell, value), saved on selection with Undo', status: 'restored',
    // The effort cell, then a value: one agent:setConfig. Undo is a second real write restoring the value.
    reach: async (page) => {
      const codex = await matrixRow(page, 'codex');
      const cell = codex.locator('[data-testid="cli-matrix-effort-codex"]');
      await expect(cell).toHaveText('medium');
      const before = getFixtureState(page).calls.length;
      await visibleEnabled(cell);
      await cell.click();
      await page.locator('[data-testid="cli-matrix-popover"] [data-effort="high"]').click();
      await expectCall(page, before, 'agent:setConfig', { codexReasoningEffort: 'high' });
      await expect(page.locator('[data-testid="cli-matrix-popover"]')).toHaveCount(0);
      await expect(cell).toHaveText('high');
      const undo = page.locator('[data-testid="settings-toast-undo"]');
      await visibleEnabled(undo);
      await undo.click();
      await expectCall(page, before, 'agent:setConfig', { codexReasoningEffort: 'medium' });
      await expect(cell).toHaveText('medium');
    } },
  { id: 'RUX-11', capability: 'CLI agent test result shown inline on its row (latency or failure reason)', status: 'restored',
    reach: async (page) => {
      const row = await matrixRow(page, GLM_ID);
      const before = getFixtureState(page).calls.length;
      const test = row.locator(`[data-testid="cli-matrix-test-${GLM_ID}"]`);
      await visibleEnabled(test);
      await test.click();
      await expectCall(page, before, 'ptahCli:testConnection', { id: GLM_ID });
      await expect(row.locator('[data-testid="cli-matrix-test-result"]')).toHaveText('Test passed.');
    } },
];
