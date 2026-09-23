import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ClaudeRpcService, WorkspaceScopeService } from '@ptah-extension/core';
import { PTAH_CONNECTORS } from '@ptah-extension/shared';
import type {
  McpOAuthConnectedRecord,
  PtahConnector,
  SmitheryConnectionSummary,
} from '@ptah-extension/shared';
import { ConnectorLinksStore } from './connector-links.store';

/**
 * ConnectorLinksStore specs.
 *
 * Migrated from `connectors-surface.component.spec.ts` (the component is
 * deleted in the switch-over batch): the status merge table, the
 * "connection exists but is not Ptah's" rule that withholds Disconnect,
 * Connect routing per `kind`, Authorize, Disconnect, and the Smithery setup
 * poll (stops on `connected`, on `error`, at the 5-minute deadline, and on
 * destroy). The catalogue filter, setup-step rendering and custom-form prefill
 * are page behaviour and move to the connectors page specs.
 *
 * New here: the store loads only when asked (zero RPC on construction and on a
 * workspace switch while idle), re-reads on a workspace switch with no
 * navigation, drops superseded loads, never runs two `connectOAuth` for one
 * busy id, and decorates installed rows.
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

/** Let every pending promise chain (real timers) run to completion. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Pick a catalogue entry by id, failing loudly if the catalogue dropped it. */
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
  brandSlug: 'calendar-with-setup',
  description: 'A test-only connector with provider setup instructions.',
  category: 'productivity',
  kind: 'oauth-app',
  url: 'https://calendar.example/mcp',
  setupSteps: ['Add {redirectUrl} to the authorized redirect URLs.'],
  scopes: ['calendar.read', 'calendar.write'],
  verifiedAt: '2026-09-04',
};

const SENTRY_RECORD: McpOAuthConnectedRecord = {
  serverKey: 'oauth-mcp.sentry',
  name: 'Sentry',
  serverUrl: SENTRY.url ?? '',
  connectedAt: '2026-09-01T00:00:00.000Z',
};

function hubspotConnection(
  overrides: Partial<SmitheryConnectionSummary> = {},
): SmitheryConnectionSummary {
  return {
    connectionId: 'hubspot',
    name: 'HubSpot',
    server: 'hubspot',
    status: 'connected',
    managedByPtah: true,
    serverKey: 'smithery_hubspot',
    ...overrides,
  };
}

