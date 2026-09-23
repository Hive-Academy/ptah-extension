/**
 * MarketplaceNavComponent specs (plan C6, Task 12.2).
 *
 * The stores are fakes with `jest.fn()` loaders so the zero-RPC rule is
 * asserted at its source: the nav reads `counts`, `state` and `links`, and
 * never calls `ensure()` or `reload()`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  signal,
  type WritableSignal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import type { MarketplaceRoute } from '@ptah-extension/core';
import {
  MarketplaceInventoryStore,
  type InventoryCounts,
} from '../data/marketplace-inventory.store';
import {
  ConnectorLinksStore,
  type ConnectorLink,
  type ConnectorLinksState,
} from '../data/connector-links.store';
import {
  MARKETPLACE_NAV_GROUPS,
  MarketplaceNavComponent,
  marketplacePageLabel,
} from './marketplace-nav.component';

@Component({
  selector: 'ptah-nav-test-host',
  standalone: true,
  imports: [MarketplaceNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ptah-marketplace-nav [compact]="compact()" [route]="route()" />`,
})
class NavTestHostComponent {
  public readonly compact = signal(false);
  public readonly route = signal<MarketplaceRoute | null>(null);
}

@Component({
  selector: 'ptah-nav-stub-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubPageComponent {}

const routes: Routes = [
  {
    path: 'marketplace',
    children: [
      { path: 'overview', component: StubPageComponent },
      { path: 'connectors', component: StubPageComponent },
      {
        path: 'servers',
        children: [
          { path: 'smithery', component: StubPageComponent },
          { path: 'registry', component: StubPageComponent },
          { path: 'custom-url', component: StubPageComponent },
          {
            path: '',
            component: StubPageComponent,
            children: [{ path: ':serverRef', children: [] }],
          },
        ],
      },
      {
        path: 'skills',
        children: [
          { path: 'ptah-plugins', component: StubPageComponent },
          { path: 'community', component: StubPageComponent },
          { path: 'marketplaces', component: StubPageComponent },
          { path: '', component: StubPageComponent },
        ],
      },
    ],
  },
];

const UNKNOWN_COUNTS: InventoryCounts = {
  installed: null,
  plugins: null,
  community: null,
  marketplaces: null,
};

describe('MarketplaceNavComponent', () => {
  let fixture: ComponentFixture<NavTestHostComponent>;
  let host: NavTestHostComponent;
  let element: HTMLElement;
  let counts: WritableSignal<InventoryCounts>;
  let linksState: WritableSignal<ConnectorLinksState>;
  let links: WritableSignal<ReadonlyMap<string, ConnectorLink>>;
  let inventory: {
    counts: WritableSignal<InventoryCounts>;
    ensure: jest.Mock;
    reload: jest.Mock;
    retry: jest.Mock;
  };
  let linksStore: {
    state: WritableSignal<ConnectorLinksState>;
    links: WritableSignal<ReadonlyMap<string, ConnectorLink>>;
    ensure: jest.Mock;
    reload: jest.Mock;
  };

  beforeEach(async () => {
    counts = signal(UNKNOWN_COUNTS);
    linksState = signal<ConnectorLinksState>('idle');
    links = signal<ReadonlyMap<string, ConnectorLink>>(new Map());
    inventory = {
      counts,
      ensure: jest.fn(),
      reload: jest.fn(),
      retry: jest.fn(),
    };
    linksStore = {
      state: linksState,
      links,
      ensure: jest.fn(),
      reload: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [NavTestHostComponent],
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        { provide: MarketplaceInventoryStore, useValue: inventory },
        { provide: ConnectorLinksStore, useValue: linksStore },
      ],
    });

    fixture = TestBed.createComponent(NavTestHostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const render = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const nav = (): HTMLElement => {
    const el = element.querySelector<HTMLElement>(
      '[data-testid="marketplace-nav"]',
    );
    if (!el) throw new Error('nav not rendered');
    return el;
  };

  const item = (id: string): HTMLAnchorElement => {
    const el = element.querySelector<HTMLAnchorElement>(
      `a[data-nav-id="${id}"]`,
    );
    if (!el) throw new Error(`missing nav item ${id}`);
    return el;
  };

  const countOf = (id: string): string | null =>
    item(id)
      .querySelector('[data-testid="marketplace-nav-count"]')
      ?.textContent?.trim() ?? null;

  const current = (): string[] =>
    Array.from(element.querySelectorAll('a[aria-current="page"]')).map(
      (a) => a.getAttribute('data-nav-id') ?? '',
    );

  const allIds = MARKETPLACE_NAV_GROUPS.flatMap((group) =>
    group.items.map((entry) => entry.id),
  );

  // ── Structure ──────────────────────────────────────────────────────────────

  it('lists two groups: Marketplace (4 pages) and Sources (6)', () => {
    expect(MARKETPLACE_NAV_GROUPS.map((group) => group.label)).toEqual([
      'Marketplace',
      'Sources',
    ]);
    expect(MARKETPLACE_NAV_GROUPS[0].items.map((i) => i.label)).toEqual([
      'Overview',
      'Connectors',
      'MCP Servers',
      'Skills & Plugins',
    ]);
    expect(MARKETPLACE_NAV_GROUPS[1].items.map((i) => i.label)).toEqual([
      'Smithery',
      'MCP Registry',
      'Custom URL',
      'Ptah Plugins',
      'Community',
      'Marketplaces',
    ]);
  });

  it('links every item to its Marketplace route', () => {
    expect(item('overview').getAttribute('href')).toBe('/marketplace/overview');
    expect(item('servers').getAttribute('href')).toBe('/marketplace/servers');
    expect(item('smithery').getAttribute('href')).toBe(
      '/marketplace/servers/smithery',
    );
    expect(item('skills').getAttribute('href')).toBe('/marketplace/skills');
    expect(item('marketplaces').getAttribute('href')).toBe(
      '/marketplace/skills/marketplaces',
    );
  });

  it('renders a 240px labelled sidebar at regular+ with group labels', () => {
    expect(nav().getAttribute('aria-label')).toBe('Marketplace');
    expect(nav().getAttribute('data-variant')).toBe('sidebar');
    expect(nav().classList).toContain('w-60');
    for (const id of allIds) {
      expect(item(id).textContent?.trim()).not.toBe('');
      expect(item(id).hasAttribute('aria-label')).toBe(false);
    }
    const lists = Array.from(element.querySelectorAll('nav ul'));
    expect(
      lists.map((list) =>
        element
          .querySelector(`#${list.getAttribute('aria-labelledby')}`)
          ?.textContent?.trim(),
      ),
    ).toEqual(['Marketplace', 'Sources']);
  });

  it('renders a 56px icon rail at compact with aria-label and title on every item', async () => {
    host.compact.set(true);
    await render();

    expect(nav().getAttribute('data-variant')).toBe('rail');
    expect(nav().classList).toContain('w-14');
    for (const group of MARKETPLACE_NAV_GROUPS) {
      for (const entry of group.items) {
        expect(item(entry.id).getAttribute('aria-label')).toBe(entry.label);
        expect(item(entry.id).getAttribute('title')).toBe(entry.label);
        expect(item(entry.id).textContent?.trim()).toBe('');
      }
    }
    expect(
      Array.from(element.querySelectorAll('nav ul')).map((list) =>
        list.getAttribute('aria-label'),
      ),
    ).toEqual(['Marketplace', 'Sources']);
  });

  it('caps its transitions at 200ms and drops them under reduced motion', () => {
    const link = item('overview');
    expect(link.classList).toContain('duration-150');
    expect(link.classList).toContain('motion-reduce:transition-none');
  });

  // ── Counts ─────────────────────────────────────────────────────────────────

  describe('counts', () => {
    it('shows no counts before any slice is ready', () => {
      for (const id of allIds) expect(countOf(id)).toBeNull();
    });

    it('shows counts only from ready slices', async () => {
      counts.set({ installed: 12, plugins: 6, community: 14, marketplaces: 3 });
      linksState.set('ready');
      links.set(
        new Map<string, ConnectorLink>([
          ['sentry', { status: 'connected', serverKey: 'sentry' }],
          ['linear', { status: 'needs-auth', serverKey: 'linear' }],
          ['notion', { status: 'not-connected' }],
        ]),
      );
      await render();

      expect(countOf('servers')).toBe('12');
      expect(countOf('connectors')).toBe('1');
      expect(countOf('skills')).toBe('23');
      expect(countOf('overview')).toBeNull();
      expect(countOf('smithery')).toBeNull();
    });

    it('renders a count of 0', async () => {
      counts.set({
        installed: 0,
        plugins: null,
        community: null,
        marketplaces: null,
      });
      await render();

      expect(countOf('servers')).toBe('0');
    });

    it('hides counts in the rail', async () => {
      counts.set({ installed: 12, plugins: 1, community: 1, marketplaces: 1 });
      host.compact.set(true);
      await render();

      expect(
        element.querySelector('[data-testid="marketplace-nav-count"]'),
      ).toBeNull();
    });

    it('never calls ensure() or reload() on either store', async () => {
      host.compact.set(true);
      await render();
      host.compact.set(false);
      counts.set({ installed: 1, plugins: 1, community: 1, marketplaces: 1 });
      linksState.set('ready');
      await render();

      expect(inventory.ensure).not.toHaveBeenCalled();
      expect(inventory.reload).not.toHaveBeenCalled();
      expect(inventory.retry).not.toHaveBeenCalled();
      expect(linksStore.ensure).not.toHaveBeenCalled();
      expect(linksStore.reload).not.toHaveBeenCalled();
    });
  });

  // ── Current item ───────────────────────────────────────────────────────────

  describe('current item', () => {
    const goTo = async (
      url: string,
      route: MarketplaceRoute,
    ): Promise<void> => {
      await TestBed.inject(Router).navigateByUrl(url);
      host.route.set(route);
      await render();
    };

    it('marks the page with aria-current="page"', async () => {
      await goTo('/marketplace/overview', { page: 'overview' });

      expect(current()).toEqual(['overview']);
      expect(item('overview').classList).toContain('text-primary');
    });

    it('marks only the source on a source page, not its installed list', async () => {
      await goTo('/marketplace/servers/smithery', {
        page: 'servers',
        source: 'smithery',
      });
      expect(current()).toEqual(['smithery']);

      await goTo('/marketplace/skills/community', {
        page: 'skills',
        source: 'community',
      });
      expect(current()).toEqual(['community']);
    });

    it('keeps the installed list current under one of its detail routes', async () => {
      await goTo('/marketplace/servers/claude-user:sentry', {
        page: 'servers',
      });

      expect(current()).toEqual(['servers']);
    });
  });

  // ── Breadcrumb label ───────────────────────────────────────────────────────

  describe('marketplacePageLabel', () => {
    it.each<[MarketplaceRoute | null, string | null]>([
      [{ page: 'overview' }, 'Overview'],
      [{ page: 'connectors' }, 'Connectors'],
      [{ page: 'servers' }, 'MCP Servers'],
      [{ page: 'servers', source: 'registry' }, 'MCP Registry'],
      [{ page: 'skills' }, 'Skills & Plugins'],
      [{ page: 'skills', source: 'ptah-plugins' }, 'Ptah Plugins'],
      [null, null],
    ])('%j → %p', (route, label) => {
      expect(marketplacePageLabel(route)).toBe(label);
    });
  });
});
