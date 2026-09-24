/**
 * ConnectorDetailComponent specs (plan C9, Task 15.2).
 *
 * The detail is created directly with its route input set, under the REAL
 * `ConnectorLinksStore` and `ConnectorActionsTracker` (RPC mocked); the tier
 * is a stub signal. Placement inside the page (drawer vs full page, Esc) is
 * pinned in the page spec.
 */

import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
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
import { OAuthSurfaceComponent } from '../../oauth-surface.component';
import { ConnectorActionsTracker } from './connector-actions';
import { ConnectorDetailComponent } from './connector-detail.component';

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess(): boolean {
      return true;
    },
  };
}

function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess(): boolean {
      return false;
    },
  };
}

function connectorById(id: string): PtahConnector {
  const found = PTAH_CONNECTORS.find((c) => c.id === id);
  if (!found) throw new Error(`Catalog entry '${id}' is missing`);
  return found;
}

const SENTRY = connectorById('sentry'); // oauth-dcr
const GITHUB = connectorById('github'); // oauth-app
const REDIRECT = 'https://host.example/oauth/callback';

const SENTRY_RECORD: McpOAuthConnectedRecord = {
  serverKey: 'oauth-mcp.sentry',
  name: 'Sentry',
  serverUrl: SENTRY.url ?? '',
  connectedAt: '2026-09-01T00:00:00.000Z',
};

