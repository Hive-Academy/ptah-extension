/**
 * Gate G entries for the Advanced tab (TASK_2026_555 Batch 49): one per capability of the pattern map's
 * preserve list (pattern-map-advanced-search-voice.md §4, rows A1-A37). Each entry makes the clicks a user
 * makes and asserts the result; a write is checked by its recorded RPC and its toast, and every entry puts
 * the fixture back the way it found it (Undo, or an explicit restore). Kept apart from the table, which is
 * at its `max-lines` budget; `REACHABILITY_TABLE` spreads them in and `EXPECTED_CAPABILITY_COUNT` counts them.
 */
import { expect, type Page } from '@playwright/test';
import type { ReachabilityEntry } from './settings-reachability.table';
import { getFixtureState } from './settings.fixtures';
import { advancedTab, visibleEnabled } from './settings-drawer.reach';
import {
  closeDrawers, dismissToast, expectSavedThenUndo, expectWrite, isElectron, promptDetailsButton, remountTab, styleRow, throughAsvVariant, withAsvChange,
} from './settings-advanced-search-voice.reach';

const before = (page: Page): number => getFixtureState(page).calls.length;
const card = (page: Page) => page.locator('ptah-license-status-card');
const radio = (page: Page, name: string) => styleRow(page, name).getByRole('radio');

/** Membership variants: the license is read once at app start, so they boot a second page. */
const MEMBER = {
  valid: true, tier: 'pro', isPremium: true, isCommunity: false, daysRemaining: 120,
  plan: { name: 'Builders', description: 'Builders membership: every Ptah feature, billed yearly.', features: [] },
  user: { email: 'j.doe@example.com', firstName: 'Jane', lastName: 'Doe' },
};

const membership: readonly ReachabilityEntry[] = [
  { id: 'ADV-1', capability: 'Membership & data: tier badge, status and one primary action (Create Account), Explore Builders', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      await expect(card(page)).toContainText('Community');
      await expect(card(page).locator('.btn-primary')).toHaveCount(1);
      await expect(card(page).locator('.btn-primary')).toContainText('Create Account');
      await visibleEnabled(card(page).getByRole('button', { name: /Explore Ptah Builders/ }));
    } },
  { id: 'ADV-2', capability: 'Membership key not active: warning, and Re-enter opens the key popover', status: 'restored',
    reach: (page) => throughAsvVariant(page, (state) => { state.license = { ...state.license, reason: 'expired' }; }, 'Advanced', async (p) => {
      const alert = p.locator('[data-testid="membership-key-alert"]');
      await expect(alert).toContainText('Ptah\'s local features remain available either way.');
      await p.locator('[data-testid="membership-key-alert-action"]').click();
      await expect(p.locator('[data-testid="membership-key-popover"]')).toBeVisible();
      await expect(p.locator('[data-testid="membership-key-input"]')).toHaveAttribute('type', 'password');
    }) },
  { id: 'ADV-3', capability: 'Member: user identity, plan text, Manage Membership, Log out behind an inline confirm', status: 'restored',
    reach: (page) => throughAsvVariant(page, (state) => { state.license = MEMBER; }, 'Advanced', async (p) => {
      const member = p.locator('ptah-license-status-card');
      await expect(member).toContainText('j.doe@example.com');
      await expect(member).toContainText(MEMBER.plan.description);
      await expect(member.locator('.btn-primary')).toHaveCount(1);
      await expect(member.locator('.btn-primary')).toContainText('Manage Membership');
      await p.locator('[data-testid="logout-button"]').click();
      const confirm = p.locator('[data-testid="logout-confirm"]');
      await expect(confirm).toBeVisible();
      await visibleEnabled(p.locator('[data-testid="logout-confirm-button"]'));
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await expect(confirm).toHaveCount(0);
    }) },
  { id: 'ADV-4', capability: 'Enter membership key: popover with a masked field and the local format check', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      const trigger = page.locator('[data-testid="membership-key-trigger"]');
      await trigger.click();
      const input = page.locator('[data-testid="membership-key-input"]');
      await expect(input).toHaveAttribute('type', 'password');
      await input.fill('not-a-key');
      await page.locator('[data-testid="membership-key-activate"]').click();
      await expect(page.locator('[data-testid="membership-key-error"]')).toContainText('Invalid format');
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="membership-key-popover"]')).toHaveCount(0);
    } },
  { id: 'ADV-5', capability: 'Export settings, and Import settings behind an inline confirm', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      const electron = await isElectron(page);
      let start = before(page);
      await page.getByRole('button', { name: 'Export settings' }).click();
      if (electron) await expectWrite(page, start, 'settings:export', {});
      else await expectWrite(page, start, 'command:execute', { command: 'ptah.exportSettings' });
      await page.getByRole('button', { name: 'Import settings' }).click();
      await expect(page.locator('[data-testid="import-confirm"]')).toBeVisible();
      start = before(page);
      await page.locator('[data-testid="import-confirm-button"]').click();
      if (electron) {
        await expectWrite(page, start, 'settings:import', {});
        await expect(page.locator('[data-testid="import-outcome"]')).toHaveText('Settings imported.');
      } else {
        await expectWrite(page, start, 'command:execute', { command: 'ptah.importSettings' });
      }
    } },
];

