/**
 * ServerDetailComponent specs (plan C7, Task 13.3).
 *
 * Built on the REAL `MarketplaceInventoryStore` and `ConnectorLinksStore`
 * with an RPC stub, so a real `listInstalled` response — secrets included —
 * travels store → mapper → DOM (R3). Per Revision 3 D-4.3 the real store gets
 * the `TabManagerService` stub `{ tabs: signal([...]) }`.
 *
 * Covers: Not found for a malformed ref, an absent ref, and a ref that
 * disappears after a workspace switch (TASK_2026_540 item 6c); no env/header
 * value in the DOM; the lock banner with its copy command; the `direct`
 * confirmation listing config paths; removal and Reconnect RPCs; Targets.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import {
  Router,
  RouterOutlet,
  provideRouter,
  withComponentInputBinding,
  type Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  ClaudeRpcService,
  CommandDiscoveryFacade,
  PluginCatalogService,
  WorkspaceScopeService,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  CapabilityEntry,
  HarnessHealth,
  InstalledMcpServer,
} from '@ptah-extension/shared';

import { CapabilityTogglesStore } from '../../data/capability-toggles.store';
import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { HarnessHealthStore } from '../../harness/harness-health.store';
import { notEnforcedProviders } from '../../ui/capability-toggle.component';
import { SCHEMA_SIZE_UNKNOWN } from './installed-servers-page.component';
import {
  ServerDetailComponent,
  formatDetailDate,
} from './server-detail.component';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENV_SECRET = 'env-value-must-not-render';
const HEADER_SECRET = 'Bearer header-value-must-not-render';
const ARG_SECRET = 'arg-value-must-not-render';

const MANAGED: InstalledMcpServer = {
  serverKey: 'firecrawl',
  target: 'claude',
  configPath: 'C:\\repo\\.mcp.json',
  config: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'firecrawl-mcp', '--api-key', ARG_SECRET],
    env: { FIRECRAWL_API_KEY: ENV_SECRET },
  },
  managedByPtah: true,
  origin: 'harness-config',
  originLabel: 'Config file',
  removal: 'ptah-managed',
};

const MANAGED_CODEX: InstalledMcpServer = {
  ...MANAGED,
  target: 'codex',
  configPath: 'C:\\Users\\me\\.codex\\config.toml',
};

const REMOTE: InstalledMcpServer = {
  serverKey: 'linear',
  target: 'cursor',
  configPath: 'C:\\Users\\me\\.cursor\\mcp.json',
  config: {
    type: 'http',
    url: 'https://mcp.linear.app/mcp',
    headers: { Authorization: HEADER_SECRET },
    env: { LINEAR_TOKEN: ENV_SECRET },
  },
  managedByPtah: false,
  origin: 'harness-config',
  originLabel: 'Config file',
  removal: 'direct',
};

const BLOCKED: InstalledMcpServer = {
  serverKey: 'sentry',
  configPath: 'C:\\Users\\me\\.claude.json',
  config: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
  managedByPtah: false,
  origin: 'claude-user',
  originLabel: 'Claude CLI',
  removal: 'none',
  removalBlockedReason: 'Declared in ~/.claude.json, which Ptah never writes.',
  removalFixCommand: 'claude mcp remove sentry',
};

const OAUTH: InstalledMcpServer = {
  serverKey: 'notion',
  configPath: '',
  config: { type: 'http', url: 'https://mcp.notion.com/mcp' },
  managedByPtah: true,
  origin: 'oauth',
  originLabel: 'OAuth',
  removal: 'oauth',
};

const ALL = [MANAGED, MANAGED_CODEX, REMOTE, BLOCKED, OAUTH];

/** Declared twice, once per scope: the detail lists both (AC-2.1). */
const FIRECRAWL_CAPABILITY: CapabilityEntry = {
  kind: 'mcp',
  id: 'firecrawl',
  label: 'firecrawl',
  sources: [
    { scope: 'workspace', path: 'C:\\repo\\.mcp.json', label: '.mcp.json' },
    {
      scope: 'global',
      path: 'C:\\Users\\me\\.codex\\config.toml',
      label: '~/.codex/config.toml',
    },
  ],
  effectiveEnabled: true,
  inheritedFrom: 'global',
  defaultReason: 'user-scope',
};

