/**
 * injectMarketplaceNavCounts specs — the derivation rules behind the nav
 * badges and the status bar, tested without either component.
 *
 * Store fakes carry `jest.fn()` loaders, so reading the counts must never be
 * the reason a slice loads (plan D4, the zero-RPC rule).
 */

import { signal, type Signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
  injectMarketplaceNavCounts,
  type MarketplaceNavCounts,
} from './marketplace-nav-counts';

describe('injectMarketplaceNavCounts', () => {
  let counts: WritableSignal<InventoryCounts>;
  let linksState: WritableSignal<ConnectorLinksState>;
  let links: WritableSignal<ReadonlyMap<string, ConnectorLink>>;
  let loaders: jest.Mock[];
  let navCounts: Signal<MarketplaceNavCounts>;

  beforeEach(() => {
    counts = signal<InventoryCounts>({
      installed: null,
      plugins: null,
      community: null,
      marketplaces: null,
    });
    linksState = signal<ConnectorLinksState>('idle');
    links = signal<ReadonlyMap<string, ConnectorLink>>(new Map());
    loaders = [jest.fn(), jest.fn(), jest.fn(), jest.fn(), jest.fn()];
    const [ensure, reload, retry, linksEnsure, linksReload] = loaders;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: MarketplaceInventoryStore,
          useValue: { counts, ensure, reload, retry },
        },
        {
          provide: ConnectorLinksStore,
          useValue: {
            state: linksState,
            links,
            ensure: linksEnsure,
            reload: linksReload,
          },
        },
      ],
    });
    navCounts = TestBed.runInInjectionContext(() =>
      injectMarketplaceNavCounts(),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is all-unknown before anything is ready', () => {
    expect(navCounts()).toEqual({
      servers: null,
      connectors: null,
      plugins: null,
      community: null,
      marketplaces: null,
      skills: null,
    });
  });

  it('passes the ready inventory counts through and sums the skills', () => {
    counts.set({ installed: 12, plugins: 6, community: 14, marketplaces: 3 });

    expect(navCounts()).toMatchObject({
      servers: 12,
      plugins: 6,
      community: 14,
      marketplaces: 3,
      skills: 23,
    });
  });

  it('keeps the skills sum unknown until all three skill slices are ready', () => {
    counts.set({
      installed: null,
      plugins: 6,
      community: 14,
      marketplaces: null,
    });

    expect(navCounts().skills).toBeNull();
    expect(navCounts().plugins).toBe(6);
  });

  it('counts only connected catalogue connectors, and only once the links are ready', () => {
    links.set(
      new Map<string, ConnectorLink>([
        ['sentry', { status: 'connected', serverKey: 'sentry' }],
        ['linear', { status: 'needs-auth', serverKey: 'linear' }],
        ['notion', { status: 'not-connected' }],
      ]),
    );
    linksState.set('loading');
    expect(navCounts().connectors).toBeNull();

    linksState.set('ready');
    expect(navCounts().connectors).toBe(1);

    linksState.set('error');
    expect(navCounts().connectors).toBeNull();
  });

  it('never calls a store loader', () => {
    navCounts();
    counts.set({ installed: 1, plugins: 1, community: 1, marketplaces: 1 });
    linksState.set('ready');
    navCounts();

    for (const loader of loaders) expect(loader).not.toHaveBeenCalled();
  });
});