const agentBehaviour: readonly ReachabilityEntry[] = [
  { id: 'ADV-6', capability: 'System prompt mode on/off with its Ptah Enhanced status (save on selection, Undo)', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      const status = page.locator('[data-testid="agent-behaviour-prompt-status"]');
      await expect(status).toContainText('Ptah Enhanced');
      await expect(status).toContainText('Active for all sessions');
      const start = before(page);
      await page.getByLabel('Toggle Enhanced System Prompt').click();
      await expectWrite(page, start, 'enhancedPrompts:setEnabled', { enabled: false });
      await expect(status).toContainText('Default');
      await expectSavedThenUndo(page, 'system prompt mode', 'enhancedPrompts:setEnabled', { enabled: true });
      await expect(status).toContainText('Ptah Enhanced');
    } },
  { id: 'ADV-7', capability: 'System prompt drawer: generated-at, stack, preview, Regenerate (confirm), Download', status: 'restored',
    // Closed through its footer Close (Esc after Download can land on the busy button); Esc is pinned by the focus scene.
    reach: async (page) => {
      const details = await promptDetailsButton(page);
      await details.click();
      try {
        await expect(page.locator('[data-testid="system-prompt-drawer"]')).toBeVisible();
        await expect(page.locator('[data-testid="system-prompt-generated-at"]')).toBeVisible();
        await expect(page.locator('[data-testid="system-prompt-detected-stack"]')).toContainText('Angular');
        await page.locator('[data-testid="system-prompt-preview-toggle"]').click();
        await expect(page.locator('[data-testid="system-prompt-markdown-preview"]')).toContainText('Project context');
        await page.locator('[data-testid="system-prompt-regenerate-button"]').click();
        await expect(page.locator('[data-testid="regenerate-confirm"]')).toBeVisible();
        await page.locator('[data-testid="regenerate-cancel-button"]').click();
        await expect(page.locator('[data-testid="regenerate-confirm"]')).toHaveCount(0);
        const start = before(page);
        await page.locator('[data-testid="system-prompt-download-button"]').click();
        await expectWrite(page, start, 'enhancedPrompts:download', {});
        await page.locator('[data-testid="system-prompt-drawer-close"]').click();
        await expect(page.locator('[data-testid="system-prompt-drawer"]')).toHaveCount(0);
        await expect(details).toBeFocused();
      } finally {
        await closeDrawers(page);
      }
    } },
  { id: 'ADV-8', capability: 'No generated prompt: mode locked with the Setup Wizard guidance, drawer empty state', status: 'restored',
    reach: (page) => withAsvChange(page, 'Advanced', (state) => {
      const previous = { ...state.prompt };
      state.prompt = { enabled: false, hasGeneratedPrompt: false };
      return () => { state.prompt = previous; };
    }, async () => {
      await expect(page.getByLabel('Toggle Enhanced System Prompt')).toBeDisabled();
      await expect(page.locator('[data-testid="agent-behaviour-row-prompt"]')).toContainText('Run the Setup Wizard');
      await page.locator('[data-testid="agent-behaviour-prompt-details"]').click();
      await expect(page.locator('[data-testid="system-prompt-empty-state"]')).toContainText('Run the Setup Wizard');
      await expect(page.locator('[data-testid="system-prompt-regenerate-button"]')).toBeDisabled();
    }) },
  { id: 'ADV-9', capability: 'Chat reasoning effort: popover with 6 choices (incl. SDK default), save on selection, Undo', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      const value = page.locator('[data-testid="agent-behaviour-effort-value"]');
      await expect(value).toContainText('Medium');
      await value.click();
      await expect(page.locator('[data-testid^="agent-behaviour-effort-choice-"]')).toHaveCount(6);
      const start = before(page);
      await page.locator('[data-testid="agent-behaviour-effort-choice-high"]').click();
      await expectWrite(page, start, 'config:effort-set', { effort: 'high' });
      await expect(value).toContainText('High');
      await expectSavedThenUndo(page, 'chat reasoning effort', 'config:effort-set', { effort: 'medium' });
      await expect(value).toContainText('Medium');
    } },
  { id: 'ADV-10', capability: 'Dynamic workflows on/off (save on selection, Undo)', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      const status = page.locator('[data-testid="agent-behaviour-workflows-status"]');
      await expect(status).toHaveText('On');
      const start = before(page);
      await page.getByLabel('Toggle dynamic workflows').click();
      await expectWrite(page, start, 'agent:setConfig', { workflowsDisabled: true });
      await expect(status).toHaveText('Off');
      await expectSavedThenUndo(page, 'dynamic workflows', 'agent:setConfig', { workflowsDisabled: false });
      await expect(status).toHaveText('On');
    } },
  { id: 'ADV-11', capability: 'Ultracode on pins X-High; off restores the previous effort', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      const toggle = page.getByLabel('Toggle Ultracode mode');
      const value = page.locator('[data-testid="agent-behaviour-effort-value"]');
      let start = before(page);
      await toggle.click();
      await expectWrite(page, start, 'config:effort-set', { effort: 'xhigh' });
      await expect(page.locator('[data-testid="agent-behaviour-ultracode-status"]')).toContainText('On');
      await expect(value).toContainText('X-High');
      await expect(value).toBeDisabled();
      await dismissToast(page, 'Saved Ultracode.');
      start = before(page);
      await toggle.click();
      await expectWrite(page, start, 'config:effort-set', { effort: 'medium' });
      await expect(value).toContainText('Medium');
      await expect(value).toBeEnabled();
      await dismissToast(page, 'Saved Ultracode.');
    } },
];

