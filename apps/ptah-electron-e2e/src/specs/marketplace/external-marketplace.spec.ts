import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';

/**
 * External marketplace consent gate (TASK_2026_270 Batch 1/5) — the security
 * model of `rpc-plugin-marketplace.types.ts` restated as executable Electron
 * UI behaviour: install is a two-call protocol, the first call writes
 * nothing, the dialog discloses everything before the second call can be
 * authorized, and deregistering a marketplace never uninstalls what it
 * already installed.
 *
 * `ExternalMarketplacesComponent.spec.ts` (jsdom/TestBed) already proves this
 * component-locally against a mocked `ClaudeRpcService`; this file proves the
 * same protocol survives the real Electron IPC round trip and DOM rendering,
 * driven the same way `new-project.spec.ts` drives the harness surface:
 * mocked RPC + real clicks, via `UiDriver`.
 *
 * Known landmine, same class as `SetupHubComponent`'s unguarded
 * `presets().length` (see `new-project.spec.ts`): `PluginStatusWidgetComponent`
 * — mounted ABOVE the external-marketplace surface inside
 * `PluginsSurfaceComponent` — reads `listResult.data.plugins.length`
 * unguarded from `plugins:list-available`, and the driver's unmocked-method
 * fallback answers with an object that has no `plugins` key. `beforeEach`
 * below mocks both `plugins:get-config` and `plugins:list-available` with
 * their real contract shapes (`PluginConfigState`, `{ plugins: PluginInfo[] }`
 * from `rpc.types.ts`) so every test in this file exercises the external
 * marketplace surface, not that unrelated widget's crash.
 */

const SOURCE = 'dotnet/skills';
const PLUGIN_NAME = 'dotnet-test';
const PLUGIN_ID = `external:${SOURCE}/${PLUGIN_NAME}`;

const MARKETPLACE_FIXTURE = {
  source: SOURCE,
  name: '.NET Agent Skills',
  pluginCount: 1,
  addedAt: '2026-01-01T00:00:00.000Z',
};

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: 'Run and debug .NET tests',
    source: SOURCE,
    path: 'skills/dotnet-test',
    version: '1.2.0',
    installed: false,
    ...overrides,
  };
}

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: PLUGIN_ID,
    source: SOURCE,
    plugin: PLUGIN_NAME,
    displayName: '.NET Test',
    version: '1.2.0',
    skills: ['dotnet-test'],
    fileCount: 4,
    totalBytes: 1024,
    scriptFiles: [],
    skippedBinaryFiles: [],
    mcpServers: [],
    collisions: [],
    consentToken: 'token-v1',
    ...overrides,
  };
}

/** The RPC shapes `PluginStatusWidgetComponent` needs to avoid the landmine. */
const PLUGIN_STATUS_WIDGET_MOCKS = {
  'plugins:get-config': { enabledPluginIds: [], disabledPluginIds: [] },
  'plugins:list-available': { plugins: [] },
};

/** Navigate to Marketplace -> Plugins, the host of the external-marketplace surface. */
async function openPluginsSurface(ui: UiDriver): Promise<void> {
  await ui.goto('marketplace');
  await ui.page.getByRole('button', { name: 'Open Plugins' }).click();
  await expect(ui.page.locator('ptah-plugins-surface')).toBeVisible();
  await expect(
    ui.page.locator('[data-testid="marketplace-source"]'),
  ).toBeVisible();
}

/** Expand the one registered marketplace so its plugin rows render. */
async function browseMarketplace(ui: UiDriver): Promise<void> {
  await ui.page.getByRole('button', { name: `Browse ${SOURCE}` }).click();
  await expect(
    ui.page.locator(`[data-testid="external-plugin-${PLUGIN_ID}"]`),
  ).toBeVisible();
}

