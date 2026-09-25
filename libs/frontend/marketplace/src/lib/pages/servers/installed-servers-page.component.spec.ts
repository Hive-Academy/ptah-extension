/**
 * InstalledServersPageComponent specs (plan C7, Task 13.2).
 *
 * Built on the REAL inventory and links stores with an RPC spy, so the RPC
 * set is the one production fires. Per Revision 3 D-4.3 the real store gets
 * the `TabManagerService` stub `{ tabs: signal([...]) }`, and sessions are
 * recorded in the real root `SessionMcpStatusRegistry`: only a session whose
 * tab is open (the active workspace) may add connector rows or the
 * "live in last session" count.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import {
  provideRouter,
  withComponentInputBinding,
  type Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  ClaudeRpcService,
  CommandDiscoveryFacade,
  PluginCatalogService,
} from '@ptah-extension/core';
import {
  SessionMcpStatusRegistry,
  TabManagerService,
} from '@ptah-extension/chat-state';
import type { InstalledMcpServer } from '@ptah-extension/shared';

import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import type { ProviderRow } from '../../data/provider-row';
import {
  MarketplaceLayout,
  type MarketplaceTier,
} from '../../layout/marketplace-layout';
import {
  InstalledServersPageComponent,
  liveInLastSession,
} from './installed-servers-page.component';

const FIRECRAWL: InstalledMcpServer = {
  serverKey: 'firecrawl',
  target: 'claude',
  configPath: 'C:\\repo\\.mcp.json',
  config: { type: 'stdio', command: 'npx', args: ['-y', 'firecrawl-mcp'] },
  managedByPtah: true,
  origin: 'harness-config',
  originLabel: 'Config file',
  removal: 'ptah-managed',
};

const NOTION: InstalledMcpServer = {
  serverKey: 'notion',
  configPath: '',
  config: { type: 'http', url: 'https://mcp.notion.com/mcp' },
  managedByPtah: true,
  origin: 'oauth',
  originLabel: 'OAuth',
  removal: 'oauth',
};

const HUBSPOT_SMITHERY: InstalledMcpServer = {
  serverKey: 'smithery_hubspot',
  configPath: '',
  config: { type: 'http', url: 'https://smithery.example/mcp' },
  managedByPtah: true,
  origin: 'smithery',
  originLabel: 'Smithery',
  removal: 'smithery',
};

function ok<T>(data: T) {
  return { success: true, data, error: undefined, isSuccess: () => true };
}

interface TabStub {
  readonly id: string;
  readonly claudeSessionId: string | null;
}

const routes: Routes = [
  {
    path: 'marketplace',
    children: [
      {
        path: 'servers',
        children: [
          {
            path: '',
            component: InstalledServersPageComponent,
            children: [{ path: ':serverRef', children: [] }],
          },
        ],
      },
      { path: 'connectors', children: [] },
    ],
  },
];

describe('InstalledServersPageComponent', () => {
  let harness: RouterTestingHarness;
  let methods: string[];
  let tabs: ReturnType<typeof signal<readonly TabStub[]>>;
  let tier: ReturnType<typeof signal<MarketplaceTier>>;
  let ensureLoaded: jest.Mock;
  /** Per-method answers; a test may replace one before `mount()`. */
  let responders: Record<string, () => unknown>;

  beforeEach(() => {
    methods = [];
    tabs = signal<readonly TabStub[]>([]);
    tier = signal<MarketplaceTier>('regular');
    ensureLoaded = jest.fn();
    responders = {
      'mcpDirectory:listInstalled': () => ok({ servers: [FIRECRAWL, NOTION] }),
      'mcpDirectory:listOAuthConnected': () =>
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
      'mcpDirectory:oauthStatus': () => ok({ state: 'connected' }),
      'mcpDirectory:listSmitheryConnections': () =>
        ok({ connections: [], namespace: null }),
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideLocationMocks(),
        MarketplaceInventoryStore,
        ConnectorLinksStore,
        {
          provide: ClaudeRpcService,
          useValue: {
            call: jest.fn((method: string) => {
              methods.push(method);
              const responder = responders[method];
              return Promise.resolve(
                responder
                  ? responder()
                  : {
                      success: false,
                      error: `unexpected ${method}`,
                      isSuccess: () => false,
                    },
              );
            }),
          },
        },
        {
          provide: PluginCatalogService,
          useValue: {
            ensureLoaded,
            refresh: jest.fn(),
            enabledPlugins: signal([]).asReadonly(),
            error: signal<string | null>(null).asReadonly(),
          },
        },
        {
          provide: CommandDiscoveryFacade,
          useValue: { clearCache: jest.fn() },
        },
        { provide: TabManagerService, useValue: { tabs } },
        { provide: MarketplaceLayout, useValue: { tier } },
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

  const mount = async (): Promise<void> => {
    harness = await RouterTestingHarness.create('/marketplace/servers');
    await settle();
  };

  const root = (): HTMLElement => harness.fixture.nativeElement as HTMLElement;
  const rowRefs = (): (string | null)[] =>
    Array.from(root().querySelectorAll('[data-list-rows] [data-ref]')).map(
      (el) => el.getAttribute('data-ref'),
    );
  const summary = (): string =>
    root()
      .querySelector('[data-testid="servers-summary"]')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim() ?? '';

  /** A session reports; `openTab` decides whether it is the active workspace's. */
  const report = (
    sessionId: string,
    servers: readonly string[],
    openTab: boolean,
  ): void => {
    if (openTab) {
      tabs.update((open) => [
        ...open,
        { id: `tab-${sessionId}`, claudeSessionId: sessionId },
      ]);
    }
    TestBed.inject(SessionMcpStatusRegistry).record(sessionId, {
      servers: servers.map((name) => ({ name, status: 'connected' as const })),
      notices: [],
    });
  };

  it('fires exactly listInstalled plus the connector link reads', async () => {
    await mount();

    expect([...methods].sort()).toEqual(
      [
        'mcpDirectory:listInstalled',
        'mcpDirectory:listOAuthConnected',
        'mcpDirectory:oauthStatus',
        'mcpDirectory:listSmitheryConnections',
      ].sort(),
    );
    expect(ensureLoaded).not.toHaveBeenCalled();
  });

  it('renders exactly one h1 and a search field the shell can focus', async () => {
    await mount();

    expect(root().querySelectorAll('h1')).toHaveLength(1);
    expect(root().querySelector('input[type="search"]')).not.toBeNull();
  });

  it('offers origin chips as filters, not links', async () => {
    await mount();
    const group = root().querySelector('[role="radiogroup"]');

    expect(group?.getAttribute('aria-label')).toBe('Filter by origin');
    expect(group?.querySelector('a')).toBeNull();
    const oauth = group?.querySelector<HTMLButtonElement>(
      '[data-origin="oauth"]',
    );
    oauth?.click();
    await settle();
    expect(rowRefs()).toEqual(['oauth:notion']);
  });

  it('decorates OAuth rows with the live link state', async () => {
    await mount();
    const notion = Array.from(
      root().querySelectorAll('[data-list-rows] [data-ref]'),
    ).find((el) => el.getAttribute('data-ref') === 'oauth:notion');

    expect(
      notion
        ?.querySelector('[data-testid="status-pill"]')
        ?.getAttribute('data-status'),
    ).toBe('connected');
  });

  /** The status pill of the row with `ref`, or `null` when it has none. */
  const pillOf = (ref: string): string | null | undefined =>
    Array.from(root().querySelectorAll('[data-list-rows] [data-ref]'))
      .find((el) => el.getAttribute('data-ref') === ref)
      ?.querySelector('[data-testid="status-pill"]')
      ?.getAttribute('data-status');

  it('decorates Smithery rows with the live connection state', async () => {
    responders['mcpDirectory:listInstalled'] = () =>
      ok({ servers: [FIRECRAWL, NOTION, HUBSPOT_SMITHERY] });
    responders['mcpDirectory:listSmitheryConnections'] = () =>
      ok({
        connections: [
          {
            connectionId: 'hubspot',
            name: 'HubSpot',
            server: 'hubspot',
            status: 'auth_required',
            managedByPtah: true,
            serverKey: 'smithery_hubspot',
          },
        ],
        namespace: 'acme',
      });
    await mount();

    expect(pillOf('smithery:smithery_hubspot')).toBe('needs-auth');
    expect(pillOf('oauth:notion')).toBe('connected');
  });

  it('keeps the list whole, without live states or an error, when the link reads fail', async () => {
    const failed = () => ({
      success: false,
      error: 'link read failed',
      isSuccess: () => false,
    });
    responders['mcpDirectory:listInstalled'] = () =>
      ok({ servers: [FIRECRAWL, NOTION, HUBSPOT_SMITHERY] });
    responders['mcpDirectory:listOAuthConnected'] = failed;
    responders['mcpDirectory:listSmitheryConnections'] = failed;
    await mount();

    expect(rowRefs()).toEqual([
      'harness-config:firecrawl',
      'oauth:notion',
      'smithery:smithery_hubspot',
    ]);
    // No decoration source answered: every row falls back to its config.
    expect(pillOf('oauth:notion')).toBe('configured');
    expect(pillOf('smithery:smithery_hubspot')).toBe('configured');
    expect(root().querySelector('[role="alert"]')).toBeNull();
    expect(root().textContent).not.toContain('link read failed');
  });

  it('shows neither connector rows nor the live count without an active-workspace session', async () => {
    // Another workspace's session reports — its tab is not open here.
    report('session-other', ['Gmail', 'firecrawl'], false);
    await mount();

    expect(rowRefs()).toEqual(['harness-config:firecrawl', 'oauth:notion']);
    expect(summary()).toBe('2 servers');
    expect(summary()).not.toContain('live');
  });

  it('shows connector rows and the live count from the active workspace session', async () => {
    report('session-here', ['Gmail', 'firecrawl'], true);
    await mount();

    expect(rowRefs()).toContain('claude-connector:Gmail');
    expect(summary()).toBe('3 servers · 2 live in last session');
    expect(
      methods.filter((m) => m === 'mcpDirectory:listInstalled'),
    ).toHaveLength(1);
  });

  it('groups rows by origin at the wide tier', async () => {
    tier.set('wide');
    await mount();

    expect(
      Array.from(
        root().querySelectorAll('[data-testid="provider-group-heading"]'),
      ).map((h) => h.firstChild?.textContent?.trim()),
    ).toEqual(['Config file', 'OAuth']);
  });

  it('counts only connected rows reported by the session as live', () => {
    const row = (overrides: Partial<ProviderRow>): ProviderRow =>
      ({
        status: 'configured',
        statusSource: 'config',
        ...overrides,
      }) as ProviderRow;

    expect(
      liveInLastSession([
        row({ status: 'connected', statusSource: 'session' }),
        row({ status: 'connected', statusSource: 'oauth' }),
        row({ status: 'failed', statusSource: 'session' }),
        row({}),
      ]),
    ).toBe(1);
  });
});
