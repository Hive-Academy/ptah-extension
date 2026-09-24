/**
 * `MARKETPLACE_ROUTES` specs (implementation-plan.md D1, C10).
 *
 * The real tree runs under a real Router, mounted the way `app.routes.ts`
 * mounts it (`loadChildren` under `marketplace`, `SURFACE_ACTIVE` on the
 * surface route, component input binding on). The shell, its three
 * shell-scoped providers, every page and every detail are the real
 * components; the real `AppStateManager` backs the restore redirect.
 *
 * Only the reused discovery surfaces inside the two source hosts are
 * same-selector stubs: which one a source mounts is this tree's concern, while
 * their own reads are covered by their own specs. With them stubbed, every
 * RPC the spec records comes from a Marketplace page or store, which is what
 * the zero-RPC rule is about.
 *
 * Migrated from the deleted `marketplace-hub.component.spec.ts`: "mounts
 * exactly one section at a time" / "swaps the mounted surface" (one page and
 * one surface per route), and "fires no installed read while a different
 * section is selected" (an unselected route fires zero RPC).
 */

import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
  type Type,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { By } from '@angular/platform-browser';
import {
  Router,
  provideRouter,
  withComponentInputBinding,
  type ActivatedRouteSnapshot,
  type Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  McpDirectoryBrowserComponent,
  PluginCatalogPanelComponent,
  SkillShBrowserComponent,
} from '@ptah-extension/chat-ui';
import {
  AppStateManager,
  ClaudeRpcService,
  CommandDiscoveryFacade,
  PluginCatalogService,
  SURFACE_ACTIVE,
  VSCodeService,
  surfaceActiveFor,
  type MarketplaceServerSource,
  type MarketplaceSkillSource,
} from '@ptah-extension/core';
import { surfaceTestRoutes } from '@ptah-extension/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { InstalledMcpServer } from '@ptah-extension/shared';

import { ConnectorLinksStore } from '../data/connector-links.store';
import { MarketplaceInventoryStore } from '../data/marketplace-inventory.store';
import { decodeServerRef } from '../data/server-ref';
import {
  decodeSkillRef,
  encodeSkillRef,
  type MarketplaceSkillKind,
} from '../data/skill-ref';
import { ExternalMarketplacesComponent } from '../external-marketplaces.component';
import { MarketplaceLayout } from '../layout/marketplace-layout';
import { OAuthSurfaceComponent } from '../oauth-surface.component';
import { ConnectorDetailComponent } from '../pages/connectors/connector-detail.component';
import { ConnectorsPageComponent } from '../pages/connectors/connectors-page.component';
import { OverviewPageComponent } from '../pages/overview/overview-page.component';
import { InstalledServersPageComponent } from '../pages/servers/installed-servers-page.component';
import { ServerDetailComponent } from '../pages/servers/server-detail.component';
import { ServerSourceHostComponent } from '../pages/servers/server-source-host.component';
import { InstalledSkillsPageComponent } from '../pages/skills/installed-skills-page.component';
import { SkillDetailComponent } from '../pages/skills/skill-detail.component';
import { SkillSourceHostComponent } from '../pages/skills/skill-source-host.component';
import { SkillsSectionHeaderComponent } from '../pages/skills/skills-section-header.component';
import { MarketplaceShellComponent } from '../shell/marketplace-shell.component';
import { SmitherySurfaceComponent } from '../smithery-surface.component';
import { MARKETPLACE_ROUTES } from './marketplace.routes';

// ---------------------------------------------------------------------------
// Same-selector stubs for the reused surfaces
// ---------------------------------------------------------------------------

