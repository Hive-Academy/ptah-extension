import { test, expect } from '../../support/fixtures';

const GET_SETTING = `(params) => {
  const values = globalThis.__skillsE2eSettings || {};
  const defaults = {
    'skillSynthesis.enabled': true,
    'skills.telemetry.enabled': true,
    'skills.enhancement.provider': 'moonshot',
    'skills.enhancement.model': 'kimi-k2',
    'skills.enhancement.timeoutMs': 120000
  };
  const key = params && params.key;
  return { success: true, value: Object.prototype.hasOwnProperty.call(values, key)
    ? values[key] : (defaults[key] ?? null) };
}`;
const SET_SETTING = `(params) => {
  globalThis.__skillsE2eSettings ||= {};
  globalThis.__skillsE2eSettings[params.key] = params.value;
  return { success: true };
}`;

test.describe('Thoth - Skills Library', () => {
  test('Library view renders in Electron', async ({ ui }) => {
    await ui.mockRpc({ 'settings:get': GET_SETTING });
    await ui.openTab('skills');
    const page = ui.page;
    await expect(page.locator('[data-testid="thoth-section-skills"]')).toBeVisible();
    await expect(page.locator('[data-testid="clones-view"]')).toBeVisible();
    await expect(page.getByText('Manage your Skills, Agents and Commands Library.')).toBeVisible();
  });

  test('pause switch writes the committed Skills setting', async ({ ui }) => {
    await ui.mockRpc({ 'settings:get': GET_SETTING, 'settings:set': SET_SETTING });
    await ui.openTab('skills');
    const page = ui.page;
    const toggle = page.locator('[data-testid="skills-enabled-toggle"]');
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('[data-testid="skills-pause-state"]')).toHaveText('Paused');
    const call = await ui.waitForObservedCall('settings:set');
    expect(call.params).toEqual({ key: 'skillSynthesis.enabled', value: false });
  });

  test('telemetry switch writes its independent setting', async ({ ui }) => {
    await ui.mockRpc({ 'settings:get': GET_SETTING, 'settings:set': SET_SETTING });
    await ui.openTab('skills');
    const toggle = ui.page.locator('[data-testid="skills-telemetry-toggle"]');
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    const call = await ui.waitForObservedCall('settings:set');
    expect(call.params).toEqual({ key: 'skills.telemetry.enabled', value: false });
  });

  test('Enhancement model picker shows its saved provider and model', async ({ ui }) => {
    await ui.mockRpc({
      'settings:get': GET_SETTING,
      'auth:getEffectiveRoute': {
        route: 'api-key', ready: true, blockers: [], driverProviderId: 'moonshot',
        resolvedAuthModality: 'api-key', resolvedModel: { kind: 'tier', tier: 'sonnet' },
        storedAuthMethodDiagnostic: null, storedAuthMethodScope: 'global',
        providers: [{ id: 'moonshot', type: 'apiKey', status: 'connected' }],
        lastSuccessfulProbeAt: null, lastFailedProbeAt: null, probedAt: null,
        fromCache: false,
      },
      'config:getScopes': { activePath: 'C:\\ptah-e2e-ws', entries: [] },
      'config:model-get': { model: 'kimi-k2' },
      'config:effort-get': { effort: null },
      'ptahCli:list': { agents: [] },
      'memory:getTriggers': { triggers: {} },
      'provider:listCustomEntries': { entries: [] },
      'provider:listModels': `(params) => params && params.providerId === 'moonshot'
        ? { models: [{ id: 'kimi-k2', name: 'Kimi K2', description: 'Moonshot Kimi K2',
              contextLength: 200000, supportsToolUse: true }], totalCount: 1, isStatic: true }
        : { models: [], totalCount: 0, isStatic: true }`,
      'llm:getProviderBaseUrl': { baseUrl: null, defaultBaseUrl: null },
      'provider:getModelTiers': { sonnet: null, opus: null, haiku: null },
    });
    await ui.goto('settings');
    const page = ui.page;
    await page.locator('ptah-settings').getByRole('button', {
      name: 'Agent Orchestration', exact: true,
    }).click();
    await page.locator('[data-testid="background-roles-summary"]').click();
    const row = page.locator('[data-testid="consumer-row-enhancement"]');
    await expect(row).toBeVisible();
    await expect(row.locator('[data-testid="consumer-summary-enhancement"]')).toBeVisible();
    await row.locator('[data-testid="consumer-edit-enhancement"]').click();
    await expect(page.locator('[data-testid="consumer-editor-enhancement"]')).toBeVisible();
    const picker = page.locator(
      '[data-testid="consumer-editor-enhancement"] ptah-provider-model-picker',
    );
    await expect(picker.locator('[data-testid="provider-model-picker-provider"]'))
      .toHaveValue('moonshot');
    await expect(picker.locator('[data-testid="provider-model-picker-model"]'))
      .toHaveValue('kimi-k2');
  });
});