describe('ConnectorDetailComponent', () => {
  let fixture: ComponentFixture<ConnectorDetailComponent>;
  let calls: { method: string; params: unknown }[];
  let responders: Map<string, () => unknown>;
  let tier: WritableSignal<MarketplaceTier>;
  let inventory: { notifyContentChanged: jest.Mock };

  const setResponder = (method: string, factory: () => unknown): void => {
    responders.set(method, factory);
  };

  const configure = (providers: unknown[] = []): void => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ClaudeRpcService,
          useValue: {
            call: jest.fn((method: string, params: unknown) => {
              calls.push({ method, params });
              const factory = responders.get(method);
              return Promise.resolve(
                factory ? factory() : fail(`No responder for ${method}`),
              );
            }),
          },
        },
        { provide: MarketplaceInventoryStore, useValue: inventory },
        { provide: MarketplaceLayout, useValue: { tier } },
        ConnectorLinksStore,
        ConnectorActionsTracker,
        ...(providers as never[]),
      ],
    });
  };

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };

  const mount = async (connectorId: string): Promise<void> => {
    fixture = TestBed.createComponent(ConnectorDetailComponent);
    fixture.componentRef.setInput('connectorId', connectorId);
    fixture.autoDetectChanges();
    await settle();
  };

  const loadLinks = async (): Promise<void> => {
    await TestBed.inject(ConnectorLinksStore).ensure();
  };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const one = (selector: string): HTMLElement | null =>
    el().querySelector<HTMLElement>(selector);
  const fact = (label: string): string =>
    one(`[data-fact="${label}"]`)?.textContent?.trim() ?? '';
  const form = (): OAuthSurfaceComponent =>
    fixture.debugElement.query(By.directive(OAuthSurfaceComponent))
      .componentInstance as OAuthSurfaceComponent;

  beforeEach(() => {
    calls = [];
    responders = new Map();
    tier = signal<MarketplaceTier>('compact');
    inventory = { notifyContentChanged: jest.fn() };
    setResponder('mcpDirectory:listOAuthConnected', () =>
      ok({ servers: [SENTRY_RECORD] }),
    );
    setResponder('mcpDirectory:oauthStatus', () => ok({ state: 'connected' }));
    setResponder('mcpDirectory:listSmitheryConnections', () =>
      ok({ connections: [], namespace: 'acme' }),
    );
    setResponder('mcpDirectory:getOAuthRedirectUri', () =>
      ok({ redirectUri: REDIRECT }),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('not found', () => {
    it('renders "Connector not found" with a link back for an unknown id', async () => {
      configure();
      await mount('no-such-connector');

      const section = one('[data-testid="connector-detail-not-found"]');
      expect(section?.querySelector('h2')?.textContent).toContain(
        'Connector not found',
      );
      expect(
        one('[data-testid="connector-detail-back"]')?.getAttribute('href'),
      ).toBe('/marketplace/connectors');
    });

    it('renders the "Not found" title as the page h1 at wide', async () => {
      tier.set('wide');
      configure();
      await mount('');

      expect(
        one('[data-testid="connector-detail-not-found"] h1')?.textContent,
      ).toContain('Connector not found');
    });
  });

  describe('an oauth-dcr connector', () => {
    it('renders the brand header, description and facts', async () => {
      configure();
      await loadLinks();
      await mount('sentry');

      expect(one('ptah-brand-mark')).not.toBeNull();
      expect(one('h2')?.textContent).toContain('Sentry');
      expect(
        one('[data-testid="connector-detail-description"]')?.textContent,
      ).toContain(SENTRY.description);
      expect(fact('Category')).toBe('DevOps');
      expect(fact('Sign-in')).toBe('Signs in with your browser');
      expect(fact('Status')).toBe('Connected');
      expect(fact('Server URL')).toBe(SENTRY.url);
      expect(fact('Verified')).toBe('Sep 4, 2026');
      expect(fact('Connected')).toBe('Sep 1, 2026');
      expect(one('ptah-status-pill')).not.toBeNull();
      expect(one('ptah-oauth-surface')).toBeNull();
    });

    it('says "Not connected" with no pill and offers Connect before any connection', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({ servers: [] }),
      );
      configure();
      await loadLinks();
      await mount('linear');

      expect(fact('Status')).toBe('Not connected');
      expect(one('ptah-status-pill')).toBeNull();
      expect(one('[data-action="connect"]')).not.toBeNull();
    });

    it('disconnects through the links store', async () => {
      setResponder('mcpDirectory:disconnectOAuth', () => ok({ success: true }));
      configure();
      await loadLinks();
      await mount('sentry');

      one('[data-action="disconnect"]')?.click();
      await settle();

      const call = calls.find(
        (c) => c.method === 'mcpDirectory:disconnectOAuth',
      );
      expect(call?.params).toEqual({ serverKey: SENTRY_RECORD.serverKey });
      expect(inventory.notifyContentChanged).toHaveBeenCalled();
    });

    it('shows the action error for this connector only', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({ servers: [] }),
      );
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: false, error: 'Consent was denied' }),
      );
      configure();
      await loadLinks();
      await mount('linear');

      one('[data-action="connect"]')?.click();
      await settle();
      expect(
        one('[data-testid="connector-card-error"]')?.textContent,
      ).toContain('Consent was denied');

      fixture.componentRef.setInput('connectorId', 'sentry');
      await settle();
      expect(one('[data-testid="connector-card-error"]')).toBeNull();
    });

    it('moves focus to its h1 on the whole page (wide)', async () => {
      tier.set('wide');
      configure();
      await loadLinks();
      await mount('sentry');

      const heading = one('h1');
      expect(heading?.textContent).toContain('Sentry');
      expect(document.activeElement).toBe(heading);
    });
  });

  describe('an oauth-app connector', () => {
    it('lists the provider steps with the host redirect URL filled in', async () => {
      configure();
      await mount('github');

      const steps = one('[data-testid="connector-setup-steps"]');
      expect(steps?.querySelectorAll('li')).toHaveLength(
        GITHUB.setupSteps?.length ?? 0,
      );
      expect(steps?.textContent).toContain(REDIRECT);
      expect(steps?.textContent).not.toContain('{redirectUrl}');
      // One redirect read — the embedded form's; the detail adds none.
      expect(
        calls.filter((c) => c.method === 'mcpDirectory:getOAuthRedirectUri'),
      ).toHaveLength(1);
    });

    it('pre-fills the embedded form after it renders', async () => {
      configure();
      await mount('github');

      expect(form().urlInput()).toBe(GITHUB.url);
      expect(form().nameInput()).toBe(GITHUB.label);
      expect(form().advancedOpen()).toBe(true);
    });

    it('never overwrites what the user typed on a later render', async () => {
      configure();
      await mount('github');

      form().nameInput.set('My GitHub');
      await TestBed.inject(ConnectorLinksStore).reload();
      await settle();

      expect(form().nameInput()).toBe('My GitHub');
    });

    it('pre-fills again for a different connector', async () => {
      configure();
      await mount('github');
      const other = PTAH_CONNECTORS.find(
        (c) => c.kind === 'oauth-app' && c.id !== 'github',
      );
      if (!other) throw new Error('need a second oauth-app connector');

      fixture.componentRef.setInput('connectorId', other.id);
      await settle();

      expect(form().urlInput()).toBe(other.url);
      expect(form().nameInput()).toBe(other.label);
    });

    it('brings the setup form into focus on Set up, without an RPC', async () => {
      configure();
      await mount('github');
      const before = calls.length;

      one('[data-action="connect"]')?.click();
      await settle();

      expect(document.activeElement).toBe(
        one('[data-testid="connector-detail-setup"]'),
      );
      expect(calls.length).toBe(before);
    });

    it('re-reads the links and notifies the inventory when the form connects', async () => {
      configure();
      await mount('github');
      const before = calls.filter(
        (c) => c.method === 'mcpDirectory:listSmitheryConnections',
      ).length;

      form().serverConnected.emit('oauth-github');
      await settle();

      expect(
        calls.filter((c) => c.method === 'mcpDirectory:listSmitheryConnections')
          .length,
      ).toBe(before + 1);
      expect(inventory.notifyContentChanged).toHaveBeenCalled();
    });
  });

  describe('Smithery states', () => {
    it('links to servers/smithery when Smithery has no key', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({ connections: [], namespace: null, error: 'No Smithery API key' }),
      );
      configure();
      await loadLinks();
      await mount('hubspot-smithery');

      expect(
        one('[data-testid="connector-card-smithery-key"]')?.getAttribute(
          'href',
        ),
      ).toBe('/marketplace/servers/smithery');
      expect(one('[data-action="connect"]')).toBeNull();
      expect(fact('Smithery server')).toBe('hubspot');
    });

    it('renders a timed-out setup with a Retry (Batch 6 follow-up 2)', async () => {
      const retry = jest.fn(() => Promise.resolve({ kind: 'done' }));
      configure([
        {
          provide: ConnectorActionsTracker,
          useValue: {
            actionErrors: signal([]),
            errorFor: () => null,
            timedOutIds: signal<ReadonlySet<string>>(
              new Set(['hubspot-smithery']),
            ),
            run: jest.fn(),
            retry,
            dismissError: jest.fn(),
            dismissTimeout: jest.fn(),
          },
        },
      ]);
      await mount('hubspot-smithery');

      expect(
        one('[data-testid="connector-card-timeout"]')?.textContent,
      ).toContain('not confirmed within 5 minutes');
      one('[data-testid="connector-card-timeout-retry"]')?.click();

      expect(retry).toHaveBeenCalledWith(
        connectorById('hubspot-smithery'),
        'detail',
      );
    });
  });
});
