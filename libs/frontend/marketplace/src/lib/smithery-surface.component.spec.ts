import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { SmitherySurfaceComponent } from './smithery-surface.component';

/**
 * Minimal stand-in for the core `RpcResult` shape consumed by the surface:
 * `isSuccess()`, `.data`, `.error`. Mirrors the real class's truthiness rule
 * (success AND data !== undefined).
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

describe('SmitherySurfaceComponent', () => {
  let fixture: ComponentFixture<SmitherySurfaceComponent>;
  let component: SmitherySurfaceComponent;
  let hostElement: HTMLElement;
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;

  const setResponder = (method: string, factory: () => unknown): void => {
    responders.set(method, factory);
  };

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

  const methodsCalled = (): string[] => calls.map((c) => c.method);

  const createComponent = async (): Promise<void> => {
    fixture = TestBed.createComponent(SmitherySurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    // Allow ngOnInit's async key-status resolution to settle.
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();

    TestBed.configureTestingModule({
      imports: [SmitherySurfaceComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  describe('key not configured', () => {
    beforeEach(() => {
      setResponder('mcpDirectory:getSmitheryKeyStatus', () =>
        ok({ configured: false }),
      );
    });

    it('renders the API-key entry prompt and fires NO browse RPC', async () => {
      await createComponent();

      expect(component.keyStatus()).toBe('not-configured');
      expect(hostElement.querySelector('input[type="password"]')).toBeTruthy();

      const browseMethods = [
        'mcpDirectory:search',
        'mcpDirectory:getDetails',
        'mcpDirectory:resolveSmithery',
      ];
      for (const m of browseMethods) {
        expect(methodsCalled()).not.toContain(m);
      }
    });

    it('saves the key, re-checks status, then browses with an empty smithery search', async () => {
      setResponder('mcpDirectory:setSmitheryApiKey', () =>
        ok({ success: true }),
      );
      setResponder('mcpDirectory:search', () => ok({ servers: [] }));
      await createComponent();

      // After save, status flips to configured.
      responders.set('mcpDirectory:getSmitheryKeyStatus', () =>
        ok({ configured: true }),
      );

      component.keyInput.set('sk-test-key');
      await component.saveKey(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();

      const setCall = calls.find(
        (c) => c.method === 'mcpDirectory:setSmitheryApiKey',
      );
      expect(setCall?.params).toEqual({ apiKey: 'sk-test-key' });
      expect(component.keyStatus()).toBe('configured');

      // The unified browse path drives the popular list via search with q:''.
      const searchCall = calls.find((c) => c.method === 'mcpDirectory:search');
      expect(searchCall?.params).toEqual({ query: '', source: 'smithery' });
    });

    it('surfaces a set-key error in-view', async () => {
      setResponder('mcpDirectory:setSmitheryApiKey', () =>
        ok({ success: false, error: 'invalid key' }),
      );
      await createComponent();

      component.keyInput.set('bad');
      await component.saveKey(new Event('submit'));
      fixture.detectChanges();

      expect(component.keyError()).toBe('invalid key');
      expect(component.keyStatus()).toBe('not-configured');
    });
  });

  describe('key configured', () => {
    beforeEach(() => {
      setResponder('mcpDirectory:getSmitheryKeyStatus', () =>
        ok({ configured: true }),
      );
    });

    it('loads popular Smithery servers on mount via an empty smithery search', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({
          servers: [
            { name: '@owner/server', verified: true, scanPassed: true },
          ],
          nextCursor: undefined,
        }),
      );
      await createComponent();

      const searchCall = calls.find((c) => c.method === 'mcpDirectory:search');
      // Initial browse uses the All category (q:'') — no cursor on page 1.
      expect(searchCall?.params).toEqual({ query: '', source: 'smithery' });
      expect(component.displayServers().length).toBe(1);
      // Trust badges rendered.
      expect(hostElement.textContent).toContain('Verified');
      expect(hostElement.textContent).toContain('Scan passed');
    });

    it('searches with source:smithery (free text resets to page 1)', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/found' }] }),
      );
      await createComponent();

      await component['performSearch']('weather');

      const searchCall = calls.find(
        (c) =>
          c.method === 'mcpDirectory:search' &&
          (c.params as { query?: string }).query === 'weather',
      );
      expect(searchCall?.params).toEqual({
        query: 'weather',
        source: 'smithery',
      });
    });

    it('appends the next page via loadMore using the prior cursor', async () => {
      const pages = [
        ok({ servers: [{ name: '@owner/a' }], nextCursor: 'cur-1' }),
        ok({ servers: [{ name: '@owner/b' }], nextCursor: undefined }),
      ];
      let call = 0;
      setResponder('mcpDirectory:search', () => pages[call++]);
      await createComponent();

      expect(component.servers().length).toBe(1);
      expect(component.nextCursor()).toBe('cur-1');

      await component.loadMore();
      fixture.detectChanges();

      const moreCall = calls.find(
        (c) =>
          c.method === 'mcpDirectory:search' &&
          (c.params as { cursor?: string }).cursor === 'cur-1',
      );
      expect(moreCall?.params).toEqual({
        query: '',
        source: 'smithery',
        cursor: 'cur-1',
      });
      expect(component.servers().map((s) => s.name)).toEqual([
        '@owner/a',
        '@owner/b',
      ]);
      expect(component.nextCursor()).toBeNull();
    });

    it('renders a server logo from icons[0].src', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({
          servers: [
            {
              name: '@owner/with-icon',
              icons: [{ src: 'https://cdn.smithery.ai/logo.png' }],
            },
          ],
        }),
      );
      await createComponent();

      const img = hostElement.querySelector('img');
      expect(img).toBeTruthy();
      expect(img?.getAttribute('src')).toBe('https://cdn.smithery.ai/logo.png');
    });

    it('renders a lettered fallback avatar when a server has no icons', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/exa', displayName: 'Exa' }] }),
      );
      await createComponent();

      expect(hostElement.querySelector('img')).toBeFalsy();
      // First letter of the display name renders as the fallback avatar.
      expect(hostElement.textContent).toContain('E');
    });

    it('renders the config form when a connection carries a configSchema with properties', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/server' }] }),
      );
      setResponder('mcpDirectory:getDetails', () =>
        ok({
          name: '@owner/server',
          connections: [
            {
              type: 'http',
              configSchema: {
                type: 'object',
                required: ['apiKey'],
                properties: {
                  apiKey: { type: 'string', secret: true },
                },
              },
            },
          ],
        }),
      );
      await createComponent();

      await component.toggleInstallPanel({ name: '@owner/server' });
      fixture.detectChanges();

      expect(component.activeConfigSchema()).not.toBeNull();
      expect(hostElement.querySelector('ptah-json-schema-form')).toBeTruthy();
      // Required field unfilled → resolve gated.
      expect(component.canSetup()).toBe(false);
    });

    it('skips the form for an empty / no-required-props configSchema (one-click)', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/simple' }] }),
      );
      setResponder('mcpDirectory:getDetails', () =>
        ok({
          name: '@owner/simple',
          connections: [{ type: 'http', configSchema: { type: 'object' } }],
        }),
      );
      await createComponent();

      await component.toggleInstallPanel({ name: '@owner/simple' });
      fixture.detectChanges();

      expect(component.activeConfigSchema()).toBeNull();
      expect(hostElement.querySelector('ptah-json-schema-form')).toBeFalsy();
      expect(component.canSetup()).toBe(true);
    });

    it('validates then PERSISTS a one-click server via installSmithery', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/simple' }] }),
      );
      setResponder('mcpDirectory:getDetails', () =>
        ok({
          name: '@owner/simple',
          connections: [{ type: 'http' }],
        }),
      );
      setResponder('mcpDirectory:resolveSmithery', () =>
        ok({ config: { type: 'http', url: 'https://server.smithery.ai/mcp' } }),
      );
      setResponder('mcpDirectory:installSmithery', () =>
        ok({ success: true, serverKey: 'smithery_owner_simple' }),
      );
      // Nothing installed on mount; the manifest reports it after install.
      setResponder('mcpDirectory:listSmitheryInstalled', () =>
        ok({ servers: [] }),
      );
      const installedEvents: string[] = [];
      await createComponent();
      component.serverInstalled.subscribe((k) => installedEvents.push(k));
      expect(component.isInstalled('@owner/simple')).toBe(false);

      setResponder('mcpDirectory:listSmitheryInstalled', () =>
        ok({
          servers: [
            {
              source: 'smithery',
              qualifiedName: '@owner/simple',
              serverKey: 'smithery_owner_simple',
              hasEncryptedConfig: false,
              installedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      );

      await component.toggleInstallPanel({ name: '@owner/simple' });
      await component.setupServer({ name: '@owner/simple' });
      fixture.detectChanges();

      // Pre-flight validation ran first...
      const resolveCall = calls.find(
        (c) => c.method === 'mcpDirectory:resolveSmithery',
      );
      expect(resolveCall?.params).toEqual({
        qualifiedName: '@owner/simple',
        config: {},
      });
      // ...then the real persistence path.
      const installCall = calls.find(
        (c) => c.method === 'mcpDirectory:installSmithery',
      );
      expect(installCall?.params).toEqual({
        qualifiedName: '@owner/simple',
        config: {},
      });
      expect(
        calls.findIndex((c) => c.method === 'mcpDirectory:resolveSmithery'),
      ).toBeLessThan(
        calls.findIndex((c) => c.method === 'mcpDirectory:installSmithery'),
      );

      expect(component.isInstalled('@owner/simple')).toBe(true);
      expect(component.serverKeyOf('@owner/simple')).toBe(
        'smithery_owner_simple',
      );
      expect(installedEvents).toEqual(['smithery_owner_simple']);
      expect(component.setupPhase()).toBe('idle');
      expect(hostElement.textContent).toContain(
        'Installed — available in new chat sessions.',
      );
    });

    it('forwards the collected config to installSmithery', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/keyed' }] }),
      );
      setResponder('mcpDirectory:getDetails', () =>
        ok({
          name: '@owner/keyed',
          connections: [
            {
              type: 'http',
              configSchema: {
                type: 'object',
                required: ['apiKey'],
                properties: { apiKey: { type: 'string' } },
              },
            },
          ],
        }),
      );
      setResponder('mcpDirectory:resolveSmithery', () =>
        ok({ config: { type: 'http', url: 'https://server.smithery.ai/mcp' } }),
      );
      setResponder('mcpDirectory:installSmithery', () =>
        ok({ success: true, serverKey: 'smithery_owner_keyed' }),
      );
      setResponder('mcpDirectory:listSmitheryInstalled', () =>
        ok({ servers: [] }),
      );
      await createComponent();

      await component.toggleInstallPanel({ name: '@owner/keyed' });
      component.configValue.set({ apiKey: 'sk-server-key' });
      component.configValid.set(true);
      await component.setupServer({ name: '@owner/keyed' });

      const installCall = calls.find(
        (c) => c.method === 'mcpDirectory:installSmithery',
      );
      expect(installCall?.params).toEqual({
        qualifiedName: '@owner/keyed',
        config: { apiKey: 'sk-server-key' },
      });
    });

    it('surfaces a validation error and NEVER calls installSmithery', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/simple' }] }),
      );
      setResponder('mcpDirectory:getDetails', () =>
        ok({ name: '@owner/simple', connections: [{ type: 'http' }] }),
      );
      setResponder('mcpDirectory:resolveSmithery', () =>
        ok({ error: 'missing api key' }),
      );
      await createComponent();

      await component.toggleInstallPanel({ name: '@owner/simple' });
      await component.setupServer({ name: '@owner/simple' });
      fixture.detectChanges();

      expect(component.setupError()).toBe('missing api key');
      expect(methodsCalled()).not.toContain('mcpDirectory:installSmithery');
      expect(component.isInstalled('@owner/simple')).toBe(false);
      expect(component.setupPhase()).toBe('idle');
    });

    it('surfaces an install failure in-view and stays uninstalled', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/simple' }] }),
      );
      setResponder('mcpDirectory:getDetails', () =>
        ok({ name: '@owner/simple', connections: [{ type: 'http' }] }),
      );
      setResponder('mcpDirectory:resolveSmithery', () =>
        ok({ config: { type: 'http', url: 'https://server.smithery.ai/mcp' } }),
      );
      setResponder('mcpDirectory:installSmithery', () =>
        ok({ success: false, error: 'disk full' }),
      );
      await createComponent();

      await component.toggleInstallPanel({ name: '@owner/simple' });
      await component.setupServer({ name: '@owner/simple' });
      fixture.detectChanges();

      expect(component.setupError()).toBe('disk full');
      expect(component.isInstalled('@owner/simple')).toBe(false);
      expect(hostElement.textContent).not.toContain(
        'Installed — available in new chat sessions.',
      );
    });

    it('reflects manifest-installed servers on mount', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/simple' }] }),
      );
      setResponder('mcpDirectory:listSmitheryInstalled', () =>
        ok({
          servers: [
            {
              source: 'smithery',
              qualifiedName: '@owner/simple',
              serverKey: 'smithery_owner_simple',
              hasEncryptedConfig: true,
              installedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      );
      await createComponent();

      expect(component.isInstalled('@owner/simple')).toBe(true);
      expect(hostElement.textContent).toContain('Installed');
      expect(hostElement.textContent).toContain('Remove');
    });

    it('uninstalls by serverKey and clears the installed badge', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/simple' }] }),
      );
      setResponder('mcpDirectory:listSmitheryInstalled', () =>
        ok({
          servers: [
            {
              source: 'smithery',
              qualifiedName: '@owner/simple',
              serverKey: 'smithery_owner_simple',
              hasEncryptedConfig: true,
              installedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      );
      setResponder('mcpDirectory:uninstallSmithery', () =>
        ok({ success: true }),
      );
      const removedEvents: string[] = [];
      await createComponent();
      component.serverUninstalled.subscribe((k) => removedEvents.push(k));

      await component.uninstall({ name: '@owner/simple' });
      fixture.detectChanges();

      const uninstallCall = calls.find(
        (c) => c.method === 'mcpDirectory:uninstallSmithery',
      );
      expect(uninstallCall?.params).toEqual({
        serverKey: 'smithery_owner_simple',
      });
      expect(component.isInstalled('@owner/simple')).toBe(false);
      expect(removedEvents).toEqual(['smithery_owner_simple']);
    });

    it('keeps browsing usable when the installed manifest read fails', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/simple' }] }),
      );
      setResponder('mcpDirectory:listSmitheryInstalled', () =>
        fail('manifest unreadable'),
      );
      await createComponent();

      expect(component.displayServers().length).toBe(1);
      expect(component.installedByName().size).toBe(0);
      expect(component.browseError()).toBeNull();
    });

    it('surfaces a getDetails RPC failure in-view', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/server' }] }),
      );
      setResponder('mcpDirectory:getDetails', () => fail('upstream 429'));
      await createComponent();

      await component.toggleInstallPanel({ name: '@owner/server' });
      fixture.detectChanges();

      expect(component.detailError()).toBe('upstream 429');
    });
  });

  /**
   * Account row + Connections list (TASK_2026_375 B3.2).
   *
   * The user's complaint that started the task was that Smithery showed a
   * server as "Installed" while the session reported it as `needs-auth`, with
   * no way to see which account was in use. These cases pin the two answers:
   * the namespace is named, and the installed badge reports the CONNECTION.
   */
  describe('account + connections', () => {
    beforeEach(() => {
      setResponder('mcpDirectory:getSmitheryKeyStatus', () =>
        ok({ configured: true }),
      );
      setResponder('mcpDirectory:search', () => ok({ servers: [] }));
      setResponder('mcpDirectory:listSmitheryInstalled', () =>
        ok({ servers: [] }),
      );
      setResponder('mcpDirectory:smitheryAccount', () =>
        ok({ configured: true, namespaces: ['acme'], activeNamespace: 'acme' }),
      );
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({ connections: [], namespace: 'acme' }),
      );
    });

    it('names the active namespace in the Account row', async () => {
      await createComponent();

      expect(component.activeNamespace()).toBe('acme');
      expect(hostElement.textContent).toContain('Smithery account');
      expect(hostElement.textContent).toContain('acme');
    });

    it('says how many namespaces the key reaches when there is more than one', async () => {
      setResponder('mcpDirectory:smitheryAccount', () =>
        ok({
          configured: true,
          namespaces: ['acme', 'beta'],
          activeNamespace: 'acme',
        }),
      );
      await createComponent();

      expect(hostElement.textContent).toContain('2 namespaces');
    });

    it('reports an account read failure without blanking the browse list', async () => {
      setResponder('mcpDirectory:smitheryAccount', () =>
        ok({
          configured: true,
          namespaces: [],
          activeNamespace: null,
          error: 'key revoked',
        }),
      );
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/simple' }] }),
      );
      await createComponent();

      expect(component.accountError()).toBe('key revoked');
      expect(component.displayServers().length).toBe(1);
      expect(component.browseError()).toBeNull();
    });

    it('reveals the API-key form from the Account row and hides it again', async () => {
      await createComponent();

      expect(component.showKeyForm()).toBe(false);
      expect(hostElement.querySelector('input[type="password"]')).toBeNull();

      component.toggleKeyForm();
      fixture.detectChanges();
      expect(hostElement.querySelector('input[type="password"]')).toBeTruthy();

      component.toggleKeyForm();
      fixture.detectChanges();
      expect(hostElement.querySelector('input[type="password"]')).toBeNull();
    });

    it('lists connections with a status badge and a Ptah-managed marker', async () => {
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
            {
              connectionId: 'other',
              name: 'Someone else',
              server: 'other',
              status: 'connected',
              managedByPtah: false,
            },
          ],
          namespace: 'acme',
        }),
      );
      await createComponent();

      expect(component.connections()).toHaveLength(2);
      expect(hostElement.textContent).toContain('Connections');
      expect(hostElement.textContent).toContain('Needs authorization');
      expect(hostElement.textContent).toContain('Managed by Ptah');
    });

    it('authorizes a connection through openSmitherySetup and re-reads the list', async () => {
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
        ok({ opened: true, setupUrl: 'https://smithery.example/setup/abc' }),
      );
      await createComponent();
      const before = calls.filter(
        (c) => c.method === 'mcpDirectory:listSmitheryConnections',
      ).length;

      await component.authorizeConnection(component.connections()[0]);

      const opened = calls.filter(
        (c) => c.method === 'mcpDirectory:openSmitherySetup',
      );
      expect(opened).toHaveLength(1);
      expect(opened[0].params).toEqual({ serverKey: 'smithery_hubspot' });
      expect(
        calls.filter((c) => c.method === 'mcpDirectory:listSmitheryConnections')
          .length,
      ).toBeGreaterThan(before);
      expect(component.connectionsError()).toBeNull();
    });

    it('surfaces a failed setup open in-view', async () => {
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
        ok({ opened: false, error: 'no browser' }),
      );
      await createComponent();

      await component.authorizeConnection(component.connections()[0]);

      expect(component.connectionsError()).toBe('no browser');
    });

    it('removes a Ptah-managed connection through uninstallSmithery', async () => {
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
      const removedEvents: string[] = [];
      component.serverUninstalled.subscribe((k) => removedEvents.push(k));

      await component.removeConnection(component.connections()[0]);

      const removed = calls.filter(
        (c) => c.method === 'mcpDirectory:uninstallSmithery',
      );
      expect(removed).toHaveLength(1);
      expect(removed[0].params).toEqual({ serverKey: 'smithery_hubspot' });
      expect(removedEvents).toEqual(['smithery_hubspot']);
    });

    it('never offers Authorize or Remove for a connection Ptah does not manage', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        ok({
          connections: [
            {
              connectionId: 'other',
              name: 'Someone else',
              server: 'other',
              status: 'auth_required',
              managedByPtah: false,
            },
          ],
          namespace: 'acme',
        }),
      );
      await createComponent();

      await component.authorizeConnection(component.connections()[0]);
      await component.removeConnection(component.connections()[0]);

      expect(
        calls.filter((c) => c.method === 'mcpDirectory:openSmitherySetup'),
      ).toHaveLength(0);
      expect(
        calls.filter((c) => c.method === 'mcpDirectory:uninstallSmithery'),
      ).toHaveLength(0);
    });

    it('renders a connection-list failure without failing the surface', async () => {
      setResponder('mcpDirectory:listSmitheryConnections', () =>
        fail('smithery unreachable'),
      );
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/simple' }] }),
      );
      await createComponent();

      expect(component.connectionsError()).toBe('smithery unreachable');
      expect(component.displayServers().length).toBe(1);
      expect(component.browseError()).toBeNull();
    });

    it('badges an installed card by its CONNECTION status, not the manifest', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: 'hubspot' }] }),
      );
      setResponder('mcpDirectory:listSmitheryInstalled', () =>
        ok({
          servers: [
            { qualifiedName: 'hubspot', serverKey: 'smithery_hubspot' },
          ],
        }),
      );
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

      expect(component.isInstalled('hubspot')).toBe(true);
      expect(component.installedBadge('hubspot')).toBe('needs-auth');
    });

    it('falls back to the Installed badge for a legacy record with no connection', async () => {
      setResponder('mcpDirectory:search', () =>
        ok({ servers: [{ name: '@owner/legacy' }] }),
      );
      setResponder('mcpDirectory:listSmitheryInstalled', () =>
        ok({
          servers: [
            {
              qualifiedName: '@owner/legacy',
              serverKey: 'smithery_owner_legacy',
            },
          ],
        }),
      );
      await createComponent();

      expect(component.connectionStatusOf('@owner/legacy')).toBeNull();
      expect(component.installedBadge('@owner/legacy')).toBe('installed');
    });
  });
});
