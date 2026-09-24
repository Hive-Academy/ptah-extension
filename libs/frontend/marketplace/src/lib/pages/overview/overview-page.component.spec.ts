/**
 * OverviewPageComponent specs (plan C7 `OverviewPage`, Task 14.1).
 *
 * Built on the REAL inventory, links and harness stores with one RPC spy, so
 * the RPC set is the one production fires (plan R5). Per Revision 3 D-4.3 the
 * real inventory store gets the `TabManagerService` stub `{ tabs: signal([...]) }`
 * and sessions are recorded in the real root `SessionMcpStatusRegistry`: only
 * a session whose tab is open (the active workspace) may add connector rows or
 * the "live in last session" figure. Only the plugin catalogue (a root cache
 * covered in core), the tier and the `/command` cache are stubbed.
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
import {
  MESSAGE_TYPES,
  PTAH_CONNECTORS,
  type HarnessHealth,
  type HarnessTargetHealth,
  type HarnessTargetId,
  type InstalledMcpServer,
  type PluginInfo,
} from '@ptah-extension/shared';

import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { HarnessHealthStore } from '../../harness/harness-health.store';
import {
  MarketplaceLayout,
  type MarketplaceTier,
} from '../../layout/marketplace-layout';
import { OverviewPageComponent } from './overview-page.component';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SENTRY_URL = PTAH_CONNECTORS.find((c) => c.id === 'sentry')?.url ?? '';

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

const SENTRY: InstalledMcpServer = {
  serverKey: 'oauth-mcp.sentry',
  configPath: '',
  config: { type: 'http', url: SENTRY_URL },
  managedByPtah: true,
  origin: 'oauth',
  originLabel: 'OAuth',
  removal: 'oauth',
};

const SONAR: InstalledMcpServer = {
  serverKey: 'sonarqube',
  target: 'claude',
  configPath: 'C:\\Users\\me\\.claude.json',
  config: { type: 'stdio', command: 'sonar-mcp', args: [] },
  managedByPtah: false,
  origin: 'claude-user',
  originLabel: 'Claude CLI',
  removal: 'none',
  removalBlockedReason: 'Owned by the Claude CLI.',
};

function harnessTarget(
  target: HarnessTargetId,
  overrides: Partial<HarnessTargetHealth> = {},
): HarnessTargetHealth {
  return {
    target,
    detected: true,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents: 'supported',
      mcp: 'supported',
    },
    expected: 4,
    found: 4,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 1,
    ...overrides,
  };
}

const HEALTH: HarnessHealth = {
  workspaceRoot: 'C:\\repo',
  generatedAt: '2026-09-24T10:00:00.000Z',
  mode: 'full',
  reason: 'activation',
  sources: 'ok',
  targets: [
    harnessTarget('claude'),
    harnessTarget('codex', { found: 3, missing: ['skills/deep-research'] }),
    harnessTarget('copilot', { detected: false }),
  ],
  collisions: [],
};

function ok<T>(data: T) {
  return { success: true, data, error: undefined, isSuccess: () => true };
}

function fail(error: string) {
  return { success: false, data: undefined, error, isSuccess: () => false };
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
        path: 'overview',
        component: OverviewPageComponent,
        children: [{ path: ':serverRef', children: [] }],
      },
      { path: 'connectors', children: [] },
      { path: 'skills', children: [] },
      { path: 'servers', children: [] },
    ],
  },
];

/** Row refs of the three installed servers, sorted. */
const INSTALLED_REFS = [
  'claude-user:sonarqube',
  'harness-config:firecrawl',
  'oauth:oauth-mcp.sentry',
];

/** The reads the plan pins for the Overview (R5), one OAuth status per record. */
const OVERVIEW_READS: Readonly<Record<string, number>> = {
  'mcpDirectory:listInstalled': 1,
  'mcpDirectory:listOAuthConnected': 1,
  'mcpDirectory:oauthStatus': 2,
  'mcpDirectory:listSmitheryConnections': 1,
  'plugins:list-marketplaces': 1,
  'skillsSh:listInstalled': 1,
  'harness:health': 1,
};

