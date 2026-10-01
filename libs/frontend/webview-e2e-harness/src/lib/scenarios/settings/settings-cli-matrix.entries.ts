/**
 * Gate G entries for the CLI matrix on the Orchestration tab (Batch 30): the restored #43, #44, #54, #70 and #71, and
 * the regressed-UX fixes RUX-8 and RUX-11. Batch 31 re-pointed #63 (Copilot auto-approve) and #64 (Cursor key) here. Kept apart from the table, which is over its `max-lines` budget (the
 * `settings-routing-map.entries.ts` precedent); `REACHABILITY_TABLE` spreads them in and `EXPECTED_CAPABILITY_COUNT`
 * counts them.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { ReachabilityEntry } from './settings-reachability.table';
import { expectCall, orchestrationTab, visibleEnabled } from './settings-drawer.reach';
import { getFixtureState } from './settings.fixtures';

/** The fixture's one Ptah CLI instance, "Glm" (BRIEF:66-67). */
const GLM_ID = 'glm-instance-1';

/** The CLI matrix (deferred chunk) on the Orchestration tab; returns the row of `id` (`cli-matrix-row-<id>`). */
async function matrixRow(page: Page, id: string): Promise<Locator> {
  await orchestrationTab(page);
  const row = page.locator(`[data-testid="cli-matrix-row-${id}"]`);
  await expect(row).toBeVisible();
  return row;
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

export const CLI_MATRIX_ENTRIES: readonly ReachabilityEntry[] = [
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
      await orchestrationTab(page);
      const uninstalled = page.locator('[data-testid="cli-matrix-uninstalled"]');
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