@Component({
  selector: 'ptah-smithery-surface',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubSmitherySurfaceComponent {
  public readonly serverInstalled = output<string>();
  public readonly serverUninstalled = output<string>();
}

@Component({
  selector: 'ptah-mcp-directory-browser',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubMcpDirectoryBrowserComponent {
  public readonly connectorServers = input<InstalledMcpServer[]>([]);
  public readonly serverInstalled = output<{
    serverName: string;
    targets: string[];
  }>();
  public readonly serverUninstalled = output<string>();
}

@Component({
  selector: 'ptah-oauth-surface',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubOAuthSurfaceComponent {
  public readonly serverConnected = output<string>();
  public readonly serverDisconnected = output<string>();
}

@Component({
  selector: 'ptah-plugin-catalog-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubPluginPanelComponent {
  public readonly saved = output<string[]>();
}

@Component({
  selector: 'ptah-skill-sh-browser',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubSkillShBrowserComponent {
  public readonly skillInstalled = output<unknown>();
  public readonly skillUninstalled = output<string>();
}

@Component({
  selector: 'ptah-external-marketplaces',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubExternalMarketplacesComponent {}

@Component({
  selector: 'ptah-skills-section-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubSectionHeaderComponent {}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Every page a route can show; exactly one is mounted per route. */
const PAGE_SELECTORS = [
  'ptah-overview-page',
  'ptah-connectors-page',
  'ptah-installed-servers-page',
  'ptah-server-source-host',
  'ptah-installed-skills-page',
  'ptah-skill-source-host',
] as const;

/** Every reused surface a source host can mount. */
const SURFACE_SELECTORS = [
  'ptah-smithery-surface',
  'ptah-mcp-directory-browser',
  'ptah-oauth-surface',
  'ptah-plugin-catalog-panel',
  'ptah-skill-sh-browser',
  'ptah-external-marketplaces',
] as const;

/** The app's table, with the Marketplace mounted as `app.routes.ts` does. */
function appRoutes(): Routes {
  return [
    {
      path: 'marketplace',
      providers: [
        {
          provide: SURFACE_ACTIVE,
          useFactory: surfaceActiveFor('marketplace'),
        },
      ],
      loadChildren: () => Promise.resolve(MARKETPLACE_ROUTES),
    },
    ...surfaceTestRoutes().filter((route) => route.path !== 'marketplace'),
  ];
}

/** An RPC answer that failed, in the core `RpcResult` shape. */
function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess: (): boolean => false,
  };
}

/** The routed component classes from the root to the deepest active route. */
function activatedChain(router: Router): Type<unknown>[] {
  const chain: Type<unknown>[] = [];
  let node: ActivatedRouteSnapshot | null = router.routerState.snapshot.root;
  while (node !== null) {
    if (node.component) chain.push(node.component);
    node = node.firstChild;
  }
  return chain;
}

function deepestSnapshot(router: Router): ActivatedRouteSnapshot {
  let node = router.routerState.snapshot.root;
  while (node.firstChild !== null) node = node.firstChild;
  return node;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('MARKETPLACE_ROUTES', () => {
  let methods: string[];
  let catalogEnsureLoaded: jest.Mock;
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    methods = [];
    catalogEnsureLoaded = jest.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        provideRouter(appRoutes(), withComponentInputBinding()),
        provideLocationMocks(),
        {
          provide: ClaudeRpcService,
          useValue: {
            // Every read fails: the pages render their error states, and the
            // spec only cares WHICH reads fire.
            call: jest.fn((method: string) => {
              methods.push(method);
              return Promise.resolve(fail('offline'));
            }),
          },
        },
        {
          provide: PluginCatalogService,
          useValue: {
            ensureLoaded: catalogEnsureLoaded,
            refresh: jest.fn().mockResolvedValue(undefined),
            enabledPlugins: signal([]).asReadonly(),
            error: signal<string | null>(null).asReadonly(),
            isLoaded: signal(false).asReadonly(),
            enabledCount: signal(0).asReadonly(),
            pluginTotal: signal(0).asReadonly(),
          },
        },
        {
          provide: CommandDiscoveryFacade,
          useValue: { clearCache: jest.fn() },
        },
        // The shell's real inventory store scopes the session picture to
        // these tabs (Revision 3 D-4.3).
        { provide: TabManagerService, useValue: { tabs: signal([]) } },
        {
          provide: VSCodeService,
          useValue: { isElectron: false, postMessage: jest.fn() },
        },
      ],
    });
    TestBed.overrideComponent(ServerSourceHostComponent, {
      remove: {
        imports: [
          SmitherySurfaceComponent,
          McpDirectoryBrowserComponent,
          OAuthSurfaceComponent,
        ],
      },
      add: {
        imports: [
          StubSmitherySurfaceComponent,
          StubMcpDirectoryBrowserComponent,
          StubOAuthSurfaceComponent,
        ],
      },
    });
    TestBed.overrideComponent(SkillSourceHostComponent, {
      remove: {
        imports: [
          PluginCatalogPanelComponent,
          SkillShBrowserComponent,
          ExternalMarketplacesComponent,
          SkillsSectionHeaderComponent,
        ],
      },
      add: {
        imports: [
          StubPluginPanelComponent,
          StubSkillShBrowserComponent,
          StubExternalMarketplacesComponent,
          StubSectionHeaderComponent,
        ],
      },
    });

    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Navigate, then let the pages' first reads start and render. */
  const visit = async (url: string): Promise<void> => {
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    harness.detectChanges();
  };

  const root = (): HTMLElement => harness.fixture.nativeElement as HTMLElement;
  const present = (selectors: readonly string[]): string[] =>
    selectors.filter((selector) => root().querySelector(selector) !== null);

  describe('the 14 addressable routes', () => {
    it.each<[string, Type<unknown>[], string]>([
      ['/marketplace/overview', [OverviewPageComponent], 'ptah-overview-page'],
      [
        '/marketplace/overview/claude-user:sentry',
        [OverviewPageComponent, ServerDetailComponent],
        'ptah-overview-page',
      ],
      [
        '/marketplace/connectors',
        [ConnectorsPageComponent],
        'ptah-connectors-page',
      ],
      [
        '/marketplace/connectors/sentry',
        [ConnectorsPageComponent, ConnectorDetailComponent],
        'ptah-connectors-page',
      ],
      [
        '/marketplace/servers',
        [InstalledServersPageComponent],
        'ptah-installed-servers-page',
      ],
      [
        '/marketplace/servers/claude-user:sentry',
        [InstalledServersPageComponent, ServerDetailComponent],
        'ptah-installed-servers-page',
      ],
      [
        '/marketplace/servers/smithery',
        [ServerSourceHostComponent],
        'ptah-server-source-host',
      ],
      [
        '/marketplace/servers/registry',
        [ServerSourceHostComponent],
        'ptah-server-source-host',
      ],
      [
        '/marketplace/servers/custom-url',
        [ServerSourceHostComponent],
        'ptah-server-source-host',
      ],
      [
        '/marketplace/skills',
        [InstalledSkillsPageComponent],
        'ptah-installed-skills-page',
      ],
      [
        '/marketplace/skills/ptah-plugin:ptah-core',
        [InstalledSkillsPageComponent, SkillDetailComponent],
        'ptah-installed-skills-page',
      ],
      [
        '/marketplace/skills/ptah-plugins',
        [SkillSourceHostComponent],
        'ptah-skill-source-host',
      ],
      [
        '/marketplace/skills/community',
        [SkillSourceHostComponent],
        'ptah-skill-source-host',
      ],
      [
        '/marketplace/skills/marketplaces',
        [SkillSourceHostComponent],
        'ptah-skill-source-host',
      ],
    ])('%s activates its page inside the shell', async (url, chain, page) => {
      await visit(url);

      expect(router.url).toBe(url);
      expect(activatedChain(router)).toEqual([
        MarketplaceShellComponent,
        ...chain,
      ]);
      expect(present(PAGE_SELECTORS)).toEqual([page]);
    });

    // The list page is created by the same navigation that activates its
    // detail child, so it must not read the child's snapshot before the
    // router has set it.
    it.each<[string, Type<unknown>]>([
      ['/marketplace/overview/claude-user:sentry', ServerDetailComponent],
      ['/marketplace/connectors/sentry', ConnectorDetailComponent],
      ['/marketplace/servers/claude-user:sentry', ServerDetailComponent],
      ['/marketplace/skills/ptah-plugin:ptah-core', SkillDetailComponent],
    ])(
      'opens %s straight from another Marketplace page',
      async (url, detail) => {
        await visit('/marketplace/servers/smithery');

        await visit(url);

        expect(router.url).toBe(url);
        expect(activatedChain(router).at(-1)).toBe(detail);
      },
    );

    it('binds each detail param under the name its page reads', async () => {
      await visit('/marketplace/overview/claude-user:sentry');
      expect(deepestSnapshot(router).paramMap.get('serverRef')).toBe(
        'claude-user:sentry',
      );

      await visit('/marketplace/connectors/sentry');
      expect(deepestSnapshot(router).paramMap.get('connectorId')).toBe(
        'sentry',
      );
      const connectorDetail = harness.fixture.debugElement.query(
        By.directive(ConnectorDetailComponent),
      ).componentInstance as ConnectorDetailComponent;
      expect(connectorDetail.connectorId()).toBe('sentry');

      await visit('/marketplace/servers/smithery:exa');
      const serverDetail = harness.fixture.debugElement.query(
        By.directive(ServerDetailComponent),
      ).componentInstance as ServerDetailComponent;
      expect(serverDetail.serverRef()).toBe('smithery:exa');
    });

    it('scopes the three shell providers to the shell, shared by its pages', async () => {
      await visit('/marketplace/overview');

      const shell = harness.fixture.debugElement.query(
        By.directive(MarketplaceShellComponent),
      ).injector;
      const page = harness.fixture.debugElement.query(
        By.directive(OverviewPageComponent),
      ).injector;
      for (const token of [
        MarketplaceInventoryStore,
        ConnectorLinksStore,
        MarketplaceLayout,
      ] as const) {
        expect(page.get<unknown>(token)).toBe(shell.get<unknown>(token));
      }
      // Not a root service: a visit that ends drops its state with the shell.
      expect(() => TestBed.inject(MarketplaceInventoryStore)).toThrow();
    });
  });

  describe('detail refs', () => {
    it('reads a server ref as a detail, never as the source it starts with', async () => {
      await visit('/marketplace/servers/smithery:exa');

      expect(activatedChain(router)).toEqual([
        MarketplaceShellComponent,
        InstalledServersPageComponent,
        ServerDetailComponent,
      ]);
      expect(
        decodeServerRef(deepestSnapshot(router).paramMap.get('serverRef')),
      ).toEqual({ origin: 'smithery', serverKey: 'exa' });
    });

    it.each<[MarketplaceSkillKind, string]>([
      ['ptah-plugin', 'ptah-core'],
      ['community-skill', 'vercel-labs/agent-skills/deep-research'],
      ['marketplace-plugin', 'external:acme/tools/review'],
    ])(
      'keeps a %s ref with "/" in its id as one :skillRef segment',
      async (kind, id) => {
        const ref = encodeSkillRef({ kind, id });

        await router.navigate(['/', 'marketplace', 'skills', ref]);
        await harness.fixture.whenStable();
        harness.detectChanges();

        expect(router.url).toBe(
          `/marketplace/skills/${ref.replaceAll('/', '%2F')}`,
        );
        expect(activatedChain(router)).toEqual([
          MarketplaceShellComponent,
          InstalledSkillsPageComponent,
          SkillDetailComponent,
        ]);
        const param = deepestSnapshot(router).paramMap.get('skillRef');
        expect(param).toBe(ref);
        expect(decodeSkillRef(param)).toEqual({ kind, id });
      },
    );
  });

  describe("'**'", () => {
    it.each([
      '/marketplace/nonsense',
      '/marketplace/servers/claude-user:sentry/extra',
      '/marketplace/connectors/sentry/extra',
      '/marketplace/skills/community/extra',
    ])('redirects %s to the overview', async (url) => {
      await visit(url);

      expect(router.url).toBe('/marketplace/overview');
      expect(present(PAGE_SELECTORS)).toEqual(['ptah-overview-page']);
    });
  });

  describe('restore redirect (bare /marketplace)', () => {
    it('lands on the overview when nothing is remembered', async () => {
      await visit('/marketplace');

      expect(router.url).toBe('/marketplace/overview');
    });

    it.each([
      [
        { page: 'servers', source: 'smithery' } as const,
        '/marketplace/servers/smithery',
      ],
      [
        { page: 'skills', source: 'community' } as const,
        '/marketplace/skills/community',
      ],
      // Retired hub ids that now name real pages (Batch 2 deviation).
      [{ page: 'connectors' } as const, '/marketplace/connectors'],
      [{ page: 'skills' } as const, '/marketplace/skills'],
    ])('restores the remembered page %o', async (remembered, expected) => {
      TestBed.inject(AppStateManager).rememberMarketplaceRoute(remembered);

      await visit('/marketplace');

      expect(router.url).toBe(expected);
    });

    it('restores the page the shell recorded, without the detail it had open', async () => {
      await visit('/marketplace/servers/claude-user:sentry');
      await visit('/chat');
      expect(root().querySelector('ptah-marketplace-shell')).toBeNull();

      await visit('/marketplace');

      expect(router.url).toBe('/marketplace/servers');
      expect(present(PAGE_SELECTORS)).toEqual(['ptah-installed-servers-page']);
    });
  });

  describe('sources: one surface per route', () => {
    it.each<[string, string]>([
      ['/marketplace/servers/smithery', 'ptah-smithery-surface'],
      ['/marketplace/servers/registry', 'ptah-mcp-directory-browser'],
      ['/marketplace/servers/custom-url', 'ptah-oauth-surface'],
      ['/marketplace/skills/ptah-plugins', 'ptah-plugin-catalog-panel'],
      ['/marketplace/skills/community', 'ptah-skill-sh-browser'],
      ['/marketplace/skills/marketplaces', 'ptah-external-marketplaces'],
    ])('%s mounts exactly %s', async (url, surface) => {
      await visit(url);

      expect(present(SURFACE_SELECTORS)).toEqual([surface]);
    });

    it('binds route data.source to the host input', async () => {
      const cases: [
        string,
        MarketplaceServerSource | MarketplaceSkillSource,
      ][] = [
        ['/marketplace/servers/registry', 'registry'],
        ['/marketplace/skills/marketplaces', 'marketplaces'],
      ];
      for (const [url, source] of cases) {
        await visit(url);
        const host = root().querySelector('[data-source]');
        expect(host?.getAttribute('data-source')).toBe(source);
      }
    });

    it('swaps the host and its surface when the source changes', async () => {
      await visit('/marketplace/servers/smithery');
      const first = harness.fixture.debugElement.query(
        By.directive(ServerSourceHostComponent),
      ).componentInstance;

      await visit('/marketplace/servers/registry');
      const second = harness.fixture.debugElement.query(
        By.directive(ServerSourceHostComponent),
      ).componentInstance;

      expect(second).not.toBe(first);
      expect(present(SURFACE_SELECTORS)).toEqual([
        'ptah-mcp-directory-browser',
      ]);
    });
  });

  describe('an unselected route fires zero RPC', () => {
    it.each([
      '/marketplace/servers/smithery',
      '/marketplace/servers/registry',
      '/marketplace/servers/custom-url',
      '/marketplace/skills/ptah-plugins',
      '/marketplace/skills/community',
      '/marketplace/skills/marketplaces',
    ])('%s fires no Marketplace read of its own', async (url) => {
      await visit(url);

      expect(methods).toEqual([]);
      expect(catalogEnsureLoaded).not.toHaveBeenCalled();
    });

    it('connectors reads links only, never the installed or skill slices', async () => {
      await visit('/marketplace/connectors');

      expect(methods.length).toBeGreaterThan(0);
      expect(methods).not.toContain('mcpDirectory:listInstalled');
      expect(methods).not.toContain('plugins:list-marketplaces');
      expect(methods).not.toContain('skillsSh:listInstalled');
      expect(catalogEnsureLoaded).not.toHaveBeenCalled();
    });

    it('leaving the overview for a source fires nothing further', async () => {
      await visit('/marketplace/overview');
      expect(methods).toContain('mcpDirectory:listInstalled');
      const before = methods.length;

      await visit('/marketplace/servers/smithery');

      expect(methods.slice(before)).toEqual([]);
    });
  });
});
