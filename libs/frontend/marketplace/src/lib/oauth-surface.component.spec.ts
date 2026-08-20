import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { OAuthSurfaceComponent } from './oauth-surface.component';

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

describe('OAuthSurfaceComponent', () => {
  let fixture: ComponentFixture<OAuthSurfaceComponent>;
  let component: OAuthSurfaceComponent;
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

  const record = (over: Partial<Record<string, string>> = {}) => ({
    serverKey: 'notion',
    name: 'Notion',
    serverUrl: 'https://mcp.notion.com/mcp',
    connectedAt: '2026-07-22T00:00:00.000Z',
    ...over,
  });

  const createComponent = async (): Promise<void> => {
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    // Allow ngOnInit's async list + status resolution to settle.
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();

    TestBed.configureTestingModule({
      imports: [OAuthSurfaceComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  it('loads the connected list and resolves per-server oauth status on mount', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () =>
      ok({ servers: [record()] }),
    );
    setResponder('mcpDirectory:oauthStatus', () => ok({ state: 'connected' }));
    await createComponent();

    expect(methodsCalled()).toContain('mcpDirectory:listOAuthConnected');
    expect(methodsCalled()).toContain('mcpDirectory:oauthStatus');

    const statusCall = calls.find(
      (c) => c.method === 'mcpDirectory:oauthStatus',
    );
    expect(statusCall?.params).toEqual({ serverKey: 'notion' });

    expect(component.displayServers().length).toBe(1);
    expect(component.statusOf('notion')).toBe('connected');
    expect(hostElement.textContent).toContain('Notion');
    expect(hostElement.textContent).toContain('Connected');
  });

  it('renders the empty state when no servers are connected', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    await createComponent();

    expect(component.displayServers().length).toBe(0);
    expect(hostElement.textContent).toContain('No apps connected yet');
    // No status probe when there is nothing to resolve.
    expect(methodsCalled()).not.toContain('mcpDirectory:oauthStatus');
  });

  it('connects a server, reloads the list, and emits serverConnected', async () => {
    let listPage = 0;
    const pages = [ok({ servers: [] }), ok({ servers: [record()] })];
    setResponder('mcpDirectory:listOAuthConnected', () => pages[listPage++]);
    setResponder('mcpDirectory:oauthStatus', () => ok({ state: 'connected' }));
    setResponder('mcpDirectory:connectOAuth', () =>
      ok({ success: true, serverKey: 'notion' }),
    );

    await createComponent();

    let emitted: string | null = null;
    component.serverConnected.subscribe((key) => (emitted = key));

    component.urlInput.set('https://mcp.notion.com/mcp');
    component.nameInput.set('Notion');
    await component.connect(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    const connectCall = calls.find(
      (c) => c.method === 'mcpDirectory:connectOAuth',
    );
    expect(connectCall?.params).toEqual({
      serverUrl: 'https://mcp.notion.com/mcp',
      name: 'Notion',
    });
    expect(emitted).toBe('notion');
    // Form cleared and list reloaded.
    expect(component.urlInput()).toBe('');
    expect(component.displayServers().length).toBe(1);
  });

  it('includes an advanced Client ID in the connectOAuth RPC params', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:oauthStatus', () => ok({ state: 'connected' }));
    setResponder('mcpDirectory:connectOAuth', () =>
      ok({ success: true, serverKey: 'notion' }),
    );
    await createComponent();

    component.urlInput.set('https://mcp.notion.com/mcp');
    component.clientIdInput.set('preregistered-abc');
    await component.connect(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    const connectCall = calls.find(
      (c) => c.method === 'mcpDirectory:connectOAuth',
    );
    expect(connectCall?.params).toEqual({
      serverUrl: 'https://mcp.notion.com/mcp',
      clientId: 'preregistered-abc',
    });
  });

  it('shows an error and does NOT emit when connectOAuth fails', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:connectOAuth', () =>
      ok({ success: false, error: 'authorization denied' }),
    );
    await createComponent();

    let emitted = false;
    component.serverConnected.subscribe(() => (emitted = true));

    component.urlInput.set('https://mcp.notion.com/mcp');
    await component.connect(new Event('submit'));
    fixture.detectChanges();

    expect(component.connectError()).toBe('authorization denied');
    expect(emitted).toBe(false);
    expect(component.isConnecting()).toBe(false);
  });

  it('disconnects a server, reloads the list, and emits serverDisconnected', async () => {
    let listPage = 0;
    const pages = [ok({ servers: [record()] }), ok({ servers: [] })];
    setResponder('mcpDirectory:listOAuthConnected', () => pages[listPage++]);
    setResponder('mcpDirectory:oauthStatus', () => ok({ state: 'connected' }));
    setResponder('mcpDirectory:disconnectOAuth', () => ok({ success: true }));
    await createComponent();

    let emitted: string | null = null;
    component.serverDisconnected.subscribe((key) => (emitted = key));

    await component.disconnect(record());
    await fixture.whenStable();
    fixture.detectChanges();

    const disconnectCall = calls.find(
      (c) => c.method === 'mcpDirectory:disconnectOAuth',
    );
    expect(disconnectCall?.params).toEqual({ serverKey: 'notion' });
    expect(emitted).toBe('notion');
    expect(component.displayServers().length).toBe(0);
  });

  it('reconnects an expired server reusing its existing serverKey', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () =>
      ok({ servers: [record()] }),
    );
    setResponder('mcpDirectory:oauthStatus', () => ok({ state: 'expired' }));
    setResponder('mcpDirectory:connectOAuth', () =>
      ok({ success: true, serverKey: 'notion' }),
    );
    await createComponent();

    let emitted: string | null = null;
    component.serverConnected.subscribe((key) => (emitted = key));

    await component.reconnect(record());
    await fixture.whenStable();
    fixture.detectChanges();

    const reconnectCall = calls.find(
      (c) => c.method === 'mcpDirectory:connectOAuth',
    );
    expect(reconnectCall?.params).toEqual({
      serverUrl: 'https://mcp.notion.com/mcp',
      serverKey: 'notion',
      name: 'Notion',
    });
    expect(emitted).toBe('notion');
  });

  it('reloads the list when refreshTrigger increments above 0', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    await createComponent();

    const before = methodsCalled().filter(
      (m) => m === 'mcpDirectory:listOAuthConnected',
    ).length;

    fixture.componentRef.setInput('refreshTrigger', 1);
    fixture.detectChanges();
    await fixture.whenStable();

    const after = methodsCalled().filter(
      (m) => m === 'mcpDirectory:listOAuthConnected',
    ).length;
    expect(after).toBeGreaterThan(before);
  });

  it('surfaces a sanitized error when the list RPC fails', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => fail('upstream 500'));
    await createComponent();

    expect(component.loadError()).toBe('upstream 500');
    expect(component.displayServers().length).toBe(0);
  });
});
