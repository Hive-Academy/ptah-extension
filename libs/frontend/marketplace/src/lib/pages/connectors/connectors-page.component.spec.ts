/**
 * ConnectorsPageComponent specs (plan C9, Task 15.1). Routed the way Batch 17
 * will (`''` + `:connectorId` children) under a host providing the REAL links
 * store; only the RPC, the tier and the inventory store are stubbed.
 */

import {
  ChangeDetectionStrategy,
  Component,
  signal,
  type WritableSignal,
} from '@angular/core';
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
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  PTAH_CONNECTORS,
  type McpOAuthConnectedRecord,
  type PtahConnector,
} from '@ptah-extension/shared';

import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import {
  MarketplaceLayout,
  type MarketplaceTier,
} from '../../layout/marketplace-layout';
import { ConnectorActionsTracker } from './connector-actions';
import { ConnectorDetailComponent } from './connector-detail.component';
import { ConnectorsPageComponent } from './connectors-page.component';

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => true,
  };
}

function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess: (): boolean => false,
  };
}

function connectorById(id: string): PtahConnector {
  const found = PTAH_CONNECTORS.find((c) => c.id === id);
  if (!found) throw new Error(`Catalog entry '${id}' is missing`);
  return found;
}

const SENTRY_RECORD: McpOAuthConnectedRecord = {
  serverKey: 'oauth-mcp.sentry',
  name: 'Sentry',
  serverUrl: connectorById('sentry').url ?? '',
  connectedAt: '2026-09-01T00:00:00.000Z',
};

type Responder = (params: unknown) => unknown;

const ACTIVATOR = '[data-testid="catalog-card-activator"]';

const LINK_READS = new Set([
  'mcpDirectory:listOAuthConnected',
  'mcpDirectory:oauthStatus',
  'mcpDirectory:listSmitheryConnections',
]);

/**
 * Budget for the one-off render in `beforeAll`. The first render of the page
 * JIT-compiles its whole component tree. With ten jest processes in parallel
 * the first test to run took up to 6.8s and timed out 3 times in 20 runs, so
 * whichever test `--randomize` ran first could overrun jest's 5s default.
 */
const WARM_UP_TIMEOUT_MS = 30_000;

/** Stands in for the shell: provides the shell-scoped links store. */
@Component({
  selector: 'ptah-test-marketplace-host',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ConnectorLinksStore],
  template: `<main><router-outlet /></main>`,
})
class TestMarketplaceHostComponent {}

const routes: Routes = [
  {
    path: 'marketplace',
    component: TestMarketplaceHostComponent,
    children: [
      {
        path: 'connectors',
        component: ConnectorsPageComponent,
        children: [
          { path: '', children: [] },
          { path: ':connectorId', component: ConnectorDetailComponent },
        ],
      },
      { path: 'servers/smithery', children: [] },
      { path: 'servers/custom-url', children: [] },
    ],
  },
];

