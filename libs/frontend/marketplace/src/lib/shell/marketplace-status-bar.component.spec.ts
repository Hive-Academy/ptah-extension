/**
 * MarketplaceStatusBarComponent specs (plan C6, Task 12.2).
 *
 * The bar reads what the visited pages already loaded and nothing else: the
 * store fakes carry `jest.fn()` loaders so a stray `ensure()` fails here.
 */

import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
  MarketplaceStatusBarComponent,
  marketplaceStatusSummary,
} from './marketplace-status-bar.component';

describe('MarketplaceStatusBarComponent', () => {
  let fixture: ComponentFixture<MarketplaceStatusBarComponent>;
  let element: HTMLElement;
  let counts: WritableSignal<InventoryCounts>;
  let linksState: WritableSignal<ConnectorLinksState>;
  let links: WritableSignal<ReadonlyMap<string, ConnectorLink>>;
  let loaders: jest.Mock[];

  beforeEach(async () => {
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
      imports: [MarketplaceStatusBarComponent],
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
    fixture = TestBed.createComponent(MarketplaceStatusBarComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const summaryText = (): string | null =>
    element
      .querySelector('[data-testid="marketplace-status-counts"]')
      ?.textContent?.trim() ?? null;

  it('shows the keyboard hints', () => {
    const hints = Array.from(
      element.querySelectorAll('ul[aria-label="Keyboard shortcuts"] li'),
    ).map((li) =>
      Array.from(li.querySelectorAll('kbd, span')).map((part) =>
        part.textContent?.trim(),
      ),
    );
    expect(hints).toEqual([
      ['↑', '↓', 'select'],
      ['Enter', 'open'],
      ['/', 'search'],
      ['Esc', 'close'],
    ]);
    expect(element.querySelectorAll('kbd')).toHaveLength(5);
  });

  it('shows no counts before anything is loaded', () => {
    expect(summaryText()).toBeNull();
  });

  it('summarises only the ready counts', async () => {
    counts.set({ installed: 12, plugins: 6, community: null, marketplaces: 1 });
    linksState.set('ready');
    links.set(
      new Map<string, ConnectorLink>([
        ['sentry', { status: 'connected', serverKey: 'sentry' }],
      ]),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(summaryText()).toBe(
      '12 MCP servers · 1 connector connected · 6 Ptah plugins · 1 marketplace plugin',
    );
  });

  it('never calls a store loader', async () => {
    counts.set({ installed: 1, plugins: 1, community: 1, marketplaces: 1 });
    linksState.set('ready');
    fixture.detectChanges();
    await fixture.whenStable();

    for (const loader of loaders) expect(loader).not.toHaveBeenCalled();
  });

  describe('marketplaceStatusSummary', () => {
    it('leaves unknown counts out rather than showing 0', () => {
      expect(
        marketplaceStatusSummary({
          servers: null,
          connectors: null,
          plugins: null,
          community: null,
          marketplaces: null,
          skills: null,
        }),
      ).toEqual([]);
    });

    it('pluralises', () => {
      expect(
        marketplaceStatusSummary({
          servers: 1,
          connectors: 0,
          plugins: 2,
          community: 1,
          marketplaces: 0,
          skills: 3,
        }),
      ).toEqual([
        '1 MCP server',
        '0 connectors connected',
        '2 Ptah plugins',
        '1 community skill',
        '0 marketplace plugins',
      ]);
    });
  });
});