const outputStyle: readonly ReachabilityEntry[] = [
  { id: 'ADV-12', capability: 'Output style: pick the active style (save on selection, Undo), tier badges', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      await expect(styleRow(page, 'team-house-style')).toContainText('Drops default coding instructions');
      await expect(radio(page, 'concise-reviewer')).toBeChecked();
      const start = before(page);
      await radio(page, 'Learning').click();
      await expectWrite(page, start, 'outputStyle:activate', { name: 'Learning' });
      await expect(radio(page, 'Learning')).toBeChecked();
      await expectSavedThenUndo(page, 'output style', 'outputStyle:activate', { name: 'concise-reviewer' });
      await expect(radio(page, 'concise-reviewer')).toBeChecked();
    } },
  { id: 'ADV-13', capability: 'Output style: missing active style banner with Clear the selection', status: 'restored',
    reach: (page) => withAsvChange(page, 'Advanced', (state) => {
      const previous = state.outputStyles.active;
      state.outputStyles.active = { name: 'retired-style', tier: 'user', missing: true };
      return () => { state.outputStyles.active = previous; };
    }, async () => {
      await expect(page.locator('[data-testid="output-style-missing-banner"]')).toBeVisible();
      const start = before(page);
      await page.locator('[data-testid="output-style-clear-selection"]').click();
      await expectWrite(page, start, 'outputStyle:activate', { name: null });
      await dismissToast(page, 'Saved output style.');
    }) },
  { id: 'ADV-14', capability: 'Output style: New style opens the editor drawer (D-OS); Cancel closes it', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      await page.locator('[data-testid="output-style-new-button"]').click();
      try {
        await expect(page.locator('[data-testid="output-style-drawer-title"]')).toHaveText('New style');
        await visibleEnabled(page.locator('#output-style-name'));
        await page.locator('[data-testid="output-style-cancel-button"]').click();
        await expect(page.locator('[data-testid="output-style-drawer"]')).toHaveCount(0);
      } finally {
        await closeDrawers(page);
      }
    } },
  { id: 'ADV-15', capability: 'Output style: Edit opens the drawer filled in; Save style writes the file', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      await styleRow(page, 'concise-reviewer').locator('[data-testid="output-style-edit-button"]').click();
      try {
        await expect(page.locator('#output-style-name')).toHaveValue('concise-reviewer');
        const start = before(page);
        await page.locator('[data-testid="output-style-save-button"]').click();
        await expectWrite(page, start, 'outputStyle:save', { name: 'concise-reviewer' });
        await expect(page.locator('[data-testid="output-style-drawer"]')).toHaveCount(0);
      } finally {
        await closeDrawers(page);
      }
    } },
  { id: 'ADV-16', capability: 'Output style: Delete behind an inline confirm; built-ins cannot be edited or deleted', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      await expect(styleRow(page, 'Learning').locator('[data-testid="output-style-delete-button"]')).toBeDisabled();
      await styleRow(page, 'team-house-style').locator('[data-testid="output-style-delete-button"]').click();
      await expect(page.locator('[data-testid="output-style-delete-confirm"]')).toBeVisible();
      const start = before(page);
      await page.locator('[data-testid="output-style-confirm-delete"]').click();
      await expectWrite(page, start, 'outputStyle:delete', { name: 'team-house-style' });
    } },
  { id: 'ADV-17', capability: 'Output style: unreadable files listed with Rewrite it here (drawer in repair mode)', status: 'restored',
    reach: (page) => withAsvChange(page, 'Advanced', (state) => {
      state.outputStyles.invalid = [{ fileName: 'broken.md', relativePath: '.claude/output-styles/broken.md', tier: 'project',
        error: { code: 'YAML_PARSE', line: 2, message: 'The frontmatter is not valid YAML (line 2).' }, openable: true }];
      return () => { state.outputStyles.invalid = []; };
    }, async () => {
      await expect(page.locator('[data-testid="output-style-invalid-section"]')).toContainText('broken.md');
      await page.locator('[data-testid="output-style-rewrite-button"]').first().click();
      await expect(page.locator('[data-testid="output-style-repair-notice"]')).toBeVisible();
      await page.locator('[data-testid="output-style-cancel-button"]').click();
    }) },
  { id: 'ADV-18', capability: 'Output style: fallback-injection banner with Copy to this project', status: 'restored',
    reach: (page) => withAsvChange(page, 'Advanced', (state) => {
      const previous = state.outputStyles.decision;
      state.outputStyles.decision = { path: 'inject', body: 'Terse answers.', styleName: 'concise-reviewer' };
      return () => { state.outputStyles.decision = previous; };
    }, async () => {
      await expect(page.locator('[data-testid="output-style-fallback-banner"]')).toBeVisible();
      await visibleEnabled(page.locator('[data-testid="output-style-copy-to-project"]'));
    }) },
  { id: 'ADV-19', capability: 'Output style: command-line parity (collapsed), the file write asks first and names the path', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      const details = page.locator('[data-testid="output-style-parity-details"]');
      await details.locator('summary').click();
      const parity = page.locator('[data-testid="output-style-parity-checkbox"]');
      await parity.check();
      await expect(page.locator('[data-testid="output-style-parity-select"]')).toBeVisible();
      const start = before(page);
      await radio(page, 'Learning').click();
      await expect(page.locator('[data-testid="parity-confirm"]')).toContainText('.claude');
      await page.locator('[data-testid="parity-cancel-button"]').click();
      await expect(page.locator('[data-testid="parity-confirm"]')).toHaveCount(0);
      await parity.uncheck();
      await details.locator('summary').click();
      expect(getFixtureState(page).calls.slice(start).some((call) => call.method === 'outputStyle:activate')).toBe(false);
      // A cancelled confirm leaves the clicked radio checked on screen (Batch 49 finding, pinned by the D15
      // scene); a remount puts the matrix back on the saved style for the entries after this one.
      await remountTab(page, 'Advanced');
      await expect(radio(page, 'concise-reviewer')).toBeChecked();
    } },
];

