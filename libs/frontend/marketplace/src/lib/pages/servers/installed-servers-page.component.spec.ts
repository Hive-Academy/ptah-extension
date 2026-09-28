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
import type {
  CapabilityEntry,
  InstalledMcpServer,
} from '@ptah-extension/shared';

import { CapabilityTogglesStore } from '../../data/capability-toggles.store';
import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import type { ProviderRow } from '../../data/provider-row';
import {
  MarketplaceLayout,
  type MarketplaceTier,
} from '../../layout/marketplace-layout';
import {
  PTAH_OFF_WARNING,
  notEnforcedProviders,
} from '../../ui/capability-toggle.component';
import {
  InstalledServersPageComponent,
  SCHEMA_SIZE_UNKNOWN,
  capabilityScopeLabels,
  liveInLastSession,
  schemaSizeText,
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

/** Ptah's own server: no installed row, but it has a switch. */
const PTAH_CAPABILITY: CapabilityEntry = {
  kind: 'mcp',
  id: 'ptah',
  label: 'ptah',
  sources: [],
  effectiveEnabled: true,
  inheritedFrom: 'default',
  defaultReason: 'ptah',
};

const FIRECRAWL_CAPABILITY: CapabilityEntry = {
  kind: 'mcp',
  id: 'firecrawl',
  label: 'firecrawl',
  sources: [
    { scope: 'workspace', path: 'C:\\repo\\.mcp.json', label: '.mcp.json' },
  ],
  effectiveEnabled: false,
  inheritedFrom: 'default',
  defaultReason: 'repository-only',
};

/** Not an MCP row: the servers page never lists it. */
const SKILL_CAPABILITY: CapabilityEntry = {
  kind: 'skill',
  id: 'review',
  label: 'review',
  sources: [],
  effectiveEnabled: true,
  inheritedFrom: 'default',
  defaultReason: 'skill',
};

function ok<T>(data: T) {
  return { success: true, data, error: undefined, isSuccess: () => true };
}

function capabilityState(entries: readonly CapabilityEntry[]) {
  return () => ok({ status: 'verified', reasons: [], entries });
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
  /** Every `capabilities:setEnabled` params object, in order. */
  let writes: unknown[];
  let tabs: ReturnType<typeof signal<readonly TabStub[]>>;
  let tier: ReturnType<typeof signal<MarketplaceTier>>;
  let ensureLoaded: jest.Mock;
  /** Per-method answers; a test may replace one before `mount()`. */
  let responders: Record<string, () => unknown>;

  beforeEach(() => {
    methods = [];
    writes = [];
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
      'capabilities:getState': capabilityState([
        PTAH_CAPABILITY,
        FIRECRAWL_CAPABILITY,
        SKILL_CAPABILITY,
      ]),
      'capabilities:setEnabled': () =>
        ok({
          entry: {
            ...FIRECRAWL_CAPABILITY,
            workspaceEnabled: true,
            effectiveEnabled: true,
            inheritedFrom: 'workspace',
          },
        }),
    };

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
            call: jest.fn((method: string, params?: unknown) => {
              methods.push(method);
              if (method === 'capabilities:setEnabled') writes.push(params);
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

  it('fires exactly listInstalled, the connector link reads and the capability read', async () => {
    await mount();

    expect([...methods].sort()).toEqual(
      [
        'mcpDirectory:listInstalled',
        'mcpDirectory:listOAuthConnected',
        'mcpDirectory:oauthStatus',
        'mcpDirectory:listSmitheryConnections',
        'capabilities:getState',
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

  // ── Use in sessions (TASK_2026_560, Batch 14) ───────────────────────────

  describe('use in sessions', () => {
    const text = (el: Element | null | undefined): string =>
      el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const capabilityRow = (id: string): HTMLElement | null =>
      root().querySelector<HTMLElement>(
        `[data-testid="server-capability-row"][data-capability-id="${id}"]`,
      );
    const toggleOf = (id: string): HTMLInputElement | null =>
      capabilityRow(id)?.querySelector<HTMLInputElement>(
        '[data-testid="capability-toggle-input"]',
      ) ?? null;

    it('lists every MCP capability row, skills excluded, inside the list column', async () => {
      await mount();

      const ids = Array.from(
        root().querySelectorAll('[data-testid="server-capability-row"]'),
      ).map((el) => el.getAttribute('data-capability-id'));
      expect(ids).toEqual(['ptah', 'firecrawl']);
      // Projected into the list view, outside the keyboard row region.
      const panel = root().querySelector('[data-testid="server-capabilities"]');
      expect(
        panel?.closest('[data-testid="provider-list-view"]'),
      ).not.toBeNull();
      expect(panel?.closest('[data-list-rows]')).toBeNull();
    });

    it('shows the scope label, the declarations, "size unknown" and the scope-of-write text', async () => {
      await mount();
      const row = capabilityRow('firecrawl');

      expect(
        text(row?.querySelector('[data-testid="capability-scope-label"]')),
      ).toBe('Workspace');
      expect(
        Array.from(
          row?.querySelectorAll('[data-testid="capability-declaration"]') ?? [],
        ).map((el) => text(el)),
      ).toEqual(['Workspace · .mcp.json']);
      expect(text(row?.querySelector('[data-testid="capability-size"]'))).toBe(
        `Tool schemas: ${SCHEMA_SIZE_UNKNOWN}`,
      );
      expect(
        text(row?.querySelector('[data-testid="capability-toggle-scope"]')),
      ).toContain('This workspace only');
      expect(
        row?.querySelector(
          '[data-testid="capability-badge-new-workspace-server"]',
        ),
      ).not.toBeNull();
      expect(toggleOf('firecrawl')?.getAttribute('aria-label')).toBe(
        'firecrawl: off (This workspace only)',
      );
    });

    // AC-2.3 template wiring (B13 reviewer acceptance item).
    it('writes the workspace from a row switch and never global', async () => {
      await mount();
      toggleOf('firecrawl')?.click();
      await settle();

      expect(writes).toEqual([
        { scope: 'workspace', kind: 'mcp', id: 'firecrawl', enabled: true },
      ]);
      expect(
        capabilityRow('firecrawl')?.querySelector(
          '[data-testid="capability-badge-override"]',
        ),
      ).not.toBeNull();
      expect(toggleOf('firecrawl')?.checked).toBe(true);
    });

    it('marks the not-enforced providers once for the panel, from CAPABILITY_ENFORCEMENT, the CLI proxy among them', async () => {
      await mount();
      const notes = Array.from(
        root().querySelectorAll('[data-testid="capability-not-enforced"]'),
      );
      const expected = notEnforcedProviders({ kind: 'mcp' });

      expect(expected).toContain('Ptah CLI proxy');
      expect(notes).toHaveLength(1);
      expect(
        notes[0].closest('[data-testid="server-capability-row"]'),
      ).toBeNull();
      expect(text(notes[0])).toBe(`Not enforced for ${expected.join(', ')}`);
    });

    it('gives an installed server with no capability row a line saying it has no switch', async () => {
      await mount();
      const lines = Array.from(
        root().querySelectorAll<HTMLElement>(
          '[data-testid="server-capability-unmanaged"]',
        ),
      );

      // notion (OAuth) is installed, but the capability state has no row.
      expect(lines.map((el) => el.getAttribute('data-server-key'))).toEqual([
        'notion',
      ]);
      expect(text(lines[0])).toContain('No switch');
      expect(
        lines[0].querySelector('[data-testid="capability-toggle-input"]'),
      ).toBeNull();
    });

    describe('follows the list filter', () => {
      const lineIds = (): (string | null)[] =>
        Array.from(
          root().querySelectorAll(
            '[data-testid="server-capability-row"], [data-testid="server-capability-unmanaged"]',
          ),
        ).map(
          (el) =>
            el.getAttribute('data-capability-id') ??
            el.getAttribute('data-server-key'),
        );
      const search = async (value: string): Promise<void> => {
        const field = root().querySelector<HTMLInputElement>(
          'input[type="search"]',
        );
        if (!field) throw new Error('no search');
        field.value = value;
        field.dispatchEvent(new Event('input'));
        await settle();
      };

      it('shows every line, uncued, with no filter', async () => {
        await mount();
        expect(lineIds()).toEqual(['ptah', 'firecrawl', 'notion']);
        expect(
          root().querySelector('[data-testid="server-capabilities-filtered"]'),
        ).toBeNull();
      });

      it('narrows to the rows the search keeps, and says so', async () => {
        await mount();
        await search('fire');

        expect(rowRefs()).toEqual(['harness-config:firecrawl']);
        expect(lineIds()).toEqual(['firecrawl']);
        expect(
          root().querySelector('[data-testid="server-capabilities-filtered"]'),
        ).not.toBeNull();
      });

      it('matches a server with no installed row by name', async () => {
        await mount();
        await search('ptah');

        expect(rowRefs()).toEqual([]);
        expect(lineIds()).toEqual(['ptah']);
      });

      it('keeps only the lines of the rows an origin chip keeps', async () => {
        await mount();
        root()
          .querySelector<HTMLButtonElement>(
            '[role="radiogroup"] [data-origin="harness-config"]',
          )
          ?.click();
        await settle();

        expect(rowRefs()).toEqual(['harness-config:firecrawl']);
        // ptah has no origin to match, so a facet hides it.
        expect(lineIds()).toEqual(['firecrawl']);
      });

      it('says when nothing matches', async () => {
        await mount();
        await search('zzz-nothing');
        expect(
          text(
            root().querySelector('[data-testid="server-capabilities-empty"]'),
          ),
        ).toBe('No servers here match the filters above.');
      });
    });

    it("warns that Ptah's tools go away when ptah is off (AC-4.6)", async () => {
      responders['capabilities:getState'] = capabilityState([
        {
          ...PTAH_CAPABILITY,
          effectiveEnabled: false,
          workspaceEnabled: false,
          inheritedFrom: 'workspace',
        },
      ]);
      await mount();

      expect(
        text(
          capabilityRow('ptah')?.querySelector(
            '[data-testid="capability-ptah-off-warning"]',
          ),
        ),
      ).toBe(PTAH_OFF_WARNING);
    });

    it('keeps the server list whole when the capability read fails (AC-5.2)', async () => {
      responders['capabilities:getState'] = () => ({
        success: false,
        error: 'policy offline',
        isSuccess: () => false,
      });
      await mount();

      expect(rowRefs()).toEqual(['harness-config:firecrawl', 'oauth:notion']);
      expect(summary()).toBe('2 servers');
      expect(
        root().querySelector('[data-testid="server-capabilities-error"]'),
      ).not.toBeNull();
      expect(root().textContent).not.toContain('policy offline');

      responders['capabilities:getState'] = capabilityState([PTAH_CAPABILITY]);
      root()
        .querySelector<HTMLButtonElement>(
          '[data-testid="server-capabilities-retry"]',
        )
        ?.click();
      await settle();
      expect(capabilityRow('ptah')).not.toBeNull();
    });

    it('shows the loading state until the capability read lands', async () => {
      responders['capabilities:getState'] = () => new Promise(() => undefined);
      await mount();
      expect(
        root().querySelector('[data-testid="server-capabilities-loading"]'),
      ).not.toBeNull();
      expect(rowRefs()).toEqual(['harness-config:firecrawl', 'oauth:notion']);
    });
  });

  describe('capability display rules', () => {
    it('labels global first, each scope once, and nothing without a declaration', () => {
      const at = (...scopes: ('global' | 'workspace')[]) => ({
        sources: scopes.map((scope, index) => ({
          scope,
          path: `/p/${index}`,
        })),
      });
      expect(
        capabilityScopeLabels(at('workspace', 'global', 'global')),
      ).toEqual(['Global', 'Workspace']);
      expect(capabilityScopeLabels(at('global'))).toEqual(['Global']);
      expect(capabilityScopeLabels(at())).toEqual([]);
    });

    it('never turns an absent or invalid size into a number', () => {
      expect(schemaSizeText(undefined)).toBe(SCHEMA_SIZE_UNKNOWN);
      expect(schemaSizeText(null)).toBe(SCHEMA_SIZE_UNKNOWN);
      expect(schemaSizeText({})).toBe(SCHEMA_SIZE_UNKNOWN);
      expect(schemaSizeText({ schemaTokens: Number.NaN })).toBe(
        SCHEMA_SIZE_UNKNOWN,
      );
      expect(schemaSizeText({ schemaTokens: 850 })).toBe(
        'about 850 tokens of tool schemas per request (estimated from its tool list)',
      );
      expect(schemaSizeText({ schemaTokens: 13_000 })).toContain('about 13k');
      expect(schemaSizeText({ schemaTokens: 15_940 })).toContain('about 15.9k');
    });
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
