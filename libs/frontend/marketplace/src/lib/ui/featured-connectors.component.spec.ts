/**
 * FeaturedConnectorsComponent specs (plan C8/C9, Task 11.2).
 *
 * Featured cards are `ptah-catalog-card`s (no connector card component) with
 * a projected `ptah-brand-mark` and `ptah-status-pill`. Busy, polling and the
 * pinned action error render in the card's `[card-status]` slot; actions
 * lock while one runs. Loading, error and empty states are explicit.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PTAH_CONNECTORS, type PtahConnector } from '@ptah-extension/shared';

import type { ConnectorLink } from '../data/connector-links.store';
import {
  FEATURED_CONNECTOR_LIMIT,
  FeaturedConnectorsComponent,
  selectFeaturedConnectors,
  type ConnectorActionErrorView,
  type ConnectorActionRequest,
  type FeaturedConnectorView,
  type FeaturedConnectorsState,
} from './featured-connectors.component';
import { statusPresentation } from './status-pill.component';

function connector(
  id: string,
  kind: PtahConnector['kind'] = 'oauth-dcr',
  overrides: Partial<PtahConnector> = {},
): PtahConnector {
  return {
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    brandSlug: id,
    description: `${id} description`,
    category: 'devops',
    kind,
    verifiedAt: '2026-09-04',
    ...(kind === 'smithery'
      ? { smitheryQualifiedName: `@acme/${id}` }
      : { url: `https://mcp.${id}.dev/mcp` }),
    ...overrides,
  };
}

const SENTRY = connector('sentry');
const NOTION = connector('notion', 'oauth-dcr', { category: 'productivity' });
const GMAIL = connector('gmail', 'smithery', { category: 'communication' });

function view(
  c: PtahConnector,
  overrides: Partial<FeaturedConnectorView> = {},
): FeaturedConnectorView {
  return {
    connector: c,
    status: 'not-connected',
    busy: false,
    polling: false,
    managedElsewhere: false,
    ...overrides,
  };
}

@Component({
  standalone: true,
  imports: [FeaturedConnectorsComponent],
  template: `
    <ptah-featured-connectors
      [items]="items()"
      [state]="state()"
      [loadError]="loadError()"
      [actionErrors]="actionErrors()"
      (action)="actions.push($event)"
      (details)="opened.push($event.id)"
      (retry)="retries = retries + 1"
      (dismissError)="dismissed.push($event)"
      (browseAll)="browses = browses + 1"
    />
  `,
})
class HostComponent {
  public readonly items = signal<readonly FeaturedConnectorView[]>([
    view(SENTRY),
    view(NOTION),
  ]);
  public readonly state = signal<FeaturedConnectorsState>('ready');
  public readonly loadError = signal<string | null>(null);
  public readonly actionErrors = signal<readonly ConnectorActionErrorView[]>(
    [],
  );
  public readonly actions: ConnectorActionRequest[] = [];
  public readonly opened: string[] = [];
  public retries = 0;
  public readonly dismissed: string[] = [];
  public browses = 0;
}

describe('selectFeaturedConnectors', () => {
  it('takes the first six not-connected oauth-dcr entries in catalogue order', () => {
    const catalogue = [
      connector('a'),
      connector('b', 'oauth-app'),
      connector('c', 'smithery'),
      connector('d'),
      connector('e'),
      connector('f'),
      connector('g'),
      connector('h'),
      connector('i'),
      connector('j'),
    ];
    const links = new Map<string, ConnectorLink>([
      ['d', { status: 'connected', serverKey: 'd' }],
      ['e', { status: 'needs-auth', serverKey: 'e' }],
      ['f', { status: 'not-connected' }],
    ]);
    expect(selectFeaturedConnectors(catalogue, links).map((c) => c.id)).toEqual(
      ['a', 'f', 'g', 'h', 'i', 'j'],
    );
    expect(FEATURED_CONNECTOR_LIMIT).toBe(6);
  });

  it('treats a connector missing from the link map as not connected', () => {
    expect(
      selectFeaturedConnectors([SENTRY], new Map()).map((c) => c.id),
    ).toEqual(['sentry']);
  });

  it('honours a smaller limit and never goes negative', () => {
    const catalogue = [connector('a'), connector('b'), connector('c')];
    expect(selectFeaturedConnectors(catalogue, new Map(), 2)).toHaveLength(2);
    expect(selectFeaturedConnectors(catalogue, new Map(), -1)).toEqual([]);
    expect(selectFeaturedConnectors(catalogue, new Map(), Number.NaN)).toEqual(
      [],
    );
  });

  it('only ever features oauth-dcr entries of the real catalogue', () => {
    const featured = selectFeaturedConnectors(PTAH_CONNECTORS, new Map());
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.length).toBeLessThanOrEqual(FEATURED_CONNECTOR_LIMIT);
    expect(featured.every((c) => c.kind === 'oauth-dcr')).toBe(true);
  });
});

describe('FeaturedConnectorsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let element: HTMLElement;

  const q = (testId: string): HTMLElement | null =>
    element.querySelector(`[data-testid="${testId}"]`);
  const card = (id: string): HTMLElement | null =>
    element.querySelector(`ptah-catalog-card[data-connector="${id}"]`);
  const cardStatus = (id: string): HTMLElement | null =>
    card(id)?.querySelector('[data-testid="catalog-card-status"]') ?? null;
  const actionButton = (id: string, action: string): HTMLButtonElement | null =>
    card(id)?.querySelector<HTMLButtonElement>(
      `[data-testid="catalog-card-actions"] [data-action="${action}"]`,
    ) ?? null;
  const text = (node: Element | null): string =>
    node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  function update(mutate: () => void): void {
    mutate();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('cards', () => {
    it('renders each connector as a ptah-catalog-card list item', () => {
      const cards = element.querySelectorAll('ptah-catalog-card');
      expect(cards).toHaveLength(2);
      for (const node of Array.from(cards)) {
        expect(node.getAttribute('role')).toBe('listitem');
      }
      expect(element.querySelector('ptah-catalog-grid')).not.toBeNull();
      expect(element.querySelector('ptah-connector-card')).toBeNull();
    });

    it('carries label, description, category and kind hint', () => {
      const sentry = card('sentry');
      expect(
        text(
          sentry?.querySelector('[data-testid="catalog-card-activator"]') ??
            null,
        ),
      ).toBe('Sentry');
      expect(
        text(
          sentry?.querySelector('[data-testid="catalog-card-description"]') ??
            null,
        ),
      ).toBe('sentry description');
      expect(
        text(
          sentry?.querySelector('[data-testid="catalog-card-meta"]') ?? null,
        ),
      ).toBe('DevOps · Signs in with your browser');
    });

    it('projects the brand mark into the card-mark slot', () => {
      const mark = card('notion')?.querySelector(
        '[data-testid="catalog-card-mark"] ptah-brand-mark',
      );
      expect(mark).not.toBeNull();
    });

    it('emits details when the card is activated', () => {
      card('sentry')
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="catalog-card-activator"]',
        )
        ?.click();
      expect(host.opened).toEqual(['sentry']);
    });

    it('titles the section with one h2 and the cards with h3s', () => {
      expect(text(element.querySelector('h2'))).toBe('Featured connectors');
      expect(element.querySelectorAll('h3')).toHaveLength(2);
    });
  });

  describe('status pill', () => {
    it('shows no pill (and no status slot) for a not-connected connector', () => {
      expect(card('sentry')?.querySelector('ptah-status-pill')).toBeNull();
      expect(cardStatus('sentry')?.children).toHaveLength(0);
    });

    it.each([
      ['connected', 'connected'],
      ['needs-auth', 'needs-auth'],
      ['error', 'failed'],
    ] as const)(
      'renders ptah-status-pill in the status slot for %s',
      (status, pillStatus) => {
        update(() => host.items.set([view(SENTRY, { status })]));
        const pill = cardStatus('sentry')?.querySelector(
          'ptah-status-pill [data-testid="status-pill"]',
        );
        expect(pill?.getAttribute('data-status')).toBe(pillStatus);
        expect(text(pill ?? null)).toBe(statusPresentation(pillStatus).label);
      },
    );

    it('shows the error reason under the pill', () => {
      update(() =>
        host.items.set([
          view(GMAIL, {
            status: 'error',
            detail: 'Smithery reported an error for this connection.',
          }),
        ]),
      );
      expect(
        text(
          cardStatus('gmail')?.querySelector(
            '[data-testid="connector-card-detail"]',
          ) ?? null,
        ),
      ).toBe('Smithery reported an error for this connection.');
    });
  });

  describe('actions', () => {
    it('offers Connect for a not-connected connector and emits it', () => {
      const connect = actionButton('sentry', 'connect');
      expect(connect?.getAttribute('aria-label')).toBe('Connect Sentry');
      expect(actionButton('sentry', 'authorize')).toBeNull();
      expect(actionButton('sentry', 'disconnect')).toBeNull();
      connect?.click();
      expect(host.actions).toEqual([{ action: 'connect', connector: SENTRY }]);
    });

    it('offers Authorize and Disconnect for needs-auth and error', () => {
      for (const status of ['needs-auth', 'error'] as const) {
        update(() => host.items.set([view(SENTRY, { status })]));
        expect(actionButton('sentry', 'authorize')).not.toBeNull();
        expect(actionButton('sentry', 'disconnect')).not.toBeNull();
        expect(actionButton('sentry', 'connect')).toBeNull();
      }
      actionButton('sentry', 'authorize')?.click();
      actionButton('sentry', 'disconnect')?.click();
      expect(host.actions.map((a) => a.action)).toEqual([
        'authorize',
        'disconnect',
      ]);
    });

    it('offers only Disconnect for a connected connector', () => {
      update(() => host.items.set([view(SENTRY, { status: 'connected' })]));
      expect(
        actionButton('sentry', 'disconnect')?.getAttribute('aria-label'),
      ).toBe('Disconnect Sentry');
      expect(actionButton('sentry', 'connect')).toBeNull();
      expect(actionButton('sentry', 'authorize')).toBeNull();
    });

    it('withholds Disconnect for a connection managed outside Ptah', () => {
      update(() =>
        host.items.set([
          view(GMAIL, { status: 'connected', managedElsewhere: true }),
        ]),
      );
      expect(actionButton('gmail', 'disconnect')).toBeNull();
      expect(
        card('gmail')?.querySelector('[data-testid="catalog-card-actions"]')
          ?.children,
      ).toHaveLength(0);
      expect(
        text(
          cardStatus('gmail')?.querySelector(
            '[data-testid="connector-card-managed"]',
          ) ?? null,
        ),
      ).toBe('Managed outside Ptah');
    });
  });

  describe('busy, polling and action error in the card-status slot', () => {
    it('shows a busy line and disables every action while busy', () => {
      update(() =>
        host.items.set([view(SENTRY, { status: 'needs-auth', busy: true })]),
      );
      const activity = cardStatus('sentry')?.querySelector(
        '[data-testid="connector-card-activity"]',
      );
      expect(activity?.getAttribute('role')).toBe('status');
      expect(activity?.getAttribute('data-activity')).toBe('busy');
      expect(text(activity ?? null)).toBe('Working…');
      const authorize = actionButton('sentry', 'authorize');
      const disconnect = actionButton('sentry', 'disconnect');
      expect(authorize?.disabled).toBe(true);
      expect(disconnect?.disabled).toBe(true);
    });

    it('shows the browser-setup line while a Smithery poll runs', () => {
      update(() =>
        host.items.set([
          view(GMAIL, { status: 'needs-auth', busy: true, polling: true }),
        ]),
      );
      const activity = cardStatus('gmail')?.querySelector(
        '[data-testid="connector-card-activity"]',
      );
      expect(activity?.getAttribute('data-activity')).toBe('polling');
      expect(text(activity ?? null)).toBe('Finish the setup in your browser…');
      expect(actionButton('gmail', 'authorize')?.disabled).toBe(true);
    });

    it('never emits an action for a locked card', () => {
      update(() => host.items.set([view(SENTRY, { busy: true })]));
      const connect = actionButton('sentry', 'connect');
      expect(connect?.disabled).toBe(true);
      connect?.dispatchEvent(new MouseEvent('click'));
      expect(host.actions).toEqual([]);
    });

    it('pins the action error to its own card, as an alert with dismiss', () => {
      update(() =>
        host.actionErrors.set([
          { connectorId: 'notion', message: 'Failed to connect Notion' },
        ]),
      );
      expect(
        cardStatus('sentry')?.querySelector(
          '[data-testid="connector-card-error"]',
        ),
      ).toBeNull();
      const error = cardStatus('notion')?.querySelector(
        '[data-testid="connector-card-error"]',
      );
      expect(error?.getAttribute('role')).toBe('alert');
      expect(text(error ?? null)).toContain('Failed to connect Notion');
      const dismiss = error?.querySelector<HTMLButtonElement>(
        '[data-testid="connector-card-error-dismiss"]',
      );
      expect(dismiss?.getAttribute('aria-label')).toBe('Dismiss error');
      dismiss?.click();
      expect(host.dismissed).toEqual(['notion']);
    });

    it('ignores a blank action error message', () => {
      update(() =>
        host.actionErrors.set([{ connectorId: 'sentry', message: '   ' }]),
      );
      expect(
        cardStatus('sentry')?.querySelector(
          '[data-testid="connector-card-error"]',
        ),
      ).toBeNull();
    });
  });

  describe('section states', () => {
    it('renders six skeleton list items while loading and marks the section busy', () => {
      update(() => host.state.set('loading'));
      const skeletons = element.querySelectorAll('ptah-catalog-card-skeleton');
      expect(skeletons).toHaveLength(FEATURED_CONNECTOR_LIMIT);
      expect(skeletons[0].getAttribute('role')).toBe('listitem');
      expect(element.querySelector('ptah-catalog-card')).toBeNull();
      expect(q('featured-connectors')?.getAttribute('aria-busy')).toBe('true');
    });

    it('renders the load error with a Retry output', () => {
      update(() => {
        host.state.set('error');
        host.loadError.set('Failed to load connection status');
      });
      const error = q('featured-connectors-error');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(text(error)).toContain('Failed to load connection status');
      expect(element.querySelector('ptah-catalog-card')).toBeNull();
      q('featured-connectors-retry')?.click();
      expect(host.retries).toBe(1);
    });

    it('falls back to a generic message when the error text is blank', () => {
      update(() => host.state.set('error'));
      expect(text(q('featured-connectors-error'))).toContain(
        'Could not load the connection status.',
      );
    });

    it('renders an empty note with a Browse call to action', () => {
      update(() => host.items.set([]));
      expect(q('featured-connectors-empty')).not.toBeNull();
      q('featured-connectors-empty-browse')?.click();
      q('featured-connectors-browse')?.click();
      expect(host.browses).toBe(2);
    });
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'featured-connectors.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
