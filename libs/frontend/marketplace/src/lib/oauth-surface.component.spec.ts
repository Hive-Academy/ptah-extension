import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
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

  /** The loopback redirect URL the Electron/CLI host reports (TASK_2026_373). */
  const REDIRECT_URI = 'http://127.0.0.1:41739/callback';

  const redirectUriField = (): HTMLInputElement | null =>
    hostElement.querySelector('input[aria-label="Redirect URL"]');

  const copyButton = (): HTMLButtonElement | null =>
    hostElement.querySelector('button[aria-label="Copy redirect URL"]');

  const advancedDetails = (): HTMLDetailsElement =>
    hostElement.querySelector('details') as HTMLDetailsElement;

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();

    // Every mount reads the host redirect URL; individual tests override it.
    setResponder('mcpDirectory:getOAuthRedirectUri', () =>
      ok({ redirectUri: REDIRECT_URI }),
    );

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

  // ── Advisory OAuth-discovery probe (TASK_2026_367 C3) ──────────────────────

  const API_KEY_NOTE =
    'This server does not publish OAuth discovery metadata. ' +
    'It probably needs an API key instead. ' +
    "Check the server's documentation.";

  /** Feed the URL field one character at a time, as a user would. */
  const typeUrl = (url: string): void => {
    for (let i = 1; i <= url.length; i++) {
      component.onUrlInput({
        target: { value: url.slice(0, i) },
      } as unknown as Event);
    }
  };

  const probeCallCount = (): number =>
    calls.filter((c) => c.method === 'mcpDirectory:probeOAuthDiscovery').length;

  it('debounces typing into exactly one probe call', fakeAsync(() => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:probeOAuthDiscovery', () =>
      ok({ supported: true }),
    );
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    tick();

    typeUrl('https://mcp.firecrawl.dev');
    // Still inside the quiet period: nothing has gone out yet.
    tick(399);
    expect(probeCallCount()).toBe(0);

    tick(1);
    expect(probeCallCount()).toBe(1);

    const probeCall = calls.find(
      (c) => c.method === 'mcpDirectory:probeOAuthDiscovery',
    );
    expect(probeCall?.params).toEqual({
      serverUrl: 'https://mcp.firecrawl.dev',
    });
  }));

  it('issues no probe for a string that is not an absolute https URL', fakeAsync(() => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    tick();

    typeUrl('firecrawl');
    tick(1000);

    expect(probeCallCount()).toBe(0);
    expect(component.discoveryHint()).toBe('none');
  }));

  it('renders the API-key hint when the probe reports no-oauth-discovery', fakeAsync(() => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:probeOAuthDiscovery', () =>
      ok({ supported: false, reason: 'no-oauth-discovery' }),
    );
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    tick();

    typeUrl('https://mcp.firecrawl.dev');
    tick(400);
    fixture.detectChanges();

    expect(component.discoveryHint()).toBe('needs-api-key');
    expect(hostElement.textContent).toContain(API_KEY_NOTE);
    // Advisory only — Connect stays enabled.
    const submit = hostElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  }));

  it('stays silent when the probe fails or reports another reason', fakeAsync(() => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:probeOAuthDiscovery', () =>
      fail('probe transport failure'),
    );
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    tick();

    typeUrl('https://mcp.firecrawl.dev');
    tick(400);
    fixture.detectChanges();

    expect(component.discoveryHint()).toBe('none');
    expect(component.connectError()).toBeNull();
    expect(hostElement.textContent).not.toContain(API_KEY_NOTE);
  }));

  it('discards a probe result whose URL is no longer in the field', fakeAsync(() => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    // A slow probe, so the URL can change while the call is in flight.
    setResponder(
      'mcpDirectory:probeOAuthDiscovery',
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(ok({ supported: false, reason: 'no-oauth-discovery' })),
            100,
          ),
        ),
    );
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    tick();

    typeUrl('https://mcp.firecrawl.dev');
    tick(400);
    expect(probeCallCount()).toBe(1);

    // The user moved on before the answer arrived.
    component.urlInput.set('https://mcp.notion.com/mcp');
    tick(100);

    expect(component.discoveryHint()).not.toBe('needs-api-key');
  }));

  it('shows the API-key hint instead of the raw error when connect fails with no-oauth-discovery', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:connectOAuth', () =>
      ok({
        success: false,
        error:
          'No OAuth authorization-server metadata found for https://mcp.firecrawl.dev.',
        reason: 'no-oauth-discovery',
      }),
    );
    await createComponent();

    component.urlInput.set('https://mcp.firecrawl.dev');
    await component.connect(new Event('submit'));
    fixture.detectChanges();

    expect(component.connectError()).toBe(API_KEY_NOTE);
    expect(hostElement.textContent).not.toContain(
      'No OAuth authorization-server metadata found',
    );
  });

  it('still shows the raw error when connect fails for another reason', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:connectOAuth', () =>
      ok({ success: false, error: 'authorization denied', reason: 'other' }),
    );
    await createComponent();

    component.urlInput.set('https://mcp.notion.com/mcp');
    await component.connect(new Event('submit'));
    fixture.detectChanges();

    expect(component.connectError()).toBe('authorization denied');
  });

  // ── Pre-registered OAuth clients (TASK_2026_373) ───────────────────────────

  const CLIENT_APP_NOTE =
    'This server does not register apps automatically. ' +
    'Create an app with the provider, register the redirect URL from Advanced, ' +
    'then enter the client ID and secret below.';

  it('loads the host redirect URL on init and renders it read-only in Advanced', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    await createComponent();

    const redirectCall = calls.find(
      (c) => c.method === 'mcpDirectory:getOAuthRedirectUri',
    );
    expect(redirectCall?.params).toEqual({});
    expect(component.redirectUri()).toBe(REDIRECT_URI);

    const field = redirectUriField();
    expect(field).not.toBeNull();
    expect(field?.value).toBe(REDIRECT_URI);
    expect(field?.readOnly).toBe(true);
    expect(hostElement.textContent).toContain(
      'Redirect URL — register this with the provider',
    );
    expect(copyButton()).not.toBeNull();
  });

  it('renders no redirect row when the host reports a null redirect URL', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:getOAuthRedirectUri', () =>
      ok({ redirectUri: null, error: 'No interactive host' }),
    );
    await createComponent();

    expect(component.redirectUri()).toBeNull();
    expect(redirectUriField()).toBeNull();
    expect(copyButton()).toBeNull();
    // The failure is silent — it must not surface as a load or connect error.
    expect(component.loadError()).toBeNull();
    expect(component.connectError()).toBeNull();
  });

  it('copies the redirect URL to the clipboard and confirms for a moment', fakeAsync(() => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));

    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    copyButton()?.click();
    tick();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith(REDIRECT_URI);
    expect(component.copied()).toBe(true);

    // The tick reverts on its own.
    tick(1500);
    fixture.detectChanges();
    expect(component.copied()).toBe(false);
  }));

  it('falls back to selecting the field when the clipboard write rejects', fakeAsync(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn(() => Promise.reject(new Error('denied'))) },
      configurable: true,
    });
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));

    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const field = redirectUriField() as HTMLInputElement;
    const select = jest.spyOn(field, 'select');

    copyButton()?.click();
    tick();
    fixture.detectChanges();

    expect(select).toHaveBeenCalled();
    expect(component.copied()).toBe(false);
  }));

  it('opens Advanced and explains the setup when the probe reports no dynamic registration', fakeAsync(() => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:probeOAuthDiscovery', () =>
      ok({ supported: true, dynamicRegistration: false }),
    );
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    tick();

    typeUrl('https://mcp.hubspot.com');
    tick(400);
    fixture.detectChanges();

    expect(component.discoveryHint()).toBe('needs-client-app');
    expect(component.advancedOpen()).toBe(true);
    expect(advancedDetails().open).toBe(true);
    expect(hostElement.textContent).toContain(CLIENT_APP_NOTE);
    // Advisory only — Connect stays enabled, as for the API-key hint.
    const submit = hostElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  }));

  it('leaves Advanced closed when the probe reports dynamic registration', fakeAsync(() => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:probeOAuthDiscovery', () =>
      ok({ supported: true, dynamicRegistration: true }),
    );
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    tick();

    typeUrl('https://mcp.notion.com/mcp');
    tick(400);
    fixture.detectChanges();

    expect(component.discoveryHint()).toBe('none');
    expect(component.advancedOpen()).toBe(false);
    expect(hostElement.textContent).not.toContain(CLIENT_APP_NOTE);
  }));

  it('opens Advanced immediately when the HubSpot chip is picked, before any probe', fakeAsync(() => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const chip = Array.from(
      hostElement.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
    ).find((b) => b.textContent?.trim() === 'HubSpot');
    expect(chip).toBeDefined();

    chip?.click();
    fixture.detectChanges();

    expect(component.urlInput()).toBe('https://mcp.hubspot.com');
    expect(component.advancedOpen()).toBe(true);
    expect(advancedDetails().open).toBe(true);
    // No round trip was needed to get here.
    expect(probeCallCount()).toBe(0);

    // Drain the debounced probe so fakeAsync has no pending timer.
    setResponder('mcpDirectory:probeOAuthDiscovery', () =>
      ok({ supported: true, dynamicRegistration: false }),
    );
    tick(400);
  }));

  it('closes Advanced again after a successful connect', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('mcpDirectory:connectOAuth', () =>
      ok({ success: true, serverKey: 'hubspot' }),
    );
    await createComponent();

    component.advancedOpen.set(true);
    component.urlInput.set('https://mcp.hubspot.com');
    component.clientIdInput.set('app-123');
    component.clientSecretInput.set('shh');
    await component.connect(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.advancedOpen()).toBe(false);
    expect(component.clientIdInput()).toBe('');
    expect(component.clientSecretInput()).toBe('');
  });

  it('mirrors a user toggle of the Advanced disclosure back into the signal', async () => {
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    await createComponent();

    const details = advancedDetails();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    expect(component.advancedOpen()).toBe(true);

    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    expect(component.advancedOpen()).toBe(false);
  });
});
