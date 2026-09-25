/**
 * E2E: Marketplace capability controls — the MCP server on/off toggles added
 * by TASK_2026_560 (plan C10) to the Installed servers page and the server
 * detail view: workspace write + reload persistence (AC-1.1), revert on a
 * failed write (AC-1.4), the scope-of-write text (AC-2.2), "size unknown"
 * with no measured schema (AC-5.2), the Ptah-off warning (AC-4.6), a new
 * repository-declared server's badge and exact write payload, the imported
 * badge, the unverified-policy banner, and the "not enforced" labels
 * (AC-4.8).
 *
 * Same real-bundle pattern as `./marketplace-servers.e2e.spec.ts` — see that
 * file's header and `./marketplace.fixtures.ts` for the host/RPC mechanism.
 * `capabilities:getState` / `capabilities:getEffective` / `capabilities:setEnabled`
 * have NO entry in `baseMarketplaceFixtures()`, so every scenario here adds
 * its own answers for them (Batch 16 reviewer acceptance item: otherwise the
 * "Use in sessions" panel and the server-detail "Use in sessions" section
 * show their error state, and no scenario below could reach the controls it
 * means to test). The capability fixtures are defined IN THIS FILE, not in
 * `marketplace.fixtures.ts`, which is imported but never modified (Batch 16
 * budget fallback).
 */
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import {
  baseMarketplaceFixtures,
  installHost,
  installRpcAutoResponder,
  type RpcFixtureResolver,
} from './marketplace.fixtures';
// Type-only: erased at compile time, so it never reaches the runtime module
// graph. A VALUE import of `@ptah-extension/shared` breaks this harness's
// `e2e` target — Playwright's transform resolves it to a CJS build, and a
// `import { x } from '@ptah-extension/shared'` ESM named import against that
// build fails with "is a CommonJS module, which may not support all
// module.exports as named exports" (confirmed by running the target with a
// value import). `postmessage-bridge.ts` and `marketplace.fixtures.ts`
// document the same constraint ("intentionally decoupled from
// `@ptah-extension/shared`" / "no dependency on `@ptah-extension/shared`'s
// reducer logic"). `PTAH_MCP_SERVER_NAME` and `CAPABILITY_ENFORCEMENT` are
// mirrored as local, clearly-labelled constants below instead.
import type { CapabilityEntry } from '@ptah-extension/shared';

test.use({ useAppBuild: true });

/** Mirrors `PTAH_MCP_SERVER_NAME` in `libs/shared/src/lib/types/capability-toggle.types.ts` (see the type-only-import note above). */
const PTAH_MCP_SERVER_NAME = 'ptah';

/**
 * Mirrors `CAPABILITY_ENFORCEMENT` in
 * `libs/shared/src/lib/types/capability-toggle.types.ts:685-694` verbatim
 * (same rows, same order) — the only table `notEnforcedProviders()`
 * (`ui/capability-toggle.component.ts`) reads from, so the app and this spec
 * read the identical source of truth in substance, even though this file
 * cannot `import` it at runtime (see the note above). If a provider starts
 * enforcing MCP toggles, this row flips here AND there, or the "not
 * enforced" scenario below fails loudly instead of silently drifting.
 */
const MIRRORED_CAPABILITY_ENFORCEMENT: readonly {
  readonly label: string;
  readonly kind: 'mcp' | 'skill' | 'plugin';
  readonly status: 'enforced' | 'not-enforced';
}[] = [
  { label: 'Claude', kind: 'mcp', status: 'enforced' },
  { label: 'Claude', kind: 'skill', status: 'enforced' },
  { label: 'Claude', kind: 'plugin', status: 'enforced' },
  { label: 'Ptah CLI agents', kind: 'mcp', status: 'enforced' },
  { label: 'Ptah CLI agents', kind: 'skill', status: 'enforced' },
  { label: 'Ptah CLI agents', kind: 'plugin', status: 'enforced' },
  { label: 'Codex', kind: 'mcp', status: 'not-enforced' },
  { label: 'Codex', kind: 'skill', status: 'enforced' },
  { label: 'Codex', kind: 'plugin', status: 'enforced' },
  { label: 'OpenCode', kind: 'mcp', status: 'not-enforced' },
  { label: 'OpenCode', kind: 'skill', status: 'enforced' },
  { label: 'OpenCode', kind: 'plugin', status: 'enforced' },
  { label: 'Antigravity', kind: 'mcp', status: 'not-enforced' },
  { label: 'Antigravity', kind: 'skill', status: 'enforced' },
  { label: 'Antigravity', kind: 'plugin', status: 'enforced' },
  { label: 'Ptah CLI proxy', kind: 'mcp', status: 'not-enforced' },
];