test.describe('External marketplace — add by owner/repo (TASK_2026_270)', () => {
  test('marketplace-add stays disabled for input that is not owner/repo, and a valid slug is sent verbatim', async ({
    ui,
  }) => {
    await ui.mockRpc({
      ...PLUGIN_STATUS_WIDGET_MOCKS,
      'plugins:list-marketplaces': {
        marketplaces: [],
        suggestions: [],
        installed: [],
      },
    });
    await openPluginsSurface(ui);

    const input = ui.page.locator('[data-testid="marketplace-source"]');
    const addButton = ui.page.locator('[data-testid="marketplace-add"]');
    await expect(addButton).toBeDisabled();

    for (const invalid of [
      'dotnet',
      'dotnet/',
      '/skills',
      'dotnet/skills/extra',
      'https://github.com/dotnet/skills',
    ]) {
      await input.fill(invalid);
      await expect(addButton).toBeDisabled();
    }
    expect(await ui.getObservedCalls('plugins:add-marketplace')).toHaveLength(
      0,
    );

    await ui.mockRpc({
      'plugins:add-marketplace': { marketplace: MARKETPLACE_FIXTURE },
    });
    await input.fill(SOURCE);
    await expect(addButton).toBeEnabled();
    await addButton.click();

    const call = await ui.waitForObservedCall('plugins:add-marketplace');
    expect(call.params).toEqual({ source: SOURCE });
  });
});