describe('OverviewPageComponent', () => {
  let harness: RouterTestingHarness;
  let methods: string[];
  let responders: Map<string, () => unknown>;
  let tabs: ReturnType<typeof signal<readonly TabStub[]>>;
  let tier: ReturnType<typeof signal<MarketplaceTier>>;
  let ensureLoaded: jest.Mock;
  let catalogRefresh: jest.Mock;

  beforeEach(() => {
    methods = [];
    tabs = signal<readonly TabStub[]>([]);
    tier = signal<MarketplaceTier>('regular');
    ensureLoaded = jest.fn().mockResolvedValue(undefined);
    catalogRefresh = jest.fn().mockResolvedValue(undefined);
    responders = new Map<string, () => unknown>([
      [
        'mcpDirectory:listInstalled',
        () => ok({ servers: [FIRECRAWL, SENTRY, SONAR] }),
      ],
      [
        'mcpDirectory:listOAuthConnected',
        () =>
          ok({
            servers: [
              {
                serverKey: 'oauth-mcp.sentry',
                name: 'Sentry',
                serverUrl: SENTRY_URL,
                connectedAt: '2026-09-01T00:00:00.000Z',
              },
              {
                serverKey: 'oauth-mcp.example',
                name: 'Example',
                serverUrl: 'https://mcp.example.test/mcp',
                connectedAt: '2026-09-02T00:00:00.000Z',
              },
            ],
          }),
      ],
      ['mcpDirectory:oauthStatus', () => ok({ state: 'connected' })],
      [
        'mcpDirectory:listSmitheryConnections',
        () => ok({ connections: [], namespace: null }),
      ],
      [
        'plugins:list-marketplaces',
        () => ok({ installed: [{ id: 'acme/review', name: 'review' }] }),
      ],
      [
        'skillsSh:listInstalled',
        () => ok({ skills: [{ name: 'deep-research' }, { name: 'tdd' }] }),
      ],
      ['harness:health', () => ok({ health: HEALTH })],
    ]);

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
              const responder = responders.get(method);
              return Promise.resolve(
                responder ? responder() : fail(`unexpected ${method}`),
              );
            }),
          },
        },
        {
          provide: PluginCatalogService,
          useValue: {
            ensureLoaded,
            refresh: catalogRefresh,
            enabledPlugins: signal([
              { id: 'ptah-core' },
              { id: 'ptah-angular' },
              { id: 'ptah-nx' },
            ] as PluginInfo[]).asReadonly(),
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
    harness = await RouterTestingHarness.create('/marketplace/overview');
    await settle();
  };

  const root = (): HTMLElement => harness.fixture.nativeElement as HTMLElement;
  const text = (el: Element | null | undefined): string =>
    el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const kpi = (name: string): HTMLElement => {
    const card = root().querySelector<HTMLElement>(`[data-kpi="${name}"]`);
    if (card === null) throw new Error(`no KPI card ${name}`);
    return card;
  };
  const kpiState = (name: string): string | null =>
    kpi(name)
      .querySelector('[data-testid="stat-card"]')
      ?.getAttribute('data-state') ?? null;
  const kpiValue = (name: string): string =>
    text(kpi(name).querySelector('[data-testid="stat-card-value"]'));
  const kpiSub = (name: string): string =>
    text(kpi(name).querySelector('[data-testid="stat-card-sub"]'));
  const rowRefs = (): (string | null)[] =>
    Array.from(root().querySelectorAll('[data-list-rows] [data-ref]')).map(
      (el) => el.getAttribute('data-ref'),
    );
  const countOf = (method: string): number =>
    methods.filter((m) => m === method).length;

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

  // ── Data ──────────────────────────────────────────────────────────────────

  describe('data', () => {
    it('fires exactly the Overview reads the plan pins (R5)', async () => {
      await mount();

      const fired: Record<string, number> = {};
      for (const method of methods) fired[method] = (fired[method] ?? 0) + 1;
      expect(fired).toEqual(OVERVIEW_READS);
      expect(ensureLoaded).toHaveBeenCalledTimes(1);
      expect(catalogRefresh).not.toHaveBeenCalled();
    });

    it('does not read harness:health when a report is already held', async () => {
      TestBed.inject(HarnessHealthStore).handleMessage({
        type: MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
        payload: { health: HEALTH },
      });
      await mount();

      expect(countOf('harness:health')).toBe(0);
      expect(kpiValue('harness')).toBe('1 of 2');
    });

    it('Refresh re-reads every slice, the links and the harness report', async () => {
      await mount();
      methods.length = 0;

      root()
        .querySelector<HTMLButtonElement>('[data-testid="overview-refresh"]')
        ?.click();
      await settle();

      const fired: Record<string, number> = {};
      for (const method of methods) fired[method] = (fired[method] ?? 0) + 1;
      expect(fired).toEqual(OVERVIEW_READS);
      expect(catalogRefresh).toHaveBeenCalledTimes(1);
    });
  });

  // ── Page contract ─────────────────────────────────────────────────────────

  describe('page', () => {
    it('renders exactly one h1 and a search field the shell can focus', async () => {
      await mount();

      expect(root().querySelectorAll('h1')).toHaveLength(1);
      expect(root().querySelector('input[type="search"]')).not.toBeNull();
    });

    it('links "Add connection" to the connectors page', async () => {
      await mount();

      expect(
        root()
          .querySelector('[data-testid="overview-add-connection"]')
          ?.getAttribute('href'),
      ).toBe('/marketplace/connectors');
    });

    it('lists the installed servers, not grouped by origin, and has no activity feed', async () => {
      tier.set('wide');
      await mount();

      expect([...rowRefs()].sort()).toEqual(INSTALLED_REFS);
      expect(
        root().querySelector('[data-testid="provider-group-heading"]'),
      ).toBeNull();
      expect(text(root())).not.toContain('Recent activity');
    });
  });

  // ── KPI cards ─────────────────────────────────────────────────────────────

  describe('KPI cards', () => {
    it('shows each figure from its real source', async () => {
      await mount();

      expect(kpiValue('servers')).toBe('3');
      expect(kpiSub('servers')).toBe('1 blocked');
      expect(kpiValue('connectors')).toBe('1');
      expect(kpiSub('connectors')).toBe(
        `of ${PTAH_CONNECTORS.length} in the catalogue`,
      );
      expect(kpiValue('skills')).toBe('6');
      expect(kpiSub('skills')).toBe('3 Ptah · 2 community · 1 marketplace');
      expect(kpiValue('harness')).toBe('1 of 2');
    });

    it('draws a chip per detected CLI with a mark, a label, a toned icon and a word', async () => {
      await mount();

      const chips = Array.from(
        kpi('harness').querySelectorAll('[data-testid="harness-chip"]'),
      );
      expect(chips.map((chip) => chip.getAttribute('data-target'))).toEqual([
        'claude',
        'codex',
      ]);
      const codex = chips[1];
      expect(codex.querySelector('ptah-target-marks')).not.toBeNull();
      expect(text(codex)).toContain('Codex');
      expect(
        text(codex.querySelector('[data-testid="harness-chip-state"]')),
      ).toBe('Out of sync');
      const icon = codex.querySelector('[data-testid="harness-chip-icon"]');
      expect(icon?.classList.contains('text-warning')).toBe(true);
      expect(
        codex
          .querySelector('lucide-angular')
          ?.classList.contains('text-warning'),
      ).toBe(false);
    });

    it('shows neither connector rows nor the live figure without an active-workspace session', async () => {
      // Another workspace's session reports: its tab is not open here.
      report('session-other', ['Gmail', 'firecrawl'], false);
      await mount();

      expect(rowRefs()).not.toContain('claude-connector:Gmail');
      expect(kpiValue('servers')).toBe('3');
      expect(kpiSub('servers')).not.toContain('live');
    });

    it('shows connector rows and the live figure from the active workspace session', async () => {
      report('session-here', ['Gmail', 'firecrawl'], true);
      await mount();

      expect(rowRefs()).toContain('claude-connector:Gmail');
      expect(kpiValue('servers')).toBe('4');
      expect(kpiSub('servers')).toBe('1 blocked · 2 live in last session');
      expect(countOf('mcpDirectory:listInstalled')).toBe(1);
    });
  });

  // ── Tier ──────────────────────────────────────────────────────────────────

  describe('needs attention and coverage', () => {
    it('render at regular and wide only', async () => {
      tier.set('compact');
      await mount();

      expect(root().querySelector('ptah-needs-attention')).toBeNull();
      expect(root().querySelector('ptah-coverage-matrix')).toBeNull();

      tier.set('wide');
      await settle();
      expect(root().querySelector('ptah-needs-attention')).not.toBeNull();
      expect(root().querySelector('ptah-coverage-matrix')).not.toBeNull();
    });

    it('sends the harness item to Skills & Plugins and the blocked item to its server', async () => {
      await mount();

      const items = Array.from(
        root().querySelectorAll('[data-testid="needs-attention-item"]'),
      );
      const harnessItem = items.find(
        (item) => item.getAttribute('data-source') === 'harness',
      );
      const blockedItem = items.find(
        (item) => item.getAttribute('data-source') === 'blocked-removal',
      );
      expect(text(harnessItem)).toContain('Codex is out of sync');
      expect(
        harnessItem
          ?.querySelector('[data-testid="needs-attention-review"]')
          ?.getAttribute('href'),
      ).toBe('/marketplace/skills');
      expect(
        blockedItem
          ?.querySelector('[data-testid="needs-attention-review"]')
          ?.getAttribute('href'),
      ).toBe('/marketplace/servers/claude-user:sonarqube');
    });

    it('builds the coverage matrix from the installed rows', async () => {
      await mount();

      expect(
        Array.from(root().querySelectorAll('[data-testid="coverage-row"]'))
          .map((row) => row.getAttribute('data-ref'))
          .sort(),
      ).toEqual(INSTALLED_REFS);
    });
  });

  // ── Failure isolation ─────────────────────────────────────────────────────

  describe('per-slice failure isolation', () => {
    it('a failed community read fails only the Skills card; Retry re-reads that slice alone', async () => {
      responders.set('skillsSh:listInstalled', () => fail('skills.sh down'));
      await mount();

      expect(kpiState('skills')).toBe('error');
      expect(text(kpi('skills'))).toContain('skills.sh down');
      expect(kpiState('servers')).toBe('ready');
      expect(kpiState('connectors')).toBe('ready');
      expect(kpiState('harness')).toBe('ready');
      expect(rowRefs()).toHaveLength(3);
      expect(
        root().querySelector('[data-testid="needs-attention-list"]'),
      ).not.toBeNull();

      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [{ name: 'deep-research' }] }),
      );
      methods.length = 0;
      kpi('skills')
        .querySelector<HTMLButtonElement>('[data-testid="stat-card-retry"]')
        ?.click();
      await settle();

      expect(methods).toEqual(['skillsSh:listInstalled']);
      expect(kpiValue('skills')).toBe('5');
    });

    it('a failed installed read fails the widgets built on it; the others still render', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        fail('disk read failed'),
      );
      await mount();

      expect(kpiState('servers')).toBe('error');
      expect(
        root().querySelector('[data-testid="needs-attention-error"]'),
      ).not.toBeNull();
      expect(
        root().querySelector('[data-testid="coverage-matrix-error"]'),
      ).not.toBeNull();
      expect(kpiValue('skills')).toBe('6');
      expect(kpiValue('connectors')).toBe('1');
      expect(kpiValue('harness')).toBe('1 of 2');

      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [FIRECRAWL] }),
      );
      methods.length = 0;
      kpi('servers')
        .querySelector<HTMLButtonElement>('[data-testid="stat-card-retry"]')
        ?.click();
      await settle();

      expect(methods).toEqual(['mcpDirectory:listInstalled']);
      expect(kpiValue('servers')).toBe('1');
      expect(rowRefs()).toEqual(['harness-config:firecrawl']);
    });

    it('names every failed skill source on the Skills card when two fail', async () => {
      responders.set('skillsSh:listInstalled', () => fail('skills.sh down'));
      responders.set('plugins:list-marketplaces', () =>
        fail('marketplaces unreadable'),
      );
      await mount();

      expect(kpiState('skills')).toBe('error');
      const message = text(
        kpi('skills').querySelector('[data-testid="stat-card-error"]'),
      );
      expect(message).toContain('Community skills: skills.sh down');
      expect(message).toContain('Marketplace plugins: marketplaces unreadable');

      methods.length = 0;
      kpi('skills')
        .querySelector<HTMLButtonElement>('[data-testid="stat-card-retry"]')
        ?.click();
      await settle();
      expect([...methods].sort()).toEqual(
        ['plugins:list-marketplaces', 'skillsSh:listInstalled'].sort(),
      );
    });

    it('a failed harness refresh keeps the last report visible with the error and a Retry', async () => {
      await mount();
      expect(kpiValue('harness')).toBe('1 of 2');
      expect(
        kpi('harness').querySelector('[data-testid="harness-stale-error"]'),
      ).toBeNull();

      responders.set('harness:health', () => fail('harness down'));
      root()
        .querySelector<HTMLButtonElement>('[data-testid="overview-refresh"]')
        ?.click();
      await settle();

      expect(kpiValue('harness')).toBe('1 of 2');
      const stale = kpi('harness').querySelector(
        '[data-testid="harness-stale-error"]',
      );
      expect(stale?.getAttribute('role')).toBe('alert');
      expect(text(stale)).toContain('harness down');

      responders.set('harness:health', () => ok({ health: HEALTH }));
      methods.length = 0;
      kpi('harness')
        .querySelector<HTMLButtonElement>('[data-testid="harness-stale-retry"]')
        ?.click();
      await settle();

      expect(methods).toEqual(['harness:health']);
      expect(
        kpi('harness').querySelector('[data-testid="harness-stale-error"]'),
      ).toBeNull();
    });

    it('a failed harness read fails only the Harness card; Retry asks again', async () => {
      responders.set('harness:health', () => fail('harness down'));
      await mount();

      expect(kpiState('harness')).toBe('error');
      expect(kpiState('servers')).toBe('ready');
      expect(kpiState('skills')).toBe('ready');

      responders.set('harness:health', () => ok({ health: HEALTH }));
      methods.length = 0;
      kpi('harness')
        .querySelector<HTMLButtonElement>('[data-testid="stat-card-retry"]')
        ?.click();
      await settle();

      expect(methods).toEqual(['harness:health']);
      expect(kpiValue('harness')).toBe('1 of 2');
    });

    it('failed link reads fail only the Connectors card; Retry re-reads the links', async () => {
      responders.set('mcpDirectory:listOAuthConnected', () =>
        fail('oauth down'),
      );
      responders.set('mcpDirectory:listSmitheryConnections', () =>
        fail('smithery down'),
      );
      await mount();

      expect(kpiState('connectors')).toBe('error');
      expect(kpiState('servers')).toBe('ready');
      expect(rowRefs()).toHaveLength(3);

      methods.length = 0;
      kpi('connectors')
        .querySelector<HTMLButtonElement>('[data-testid="stat-card-retry"]')
        ?.click();
      await settle();

      expect([...methods].sort()).toEqual(
        [
          'mcpDirectory:listOAuthConnected',
          'mcpDirectory:listSmitheryConnections',
        ].sort(),
      );
    });
  });
});
