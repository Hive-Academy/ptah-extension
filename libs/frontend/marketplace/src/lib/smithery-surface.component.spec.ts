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
      expect(component.canResolve()).toBe(false);
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
      expect(component.canResolve()).toBe(true);
    });

    it('resolves a one-click server with empty config and marks it ready', async () => {
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
      await createComponent();

      await component.toggleInstallPanel({ name: '@owner/simple' });
      await component.resolve({ name: '@owner/simple' });
      fixture.detectChanges();

      const resolveCall = calls.find(
        (c) => c.method === 'mcpDirectory:resolveSmithery',
      );
      expect(resolveCall?.params).toEqual({
        qualifiedName: '@owner/simple',
        config: {},
      });
      expect(component.resolvedNames().has('@owner/simple')).toBe(true);
    });

    it('surfaces a resolve error in-view', async () => {
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
      await component.resolve({ name: '@owner/simple' });
      fixture.detectChanges();

      expect(component.resolveError()).toBe('missing api key');
      expect(component.resolvedNames().has('@owner/simple')).toBe(false);
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
});