// ---------------------------------------------------------------------------
// Capability fixtures — local to this spec (Batch 16 budget fallback: no
// `marketplace.fixtures.ts` edit).
// ---------------------------------------------------------------------------

/** A server present in `INSTALLED_SERVERS_FIXTURE`, ON by the global layer. */
const FIRECRAWL_ID = 'firecrawl';
/** A server present in `INSTALLED_SERVERS_FIXTURE`, used only for the revert
 * case so its failure never leaks into another scenario's assertions. */
const REVERT_ID = 'davinci-resolve';
const REVERT_LABEL = 'Davinci Resolve';
/** No installed row for either — Ptah's own server and a repository-only
 * declaration both have a capability row with nothing installed (the doc
 * comment on `InstalledServersPageComponent` names this explicitly). */
const REPO_ONLY_ID = 'repo-only-server';
const IMPORTED_ID = 'imported-server';

function baseEntries(): CapabilityEntry[] {
  return [
    {
      kind: 'mcp',
      id: PTAH_MCP_SERVER_NAME,
      label: 'ptah',
      sources: [
        {
          scope: 'global',
          path: 'C:\\Users\\dev\\.ptah\\mcp\\ptah.json',
          label: 'Config file',
        },
      ],
      effectiveEnabled: true,
      inheritedFrom: 'default',
      defaultReason: 'ptah',
    },
    {
      kind: 'mcp',
      id: FIRECRAWL_ID,
      label: 'firecrawl',
      sources: [
        {
          scope: 'global',
          path: 'C:\\Users\\dev\\.claude.json',
          label: '~/.claude.json',
        },
      ],
      effectiveEnabled: true,
      globalEnabled: true,
      inheritedFrom: 'global',
      // Deliberately no `schemaTokens` (AC-5.2: "size unknown", never zero).
    },
    {
      kind: 'mcp',
      id: REVERT_ID,
      label: REVERT_LABEL,
      sources: [
        {
          scope: 'global',
          path: 'C:\\Users\\dev\\.claude.json',
          label: '~/.claude.json',
        },
      ],
      effectiveEnabled: true,
      globalEnabled: true,
      inheritedFrom: 'global',
    },
    {
      kind: 'mcp',
      id: REPO_ONLY_ID,
      label: 'repo-only-server',
      sources: [
        {
          scope: 'workspace',
          path: 'C:\\ptah-e2e-ws-a\\.mcp.json',
          label: '.mcp.json',
        },
      ],
      effectiveEnabled: false,
      inheritedFrom: 'default',
      defaultReason: 'repository-only',
    },
    {
      kind: 'mcp',
      id: IMPORTED_ID,
      label: 'imported-server',
      sources: [
        {
          scope: 'global',
          path: 'C:\\Users\\dev\\.claude.json',
          label: '~/.claude.json',
        },
      ],
      effectiveEnabled: true,
      inheritedFrom: 'imported',
      importedFromClaude: true,
    },
  ];
}

interface CapabilitySetEnabledCall {
  scope: string;
  kind: string;
  id: string;
  enabled: boolean;
}

/**
 * A verified-policy capability fixture set: `capabilities:getState` answers
 * from a Node-side map that `capabilities:setEnabled` mutates, so a toggle
 * survives a `page.reload()` (the resolvers are exposed via
 * `page.exposeFunction`, which Playwright re-installs on every navigation —
 * see `installRpcAutoResponder`'s doc comment). `failId`, when given, makes
 * every `setEnabled` call for that one id answer with no `entry` (so
 * `RpcResult.isSuccess()` is false — `success:true` but `data:undefined` —
 * without needing the auto-responder to support an error envelope it does
 * not have).
 */