const mcpAndLm: readonly ReachabilityEntry[] = [
  { id: 'ADV-20', capability: 'MCP port: validation, explicit Save with the restart note, Undo', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      await expect(page.locator('ptah-mcp-port-config')).toContainText('Changes apply after the MCP server restarts.');
      const input = page.locator('[data-testid="mcp-port-input"]');
      await input.fill('80');
      await expect(page.locator('[data-testid="mcp-port-validation-error"]')).toContainText('between 1024 and 65535');
      await input.fill('51821');
      const start = before(page);
      await page.locator('[data-testid="mcp-port-save-btn"]').click();
      await expectWrite(page, start, 'agent:setConfig', { mcpPort: 51821 });
      await expectSavedThenUndo(page, 'MCP port', 'agent:setConfig', { mcpPort: 51820 });
      await expect(input).toHaveValue('51820');
    } },
  { id: 'ADV-21', capability: 'MCP tool namespaces: 5 on/off rows (save on selection, Undo)', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      await expect(page.locator('[data-testid^="settings-toggle-mcp-namespace-"]')).toHaveCount(5);
      const git = page.locator('[data-testid="settings-toggle-mcp-namespace-git"]');
      await expect(git).toBeChecked();
      const start = before(page);
      await git.click();
      await expectWrite(page, start, 'agent:setConfig', { disabledMcpNamespaces: ['git'] });
      await expect(git).not.toBeChecked();
      await expectSavedThenUndo(page, 'Git Worktree namespace', 'agent:setConfig', { disabledMcpNamespaces: [] });
      await expect(git).toBeChecked();
    } },
  { id: 'ADV-22', capability: 'Browser "Allow localhost": enabling asks first (inline confirm); disabling saves at once', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      const toggle = page.locator('[data-testid="settings-toggle-browser-allow-localhost"]');
      await toggle.click();
      await expect(page.locator('[data-testid="allow-localhost-confirm"]')).toBeVisible();
      await expect(toggle).not.toBeChecked();
      await page.locator('[data-testid="allow-localhost-cancel-btn"]').click();
      await expect(page.locator('[data-testid="allow-localhost-confirm"]')).toHaveCount(0);
      let start = before(page);
      await toggle.click();
      await page.locator('[data-testid="allow-localhost-confirm-btn"]').click();
      await expectWrite(page, start, 'agent:setConfig', { browserAllowLocalhost: true });
      await expect(toggle).toBeChecked();
      await dismissToast(page, 'Saved Allow localhost.');
      start = before(page);
      await toggle.click();
      await expectWrite(page, start, 'agent:setConfig', { browserAllowLocalhost: false });
      await expect(toggle).not.toBeChecked();
      await dismissToast(page, 'Saved Allow localhost.');
    } },
  { id: 'ADV-23', capability: 'VS Code LM card: Default / Configured / capability badges; model choice saved with Undo', status: 'restored',
    reach: async (page) => {
      await advancedTab(page);
      const lm = page.locator('ptah-vscode-lm-config');
      await expect(lm.getByLabel('Default provider')).toBeVisible();
      await expect(lm.getByLabel('Provider configured')).toBeVisible();
      await expect(lm).toContainText('Tool Use', { ignoreCase: true });
      const start = before(page);
      await page.locator('[data-testid="vscode-lm-model-select"]').selectOption('copilot-claude-sonnet');
      await expectWrite(page, start, 'llm:setDefaultModel', { provider: 'vscode-lm', model: 'copilot-claude-sonnet' });
      await expectSavedThenUndo(page, 'VS Code language model', 'llm:setDefaultModel', { provider: 'vscode-lm', model: 'copilot-gpt-4o' });
    } },
  { id: 'ADV-24', capability: 'VS Code LM: Set as Default when another provider is the default', status: 'restored',
    // `LlmProviderStateService` reads the provider status once and caches it: a second page boots with it.
    reach: (page) => throughAsvVariant(page, (state) => { state.llm.defaultProvider = 'openrouter'; }, 'Advanced', async (p, calls) => {
      const setDefault = p.locator('[data-testid="vscode-lm-set-default"]');
      await visibleEnabled(setDefault);
      await setDefault.click();
      await expect.poll(() => calls.filter((call) => call.method === 'llm:setDefaultProvider').map((call) => call.params))
        .toContainEqual({ provider: 'vscode-lm' });
      await expect(p.locator('[data-testid="settings-toast-message"]')).toHaveText('Saved default provider.');
      await expect(setDefault).toHaveCount(0);
    }) },
];

/** Every Advanced entry, in tab order. */
export const ADVANCED_ENTRIES: readonly ReachabilityEntry[] = [...membership, ...agentBehaviour, ...outputStyle, ...mcpAndLm];