test.describe('External marketplace — the two-call install protocol (TASK_2026_270)', () => {
  test.beforeEach(async ({ ui }) => {
    await ui.mockRpc({
      ...PLUGIN_STATUS_WIDGET_MOCKS,
      'plugins:list-marketplaces': {
        marketplaces: [MARKETPLACE_FIXTURE],
        suggestions: [],
        installed: [],
      },
      'plugins:browse-marketplace': {
        marketplace: MARKETPLACE_FIXTURE,
        plugins: [makeListing()],
        fromCache: false,
      },
    });
  });

  test('install issues ONE call with no consentToken and writes nothing', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'plugins:install-external': {
        status: 'consent-required',
        reason: 'not-yet-approved',
        plan: makePlan(),
      },
    });
    await openPluginsSurface(ui);
    await browseMarketplace(ui);

    await ui.page.locator('[data-testid="external-install"]').click();

    const calls = await ui.getObservedCalls('plugins:install-external');
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({ source: SOURCE, plugin: PLUGIN_NAME });
    // The key is absent, not merely undefined — a tokenless call by contract.
    expect(Object.keys(calls[0].params as object).sort()).toEqual([
      'plugin',
      'source',
    ]);

    // Nothing installed yet: the consent dialog is open and the row still
    // reads un-installed.
    await expect(
      ui.page.locator('[data-testid="external-consent"]'),
    ).toBeVisible();
    await expect(
      ui.page.locator(`[data-testid="external-plugin-${PLUGIN_ID}"]`),
    ).not.toContainText('Installed');
  });

  test('the consent dialog discloses the MCP command line verbatim, script file names, and the skill count — before any second call', async ({
    ui,
  }) => {
    const commandLine =
      'dotnet dnx Microsoft.AITools.BinlogMcp --yes --prerelease';
    const plan = makePlan({
      skills: ['dotnet-test', 'dotnet-trace'],
      scriptFiles: ['scripts/run-tests.ps1', 'scripts/collect-trace.py'],
      mcpServers: [
        {
          name: 'binlog',
          command: 'dotnet',
          args: ['dnx', 'Microsoft.AITools.BinlogMcp', '--yes', '--prerelease'],
          commandLine,
        },
      ],
    });
    await ui.mockRpc({
      'plugins:install-external': {
        status: 'consent-required',
        reason: 'not-yet-approved',
        plan,
      },
    });
    await openPluginsSurface(ui);
    await browseMarketplace(ui);

    await ui.page.locator('[data-testid="external-install"]').click();

    const dialog = ui.page.locator('[data-testid="external-consent"]');
    await expect(dialog).toBeVisible();
    const dialogText = await dialog.innerText();

    // The command line, verbatim — never abbreviated or reformatted.
    expect(dialogText).toContain(commandLine);
    expect(dialogText).toContain('NOT register or run');

    // The executable surface: script file names, verbatim.
    expect(dialogText).toContain('scripts/run-tests.ps1');
    expect(dialogText).toContain('scripts/collect-trace.py');

    // The skill count, plus the individual skill names it counts.
    expect(dialogText).toContain(`${plan.skills.length}`);
    for (const skill of plan.skills) {
      expect(dialogText).toContain(skill);
    }

    // Still only one call — the dialog discloses BEFORE the second call, not
    // instead of a second call the user never asked for.
    expect(await ui.getObservedCalls('plugins:install-external')).toHaveLength(
      1,
    );
  });

  test('confirm carries exactly the plan consentToken, and cancel issues no second call', async ({
    ui,
  }) => {
    const plan = makePlan();
    await ui.mockRpc({
      'plugins:install-external': `(params) => {
        const calls = (globalThis.__uiObservedCalls || []).filter(
          (c) => c.method === 'plugins:install-external',
        );
        if (calls.length === 1) {
          return {
            status: 'consent-required',
            reason: 'not-yet-approved',
            plan: ${JSON.stringify(plan)},
          };
        }
        return {
          status: 'installed',
          result: {
            pluginId: ${JSON.stringify(PLUGIN_ID)},
            displayName: '.NET Test',
            installedVersion: '1.2.0',
            filesWritten: 4,
            skippedBinaryFiles: [],
            collisions: [],
          },
        };
      }`,
    });
    await openPluginsSurface(ui);
    await browseMarketplace(ui);

    // --- Confirm path ---
    await ui.page.locator('[data-testid="external-install"]').click();
    await ui.page.locator('[data-testid="external-consent-confirm"]').click();

    const calls = await ui.getObservedCalls('plugins:install-external');
    expect(calls).toHaveLength(2);
    expect(calls[1].params).toEqual({
      source: SOURCE,
      plugin: PLUGIN_NAME,
      consentToken: plan.consentToken,
    });
    await expect(
      ui.page.locator('[data-testid="external-consent"]'),
    ).toHaveCount(0);
  });

  test('cancel issues no second call and leaves nothing installed', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'plugins:install-external': {
        status: 'consent-required',
        reason: 'not-yet-approved',
        plan: makePlan(),
      },
    });
    await openPluginsSurface(ui);
    await browseMarketplace(ui);

    await ui.page.locator('[data-testid="external-install"]').click();
    expect(await ui.getObservedCalls('plugins:install-external')).toHaveLength(
      1,
    );

    const dialog = ui.page.locator('[data-testid="external-consent"]');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    expect(await ui.getObservedCalls('plugins:install-external')).toHaveLength(
      1,
    );
    await expect(dialog).toHaveCount(0);
    await expect(
      ui.page.locator(`[data-testid="external-plugin-${PLUGIN_ID}"]`),
    ).not.toContainText('Installed');
  });

  test('a confirm answered consent-required re-renders the NEW plan with a re-approval banner that does not claim upstream changed, and installs nothing', async ({
    ui,
  }) => {
    const v2Plan = makePlan({
      version: '2.0.0',
      consentToken: 'token-v2',
      skills: ['dotnet-test', 'dotnet-trace'],
    });
    await ui.mockRpc({
      'plugins:install-external': `(params) => {
        const calls = (globalThis.__uiObservedCalls || []).filter(
          (c) => c.method === 'plugins:install-external',
        );
        if (calls.length === 1) {
          return {
            status: 'consent-required',
            reason: 'not-yet-approved',
            plan: ${JSON.stringify(makePlan())},
          };
        }
        if (calls.length === 2) {
          return {
            status: 'consent-required',
            reason: 'approval-expired',
            plan: ${JSON.stringify(v2Plan)},
          };
        }
        return {
          status: 'installed',
          result: {
            pluginId: ${JSON.stringify(PLUGIN_ID)},
            displayName: '.NET Test',
            installedVersion: '2.0.0',
            filesWritten: 6,
            skippedBinaryFiles: [],
            collisions: [],
          },
        };
      }`,
    });
    await openPluginsSurface(ui);
    await browseMarketplace(ui);

    await ui.page.locator('[data-testid="external-install"]').click();
    await ui.page.locator('[data-testid="external-consent-confirm"]').click();

    // Re-consent, not a dismissal and not an error: the dialog is still open,
    // showing the FRESH plan.
    const dialog = ui.page.locator('[data-testid="external-consent"]');
    await expect(dialog).toBeVisible();
    const dialogText = await dialog.innerText();
    expect(dialogText).toContain('2.0.0');
    expect(dialogText).toContain('dotnet-trace');

    // `approval-expired` covers a lapsed TTL, a host restart AND changed
    // upstream content, so the honest copy names all three possibilities
    // rather than committing to "upstream changed".
    expect(dialogText).toContain('no longer valid');
    expect(dialogText).toContain('may have timed out');
    expect(dialogText).toContain('Ptah may have restarted');
    expect(dialogText).toContain('contents may have changed');

    // Still exactly 2 calls — the re-ask did not install anything.
    expect(await ui.getObservedCalls('plugins:install-external')).toHaveLength(
      2,
    );

    // Confirming the fresh plan carries the NEW token, never the stale one.
    await ui.page.locator('[data-testid="external-consent-confirm"]').click();
    const calls = await ui.getObservedCalls('plugins:install-external');
    expect(calls).toHaveLength(3);
    expect(calls[2].params).toEqual({
      source: SOURCE,
      plugin: PLUGIN_NAME,
      consentToken: 'token-v2',
    });
  });
});