function verifiedCapabilityFixtures(failId?: string): {
  fixtures: Record<string, unknown>;
  setEnabledCalls: CapabilitySetEnabledCall[];
} {
  const state = new Map<string, CapabilityEntry>();
  for (const entry of baseEntries()) state.set(`${entry.kind}:${entry.id}`, entry);
  const setEnabledCalls: CapabilitySetEnabledCall[] = [];

  const getState: RpcFixtureResolver = () => ({
    status: 'verified',
    reasons: [],
    entries: [...state.values()],
  });

  const setEnabled: RpcFixtureResolver = (params) => {
    const call = params as CapabilitySetEnabledCall;
    setEnabledCalls.push(call);
    if (call.id === failId) return undefined;
    const key = `${call.kind}:${call.id}`;
    const prior = state.get(key);
    if (prior === undefined) return undefined;
    const next: CapabilityEntry =
      call.scope === 'workspace'
        ? {
            ...prior,
            workspaceEnabled: call.enabled,
            effectiveEnabled: call.enabled,
            inheritedFrom: 'workspace',
          }
        : {
            ...prior,
            globalEnabled: call.enabled,
            effectiveEnabled: call.enabled,
            inheritedFrom: 'global',
          };
    state.set(key, next);
    return { entry: next };
  };

  const getEffective = {
    physicalRoot: 'C:\\ptah-e2e-ws-a',
    policyKey: 'c:\\ptah-e2e-ws-a',
    status: 'verified',
    reasons: [],
    ptahEnabled: true,
    deniedMcpServers: [],
    approvedProjectMcpServers: [],
    deniedSkillNames: [],
    disabledPluginIds: [],
    harnessFingerprint: 'e2e-fixture-fingerprint',
  };

  return {
    fixtures: {
      ...baseMarketplaceFixtures(),
      'capabilities:getState': getState,
      'capabilities:setEnabled': setEnabled,
      'capabilities:getEffective': getEffective,
    },
    setEnabledCalls,
  };
}

