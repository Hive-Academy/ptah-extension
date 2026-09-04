import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { PTAH_CONNECTORS } from '@ptah-extension/shared';
import type { PtahConnector } from '@ptah-extension/shared';
import { ConnectorsSurfaceComponent } from './connectors-surface.component';

/**
 * ConnectorsSurfaceComponent specs.
 *
 * Coverage:
 *  - The catalog filter (search box + category chips).
 *  - The status merge from the two independent sources, including the
 *    "connection exists but is not Ptah's" case that must withhold Disconnect.
 *  - Connect routing per `kind`, which is the one branch a regression would
 *    silently break: an `oauth-app` connector must NOT call `connectOAuth`,
 *    because there is no client id yet for it to use.
 *  - Per-provider setup instructions, redirect URL substitution, and cleanup.
 *  - Authorize on a connector that is listed but not usable.
 *  - The Smithery setup poll: it stops on `connected`, on `error`, at the
 *    5-minute deadline, and on destroy.
 *
 * The embedded `ptah-oauth-surface` is the REAL component, so its own mount RPC
 * appears in `calls`. Assertions therefore filter by method and inspect params
 * rather than counting every call.
 */

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess(): boolean {
      return data !== undefined;
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

interface RpcCall {
  method: string;
  params: unknown;
}

/** Pick a catalog entry by id, failing loudly if the catalog dropped it. */
function connectorById(id: string): PtahConnector {
  const found = PTAH_CONNECTORS.find((c) => c.id === id);
  if (!found) throw new Error(`Catalog entry '${id}' is missing`);
  return found;
}

const SENTRY = connectorById('sentry'); // oauth-dcr
const GITHUB = connectorById('github'); // oauth-app
const HUBSPOT_SMITHERY = connectorById('hubspot-smithery'); // smithery

const APP_WITH_SETUP: PtahConnector = {
  id: 'calendar-with-setup',
  label: 'Calendar with setup',
  description: 'A test-only connector with provider setup instructions.',
  category: 'productivity',
  kind: 'oauth-app',
  url: 'https://calendar.example/mcp',
  setupSteps: [
    'Create an app in the provider console.',
    'Add {redirectUrl} to the authorized redirect URLs.',
    'Copy the client ID and client secret into the fields below.',
  ],
  scopes: ['calendar.read', 'calendar.write'],
  verifiedAt: '2026-09-04',
};

const SECOND_APP_WITH_SETUP: PtahConnector = {
  ...APP_WITH_SETUP,
  id: 'drive-with-setup',
  label: 'Drive with setup',
  url: 'https://drive.example/mcp',
  setupSteps: ['Register {redirectUrl} for the second app.'],
};

describe('ConnectorsSurfaceComponent', () => {
  let fixture: ComponentFixture<ConnectorsSurfaceComponent>;
  let component: ConnectorsSurfaceComponent;
  let hostElement: HTMLElement;
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;

  const setResponder = (method: string, factory: () => unknown): void => {
    responders.set(method, factory);
  };

  const callsTo = (method: string): RpcCall[] =>
    calls.filter((c) => c.method === method);

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      if (!factory) {
        return Promise.resolve(fail(`No responder for ${method}`));
      }
      return Promise.resolve(factory());
    }),
  };

  /** The default happy world: nothing connected, no Smithery connections. */
  const setEmptyWorld = (): void => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:getOAuthRedirectUri', () =>
      ok({ redirectUri: 'http://127.0.0.1:41234/callback' }),
    );
    setResponder('mcpDirectory:listSmitheryConnections', () =>
      ok({ connections: [], namespace: 'acme' }),
    );
  };

  const createComponent = async (): Promise<void> => {
    fixture = TestBed.createComponent(ConnectorsSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    setEmptyWorld();

    TestBed.configureTestingModule({
      imports: [ConnectorsSurfaceComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  // ── Catalog filter ─────────────────────────────────────────────────────────

  describe('catalog filter', () => {
    it('shows every catalog entry before any filter', async () => {
      await createComponent();

      expect(component.visibleConnectors().length).toBe(PTAH_CONNECTORS.length);
      expect(hostElement.textContent).toContain(SENTRY.label);
    });

    it('filters by label', async () => {
      await createComponent();

      component.searchQuery.set('sentry');
      fixture.detectChanges();

      const ids = component.visibleConnectors().map((c) => c.id);
      expect(ids).toContain('sentry');
      expect(ids).not.toContain('stripe');
    });

    it('filters by description text, not just the label', async () => {
      await createComponent();

      component.searchQuery.set('subscriptions');

      const ids = component.visibleConnectors().map((c) => c.id);
      expect(ids).toContain('stripe');
      expect(ids).not.toContain('sentry');
    });

    it('is case-insensitive', async () => {
      await createComponent();

      component.searchQuery.set('SeNtRy');

      expect(component.visibleConnectors().map((c) => c.id)).toContain(
        'sentry',
      );
    });

    it('filters by category chip and restores on All', async () => {
      await createComponent();

      component.selectCategory('finance');
      const financeIds = component.visibleConnectors().map((c) => c.id);
      expect(financeIds).toContain('stripe');
      expect(financeIds).not.toContain('sentry');

      component.selectCategory(null);
      expect(component.visibleConnectors().length).toBe(PTAH_CONNECTORS.length);
    });

    it('applies the search box and the category chip together', async () => {
      await createComponent();

      component.selectCategory('finance');
      component.searchQuery.set('sentry');

      expect(component.visibleConnectors()).toHaveLength(0);
    });

    it('renders an empty state when nothing matches', async () => {
      await createComponent();

      component.searchQuery.set('zzzz-no-such-connector');
      fixture.detectChanges();

      expect(hostElement.textContent).toContain(
        'No connectors match your search.',
      );
    });

    it('only offers chips for categories the catalog uses', async () => {
      await createComponent();

      const used = new Set(PTAH_CONNECTORS.map((c) => c.category));
      for (const category of component.categories()) {
        expect(used.has(category)).toBe(true);
      }
    });
  });

  // ── Status merge ───────────────────────────────────────────────────────────

  describe('app-required setup guidance', () => {
    it('renders an oauth-app connector setup steps in order', async () => {
      await createComponent();

      await component.connect(APP_WITH_SETUP);
      fixture.detectChanges();

      const steps = Array.from(
        hostElement.querySelectorAll<HTMLLIElement>(
          '[data-testid="connector-setup-steps"] li',
        ),
      ).map((item) => item.textContent?.trim());
      expect(steps).toEqual([
        'Create an app in the provider console.',
        'Add http://127.0.0.1:41234/callback to the authorized redirect URLs.',
        'Copy the client ID and client secret into the fields below.',
      ]);
    });

    it('substitutes the redirect URL loaded by the embedded form', async () => {
      await createComponent();

      await component.connect(APP_WITH_SETUP);
      fixture.detectChanges();

      const setupText = hostElement.querySelector(
        '[data-testid="connector-setup-steps"]',
      )?.textContent;
      expect(setupText).toContain('http://127.0.0.1:41234/callback');
      expect(setupText).not.toContain('{redirectUrl}');
    });

    it('uses fallback wording when the redirect URL is unavailable', async () => {
      setResponder('mcpDirectory:getOAuthRedirectUri', () =>
        ok({ redirectUri: null }),
      );
      await createComponent();

      await component.connect(APP_WITH_SETUP);
      fixture.detectChanges();

      const setupText = hostElement.querySelector(
        '[data-testid="connector-setup-steps"]',
      )?.textContent;
      expect(setupText).toContain('the redirect URL shown above');
      expect(setupText).not.toContain('{redirectUrl}');
    });

    it('replaces the steps when another app connector is clicked', async () => {
      await createComponent();

      await component.connect(APP_WITH_SETUP);
      await component.connect(SECOND_APP_WITH_SETUP);
      fixture.detectChanges();

      const setupText = hostElement.querySelector(
        '[data-testid="connector-setup-steps"]',
      )?.textContent;
      expect(setupText).toContain('Register http://127.0.0.1:41234/callback');
      expect(setupText).not.toContain('Create an app in the provider console.');
    });

    it('clears setup steps when the custom form closes', async () => {
      await createComponent();
      await component.connect(APP_WITH_SETUP);
      fixture.detectChanges();
      expect(component.setupSteps()).toHaveLength(3);

      const details = hostElement.querySelector('details');
      if (!details) throw new Error('Custom server disclosure is missing');
      details.open = false;
      details.dispatchEvent(new Event('toggle'));
      fixture.detectChanges();

      expect(component.setupConnector()).toBeNull();
      expect(component.setupSteps()).toHaveLength(0);
      expect(
        hostElement.querySelector('[data-testid="connector-setup-steps"]'),
      ).toBeNull();
    });

    it('passes connector scopes to connectOAuth as one space-joined scope', async () => {
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: true, serverKey: 'oauth-mcp.calendar' }),
      );
      await createComponent();

      await component.authorize(APP_WITH_SETUP);

      expect(callsTo('mcpDirectory:connectOAuth')[0].params).toEqual({
        serverUrl: APP_WITH_SETUP.url,
        name: APP_WITH_SETUP.label,
        scope: 'calendar.read calendar.write',
      });
    });

    it('renders no setup steps for an oauth-dcr connector', async () => {
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: true, serverKey: 'oauth-mcp.sentry' }),
      );
      await createComponent();

      await component.connect(APP_WITH_SETUP);
      fixture.detectChanges();
      expect(component.setupSteps()).toHaveLength(3);

      await component.connect(SENTRY);
      fixture.detectChanges();

      expect(component.setupSteps()).toHaveLength(0);
      expect(
        hostElement.querySelector('[data-testid="connector-setup-steps"]'),
      ).toBeNull();
    });

    it('includes the provider setup effort in the oauth-app card hint', async () => {
      await createComponent();

      expect(component.kindHint(APP_WITH_SETUP)).toContain('3 steps');
    });
  });

  describe('status merge', () => {
    it('reports not-connected when neither source knows the connector', async () => {
      await createComponent();

      expect(component.statusOf(SENTRY)).toBe('not-connected');
      expect(component.linkOf(SENTRY).serverKey).toBeUndefined();
    });

    it('reports connected for an OAuth record whose status is connected', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({
          servers: [
            {
              serverKey: 'oauth-mcp.sentry',
              name: 'Sentry',
              serverUrl: SENTRY.url,
              connectedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }),
      );
      setResponder('mcpDirectory:oauthStatus', () =>
        ok({ state: 'connected' }),
      );
      await createComponent();

      expect(component.statusOf(SENTRY)).toBe('connected');
      expect(component.linkOf(SENTRY).serverKey).toBe('oauth-mcp.sentry');
    });

    it('reports needs-auth for an expired OAuth record', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({
          servers: [
            {
              serverKey: 'oauth-mcp.sentry',
              name: 'Sentry',
              serverUrl: SENTRY.url,
              connectedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }),
      );
      setResponder('mcpDirectory:oauthStatus', () => ok({ state: 'expired' }));
      await createComponent();

      expect(component.statusOf(SENTRY)).toBe('needs-auth');
    });

    it('matches an OAuth record whose URL differs only by a trailing slash', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({
          servers: [
            {
              serverKey: 'oauth-mcp.sentry',
              name: 'Sentry',
              serverUrl: `${SENTRY.url}/`,
              connectedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }),
      );
      setResponder('mcpDirectory:oauthStatus', () =>
        ok({ state: 'connected' }),
      );
      await createComponent();

      expect(component.statusOf(SENTRY)).toBe('connected');
    });

    it('reports connected for a Smithery connection matched by its server field', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({
          connections: [
            {
              connectionId: 'hubspot',
              name: 'HubSpot',
              server: 'hubspot',
              status: 'connected',
              managedByPtah: true,
              serverKey: 'smithery_hubspot',
            },
          ],
          namespace: 'acme',
        }),
      );
      await createComponent();

      expect(component.statusOf(HUBSPOT_SMITHERY)).toBe('connected');
      expect(component.linkOf(HUBSPOT_SMITHERY).serverKey).toBe(
        'smithery_hubspot',
      );
    });

    it('reports needs-auth for a Smithery connection in auth_required', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
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
        }),
      );
      await createComponent();

      expect(component.statusOf(HUBSPOT_SMITHERY)).toBe('needs-auth');
    });

    it('reports error with a reason for a Smithery connection in error', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({
          connections: [
            {
              connectionId: 'hubspot',
              name: 'HubSpot',
              server: 'hubspot',
              status: 'error',
              managedByPtah: true,
              serverKey: 'smithery_hubspot',
            },
          ],
          namespace: 'acme',
        }),
      );
      await createComponent();

      expect(component.statusOf(HUBSPOT_SMITHERY)).toBe('error');
      expect(component.linkOf(HUBSPOT_SMITHERY).detail).toBeDefined();
    });

    it('withholds Disconnect for a connection Ptah does not manage', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({
          connections: [
            {
              connectionId: 'hubspot',
              name: 'HubSpot',
              server: 'hubspot',
              status: 'connected',
              managedByPtah: false,
            },
          ],
          namespace: 'acme',
        }),
      );
      await createComponent();

      expect(component.isManagedElsewhere(HUBSPOT_SMITHERY)).toBe(true);

      await component.disconnect(HUBSPOT_SMITHERY);

      expect(callsTo('mcpDirectory:uninstallSmithery')).toHaveLength(0);
    });

    it('sets loadError only when BOTH sources fail', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () => fail('boom'));
      setResponder('mcpDirectory:listSmitheryConnections', () => fail('boom'));
      await createComponent();

      expect(component.loadError()).toBe('Failed to load connection status');
    });

    it('keeps a missing Smithery key out of loadError', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({ connections: [], namespace: null, error: 'API key not set' }),
      );
      await createComponent();

      expect(component.loadError()).toBeNull();
      expect(component.statusOf(SENTRY)).toBe('not-connected');
    });
  });

  // ── Connect routing ────────────────────────────────────────────────────────

  describe('Connect routes by kind', () => {
    it('oauth-dcr connects through connectOAuth and re-reads the status', async () => {
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: true, serverKey: 'oauth-mcp.sentry' }),
      );
      await createComponent();
      const before = callsTo('mcpDirectory:listOAuthConnected').length;

      await component.connect(SENTRY);

      const connect = callsTo('mcpDirectory:connectOAuth');
      expect(connect).toHaveLength(1);
      expect(connect[0].params).toEqual({
        serverUrl: SENTRY.url,
        name: SENTRY.label,
      });
      expect(callsTo('mcpDirectory:listOAuthConnected').length).toBeGreaterThan(
        before,
      );
    });

    it('oauth-app opens the custom form pre-filled with Advanced expanded', async () => {
      await createComponent();

      await component.connect(GITHUB);
      fixture.detectChanges();

      expect(callsTo('mcpDirectory:connectOAuth')).toHaveLength(0);
      expect(component.customFormOpen()).toBe(true);

      const form =
        fixture.debugElement.nativeElement.querySelector('ptah-oauth-surface');
      expect(form).toBeTruthy();
      // The embedded form now carries this connector.
      const urlField = hostElement.querySelector<HTMLInputElement>(
        'ptah-oauth-surface input[type="url"]',
      );
      expect(urlField?.value).toBe(GITHUB.url);
    });

    it('smithery installs, then opens the setup page when setup is needed', async () => {
      setResponder('mcpDirectory:installSmithery', () =>
        ok({
          success: true,
          serverKey: 'smithery_hubspot',
          status: 'auth_required',
          setupUrl: 'https://smithery.example/setup/abc',
        }),
      );
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: true, setupUrl: 'https://smithery.example/setup/def' }),
      );
      await createComponent();

      await component.connect(HUBSPOT_SMITHERY);

      const install = callsTo('mcpDirectory:installSmithery');
      expect(install).toHaveLength(1);
      expect(install[0].params).toEqual({
        qualifiedName: HUBSPOT_SMITHERY.smitheryQualifiedName,
        config: {},
      });
      expect(callsTo('mcpDirectory:openSmitherySetup')).toHaveLength(1);

      // The setup poll is now running on real timers; stop it with the test.
      fixture.destroy();
    });

    it('smithery skips the setup page when the install is already connected', async () => {
      setResponder('mcpDirectory:installSmithery', () =>
        ok({
          success: true,
          serverKey: 'smithery_hubspot',
          status: 'connected',
        }),
      );
      await createComponent();

      await component.connect(HUBSPOT_SMITHERY);

      expect(callsTo('mcpDirectory:installSmithery')).toHaveLength(1);
      expect(callsTo('mcpDirectory:openSmitherySetup')).toHaveLength(0);
    });

    it('surfaces a failed install without opening a setup page', async () => {
      setResponder('mcpDirectory:installSmithery', () =>
        ok({ success: false, error: 'no namespace' }),
      );
      await createComponent();

      await component.connect(HUBSPOT_SMITHERY);

      expect(component.actionError()).toBe('no namespace');
      expect(callsTo('mcpDirectory:openSmitherySetup')).toHaveLength(0);
    });
  });

  // ── Authorize ──────────────────────────────────────────────────────────────

  describe('Authorize', () => {
    it('re-runs connectOAuth against the existing serverKey', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({
          servers: [
            {
              serverKey: 'oauth-mcp.sentry',
              name: 'Sentry',
              serverUrl: SENTRY.url,
              connectedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }),
      );
      setResponder('mcpDirectory:oauthStatus', () => ok({ state: 'expired' }));
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: true, serverKey: 'oauth-mcp.sentry' }),
      );
      await createComponent();

      await component.authorize(SENTRY);

      const connect = callsTo('mcpDirectory:connectOAuth');
      expect(connect).toHaveLength(1);
      expect(connect[0].params).toEqual({
        serverUrl: SENTRY.url,
        name: SENTRY.label,
        serverKey: 'oauth-mcp.sentry',
      });
    });

    it('opens a fresh Smithery setup page for an auth_required connection', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
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
        }),
      );
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: true, setupUrl: 'https://smithery.example/setup/def' }),
      );
      await createComponent();

      await component.authorize(HUBSPOT_SMITHERY);

      const opened = callsTo('mcpDirectory:openSmitherySetup');
      expect(opened).toHaveLength(1);
      expect(opened[0].params).toEqual({ serverKey: 'smithery_hubspot' });

      fixture.destroy();
    });

    it('explains rather than acts when the connection is not Ptah-managed', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({
          connections: [
            {
              connectionId: 'hubspot',
              name: 'HubSpot',
              server: 'hubspot',
              status: 'auth_required',
              managedByPtah: false,
            },
          ],
          namespace: 'acme',
        }),
      );
      await createComponent();

      await component.authorize(HUBSPOT_SMITHERY);

      expect(callsTo('mcpDirectory:openSmitherySetup')).toHaveLength(0);
      expect(component.actionError()).toContain('outside Ptah');
    });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────

  describe('Disconnect', () => {
    it('routes an OAuth connector to disconnectOAuth', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({
          servers: [
            {
              serverKey: 'oauth-mcp.sentry',
              name: 'Sentry',
              serverUrl: SENTRY.url,
              connectedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }),
      );
      setResponder('mcpDirectory:oauthStatus', () =>
        ok({ state: 'connected' }),
      );
      setResponder('mcpDirectory:disconnectOAuth', () => ok({ success: true }));
      await createComponent();

      await component.disconnect(SENTRY);

      const disconnect = callsTo('mcpDirectory:disconnectOAuth');
      expect(disconnect).toHaveLength(1);
      expect(disconnect[0].params).toEqual({ serverKey: 'oauth-mcp.sentry' });
    });

    it('routes a Smithery connector to uninstallSmithery', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({
          connections: [
            {
              connectionId: 'hubspot',
              name: 'HubSpot',
              server: 'hubspot',
              status: 'connected',
              managedByPtah: true,
              serverKey: 'smithery_hubspot',
            },
          ],
          namespace: 'acme',
        }),
      );
      setResponder('mcpDirectory:uninstallSmithery', () =>
        ok({ success: true }),
      );
      await createComponent();

      await component.disconnect(HUBSPOT_SMITHERY);

      const removed = callsTo('mcpDirectory:uninstallSmithery');
      expect(removed).toHaveLength(1);
      expect(removed[0].params).toEqual({ serverKey: 'smithery_hubspot' });
    });
  });

  // ── Setup poll ─────────────────────────────────────────────────────────────

  describe('Smithery setup poll', () => {
    const startAuthorize = async (): Promise<void> => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
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
        }),
      );
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: true, setupUrl: 'https://smithery.example/setup/def' }),
      );
      await createComponent();
      jest.useFakeTimers();
      await component.authorize(HUBSPOT_SMITHERY);
    };

    afterEach(() => {
      jest.useRealTimers();
    });

    it('polls every 3 seconds and stops once the connection is connected', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'auth_required' }),
      );
      await startAuthorize();

      expect(component.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(true);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(3000);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(3000);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(2);

      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'connected' }),
      );
      await jest.advanceTimersByTimeAsync(3000);

      expect(component.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(false);

      const settled = callsTo('mcpDirectory:smitheryConnectionStatus').length;
      await jest.advanceTimersByTimeAsync(30_000);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(
        settled,
      );
    });

    it('stops on an error status rather than waiting out the deadline', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'error' }),
      );
      await startAuthorize();

      await jest.advanceTimersByTimeAsync(3000);

      expect(component.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(false);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(1);
    });

    it('keeps polling through a transient status failure', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        fail('network'),
      );
      await startAuthorize();

      await jest.advanceTimersByTimeAsync(9000);

      expect(component.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(true);
      expect(
        callsTo('mcpDirectory:smitheryConnectionStatus').length,
      ).toBeGreaterThanOrEqual(3);
    });

    it('gives up after five minutes', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'auth_required' }),
      );
      await startAuthorize();

      await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 3000);

      expect(component.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(false);
      const settled = callsTo('mcpDirectory:smitheryConnectionStatus').length;
      await jest.advanceTimersByTimeAsync(30_000);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(
        settled,
      );
    });

    it('stops on destroy', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'auth_required' }),
      );
      await startAuthorize();

      await jest.advanceTimersByTimeAsync(3000);
      const before = callsTo('mcpDirectory:smitheryConnectionStatus').length;

      fixture.destroy();

      await jest.advanceTimersByTimeAsync(30_000);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(
        before,
      );
      expect(component.pollingIds().size).toBe(0);
    });
  });
});