describe('ConnectorLinksStore', () => {
  let store: ConnectorLinksStore;
  let injector: EnvironmentInjector;
  let injectorDestroyed: boolean;
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;

  const routerSpy = {
    navigate: jest.fn(),
    navigateByUrl: jest.fn(),
  };

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

  const setOAuthRecords = (
    records: McpOAuthConnectedRecord[],
    state: string,
  ): void => {
    setResponder('mcpDirectory:listOAuthConnected', () =>
      ok({ servers: records }),
    );
    setResponder('mcpDirectory:oauthStatus', () => ok({ state }));
  };

  const setSmitheryConnections = (
    connections: SmitheryConnectionSummary[],
  ): void => {
    setResponder('mcpDirectory:listSmitheryConnections', () =>
      ok({ connections, namespace: 'acme' }),
    );
  };

  /** Create the store the way the shell will: in its own injector. */
  const createStore = (): void => {
    injector = createEnvironmentInjector(
      [ConnectorLinksStore],
      TestBed.inject(EnvironmentInjector),
    );
    injectorDestroyed = false;
    store = injector.get(ConnectorLinksStore);
  };

  /** The shell's destruction: runs the store's `DestroyRef` callbacks. */
  const destroyStore = (): void => {
    if (injectorDestroyed) return;
    injectorDestroyed = true;
    injector.destroy();
  };

  const createLoadedStore = async (): Promise<void> => {
    createStore();
    await store.ensure();
  };

  const switchWorkspace = (path: string): void => {
    TestBed.inject(WorkspaceScopeService).switchTo(path);
    TestBed.tick();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    routerSpy.navigate.mockClear();
    routerSpy.navigateByUrl.mockClear();
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setSmitheryConnections([]);

    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: Router, useValue: routerSpy },
      ],
    });
  });

  afterEach(() => {
    destroyStore();
    jest.useRealTimers();
  });

  // ── Loading ────────────────────────────────────────────────────────────────

  describe('loading', () => {
    it('constructs without a single RPC and stays idle', () => {
      createStore();
      TestBed.tick();

      expect(calls).toHaveLength(0);
      expect(store.state()).toBe('idle');
    });

    it('reads nothing when only the derived views are read', () => {
      createStore();

      store.links();
      store.linkOf(SENTRY);
      store.statusFor({ origin: 'oauth', serverKey: 'oauth-mcp.sentry' });
      store.datesFor('oauth-mcp.sentry');

      expect(calls).toHaveLength(0);
    });

    it('ensure loads both halves once, and a second ensure is a no-op', async () => {
      await createLoadedStore();
      await store.ensure();

      expect(store.state()).toBe('ready');
      expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(1);
      expect(callsTo('mcpDirectory:listSmitheryConnections')).toHaveLength(1);
    });

    it('ensure while the first load is in flight does not start another', async () => {
      createStore();
      const first = store.ensure();
      const second = store.ensure();
      await Promise.all([first, second]);

      expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(1);
    });

    it('reload re-reads a ready store', async () => {
      await createLoadedStore();

      await store.reload();

      expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(2);
    });

    it('a load superseded by a newer one publishes nothing', async () => {
      const slow = deferred<unknown>();
      setResponder('mcpDirectory:listOAuthConnected', () => slow.promise);
      createStore();
      const first = store.ensure();

      setOAuthRecords([SENTRY_RECORD], 'connected');
      await store.reload();
      expect(store.linkOf(SENTRY).status).toBe('connected');

      slow.resolve(ok({ servers: [] }));
      await first;

      expect(store.linkOf(SENTRY).status).toBe('connected');
      expect(store.state()).toBe('ready');
    });

    it('sets loadError only when BOTH sources fail', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () => fail('boom'));
      setResponder('mcpDirectory:listSmitheryConnections', () => fail('boom'));
      await createLoadedStore();

      expect(store.loadError()).toBe('Failed to load connection status');
      expect(store.state()).toBe('error');
    });

    it('keeps a missing Smithery key out of loadError and reports it as a state', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({ connections: [], namespace: null, error: 'API key not set' }),
      );
      await createLoadedStore();

      expect(store.loadError()).toBeNull();
      expect(store.state()).toBe('ready');
      expect(store.smitheryUnavailable()).toBe('API key not set');
      expect(store.linkOf(SENTRY).status).toBe('not-connected');
    });

    it('treats a thrown half as a failure of that half only', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () => {
        throw new Error('transport down');
      });
      setOAuthRecords([SENTRY_RECORD], 'connected');
      await createLoadedStore();

      expect(store.state()).toBe('ready');
      expect(store.loadError()).toBeNull();
      expect(store.linkOf(SENTRY).status).toBe('connected');
    });

    it('a failed half keeps its last answer', async () => {
      setOAuthRecords([SENTRY_RECORD], 'connected');
      await createLoadedStore();

      setResponder('mcpDirectory:listOAuthConnected', () => fail('boom'));
      await store.reload();

      expect(store.linkOf(SENTRY).status).toBe('connected');
      expect(store.state()).toBe('ready');
    });

    it('shows a record whose state cannot be read as needs-auth', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({ servers: [SENTRY_RECORD] }),
      );
      setResponder('mcpDirectory:oauthStatus', () => {
        throw new Error('status failed');
      });
      await createLoadedStore();

      expect(store.linkOf(SENTRY).status).toBe('needs-auth');
      expect(store.linkOf(SENTRY).serverKey).toBe('oauth-mcp.sentry');
    });
  });

  // ── Workspace switch (TASK_2026_540 item 6b) ─────────────────────────────

  describe('workspace switch without navigation', () => {
    it('re-reads a loaded store once when the workspace generation bumps, with no router call', async () => {
      await createLoadedStore();
      expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(1);
      setOAuthRecords([SENTRY_RECORD], 'connected');

      switchWorkspace('/ws/b');

      expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(2);
      expect(callsTo('mcpDirectory:listSmitheryConnections')).toHaveLength(2);
      expect(store.state()).toBe('loading');

      await settle();

      expect(store.state()).toBe('ready');
      expect(store.linkOf(SENTRY).status).toBe('connected');
      expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(2);
      expect(routerSpy.navigate).not.toHaveBeenCalled();
      expect(routerSpy.navigateByUrl).not.toHaveBeenCalled();
    });

    it('keeps an idle store idle across a workspace switch', () => {
      createStore();
      TestBed.tick();

      switchWorkspace('/ws/b');

      expect(calls).toHaveLength(0);
      expect(store.state()).toBe('idle');
    });

    it('does not re-read for a switch to the workspace already active', async () => {
      switchWorkspace('/ws/a');
      await createLoadedStore();

      switchWorkspace('/ws/a');

      expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(1);
    });

    it('drops a read that started under the previous workspace', async () => {
      const slow = deferred<unknown>();
      setResponder('mcpDirectory:listOAuthConnected', () => slow.promise);
      createStore();
      TestBed.tick();
      const first = store.ensure();

      // Bump without flushing effects: the re-read is not scheduled yet.
      TestBed.inject(WorkspaceScopeService).switchTo('/ws/b');
      slow.resolve(ok({ servers: [SENTRY_RECORD] }));
      setResponder('mcpDirectory:oauthStatus', () =>
        ok({ state: 'connected' }),
      );
      await first;

      expect(store.oauthRecords()).toHaveLength(0);
      expect(store.state()).toBe('loading');

      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({ servers: [] }),
      );
      TestBed.tick();
      await settle();

      expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(2);
      expect(store.state()).toBe('ready');
      expect(store.oauthRecords()).toHaveLength(0);
    });
  });

  // ── Status merge ───────────────────────────────────────────────────────────

  describe('status merge', () => {
    it('reports not-connected when neither source knows the connector', async () => {
      await createLoadedStore();

      expect(store.linkOf(SENTRY).status).toBe('not-connected');
      expect(store.linkOf(SENTRY).serverKey).toBeUndefined();
    });

    it('reports connected for an OAuth record whose status is connected', async () => {
      setOAuthRecords([SENTRY_RECORD], 'connected');
      await createLoadedStore();

      expect(store.linkOf(SENTRY).status).toBe('connected');
      expect(store.linkOf(SENTRY).serverKey).toBe('oauth-mcp.sentry');
    });

    it('reports needs-auth for an expired OAuth record', async () => {
      setOAuthRecords([SENTRY_RECORD], 'expired');
      await createLoadedStore();

      expect(store.linkOf(SENTRY).status).toBe('needs-auth');
    });

    it('matches an OAuth record whose URL differs only by a trailing slash', async () => {
      setOAuthRecords(
        [{ ...SENTRY_RECORD, serverUrl: `${SENTRY.url}/` }],
        'connected',
      );
      await createLoadedStore();

      expect(store.linkOf(SENTRY).status).toBe('connected');
    });

    it('reports connected for a Smithery connection matched by its server field', async () => {
      setSmitheryConnections([hubspotConnection()]);
      await createLoadedStore();

      expect(store.linkOf(HUBSPOT_SMITHERY).status).toBe('connected');
      expect(store.linkOf(HUBSPOT_SMITHERY).serverKey).toBe('smithery_hubspot');
    });

    it('reports needs-auth for a Smithery connection in auth_required', async () => {
      setSmitheryConnections([hubspotConnection({ status: 'auth_required' })]);
      await createLoadedStore();

      expect(store.linkOf(HUBSPOT_SMITHERY).status).toBe('needs-auth');
    });

    it('reports error with a reason for a Smithery connection in error', async () => {
      setSmitheryConnections([hubspotConnection({ status: 'error' })]);
      await createLoadedStore();

      expect(store.linkOf(HUBSPOT_SMITHERY).status).toBe('error');
      expect(store.linkOf(HUBSPOT_SMITHERY).detail).toBeDefined();
    });

    it('withholds Disconnect for a connection Ptah does not manage', async () => {
      setSmitheryConnections([
        hubspotConnection({ managedByPtah: false, serverKey: undefined }),
      ]);
      await createLoadedStore();

      expect(store.isManagedElsewhere(HUBSPOT_SMITHERY)).toBe(true);

      const outcome = await store.disconnect(HUBSPOT_SMITHERY);

      expect(outcome).toEqual({ kind: 'skipped' });
      expect(callsTo('mcpDirectory:uninstallSmithery')).toHaveLength(0);
    });
  });

  // ── Installed-row decoration and dates ────────────────────────────────────

  describe('statusFor and datesFor', () => {
    it('decorates an oauth row with its OAuth state and a smithery row with its status', async () => {
      setOAuthRecords([SENTRY_RECORD], 'expired');
      setSmitheryConnections([hubspotConnection({ status: 'auth_required' })]);
      await createLoadedStore();

      expect(
        store.statusFor({ origin: 'oauth', serverKey: 'oauth-mcp.sentry' }),
      ).toEqual({ source: 'oauth', state: 'expired' });
      expect(
        store.statusFor({ origin: 'smithery', serverKey: 'smithery_hubspot' }),
      ).toEqual({ source: 'smithery', status: 'auth_required' });
    });

    it('has no decoration for other origins or unknown keys', async () => {
      setOAuthRecords([SENTRY_RECORD], 'connected');
      await createLoadedStore();

      expect(
        store.statusFor({
          origin: 'claude-user',
          serverKey: 'oauth-mcp.sentry',
        }),
      ).toBeNull();
      expect(
        store.statusFor({ origin: 'oauth', serverKey: 'oauth-mcp.unknown' }),
      ).toBeNull();
      expect(
        store.statusFor({ origin: 'smithery', serverKey: 'smithery_none' }),
      ).toBeNull();
    });

    it('looks up connectedAt and createdAt by server key', async () => {
      setOAuthRecords([SENTRY_RECORD], 'connected');
      setSmitheryConnections([
        hubspotConnection({ createdAt: '2026-08-01T10:00:00.000Z' }),
      ]);
      await createLoadedStore();

      expect(store.datesFor('oauth-mcp.sentry')).toEqual({
        connectedAt: '2026-09-01T00:00:00.000Z',
      });
      expect(store.datesFor('smithery_hubspot')).toEqual({
        createdAt: '2026-08-01T10:00:00.000Z',
      });
      expect(store.datesFor('nothing')).toEqual({});
    });
  });

  // ── Connect routing ────────────────────────────────────────────────────────

  describe('Connect routes by kind', () => {
    it('oauth-dcr connects through connectOAuth and re-reads the status', async () => {
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: true, serverKey: 'oauth-mcp.sentry' }),
      );
      await createLoadedStore();
      const before = callsTo('mcpDirectory:listOAuthConnected').length;

      const outcome = await store.connect(SENTRY);

      expect(outcome).toEqual({ kind: 'done' });
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

    it('oauth-app answers needs-setup and calls nothing', async () => {
      await createLoadedStore();
      const before = calls.length;

      const outcome = await store.connect(GITHUB);

      expect(outcome).toEqual({ kind: 'needs-setup' });
      expect(callsTo('mcpDirectory:connectOAuth')).toHaveLength(0);
      expect(calls).toHaveLength(before);
      expect(store.isBusy(GITHUB)).toBe(false);
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
      await createLoadedStore();

      const outcome = await store.connect(HUBSPOT_SMITHERY);

      expect(outcome).toEqual({ kind: 'awaiting-setup' });
      const install = callsTo('mcpDirectory:installSmithery');
      expect(install).toHaveLength(1);
      expect(install[0].params).toEqual({
        qualifiedName: HUBSPOT_SMITHERY.smitheryQualifiedName,
        config: {},
      });
      const opened = callsTo('mcpDirectory:openSmitherySetup');
      expect(opened).toHaveLength(1);
      expect(opened[0].params).toEqual({ serverKey: 'smithery_hubspot' });
      expect(store.isPolling(HUBSPOT_SMITHERY)).toBe(true);
      // afterEach destroys the store, which stops the real-timer poll.
    });

    it('smithery skips the setup page when the install is already connected', async () => {
      setResponder('mcpDirectory:installSmithery', () =>
        ok({
          success: true,
          serverKey: 'smithery_hubspot',
          status: 'connected',
        }),
      );
      await createLoadedStore();

      const outcome = await store.connect(HUBSPOT_SMITHERY);

      expect(outcome).toEqual({ kind: 'done' });
      expect(callsTo('mcpDirectory:installSmithery')).toHaveLength(1);
      expect(callsTo('mcpDirectory:openSmitherySetup')).toHaveLength(0);
      expect(store.isBusy(HUBSPOT_SMITHERY)).toBe(false);
    });

    it('surfaces a failed install without opening a setup page', async () => {
      setResponder('mcpDirectory:installSmithery', () =>
        ok({ success: false, error: 'no namespace' }),
      );
      await createLoadedStore();

      const outcome = await store.connect(HUBSPOT_SMITHERY);

      expect(outcome).toEqual({ kind: 'failed', error: 'no namespace' });
      expect(store.actionError()).toBe('no namespace');
      expect(callsTo('mcpDirectory:openSmitherySetup')).toHaveLength(0);
    });

    it('passes connector scopes to connectOAuth as one space-joined scope', async () => {
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: true, serverKey: 'oauth-mcp.calendar' }),
      );
      await createLoadedStore();

      await store.authorize(APP_WITH_SETUP);

      expect(callsTo('mcpDirectory:connectOAuth')[0].params).toEqual({
        serverUrl: APP_WITH_SETUP.url,
        name: APP_WITH_SETUP.label,
        scope: 'calendar.read calendar.write',
      });
    });

    it('never runs a second connectOAuth for a connector already busy', async () => {
      const pending = deferred<unknown>();
      setResponder('mcpDirectory:connectOAuth', () => pending.promise);
      await createLoadedStore();

      const first = store.connect(SENTRY);
      expect(store.isBusy(SENTRY)).toBe(true);
      const second = await store.connect(SENTRY);
      const third = await store.authorize(SENTRY);

      expect(second).toEqual({ kind: 'skipped' });
      expect(third).toEqual({ kind: 'skipped' });
      expect(callsTo('mcpDirectory:connectOAuth')).toHaveLength(1);

      pending.resolve(ok({ success: true, serverKey: 'oauth-mcp.sentry' }));
      await first;
      expect(store.isBusy(SENTRY)).toBe(false);
    });

    it('clears the previous action error when the next action starts', async () => {
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: false, error: 'denied' }),
      );
      await createLoadedStore();
      await store.connect(SENTRY);
      expect(store.actionError()).toBe('denied');

      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: true, serverKey: 'oauth-mcp.sentry' }),
      );
      await store.connect(SENTRY);

      expect(store.actionError()).toBeNull();
    });

    it('reports a thrown connect with the fixed text and logs the raw error', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
        /* silence the expected log */
      });
      const thrown = new Error('callback server could not bind');
      setResponder('mcpDirectory:connectOAuth', () => {
        throw thrown;
      });
      await createLoadedStore();

      const outcome = await store.connect(SENTRY);

      expect(outcome).toEqual({
        kind: 'failed',
        error: `Failed to connect ${SENTRY.label}`,
      });
      expect(store.actionError()).toBe(`Failed to connect ${SENTRY.label}`);
      expect(warn).toHaveBeenCalledWith(expect.any(String), thrown);
      expect(store.isBusy(SENTRY)).toBe(false);
      warn.mockRestore();
    });
  });

  // ── Thrown exception text stays out of the UI ──────────────────────────────

  describe('thrown exception text', () => {
    const SECRET_URL = 'https://user:secret-token@example.com/mcp';
    const throwSecret = (): never => {
      throw new Error(`${SECRET_URL} failed`);
    };
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {
        /* the raw error is expected on the console only */
      });
    });

    afterEach(() => {
      warn.mockRestore();
    });

    const expectNoLeak = (text: string | null): void => {
      expect(text).not.toBeNull();
      expect(text).not.toContain('secret-token');
      expect(text).not.toContain(SECRET_URL);
      expect(text).not.toContain('example.com');
    };

    it('connectOAuth: actionError and outcome carry only the fixed text', async () => {
      setResponder('mcpDirectory:connectOAuth', throwSecret);
      await createLoadedStore();

      const outcome = await store.connect(SENTRY);

      expectNoLeak(store.actionError());
      expect(store.actionError()).toBe(`Failed to connect ${SENTRY.label}`);
      expect(outcome).toEqual({
        kind: 'failed',
        error: `Failed to connect ${SENTRY.label}`,
      });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('disconnect: actionError carries only the fixed text', async () => {
      setOAuthRecords([SENTRY_RECORD], 'connected');
      setResponder('mcpDirectory:disconnectOAuth', throwSecret);
      await createLoadedStore();

      await store.disconnect(SENTRY);

      expect(callsTo('mcpDirectory:disconnectOAuth')).toHaveLength(1);
      expectNoLeak(store.actionError());
      expect(store.actionError()).toBe(`Failed to disconnect ${SENTRY.label}`);
    });

    it('installSmithery: actionError carries only the fixed text', async () => {
      setResponder('mcpDirectory:installSmithery', throwSecret);
      await createLoadedStore();

      await store.connect(HUBSPOT_SMITHERY);

      expectNoLeak(store.actionError());
      expect(store.actionError()).toBe(
        `Failed to install ${HUBSPOT_SMITHERY.label}`,
      );
    });

    it('openSmitherySetup: actionError carries only the fixed text', async () => {
      setResponder('mcpDirectory:installSmithery', () =>
        ok({
          success: true,
          serverKey: 'smithery_hubspot',
          status: 'auth_required',
        }),
      );
      setResponder('mcpDirectory:openSmitherySetup', throwSecret);
      await createLoadedStore();

      await store.connect(HUBSPOT_SMITHERY);

      expectNoLeak(store.actionError());
      expect(store.actionError()).toBe(
        `Could not open the setup page for ${HUBSPOT_SMITHERY.label}`,
      );
    });

    it('load: loadError carries only the fixed text when both halves throw', async () => {
      setResponder('mcpDirectory:listOAuthConnected', throwSecret);
      setResponder('mcpDirectory:listSmitheryConnections', throwSecret);
      await createLoadedStore();

      expect(store.state()).toBe('error');
      expectNoLeak(store.loadError());
      expect(store.loadError()).toBe('Failed to load connection status');
    });
  });

  // ── Authorize ──────────────────────────────────────────────────────────────

  describe('Authorize', () => {
    it('re-runs connectOAuth against the existing serverKey', async () => {
      setOAuthRecords([SENTRY_RECORD], 'expired');
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: true, serverKey: 'oauth-mcp.sentry' }),
      );
      await createLoadedStore();

      await store.authorize(SENTRY);

      const connect = callsTo('mcpDirectory:connectOAuth');
      expect(connect).toHaveLength(1);
      expect(connect[0].params).toEqual({
        serverUrl: SENTRY.url,
        name: SENTRY.label,
        serverKey: 'oauth-mcp.sentry',
      });
    });

    it('opens a fresh Smithery setup page for an auth_required connection', async () => {
      setSmitheryConnections([hubspotConnection({ status: 'auth_required' })]);
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: true, setupUrl: 'https://smithery.example/setup/def' }),
      );
      await createLoadedStore();

      await store.authorize(HUBSPOT_SMITHERY);

      const opened = callsTo('mcpDirectory:openSmitherySetup');
      expect(opened).toHaveLength(1);
      expect(opened[0].params).toEqual({ serverKey: 'smithery_hubspot' });
    });

    it('explains rather than acts when the connection is not Ptah-managed', async () => {
      setSmitheryConnections([
        hubspotConnection({
          status: 'auth_required',
          managedByPtah: false,
          serverKey: undefined,
        }),
      ]);
      await createLoadedStore();

      await store.authorize(HUBSPOT_SMITHERY);

      expect(callsTo('mcpDirectory:openSmitherySetup')).toHaveLength(0);
      expect(store.actionError()).toContain('outside Ptah');
    });
  });

  // ── Reconnect (installed rows) ─────────────────────────────────────────────

  describe('reconnect an installed row', () => {
    it('re-runs connectOAuth for an oauth row outside the catalogue', async () => {
      setOAuthRecords(
        [
          {
            serverKey: 'oauth-mcp.custom',
            name: 'Custom',
            serverUrl: 'https://custom.example/mcp',
            connectedAt: '2026-09-02T00:00:00.000Z',
          },
        ],
        'expired',
      );
      setResponder('mcpDirectory:connectOAuth', () =>
        ok({ success: true, serverKey: 'oauth-mcp.custom' }),
      );
      await createLoadedStore();

      const outcome = await store.reconnect({
        origin: 'oauth',
        serverKey: 'oauth-mcp.custom',
      });

      expect(outcome).toEqual({ kind: 'done' });
      expect(callsTo('mcpDirectory:connectOAuth')[0].params).toEqual({
        serverUrl: 'https://custom.example/mcp',
        name: 'Custom',
        serverKey: 'oauth-mcp.custom',
      });
    });

    it('shares the busy guard with the catalogue connector for the same server', async () => {
      setOAuthRecords([SENTRY_RECORD], 'expired');
      const pending = deferred<unknown>();
      setResponder('mcpDirectory:connectOAuth', () => pending.promise);
      await createLoadedStore();
      const row = { origin: 'oauth' as const, serverKey: 'oauth-mcp.sentry' };

      const first = store.authorize(SENTRY);
      expect(store.isServerBusy(row)).toBe(true);
      const second = await store.reconnect(row);

      expect(second).toEqual({ kind: 'skipped' });
      expect(callsTo('mcpDirectory:connectOAuth')).toHaveLength(1);

      pending.resolve(ok({ success: true, serverKey: 'oauth-mcp.sentry' }));
      await first;
    });

    it('fails without a call when the oauth row has no record', async () => {
      await createLoadedStore();

      const outcome = await store.reconnect({
        origin: 'oauth',
        serverKey: 'oauth-mcp.gone',
      });

      expect(outcome.kind).toBe('failed');
      expect(callsTo('mcpDirectory:connectOAuth')).toHaveLength(0);
    });

    it('opens the Smithery setup page for a smithery row', async () => {
      setSmitheryConnections([hubspotConnection({ status: 'auth_required' })]);
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: true }),
      );
      await createLoadedStore();

      const outcome = await store.reconnect({
        origin: 'smithery',
        serverKey: 'smithery_hubspot',
      });

      expect(outcome).toEqual({ kind: 'awaiting-setup' });
      expect(callsTo('mcpDirectory:openSmitherySetup')[0].params).toEqual({
        serverKey: 'smithery_hubspot',
      });
      expect(store.isPolling(HUBSPOT_SMITHERY)).toBe(true);
    });

    it('does nothing for an origin with no connection lifecycle', async () => {
      await createLoadedStore();
      const before = calls.length;

      const outcome = await store.reconnect({
        origin: 'harness-config',
        serverKey: 'sentry',
      });

      expect(outcome).toEqual({ kind: 'skipped' });
      expect(calls).toHaveLength(before);
    });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────

  describe('Disconnect', () => {
    it('routes an OAuth connector to disconnectOAuth', async () => {
      setOAuthRecords([SENTRY_RECORD], 'connected');
      setResponder('mcpDirectory:disconnectOAuth', () => ok({ success: true }));
      await createLoadedStore();

      await store.disconnect(SENTRY);

      const disconnect = callsTo('mcpDirectory:disconnectOAuth');
      expect(disconnect).toHaveLength(1);
      expect(disconnect[0].params).toEqual({ serverKey: 'oauth-mcp.sentry' });
    });

    it('routes a Smithery connector to uninstallSmithery', async () => {
      setSmitheryConnections([hubspotConnection()]);
      setResponder('mcpDirectory:uninstallSmithery', () =>
        ok({ success: true }),
      );
      await createLoadedStore();

      await store.disconnect(HUBSPOT_SMITHERY);

      const removed = callsTo('mcpDirectory:uninstallSmithery');
      expect(removed).toHaveLength(1);
      expect(removed[0].params).toEqual({ serverKey: 'smithery_hubspot' });
    });

    it('does nothing for a connector that is not connected', async () => {
      await createLoadedStore();

      const outcome = await store.disconnect(SENTRY);

      expect(outcome).toEqual({ kind: 'skipped' });
      expect(callsTo('mcpDirectory:disconnectOAuth')).toHaveLength(0);
    });
  });

  // ── Setup poll ─────────────────────────────────────────────────────────────

  describe('Smithery setup poll', () => {
    const startAuthorize = async (): Promise<void> => {
      setSmitheryConnections([hubspotConnection({ status: 'auth_required' })]);
      setResponder('mcpDirectory:openSmitherySetup', () =>
        ok({ opened: true, setupUrl: 'https://smithery.example/setup/def' }),
      );
      await createLoadedStore();
      jest.useFakeTimers();
      await store.authorize(HUBSPOT_SMITHERY);
    };

    it('polls every 3 seconds and stops once the connection is connected', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'auth_required' }),
      );
      await startAuthorize();

      expect(store.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(true);
      expect(store.isBusy(HUBSPOT_SMITHERY)).toBe(true);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(3000);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(3000);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(2);

      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'connected' }),
      );
      await jest.advanceTimersByTimeAsync(3000);

      expect(store.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(false);

      const settled = callsTo('mcpDirectory:smitheryConnectionStatus').length;
      await jest.advanceTimersByTimeAsync(30_000);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(
        settled,
      );
    });

    it('re-reads the connection picture when the poll settles', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'connected' }),
      );
      await startAuthorize();
      setSmitheryConnections([hubspotConnection({ status: 'connected' })]);

      await jest.advanceTimersByTimeAsync(3000);

      expect(store.linkOf(HUBSPOT_SMITHERY).status).toBe('connected');
    });

    it('stops on an error status rather than waiting out the deadline', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'error' }),
      );
      await startAuthorize();

      await jest.advanceTimersByTimeAsync(3000);

      expect(store.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(false);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(1);
    });

    it('keeps polling through a transient status failure', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        fail('network'),
      );
      await startAuthorize();

      await jest.advanceTimersByTimeAsync(9000);

      expect(store.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(true);
      expect(
        callsTo('mcpDirectory:smitheryConnectionStatus').length,
      ).toBeGreaterThanOrEqual(3);
    });

    it('keeps polling through a thrown status call', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () => {
        throw new Error('socket closed');
      });
      await startAuthorize();

      await jest.advanceTimersByTimeAsync(6000);

      expect(store.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(true);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(2);
    });

    it('gives up after five minutes', async () => {
      setResponder('mcpDirectory:smitheryConnectionStatus', () =>
        ok({ status: 'auth_required' }),
      );
      await startAuthorize();
      // The deadline is the fake `Date.now()` at poll start + 5 minutes. Jump
      // the fake clock to 1 ms short of the deadline's last tick instead of
      // replaying ~100 ticks: `advanceTimersByTimeAsync` yields one real
      // event-loop turn per fired timer (~15 ms on Windows), which pushed this
      // test toward Jest's 5 s timeout under load. `setSystemTime` keeps the
      // pending tick 3 s ahead of the new clock.
      jest.setSystemTime(Date.now() + 5 * 60 * 1000 - 3000 - 1);

      await jest.advanceTimersByTimeAsync(3000);
      expect(store.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(true);

      await jest.advanceTimersByTimeAsync(3000);

      expect(store.pollingIds().has(HUBSPOT_SMITHERY.id)).toBe(false);
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

      destroyStore();

      await jest.advanceTimersByTimeAsync(30_000);
      expect(callsTo('mcpDirectory:smitheryConnectionStatus')).toHaveLength(
        before,
      );
      expect(store.pollingIds().size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