/** An unverified-policy fixture set (scenario 8: the fail-closed banner). */
function unverifiedCapabilityFixtures(): {
  fixtures: Record<string, unknown>;
  reason: { path: string; error: string };
} {
  const reason = {
    path: 'C:\\Users\\dev\\.claude\\settings.local.json',
    error: 'invalid JSON',
  };
  return {
    fixtures: {
      ...baseMarketplaceFixtures(),
      'capabilities:getState': {
        status: 'unverified',
        reasons: [reason],
        entries: baseEntries().map((entry) => ({
          ...entry,
          effectiveEnabled: null,
        })),
      },
      'capabilities:getEffective': {
        physicalRoot: 'C:\\ptah-e2e-ws-a',
        policyKey: 'c:\\ptah-e2e-ws-a',
        status: 'unverified',
        reasons: [reason],
        ptahEnabled: true,
        deniedMcpServers: [],
        approvedProjectMcpServers: [],
        deniedSkillNames: [],
        disabledPluginIds: [],
        harnessFingerprint: 'e2e-fixture-fingerprint-unverified',
      },
    },
    reason,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openServersPage(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('a[data-nav-id="servers"]').click();
  await expect(page.locator('[data-testid="provider-list-rows"]')).toBeVisible();
  await expect(page.locator('[data-testid="server-capabilities"]')).toHaveAttribute(
    'data-state',
    'ready',
  );
}

function capabilityRow(page: import('@playwright/test').Page, id: string) {
  return page.locator(
    `[data-testid="server-capability-row"][data-capability-id="${id}"]`,
  );
}

// ---------------------------------------------------------------------------
// AC-1.1 — a workspace toggle writes and survives a webview reload.
// ---------------------------------------------------------------------------

test.describe('webview > marketplace > capability toggles > persistence', () => {
  test('a server toggle writes and survives a webview reload (AC-1.1)', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    const { fixtures } = verifiedCapabilityFixtures();
    await installRpcAutoResponder(page, fixtures);
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });

    await openServersPage(page);
    const row = capabilityRow(page, FIRECRAWL_ID);
    const input = row.locator('[data-testid="capability-toggle-input"]');
    await expect(input).toBeChecked();

    await input.click();
    await expect(input).not.toBeChecked();

    // A real webview reload — the postMessage bridge, host config and RPC
    // auto-responder are all `addInitScript`/`exposeFunction`-based, so they
    // survive it (see `installRpcAutoResponder`'s doc comment); the Node-side
    // `state` map the resolver mutated survives too, since it lives in this
    // test's own closure, not in the page.
    await page.reload();
    await openServersPage(page);
    const inputAfterReload = capabilityRow(page, FIRECRAWL_ID).locator(
      '[data-testid="capability-toggle-input"]',
    );
    await expect(inputAfterReload).not.toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// AC-1.4 — a failing write reverts the control and names the server.
// ---------------------------------------------------------------------------

test.describe('webview > marketplace > capability toggles > revert on failure', () => {
  test('a failing setEnabled reverts the control and shows an error naming the server (AC-1.4)', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    const { fixtures } = verifiedCapabilityFixtures(REVERT_ID);
    await installRpcAutoResponder(page, fixtures);
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });

    await openServersPage(page);
    const row = capabilityRow(page, REVERT_ID);
    const input = row.locator('[data-testid="capability-toggle-input"]');
    await expect(input).toBeChecked();

    await input.click();

    // Reverted to its prior (ON) state, and the row's own error names it.
    await expect(row.locator('[data-testid="capability-toggle-error"]')).toContainText(
      REVERT_LABEL,
    );
    await expect(input).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// AC-2.2 — the scope-of-write text beside each switch in the server detail.
// ---------------------------------------------------------------------------

test.describe('webview > marketplace > capability toggles > scope-of-write text', () => {
  test('"This workspace only" and "All workspaces" appear beside the matching switch (AC-2.2)', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    const { fixtures } = verifiedCapabilityFixtures();
    await installRpcAutoResponder(page, fixtures);
    await page.goto(fixtureServer.url);
    // Wide tier: the detail docks inline instead of opening as an animated
    // drawer overlay (same choice `marketplace-servers.e2e.spec.ts`'s
    // workspace-switch scenario makes), so no entrance-animation wait is
    // needed before reading the switches' description text.
    await page.setViewportSize({ width: 1600, height: 900 });

    await openServersPage(page);
    const row = page
      .locator('[data-testid="provider-list-rows"]')
      .locator('tr, [data-testid="provider-card"]')
      .filter({ hasText: FIRECRAWL_ID })
      .first();
    await row.locator('[data-testid="provider-row-open"]').click();
    await expect(page.locator('[data-testid="server-detail-title"]')).toBeVisible();

    const workspaceToggle = page.locator('[data-testid="server-detail-toggle-workspace"]');
    const globalToggle = page.locator('[data-testid="server-detail-toggle-global"]');
    await expect(
      workspaceToggle.locator('[data-testid="capability-toggle-scope"]'),
    ).toContainText('This workspace only');
    await expect(
      globalToggle.locator('[data-testid="capability-toggle-scope"]'),
    ).toContainText('All workspaces');
  });
});

// ---------------------------------------------------------------------------
// AC-5.2 — "size unknown" with no schemaTokens.
// ---------------------------------------------------------------------------

test.describe('webview > marketplace > capability toggles > schema size', () => {
  test('shows "size unknown" for a server with no schemaTokens (AC-5.2)', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    const { fixtures } = verifiedCapabilityFixtures();
    await installRpcAutoResponder(page, fixtures);
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });

    await openServersPage(page);
    const row = capabilityRow(page, FIRECRAWL_ID);
    await expect(row.locator('[data-testid="capability-size"]')).toContainText(
      'size unknown',
    );

    // The same rule holds in the server detail's Overview row.
    const listRow = page
      .locator('[data-testid="provider-list-rows"]')
      .locator('tr, [data-testid="provider-card"]')
      .filter({ hasText: FIRECRAWL_ID })
      .first();
    await page.setViewportSize({ width: 1600, height: 900 });
    await listRow.locator('[data-testid="provider-row-open"]').click();
    await expect(page.locator('[data-testid="server-detail-size"]')).toHaveText(
      'size unknown',
    );
  });
});

// ---------------------------------------------------------------------------
// AC-4.6 — turning ptah off shows the Ptah-tools warning.
// ---------------------------------------------------------------------------

test.describe('webview > marketplace > capability toggles > ptah-off warning', () => {
  test('turning ptah off shows the Ptah-tools warning (AC-4.6)', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    const { fixtures } = verifiedCapabilityFixtures();
    await installRpcAutoResponder(page, fixtures);
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });

    await openServersPage(page);
    const row = capabilityRow(page, PTAH_MCP_SERVER_NAME);
    await expect(row.locator('[data-testid="capability-ptah-off-warning"]')).toHaveCount(0);

    await row.locator('[data-testid="capability-toggle-input"]').click();

    const warning = row.locator('[data-testid="capability-ptah-off-warning"]');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Ptah tools');
    await expect(warning).toContainText('unavailable');
  });
});

