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
import type { HarnessHealth, InstalledMcpServer } from '@ptah-extension/shared';

import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { HarnessHealthStore } from '../../harness/harness-health.store';
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
    health = signal<HarnessHealth | null>(null);

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideLocationMocks(),
        MarketplaceInventoryStore,
        ConnectorLinksStore,
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

  const leaks = (): boolean => {
    const html = root().innerHTML;
    return [ENV_SECRET, 'header-value-must-not-render', ARG_SECRET].some((secret) =>
      html.includes(secret),
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