test.describe('External marketplace — deregistering (TASK_2026_270)', () => {
  test('deregistering a marketplace does not uninstall its plugins, and they stay visible (and removable) in the flat Installed section', async ({
    ui,
  }) => {
    const installedListing = makeListing({
      installed: true,
      installedVersion: '1.2.0',
    });
    await ui.mockRpc({
      ...PLUGIN_STATUS_WIDGET_MOCKS,
      'plugins:list-marketplaces': `() => {
        const removed = globalThis.__marketplaceRemoved === true;
        return {
          marketplaces: removed ? [] : [${JSON.stringify(MARKETPLACE_FIXTURE)}],
          suggestions: [],
          installed: [${JSON.stringify(installedListing)}],
        };
      }`,
      'plugins:remove-marketplace': `() => {
        globalThis.__marketplaceRemoved = true;
        return { removed: true };
      }`,
    });
    await openPluginsSurface(ui);

    const installedRow = ui.page.locator(
      `[data-testid="external-installed-${PLUGIN_ID}"]`,
    );
    await expect(installedRow).toBeVisible();
    await expect(installedRow).not.toContainText('Marketplace removed');

    // Deregister, confirming the "NOT uninstalled" copy first.
    await ui.page.getByRole('button', { name: `Remove ${SOURCE}` }).click();
    await expect(
      ui.page.getByText('are NOT uninstalled', { exact: false }),
    ).toBeVisible();
    await ui.page.getByRole('button', { name: 'Remove marketplace' }).click();

    const call = await ui.waitForObservedCall('plugins:remove-marketplace');
    expect(call.params).toEqual({ source: SOURCE });

    // The registered section is now empty...
    await expect(
      ui.page.locator(`[data-testid="external-plugin-${PLUGIN_ID}"]`),
    ).toHaveCount(0);
    await expect(
      ui.page.getByText('No external marketplaces yet'),
    ).toBeVisible();

    // ...but the plugin the deregistered marketplace installed is STILL
    // installed, still visible, flagged orphaned, and still has an Uninstall
    // action — the only surface left that can remove it.
    await expect(installedRow).toBeVisible();
    await expect(installedRow).toContainText('Marketplace removed');
    await expect(
      installedRow.getByRole('button', { name: /Uninstall/ }),
    ).toBeVisible();
  });
});