// ---------------------------------------------------------------------------
// A new repository-declared server: badge + exact write payload.
// ---------------------------------------------------------------------------

test.describe('webview > marketplace > capability toggles > new repository server', () => {
  test('shows the "New in this workspace" badge, and turning it ON sends exactly {scope, kind, id, enabled}', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    const { fixtures, setEnabledCalls } = verifiedCapabilityFixtures();
    await installRpcAutoResponder(page, fixtures);
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });

    await openServersPage(page);
    const row = capabilityRow(page, REPO_ONLY_ID);
    await expect(row.locator('[data-testid="capability-badge-new-workspace-server"]')).toHaveText(
      /New in this workspace/,
    );
    const input = row.locator('[data-testid="capability-toggle-input"]');
    await expect(input).not.toBeChecked();

    await input.click();
    await expect(input).toBeChecked();

    // The RPC call actually sent, read from the Node-side resolver's own
    // observed calls — not inferred from the DOM.
    const calls = setEnabledCalls.filter((call) => call.id === REPO_ONLY_ID);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      scope: 'workspace',
      kind: 'mcp',
      id: REPO_ONLY_ID,
      enabled: true,
    });
  });
});

// ---------------------------------------------------------------------------
// The imported badge.
// ---------------------------------------------------------------------------

test.describe('webview > marketplace > capability toggles > imported badge', () => {
  test('shows the "Imported" badge for a value that came from a Claude approval', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    const { fixtures } = verifiedCapabilityFixtures();
    await installRpcAutoResponder(page, fixtures);
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });

    await openServersPage(page);
    const row = capabilityRow(page, IMPORTED_ID);
    await expect(row.locator('[data-testid="capability-badge-imported"]')).toHaveText(
      /Imported/,
    );
  });
});

// ---------------------------------------------------------------------------
// The unverified-policy banner names the unreadable path.
// ---------------------------------------------------------------------------

test.describe('webview > marketplace > capability toggles > unverified policy banner', () => {
  test('names the unreadable path and its error', async ({ page, fixtureServer }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    const { fixtures, reason } = unverifiedCapabilityFixtures();
    await installRpcAutoResponder(page, fixtures);
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });

    // The shell reads the store; it never loads on its own (doc comment on
    // `MarketplaceShellComponent`), so a page that calls `ensure()` — the
    // Installed servers page — must be visited for the banner to have
    // anything to show.
    await openServersPage(page);

    const banner = page.locator('[data-testid="capability-policy-banner"]');
    await expect(banner).toBeVisible();
    await expect(page.locator('[data-testid="capability-policy-banner-paths"]')).toContainText(
      reason.path,
    );
    await expect(page.locator('[data-testid="capability-policy-banner-paths"]')).toContainText(
      reason.error,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-4.8 — the rival-lane and CLI-proxy "not enforced" labels.
// ---------------------------------------------------------------------------

test.describe('webview > marketplace > capability toggles > not-enforced labels', () => {
  test('names every provider that does not yet enforce MCP toggles (AC-4.8)', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    const { fixtures } = verifiedCapabilityFixtures();
    await installRpcAutoResponder(page, fixtures);
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });

    await openServersPage(page);

    // Derived from the mirrored `CAPABILITY_ENFORCEMENT` table (R6), not a
    // literal string: a provider that starts enforcing MCP toggles flips its
    // row there (and in the real table this mirrors), and this expectation
    // moves with it.
    const expectedProviders = MIRRORED_CAPABILITY_ENFORCEMENT.filter(
      (row) => row.kind === 'mcp' && row.status === 'not-enforced',
    ).map((row) => row.label);
    expect(expectedProviders.length).toBeGreaterThan(0);

    // Only one "not enforced" note renders on this page: the panel prints it
    // once (`mcpNotEnforcedNote()`), and every per-row toggle is given
    // `[showNotEnforced]="false"` so it never repeats it per row.
    const note = page.locator('[data-testid="capability-not-enforced"]');
    await expect(note).toHaveText(`Not enforced for ${expectedProviders.join(', ')}`);
  });
});