/** Measured: the only kind of entry that shows a figure (AC-5.1). */
const LINEAR_CAPABILITY: CapabilityEntry = {
  kind: 'mcp',
  id: 'linear',
  label: 'linear',
  sources: [{ scope: 'global', path: 'C:\\Users\\me\\.cursor\\mcp.json' }],
  effectiveEnabled: false,
  inheritedFrom: 'workspace',
  workspaceEnabled: false,
  schemaTokens: 13_200,
};

function ok<T>(data: T) {
  return { success: true, data, error: undefined, isSuccess: () => true };
}

function fail(error: string) {
  return { success: false, data: undefined, error, isSuccess: () => false };
}

// ── Host ──────────────────────────────────────────────────────────────────────

@Component({
  selector: 'ptah-stub-list',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="list-stub">list</p>
    <router-outlet />`,
})
class StubListComponent {}

const routes: Routes = [
  {
    path: 'marketplace',
    children: [
      {
        path: 'servers',
        children: [
          {
            path: '',
            component: StubListComponent,
            children: [
              { path: ':serverRef', component: ServerDetailComponent },
            ],
          },
        ],
      },
    ],
  },
];

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ServerDetailComponent', () => {
  let harness: RouterTestingHarness;
  let responders: Map<string, (params: unknown) => unknown>;
  let calls: { method: string; params: unknown }[];
  let health: ReturnType<typeof signal<HarnessHealth | null>>;

  beforeEach(() => {
    calls = [];
    responders = new Map();
    responders.set('mcpDirectory:listInstalled', () => ok({ servers: ALL }));
    responders.set('mcpDirectory:listOAuthConnected', () =>
      ok({
        servers: [
          {
            serverKey: 'notion',
            name: 'Notion',
            serverUrl: 'https://mcp.notion.com/mcp',
            connectedAt: '2026-03-04T10:00:00.000Z',
          },
        ],
      }),
    );
    responders.set('mcpDirectory:oauthStatus', () => ok({ state: 'expired' }));
    responders.set('mcpDirectory:listSmitheryConnections', () =>
      ok({ connections: [], namespace: null }),
    );
    responders.set('capabilities:getState', () =>
      ok({
        status: 'verified',
        reasons: [],
        entries: [FIRECRAWL_CAPABILITY, LINEAR_CAPABILITY],
      }),
    );
    responders.set('capabilities:setEnabled', (params) => {
      const { id, scope, enabled } = params as {
        id: string;
        scope: 'workspace' | 'global';
        enabled: boolean;
      };
      const base = id === 'linear' ? LINEAR_CAPABILITY : FIRECRAWL_CAPABILITY;
      return ok({
        entry:
          scope === 'workspace'
            ? {
                ...base,
                workspaceEnabled: enabled,
                effectiveEnabled: enabled,
                inheritedFrom: 'workspace',
              }
            : { ...base, globalEnabled: enabled },
      });
    });
    health = signal<HarnessHealth | null>(null);

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideLocationMocks(),
        MarketplaceInventoryStore,
        ConnectorLinksStore,
        CapabilityTogglesStore,
        {
          provide: ClaudeRpcService,
          useValue: {
            call: jest.fn((method: string, params: unknown) => {
              calls.push({ method, params });
              const responder = responders.get(method);
              return Promise.resolve(
                responder ? responder(params) : fail(`no responder: ${method}`),
              );
            }),
          },
        },
        {
          provide: PluginCatalogService,
          useValue: {
            ensureLoaded: jest.fn(),
            refresh: jest.fn(),
            enabledPlugins: signal([]).asReadonly(),
            error: signal<string | null>(null).asReadonly(),
          },
        },
        {
          provide: CommandDiscoveryFacade,
          useValue: { clearCache: jest.fn() },
        },
        { provide: TabManagerService, useValue: { tabs: signal([]) } },
        { provide: HarnessHealthStore, useValue: { health } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i += 1) {
      harness.detectChanges();
      await harness.fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    harness.detectChanges();
  };

  const mount = async (ref: string): Promise<void> => {
    harness = await RouterTestingHarness.create(
      `/marketplace/servers/${encodeURIComponent(ref)}`,
    );
    await settle();
  };

  const root = (): HTMLElement => harness.fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => root().querySelector<T>(`[data-testid="${id}"]`);
  const allByTestId = (id: string): HTMLElement[] =>
    Array.from(root().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const methods = (): string[] => calls.map((call) => call.method);
  const url = (): string => TestBed.inject(Router).url;

  const selectTab = async (label: string): Promise<void> => {
    const tab = Array.from(
      root().querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((candidate) => candidate.textContent?.trim().startsWith(label));
    if (!tab) throw new Error(`no tab ${label}`);
    tab.click();
    await settle();
  };

  // ── Not found ───────────────────────────────────────────────────────────

  describe('not found', () => {
    it('renders "Not found" with a link back for a malformed ref', async () => {
      await mount('not-a-ref');

      expect(byTestId('server-detail-not-found')).not.toBeNull();
      expect(
        byTestId<HTMLAnchorElement>('server-detail-back')?.getAttribute('href'),
      ).toBe('/marketplace/servers');
    });

    it('renders "Not found" for a well-formed ref the inventory does not hold', async () => {
      await mount('harness-config:ghost');
      expect(byTestId('server-detail-not-found')).not.toBeNull();
    });

    it('falls back to "Not found" when a workspace switch drops the open server', async () => {
      await mount('harness-config:linear');
      expect(byTestId('server-detail-title')?.textContent?.trim()).toBe(
        'linear',
      );

      // The next workspace has no `linear` (a project-scope server of A).
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [MANAGED] }),
      );
      TestBed.inject(WorkspaceScopeService).switchTo('/workspace/b');
      await settle();

      expect(byTestId('server-detail-title')).toBeNull();
      expect(byTestId('server-detail-not-found')).not.toBeNull();
      expect(url()).toBe('/marketplace/servers/harness-config:linear');
    });

    it('follows the link back to the list', async () => {
      await mount('harness-config:ghost');
      byTestId<HTMLAnchorElement>('server-detail-back')?.click();
      await settle();
      expect(url()).toBe('/marketplace/servers');
    });
  });

  // ── Load states ─────────────────────────────────────────────────────────

  it('shows a loading state until the inventory is read', async () => {
    let release: (value: unknown) => void = () => undefined;
    responders.set(
      'mcpDirectory:listInstalled',
      () => new Promise((resolve) => (release = resolve)),
    );
    harness = await RouterTestingHarness.create(
      '/marketplace/servers/harness-config:firecrawl',
    );
    harness.detectChanges();
    expect(byTestId('server-detail-loading')).not.toBeNull();

    release(ok({ servers: ALL }));
    await settle();
    expect(byTestId('server-detail-title')?.textContent?.trim()).toBe(
      'firecrawl',
    );
  });

  it('shows the load error with a Retry that re-reads the inventory', async () => {
    responders.set('mcpDirectory:listInstalled', () => fail('disk offline'));
    await mount('harness-config:firecrawl');
    expect(byTestId('server-detail-error')?.textContent).toContain(
      'disk offline',
    );

    responders.set('mcpDirectory:listInstalled', () => ok({ servers: ALL }));
    byTestId<HTMLButtonElement>('server-detail-retry')?.click();
    await settle();
    expect(byTestId('server-detail-title')?.textContent?.trim()).toBe(
      'firecrawl',
    );
  });

  // ── Content ─────────────────────────────────────────────────────────────

  it('renders the brand header, origin badge and status, with three tabs and no Tools tab', async () => {
    await mount('harness-config:firecrawl');

    expect(root().querySelector('ptah-brand-mark')).not.toBeNull();
    expect(byTestId('server-detail-origin')?.textContent?.trim()).toBe(
      'Config file',
    );
    expect(
      byTestId('server-detail-status-source')?.textContent?.trim(),
    ).toContain('no live source');
    const tabs = Array.from(
      root().querySelectorAll<HTMLElement>('[role="tab"]'),
    ).map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim());
    expect(tabs).toEqual(['Overview', 'Targets2', 'Config']);
  });

  // Batch 25b: a flex `dd` without min-w-0 cannot shrink below its longest
  // unbreakable run, so a long raw status text pushed the Status value past
  // the drawer's edge. Every Overview row keeps its label and lets its value
  // shrink and wrap.
  it.each([['harness-config:firecrawl'], ['oauth:notion']])(
    'lets every Overview value shrink and wrap inside a narrow panel (%s)',
    async (ref) => {
      await mount(ref);
      const rows = Array.from(
        byTestId('server-detail-status')?.closest('dl')?.children ?? [],
      );
      expect(rows.length).toBeGreaterThan(1);
      for (const row of rows) {
        expect(row.querySelector('dt')?.classList).toContain('shrink-0');
        expect(row.querySelector('dd')?.classList).toContain('min-w-0');
      }
      expect(byTestId('server-detail-status-source')?.classList).toContain(
        'break-words',
      );
    },
  );

  it('breaks a config path anywhere so it never widens the panel', async () => {
    await mount('harness-config:firecrawl');
    const paths = allByTestId('server-detail-config-path');
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.classList).toContain('break-all');
    }
  });

  const leaks = (): boolean => {
    const html = root().innerHTML;
    return [ENV_SECRET, 'header-value-must-not-render', ARG_SECRET].some(
      (secret) => html.includes(secret),
    );
  };

  it('shows env and header KEYS with masked values and never a value, in any tab', async () => {
    await mount('harness-config:linear');
    expect(leaks()).toBe(false);

    await selectTab('Config');
    expect(
      allByTestId('server-detail-env-key').map((el) =>
        el.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['LINEAR_TOKEN=••••value hidden']);
    expect(
      allByTestId('server-detail-header-key').map((el) =>
        el.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['Authorization: ••••value hidden']);
    expect(leaks()).toBe(false);

    await selectTab('Targets');
    expect(leaks()).toBe(false);
  });

  it('masks a stdio server: secret args and env values never render, in any tab', async () => {
    await mount('harness-config:firecrawl');
    expect(leaks()).toBe(false);

    await selectTab('Config');
    expect(
      byTestId('server-detail-command')?.textContent?.replace(/\s+/g, ' '),
    ).toContain('--api-key ••••');
    expect(
      allByTestId('server-detail-env-key').map((el) =>
        el.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['FIRECRAWL_API_KEY=••••value hidden']);
    expect(leaks()).toBe(false);

    await selectTab('Targets');
    expect(leaks()).toBe(false);
  });

  it('lists each target with its config path and harness detection', async () => {
    health.set({
      targets: [
        { target: 'claude', detected: true },
        { target: 'codex', detected: false },
      ],
    } as unknown as HarnessHealth);
    await mount('harness-config:firecrawl');
    await selectTab('Targets');

    const targets = allByTestId('server-detail-target');
    expect(targets.map((el) => el.getAttribute('data-target'))).toEqual([
      'claude',
      'codex',
    ]);
    expect(targets[0].textContent).toContain('C:\\repo\\.mcp.json');
    expect(targets[1].textContent).toContain(
      'C:\\Users\\me\\.codex\\config.toml',
    );
    expect(
      allByTestId('server-detail-target-detection').map((el) =>
        el.getAttribute('data-detection'),
      ),
    ).toEqual(['detected', 'not-detected']);
  });

  it('reports detection as not checked when the harness has not answered', async () => {
    await mount('harness-config:firecrawl');
    await selectTab('Targets');
    expect(
      byTestId('server-detail-target-detection')?.textContent?.trim(),
    ).toBe('Detection not checked yet');
  });

  // ── Blocked ─────────────────────────────────────────────────────────────

  it('shows the lock banner with the fix command and a copy button, and no remove', async () => {
    await mount('claude-user:sentry');

    expect(byTestId('server-detail-lock-reason')?.textContent).toContain(
      'Ptah never writes',
    );
    expect(byTestId('server-detail-fix-command')?.textContent).toBe(
      'claude mcp remove sentry',
    );
    expect(byTestId('copy-command-button')).not.toBeNull();
    expect(byTestId('server-detail-remove')).toBeNull();
  });

  it('selects the command when the clipboard rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
    });
    await mount('claude-user:sentry');
    byTestId<HTMLButtonElement>('copy-command-button')?.click();
    await settle();

    expect(window.getSelection()?.toString()).toBe('claude mcp remove sentry');
  });

  // ── Removal ─────────────────────────────────────────────────────────────

  it('asks before removing a direct row, listing its config paths', async () => {
    responders.set('mcpDirectory:uninstall', () =>
      ok({ results: [{ target: 'cursor', success: true }] }),
    );
    await mount('harness-config:linear');
    byTestId<HTMLButtonElement>('server-detail-remove')?.click();
    await settle();

    expect(methods()).not.toContain('mcpDirectory:uninstall');
    expect(
      allByTestId('direct-removal-path').map((el) => el.textContent?.trim()),
    ).toEqual(['C:\\Users\\me\\.cursor\\mcp.json']);

    byTestId<HTMLButtonElement>('direct-removal-confirm-button')?.click();
    await settle();
    const uninstall = calls.find(
      (call) => call.method === 'mcpDirectory:uninstall',
    );
    expect(uninstall?.params).toEqual({
      serverKey: 'linear',
      targets: ['cursor'],
      force: true,
    });
  });

  it('cancels the direct confirmation without an RPC', async () => {
    await mount('harness-config:linear');
    byTestId<HTMLButtonElement>('server-detail-remove')?.click();
    await settle();
    byTestId<HTMLButtonElement>('direct-removal-cancel')?.click();
    await settle();

    expect(byTestId('direct-removal-confirm')).toBeNull();
    expect(methods()).not.toContain('mcpDirectory:uninstall');
  });

  it('uninstalls a Ptah-managed server and returns to the list', async () => {
    responders.set('mcpDirectory:uninstall', () =>
      ok({
        results: [
          { target: 'claude', success: true },
          { target: 'codex', success: true },
        ],
      }),
    );
    await mount('harness-config:firecrawl');
    byTestId<HTMLButtonElement>('server-detail-remove')?.click();
    await settle();

    expect(methods()).toContain('mcpDirectory:uninstall');
    expect(url()).toBe('/marketplace/servers');
  });

  it('shows a failed removal inline and stays open', async () => {
    responders.set('mcpDirectory:uninstall', () => fail('File is locked.'));
    await mount('harness-config:firecrawl');
    byTestId<HTMLButtonElement>('server-detail-remove')?.click();
    await settle();

    expect(byTestId('server-detail-action-error')?.textContent).toContain(
      'File is locked.',
    );
    expect(url()).toBe('/marketplace/servers/harness-config:firecrawl');
  });

  // ── Reconnect ───────────────────────────────────────────────────────────

  it('reconnects an OAuth server through the links store, with its dates', async () => {
    responders.set('mcpDirectory:connectOAuth', () =>
      ok({ success: true, serverKey: 'notion' }),
    );
    await mount('oauth:notion');

    expect(root().textContent).toContain(
      formatDetailDate('2026-03-04T10:00:00.000Z'),
    );
    expect(byTestId('server-detail-remove')?.textContent).toContain(
      'Disconnect',
    );
    byTestId<HTMLButtonElement>('server-detail-reconnect')?.click();
    await settle();

    const connect = calls.find(
      (call) => call.method === 'mcpDirectory:connectOAuth',
    );
    expect(connect?.params).toEqual(
      expect.objectContaining({
        serverKey: 'notion',
        serverUrl: 'https://mcp.notion.com/mcp',
      }),
    );
  });

  it('shows a failed reconnect inline', async () => {
    responders.set('mcpDirectory:connectOAuth', () =>
      ok({ success: false, error: 'Authorization was cancelled.' }),
    );
    await mount('oauth:notion');
    byTestId<HTMLButtonElement>('server-detail-reconnect')?.click();
    await settle();

    expect(byTestId('server-detail-action-error')?.textContent).toContain(
      'Authorization was cancelled.',
    );
  });

  it('offers no Reconnect for a config-file server', async () => {
    await mount('harness-config:firecrawl');
    expect(byTestId('server-detail-reconnect')).toBeNull();
  });

  // ── Use in sessions (TASK_2026_560, Batch 14) ───────────────────────────

  describe('use in sessions', () => {
    const toggleIn = (testId: string): HTMLInputElement | null =>
      root().querySelector<HTMLInputElement>(
        `[data-testid="${testId}"] [data-testid="capability-toggle-input"]`,
      );
    const writes = (): { scope: string; id: string; enabled: boolean }[] =>
      calls
        .filter((call) => call.method === 'capabilities:setEnabled')
        .map(
          (call) =>
            call.params as { scope: string; id: string; enabled: boolean },
        );
    const text = (el: Element | null | undefined): string =>
      el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    it('offers a workspace and a global switch, each naming the scope it writes', async () => {
      await mount('harness-config:firecrawl');

      expect(
        text(
          root().querySelector(
            '[data-testid="server-detail-toggle-workspace"] [data-testid="capability-toggle-scope"]',
          ),
        ),
      ).toContain('This workspace only');
      expect(
        text(
          root().querySelector(
            '[data-testid="server-detail-toggle-global"] [data-testid="capability-toggle-scope"]',
          ),
        ),
      ).toContain('All workspaces');
      // AC-1.5: the accessible name carries the server name and its state.
      expect(
        toggleIn('server-detail-toggle-workspace')?.getAttribute('aria-label'),
      ).toBe('firecrawl: on (This workspace only)');
      // AC-1.3: a workspace that follows global says so.
      expect(
        root().querySelector(
          '[data-testid="server-detail-toggle-workspace"] [data-testid="capability-badge-inheriting"]',
        ),
      ).not.toBeNull();
    });

    // AC-2.3 template wiring (B13 reviewer acceptance item).
    it('writes the workspace from the workspace switch and never global', async () => {
      await mount('harness-config:firecrawl');
      toggleIn('server-detail-toggle-workspace')?.click();
      await settle();

      expect(writes()).toEqual([
        { scope: 'workspace', kind: 'mcp', id: 'firecrawl', enabled: false },
      ]);
      expect(writes().some((write) => write.scope === 'global')).toBe(false);
      // AC-2.4: the saved row is a workspace override, and says so.
      expect(
        root().querySelector(
          '[data-testid="server-detail-toggle-workspace"] [data-testid="capability-badge-override"]',
        ),
      ).not.toBeNull();
    });

    it('writes global from the global switch and never the workspace', async () => {
      await mount('harness-config:firecrawl');
      toggleIn('server-detail-toggle-global')?.click();
      await settle();

      expect(writes()).toEqual([
        { scope: 'global', kind: 'mcp', id: 'firecrawl', enabled: false },
      ]);
      expect(writes().some((write) => write.scope === 'workspace')).toBe(false);
    });

    it('shows a failed write under the switch that made it, naming the server', async () => {
      responders.set('capabilities:setEnabled', () => fail('EACCES'));
      await mount('harness-config:firecrawl');
      toggleIn('server-detail-toggle-global')?.click();
      await settle();

      expect(
        text(
          root().querySelector(
            '[data-testid="server-detail-toggle-global"] [data-testid="capability-toggle-error"]',
          ),
        ),
      ).toContain('firecrawl');
      expect(
        root().querySelector(
          '[data-testid="server-detail-toggle-workspace"] [data-testid="capability-toggle-error"]',
        ),
      ).toBeNull();
      expect(toggleIn('server-detail-toggle-global')?.checked).toBe(true);
    });

    it('lists every declaration with its scope, and the scope labels (AC-2.1)', async () => {
      await mount('harness-config:firecrawl');

      expect(text(byTestId('server-detail-scope'))).toBe('Global · Workspace');
      const declarations = allByTestId('server-detail-declaration');
      expect(declarations.map((el) => el.getAttribute('data-scope'))).toEqual([
        'workspace',
        'global',
      ]);
      expect(text(declarations[0])).toContain('Workspace · .mcp.json');
      expect(text(declarations[1])).toContain(
        'C:\\Users\\me\\.codex\\config.toml',
      );
    });

    it('shows "size unknown" without a measured figure (AC-5.2)', async () => {
      await mount('harness-config:firecrawl');
      expect(text(byTestId('server-detail-size'))).toBe(SCHEMA_SIZE_UNKNOWN);
      expect(text(byTestId('server-detail-size'))).not.toMatch(/\b0\b/);
    });

    it('shows a measured figure as an estimate with its method (AC-5.1)', async () => {
      await mount('harness-config:linear');
      expect(text(byTestId('server-detail-size'))).toBe(
        'about 13.2k tokens of tool schemas per request (estimated from its tool list)',
      );
    });

    it('marks the providers that do not enforce MCP toggles once for both switches, from CAPABILITY_ENFORCEMENT', async () => {
      await mount('harness-config:firecrawl');
      const expected = notEnforcedProviders({ kind: 'mcp' });
      const notes = allByTestId('capability-not-enforced');

      expect(notes).toHaveLength(1);
      expect(
        notes[0].closest('[data-testid="server-detail-capability"]'),
      ).not.toBeNull();
      expect(text(notes[0])).toBe(`Not enforced for ${expected.join(', ')}`);
      expect(expected).toContain('Ptah CLI proxy');
    });

    // Contract for the `serverKey` <-> `CapabilityEntry.id` join. The resolver
    // keys MCP rows by `McpInstallService.listDeclarations`' raw `serverKey`
    // (`capability-resolver.service.ts`), the same key the installed rows
    // carry, with no normalisation on either side.
    describe('name join with the capability rows', () => {
      const declared = (
        serverKey: string,
        overrides: Partial<InstalledMcpServer> = {},
      ): InstalledMcpServer => ({
        ...MANAGED,
        serverKey,
        config: { type: 'stdio', command: 'npx', args: ['-y', serverKey] },
        ...overrides,
      });
      const capabilityFor = (id: string): CapabilityEntry => ({
        ...FIRECRAWL_CAPABILITY,
        id,
        label: id,
        sources: [{ scope: 'workspace', path: 'C:\\repo\\.mcp.json' }],
      });

      beforeEach(() => {
        responders.set('mcpDirectory:listInstalled', () =>
          ok({
            servers: [
              declared('my.server'),
              declared('my server'),
              declared('Shared'),
              declared('Shared', {
                target: undefined,
                configPath: 'C:\\Users\\me\\.claude.json',
                origin: 'claude-user',
                originLabel: 'Claude CLI',
                managedByPtah: false,
                removal: 'none',
              }),
            ],
          }),
        );
        responders.set('capabilities:getState', () =>
          ok({
            status: 'verified',
            reasons: [],
            entries: [
              capabilityFor('my.server'),
              capabilityFor('my server'),
              capabilityFor('Shared'),
              // Case differs: a different name, never a match.
              capabilityFor('shared'),
            ],
          }),
        );
      });

      it.each([
        ['a dotted name', 'harness-config:my.server', 'my.server'],
        ['a name with a space', 'harness-config:my server', 'my server'],
        ['a name in a project file', 'harness-config:Shared', 'Shared'],
        ['the same name in ~/.claude.json', 'claude-user:Shared', 'Shared'],
      ])('finds the row for %s', async (_case, ref, id) => {
        await mount(ref);
        toggleIn('server-detail-toggle-workspace')?.click();
        await settle();

        expect(writes()).toEqual([
          { scope: 'workspace', kind: 'mcp', id, enabled: false },
        ]);
      });
    });

    it('keeps the rest of the detail when the capability read fails', async () => {
      responders.set('capabilities:getState', () => fail('policy offline'));
      await mount('harness-config:firecrawl');

      expect(byTestId('server-detail-title')?.textContent?.trim()).toBe(
        'firecrawl',
      );
      expect(byTestId('server-detail-capability-error')).not.toBeNull();
      expect(toggleIn('server-detail-toggle-workspace')).toBeNull();
      // No capability row: the installed config paths still show.
      expect(allByTestId('server-detail-config-path').length).toBeGreaterThan(
        0,
      );
      expect(text(byTestId('server-detail-size'))).toBe(SCHEMA_SIZE_UNKNOWN);

      byTestId<HTMLButtonElement>('server-detail-capability-retry')?.click();
      await settle();
      expect(
        calls.filter((call) => call.method === 'capabilities:getState'),
      ).toHaveLength(2);
    });

    it('says so when the policy knows no row for the server name', async () => {
      await mount('oauth:notion');
      expect(byTestId('server-detail-capability-missing')).not.toBeNull();
      expect(text(byTestId('server-detail-size'))).toBe(SCHEMA_SIZE_UNKNOWN);
    });
  });

  // ── Pure helpers and source rules ───────────────────────────────────────

  it('formats a date, and shows an unparsable one as sent', () => {
    expect(formatDetailDate('not a date')).toBe('not a date');
    expect(formatDetailDate('2026-03-04T10:00:00.000Z')).not.toBe(
      '2026-03-04T10:00:00.000Z',
    );
  });

  it('does not use innerHTML in its template or source', () => {
    for (const file of [
      'server-detail.component.ts',
      'server-detail.component.html',
    ]) {
      expect(readFileSync(join(__dirname, file), 'utf8')).not.toMatch(
        /innerHTML/i,
      );
    }
  });
});