describe('ConnectorsPageComponent', () => {
  let harness: RouterTestingHarness;
  let calls: { method: string; params: unknown }[];
  let responders: Map<string, Responder>;
  let tier: WritableSignal<MarketplaceTier>;

  const setResponder = (method: string, factory: Responder): void => {
    responders.set(method, factory);
  };

  const configure = (providers: unknown[] = []): void => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideLocationMocks(),
        {
          provide: ClaudeRpcService,
          useValue: {
            call: jest.fn((method: string, params: unknown) => {
              calls.push({ method, params });
              const factory = responders.get(method);
              return Promise.resolve(
                factory ? factory(params) : fail(`No responder for ${method}`),
              );
            }),
          },
        },
        {
          provide: MarketplaceInventoryStore,
          useValue: { notifyContentChanged: jest.fn() },
        },
        { provide: MarketplaceLayout, useValue: { tier } },
        ...(providers as never[]),
      ],
    });
  };

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await harness.fixture.whenStable();
    }
  };

  const mount = async (url = '/marketplace/connectors'): Promise<void> => {
    harness = await RouterTestingHarness.create(url);
    harness.fixture.autoDetectChanges();
    await settle();
  };

  const root = (): HTMLElement => harness.fixture.nativeElement as HTMLElement;
  const all = (selector: string): HTMLElement[] =>
    Array.from(root().querySelectorAll<HTMLElement>(selector));
  const one = (selector: string): HTMLElement | null =>
    root().querySelector<HTMLElement>(selector);
  const url = (): string => TestBed.inject(Router).url;
  const gridIds = (): string[] =>
    all('[data-grid-connector]').map(
      (el) => el.getAttribute('data-grid-connector') ?? '',
    );
  const gridCard = (id: string): HTMLElement => {
    const card = all('[data-grid-connector]').find(
      (el) => el.getAttribute('data-grid-connector') === id,
    );
    if (!card) throw new Error(`no grid card for ${id}`);
    return card;
  };
  const clickIn = (id: string, selector: string): void =>
    gridCard(id).querySelector<HTMLElement>(selector)?.click();
  const methods = (): string[] => calls.map((c) => c.method);
  const press = (target: Element | null, key: string): void => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };

  const seedResponders = (): void => {
    calls = [];
    responders = new Map();
    tier = signal<MarketplaceTier>('compact');
    setResponder('mcpDirectory:listOAuthConnected', () =>
      ok({ servers: [SENTRY_RECORD] }),
    );
    setResponder('mcpDirectory:oauthStatus', () => ok({ state: 'connected' }));
    setResponder('mcpDirectory:listSmitheryConnections', () =>
      ok({ connections: [], namespace: 'acme' }),
    );
    setResponder('harness:health', () => ok({ health: null, summary: null }));
    setResponder('mcpDirectory:getOAuthRedirectUri', () =>
      ok({ redirectUri: 'https://host.example/callback' }),
    );
  };

  // Render the page, the full-page detail and the drawer once so no test pays
  // for compiling them (see WARM_UP_TIMEOUT_MS).
  beforeAll(async () => {
    seedResponders();
    tier.set('wide');
    configure();
    await mount('/marketplace/connectors/sentry');
    tier.set('compact');
    await settle();
    TestBed.resetTestingModule();
  }, WARM_UP_TIMEOUT_MS);

  beforeEach(() => {
    seedResponders();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('data', () => {
    it.each([
      ['compact', []],
      ['wide', ['harness:health']],
    ] as const)(
      'fires only the link reads at %s, plus %j',
      async (t, extra) => {
        tier.set(t);
        configure();
        await mount();

        expect(methods().filter((m) => !LINK_READS.has(m))).toEqual(extra);
        expect(methods()).toContain('mcpDirectory:listOAuthConnected');
        expect(methods()).toContain('mcpDirectory:listSmitheryConnections');
      },
    );

    it('shows skeletons, not actions, until the first read settles', async () => {
      let release!: () => void;
      setResponder(
        'mcpDirectory:listOAuthConnected',
        () =>
          new Promise((resolve) => {
            release = () => resolve(ok({ servers: [] }));
          }),
      );
      configure();
      await mount();

      expect(all('ptah-catalog-card-skeleton').length).toBeGreaterThan(0);
      expect(all('[data-grid-connector]')).toHaveLength(0);

      release();
      await settle();

      expect(all('ptah-catalog-card-skeleton')).toHaveLength(0);
      expect(gridIds()).toHaveLength(PTAH_CONNECTORS.length);
    });

    it('renders the load failure with a Retry that re-reads', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () => fail('down'));
      setResponder('mcpDirectory:listSmitheryConnections', () => fail('down'));
      configure();
      await mount();

      expect(one('[data-testid="connectors-load-error"]')).not.toBeNull();
      const before = calls.length;
      one('[data-testid="connectors-load-retry"]')?.click();
      await settle();

      expect(calls.length).toBeGreaterThan(before);
    });
  });

  describe('headings and structure', () => {
    it.each(['compact', 'regular', 'wide'] as const)(
      'renders exactly one h1 at %s, and the storefront only at wide',
      async (value) => {
        tier.set(value);
        configure();
        await mount();

        expect(all('h1')).toHaveLength(1);
        const storefront = [
          'ptah-storefront-hero h1',
          'ptah-featured-connectors',
          'ptah-category-bento',
        ];
        for (const selector of storefront) {
          expect(one(selector) !== null).toBe(value === 'wide');
        }
      },
    );

    it('draws a connected card with its pill and a not-connected card without one', async () => {
      configure();
      await mount();

      expect(
        gridCard('sentry').querySelector('ptah-status-pill'),
      ).not.toBeNull();
      expect(
        gridCard('sentry').querySelector('[data-action="disconnect"]'),
      ).not.toBeNull();
      const linear = gridCard('linear');
      expect(linear.querySelector('ptah-status-pill')).toBeNull();
      expect(linear.querySelector('[data-action="connect"]')).not.toBeNull();
      expect(linear.querySelector('ptah-brand-mark')).not.toBeNull();
    });
  });

  describe('search and category', () => {
    it('renders the search as input[type="search"] and filters the grid', async () => {
      configure();
      await mount();

      const search = one('input[type="search"]') as HTMLInputElement;
      expect(search).not.toBeNull();
      search.value = 'sentry';
      search.dispatchEvent(new Event('input'));
      await settle();

      expect(gridIds()).toEqual(['sentry']);
      expect(one('[data-testid="connectors-count"]')?.textContent).toContain(
        `1 of ${PTAH_CONNECTORS.length}`,
      );
    });

    it('shows an empty state that clears the filters', async () => {
      configure();
      await mount('/marketplace/connectors?category=devops');

      const search = one('input[type="search"]') as HTMLInputElement;
      // Search and category narrow together ("issues" matches outside devops).
      const hits = PTAH_CONNECTORS.filter((c) =>
        `${c.id} ${c.label} ${c.description}`.toLowerCase().includes('issues'),
      );
      expect(hits.some((c) => c.category !== 'devops')).toBe(true);
      search.value = 'issues';
      search.dispatchEvent(new Event('input'));
      await settle();
      const devopsHits = hits.filter((c) => c.category === 'devops');
      expect(gridIds()).toEqual(devopsHits.map((c) => c.id));
      search.value = 'zzz-no-match';
      search.dispatchEvent(new Event('input'));
      await settle();
      expect(one('[data-testid="connectors-empty"]')).not.toBeNull();

      one('[data-testid="connectors-empty-reset"]')?.click();
      await settle();

      expect(gridIds()).toHaveLength(PTAH_CONNECTORS.length);
      expect(url()).toBe('/marketplace/connectors');
    });

    it('filters on ?category= and marks the chip pressed', async () => {
      configure();
      await mount('/marketplace/connectors?category=devops');

      const expected = PTAH_CONNECTORS.filter(
        (c) => c.category === 'devops',
      ).map((c) => c.id);
      expect(gridIds()).toEqual(expected);
      expect(
        one('[data-category="devops"]')?.getAttribute('aria-pressed'),
      ).toBe('true');

      // An unknown category is "All".
      await harness.navigateByUrl('/marketplace/connectors?category=nope');
      await settle();
      expect(gridIds()).toHaveLength(PTAH_CONNECTORS.length);
    });

    it('navigates with ?category= when a chip is pressed, and drops it for All', async () => {
      configure();
      await mount();

      one('[data-category="devops"]')?.click();
      await settle();
      expect(url()).toBe('/marketplace/connectors?category=devops');

      one('[data-category="all"]')?.click();
      await settle();
      expect(url()).toBe('/marketplace/connectors');
    });

    it('navigates with ?category= when a bento tile is pressed (wide)', async () => {
      tier.set('wide');
      configure();
      await mount();

      const tile = all('[data-testid="category-bento-tile"]')[0];
      const category = tile.getAttribute('data-category');
      tile.click();
      await settle();

      expect(url()).toBe(`/marketplace/connectors?category=${category}`);
    });
  });

  describe('featured rule (wide)', () => {
    it('features the first six not-connected oauth-dcr entries in catalogue order', async () => {
      tier.set('wide');
      configure();
      await mount();

      const expected = PTAH_CONNECTORS.filter(
        (c) => c.kind === 'oauth-dcr' && c.id !== 'sentry',
      )
        .slice(0, 6)
        .map((c) => c.id);
      const featured = all('ptah-featured-connectors [data-connector]').map(
        (el) => el.getAttribute('data-connector'),
      );

      expect(featured).toEqual(expected);
      expect(featured).not.toContain('sentry');
    });
  });

  describe('Smithery without a key', () => {
    beforeEach(() => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({ connections: [], namespace: null, error: 'No Smithery API key' }),
      );
    });

    it('links to servers/smithery instead of failing', async () => {
      configure();
      await mount();

      const link = one('[data-testid="connectors-smithery-key-link"]');
      expect(link?.getAttribute('href')).toBe('/marketplace/servers/smithery');
      const smithery = gridCard('hubspot-smithery');
      expect(
        smithery
          .querySelector('[data-testid="connector-card-smithery-key"]')
          ?.getAttribute('href'),
      ).toBe('/marketplace/servers/smithery');
      expect(smithery.querySelector('[data-action="connect"]')).toBeNull();
    });
  });

  describe('card actions', () => {
    it('connects an oauth-dcr connector through the links store', async () => {
      setResponder('mcpDirectory:connectOAuth', () => ok({ success: true }));
      configure();
      await mount();

      clickIn('linear', '[data-action="connect"]');
      await settle();

      const connect = calls.find(
        (c) => c.method === 'mcpDirectory:connectOAuth',
      );
      expect(connect?.params).toEqual(
        expect.objectContaining({ serverUrl: connectorById('linear').url }),
      );
    });

    it('falls back to a page alert when the failing connector is not on screen', async () => {
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: false, error: 'Consent was denied' }),
      );
      configure();
      await mount();
      clickIn('linear', '[data-action="connect"]');
      await settle();

      const search = one('input[type="search"]') as HTMLInputElement;
      search.value = 'sentry';
      search.dispatchEvent(new Event('input'));
      await settle();

      const alert = one('[data-testid="connectors-page-error"]');
      expect(alert?.textContent).toContain('Linear:');
      expect(alert?.textContent).toContain('Consent was denied');
      expect(all('[role="alert"]')).toHaveLength(1);

      one('[data-testid="connectors-page-error-dismiss"]')?.click();
      await settle();
      expect(one('[data-testid="connectors-page-error"]')).toBeNull();
    });

    it('opens the detail for an oauth-app Connect, where the setup form lives', async () => {
      configure();
      await mount();

      clickIn('github', '[data-action="connect"]');
      await settle();

      expect(url()).toBe('/marketplace/connectors/github');
      expect(
        one(
          '[data-testid="native-drawer-panel"] [data-testid="connector-setup-steps"]',
        ),
      ).not.toBeNull();
      expect(calls.some((c) => c.method === 'mcpDirectory:connectOAuth')).toBe(
        false,
      );
    });
  });

  describe('detail placement', () => {
    it('opens the detail in a drawer at compact, keeps the list and ?category=', async () => {
      configure();
      await mount('/marketplace/connectors?category=devops');

      clickIn('sentry', ACTIVATOR);
      await settle();

      expect(url()).toBe('/marketplace/connectors/sentry?category=devops');
      const panel = one('[data-testid="native-drawer-panel"]');
      expect(panel?.querySelector('ptah-connector-detail')).not.toBeNull();
      expect(panel?.querySelector('h2')?.textContent).toContain('Sentry');
      expect(one('[data-testid="connectors-grid-section"]')).not.toBeNull();
      expect(all('h1')).toHaveLength(1);

      one('[data-testid="native-drawer-close"]')?.click();
      await settle();

      expect(url()).toBe('/marketplace/connectors?category=devops');
      expect(one('[data-testid="native-drawer-panel"]')).toBeNull();
    });

    it('takes the whole page at wide, focuses the detail h1, and Esc returns to the card', async () => {
      tier.set('wide');
      configure();
      await mount();

      clickIn('sentry', ACTIVATOR);
      await settle();

      expect(one('[data-testid="connectors-grid-section"]')).toBeNull();
      expect(one('ptah-storefront-hero')).toBeNull();
      expect(one('[data-testid="connectors-back"]')).not.toBeNull();
      const heading = one('ptah-connector-detail h1');
      expect(heading?.textContent).toContain('Sentry');
      expect(all('h1')).toHaveLength(1);
      expect(document.activeElement).toBe(heading);

      press(heading, 'Escape');
      await settle();

      expect(url()).toBe('/marketplace/connectors');
      expect(one('[data-testid="connectors-grid-section"]')).not.toBeNull();
      expect(document.activeElement).toBe(
        gridCard('sentry').querySelector(
          '[data-testid="catalog-card-activator"]',
        ),
      );
    });

    it('leaves Esc alone while typing in a field of the full-page detail', async () => {
      tier.set('wide');
      configure();
      await mount('/marketplace/connectors/github');

      const field = one('ptah-connector-detail input');
      expect(field).not.toBeNull();
      press(field, 'Escape');
      await settle();

      expect(url()).toBe('/marketplace/connectors/github');
    });

    it('follows a tier flip with the detail open', async () => {
      configure();
      await mount('/marketplace/connectors/sentry');
      expect(
        one('[data-testid="native-drawer-panel"] ptah-connector-detail'),
      ).not.toBeNull();

      tier.set('wide');
      await settle();

      expect(one('[data-testid="native-drawer-panel"]')).toBeNull();
      expect(
        one('[data-testid="connectors-full-detail"] ptah-connector-detail h1')
          ?.textContent,
      ).toContain('Sentry');
    });
  });

  describe('keyboard', () => {
    it('moves focus between card titles with ↑/↓, never from the search field', async () => {
      configure();
      await mount();

      const activators = all(
        '[data-testid="connectors-grid-section"] [data-testid="catalog-card-activator"]',
      );
      activators[0].focus();
      press(activators[0], 'ArrowDown');
      expect(document.activeElement).toBe(activators[1]);
      press(activators[1], 'ArrowUp');
      expect(document.activeElement).toBe(activators[0]);
      press(activators[0], 'ArrowUp');
      expect(document.activeElement).toBe(activators[0]);

      // Arrows in the search field stay with the field.
      const search = one('input[type="search"]') as HTMLInputElement;
      search.focus();
      press(search, 'ArrowDown');

      expect(document.activeElement).toBe(search);
    });
  });

  describe('revise round 1', () => {
    it('renders a timed-out setup whose Retry re-runs it (Batch 6 follow-up 2)', async () => {
      const retry = jest.fn(() => Promise.resolve({ kind: 'done' }));
      const timedOutIds = signal(new Set(['hubspot-smithery']));
      const stub = {
        actionErrors: signal([]),
        errorFor: () => null,
        timedOutIds,
        retry,
      };
      configure();
      TestBed.overrideComponent(ConnectorsPageComponent, {
        set: {
          providers: [{ provide: ConnectorActionsTracker, useValue: stub }],
        },
      });
      await mount();

      const card = gridCard('hubspot-smithery');
      expect(
        card.querySelector('[data-testid="connector-card-timeout"]'),
      ).not.toBeNull();
      clickIn(
        'hubspot-smithery',
        '[data-testid="connector-card-timeout-retry"]',
      );
      expect(retry).toHaveBeenCalledWith(
        connectorById('hubspot-smithery'),
        'grid',
      );
    });

    it('shows each of two overlapping failures on its own card', async () => {
      const pending = new Map<string, (value: unknown) => void>();
      setResponder(
        'mcpDirectory:connectOAuth',
        (params) =>
          new Promise((resolve) =>
            pending.set((params as { serverUrl: string }).serverUrl, resolve),
          ),
      );
      configure();
      await mount();
      for (const id of ['linear', 'notion']) {
        clickIn(id, '[data-action="connect"]');
      }
      await settle();

      pending.get(connectorById('notion').url ?? '')?.(
        ok({ success: false, error: 'Notion failed' }),
      );
      await settle();
      pending.get(connectorById('linear').url ?? '')?.(
        ok({ success: false, error: 'Linear failed' }),
      );
      await settle();

      const errorOf = (id: string): string =>
        gridCard(id).querySelector('[data-testid="connector-card-error"]')
          ?.textContent ?? '';
      expect(errorOf('linear')).toContain('Linear failed');
      expect(errorOf('notion')).toContain('Notion failed');
      expect(errorOf('linear')).not.toContain('Notion');
      expect(one('[data-testid="connectors-page-error"]')).toBeNull();
    });

    it('reports a failed harness read as "No CLI detected" with a Retry tile (wide)', async () => {
      setResponder('harness:health', () => fail('harness down'));
      tier.set('wide');
      configure();
      await mount();

      expect(
        one('[data-testid="storefront-hero-synced-empty"]'),
      ).not.toBeNull();
      const tile = one(
        '[data-testid="storefront-hero-tile"][data-tile="clis"]',
      );
      expect(tile?.getAttribute('data-state')).toBe('error');

      setResponder('harness:health', () => ok({ health: null, summary: null }));
      tile
        ?.querySelector<HTMLElement>(
          '[data-testid="storefront-hero-tile-retry"]',
        )
        ?.click();
      await settle();

      expect(methods().filter((m) => m === 'harness:health')).toHaveLength(2);
    });

    it('focuses the grid heading when the closed detail card is filtered out', async () => {
      tier.set('wide');
      configure();
      await mount('/marketplace/connectors/sentry?category=code');

      press(one('ptah-connector-detail h1'), 'Escape');
      await settle();

      expect(url()).toBe('/marketplace/connectors?category=code');
      expect(document.activeElement).toBe(one('#connectors-grid-heading'));
    });
  });
});
