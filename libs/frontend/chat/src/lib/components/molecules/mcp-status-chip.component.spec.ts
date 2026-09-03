/**
 * McpStatusChipComponent specs (TASK_2026_375 B4.4).
 *
 * Coverage:
 *  - The chip hides itself when the session reported nothing, and appears the
 *    moment a record exists. That is the whole visible half of the defect.
 *  - The recovery read: a cold-loaded webview missed the one push this session
 *    sends, so `session:status` is what refills the chip — once per session.
 *  - Authorize routing per key. `smithery` must NOT call an RPC: a
 *    Connections-API install is ONE session server backed by several
 *    connections in different states, so the Marketplace Smithery surface is
 *    the only place that can act (B2/B3 notes).
 *  - The claude.ai notice is INFORMATION, not an error, and names the provider
 *    the session actually runs on.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import { PTAH_CONNECTORS } from '@ptah-extension/shared';
import { McpStatusChipComponent } from './mcp-status-chip.component';

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

interface RpcCall {
  method: string;
  params: unknown;
}

const SENTRY = PTAH_CONNECTORS.find((c) => c.id === 'sentry');
if (!SENTRY?.url) throw new Error("Catalog entry 'sentry' is missing its url");

const SENTRY_KEY = 'oauth-mcp.sentry.dev-mcp';
const NOTICE = {
  code: 'claude-ai-connectors-disabled' as const,
  message: 'claude.ai connectors are disabled because ANTHROPIC_API_KEY …',
};

describe('McpStatusChipComponent', () => {
  let fixture: ComponentFixture<McpStatusChipComponent>;
  let component: McpStatusChipComponent;
  let hostElement: HTMLElement;
  let registry: SessionMcpStatusRegistry;
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
      if (!factory) return Promise.resolve(fail(`No responder for ${method}`));
      return Promise.resolve(factory());
    }),
  };

  const appStateMock = {
    setCurrentView: jest.fn(),
    setMarketplaceActiveProvider: jest.fn(),
  };

  const createComponent = async (
    inputs: { sessionId?: string | null; tabId?: string | null } = {},
  ): Promise<void> => {
    fixture = TestBed.createComponent(McpStatusChipComponent);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('sessionId', inputs.sessionId ?? null);
    fixture.componentRef.setInput('tabId', inputs.tabId ?? null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Open the popover and let its two lazy loads settle. */
  const openPopover = async (): Promise<void> => {
    component.toggle();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    appStateMock.setCurrentView.mockClear();
    appStateMock.setMarketplaceActiveProvider.mockClear();
    setResponder('mcpDirectory:listOAuthConnected', () => ok({ servers: [] }));
    setResponder('session:status', () =>
      ok({ isActive: true, isStreaming: false }),
    );
    setResponder('auth:getAuthStatus', () =>
      ok({
        hasApiKey: false,
        hasOpenRouterKey: false,
        authMethod: 'apiKey',
        anthropicProviderId: 'openai-codex',
        availableProviders: [
          { id: 'openai-codex', name: 'OpenAI Codex' },
          { id: 'openrouter', name: 'OpenRouter' },
        ],
      }),
    );

    TestBed.configureTestingModule({
      imports: [McpStatusChipComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: AppStateManager, useValue: appStateMock },
      ],
    });
    registry = TestBed.inject(SessionMcpStatusRegistry);
  });

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('renders nothing when the session reported no servers and no notice', async () => {
    await createComponent({ sessionId: 's1' });

    expect(hostElement.textContent?.trim()).toBe('');
  });

  it('renders the chip once a record exists', async () => {
    registry.record('s1', {
      servers: [{ name: 'smithery', status: 'connected' }],
      notices: [],
    });
    await createComponent({ sessionId: 's1' });

    expect(hostElement.textContent).toContain('MCP');
    expect(component.chipLabel()).toBe('1');
  });

  it('reads the record under the tabId until the SDK id has one', async () => {
    registry.record('tab-1', {
      servers: [{ name: 'smithery', status: 'connected' }],
      notices: [],
    });
    await createComponent({ sessionId: 'real-1', tabId: 'tab-1' });

    expect(component.rows()).toHaveLength(1);
  });

  it('shows connected/total and warns when a server needs attention', async () => {
    registry.record('s1', {
      servers: [
        { name: 'a', status: 'connected' },
        { name: 'smithery', status: 'needs-auth' },
      ],
      notices: [],
    });
    await createComponent({ sessionId: 's1' });

    expect(component.chipLabel()).toBe('1/2');
    expect(component.chipClasses()).toContain('warning');
    expect(component.chipTitle()).toContain('1 MCP server(s) need attention');
  });

  it('treats failed as actionable — the next move is the same as needs-auth', async () => {
    registry.record('s1', {
      servers: [{ name: 'smithery', status: 'failed' }],
      notices: [],
    });
    await createComponent({ sessionId: 's1' });

    expect(component.rows()[0]?.needsAction).toBe(true);
  });

  it.each([
    ['connected', false],
    ['pending', false],
    ['disabled', false],
    ['reconnecting', false],
    ['needs-auth', true],
    ['failed', true],
  ])('status %s → needsAction %s', async (status, expected) => {
    registry.record('s1', {
      servers: [{ name: 'x', status }],
      notices: [],
    });
    await createComponent({ sessionId: 's1' });

    expect(component.rows()[0]?.needsAction).toBe(expected);
  });

  it('shows an unknown status verbatim — the value set belongs to the CLI', async () => {
    registry.record('s1', {
      servers: [{ name: 'x', status: 'reconnecting' }],
      notices: [],
    });
    await createComponent({ sessionId: 's1' });

    expect(component.rows()[0]?.statusLabel).toBe('reconnecting');
  });

  // ── Recovery read ──────────────────────────────────────────────────────────

  describe('session:status recovery', () => {
    it('reads session:status when nothing is recorded for the session', async () => {
      setResponder('session:status', () =>
        ok({
          isActive: true,
          isStreaming: false,
          mcpServers: [{ name: 'smithery', status: 'needs-auth' }],
          notices: [],
        }),
      );
      await createComponent({ sessionId: 's1' });

      expect(callsTo('session:status')[0]?.params).toEqual({
        sessionId: 's1',
      });
      expect(component.rows()).toHaveLength(1);
    });

    it('does NOT read when a record already exists', async () => {
      registry.record('s1', {
        servers: [{ name: 'a', status: 'connected' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });

      expect(callsTo('session:status')).toHaveLength(0);
    });

    it('records nothing when the backend has nothing — absent is not empty', async () => {
      // Writing an empty record here would hide the chip on a session whose
      // init message simply has not arrived yet.
      await createComponent({ sessionId: 's1' });

      expect(registry.peek('s1')).toBeNull();
    });

    it('reads at most once per session id', async () => {
      await createComponent({ sessionId: 's1' });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(callsTo('session:status')).toHaveLength(1);
    });
  });

  // ── Authorize routing ──────────────────────────────────────────────────────

  describe('Authorize routing', () => {
    it('routes the `smithery` key to the Marketplace Smithery surface, with NO RPC', async () => {
      // One namespace endpoint holds several connections in different states,
      // so there is no single connection for this chip to authorize.
      registry.record('s1', {
        servers: [{ name: 'smithery', status: 'needs-auth' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });

      await component.authorize(component.rows()[0]);

      expect(appStateMock.setMarketplaceActiveProvider).toHaveBeenCalledWith(
        'smithery',
      );
      expect(appStateMock.setCurrentView).toHaveBeenCalledWith('marketplace');
      expect(callsTo('mcpDirectory:openSmitherySetup')).toHaveLength(0);
      expect(callsTo('mcpDirectory:connectOAuth')).toHaveLength(0);
    });

    it("routes an `oauth-` key to connectOAuth with the record's serverUrl", async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({
          servers: [
            {
              serverKey: SENTRY_KEY,
              name: 'Sentry',
              serverUrl: SENTRY.url,
              connectedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }),
      );
      setResponder('mcpDirectory:connectOAuth', () => ok({ success: true }));
      registry.record('s1', {
        servers: [{ name: SENTRY_KEY, status: 'needs-auth' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });
      await openPopover();

      await component.authorize(component.rows()[0]);

      expect(callsTo('mcpDirectory:connectOAuth')[0]?.params).toEqual({
        serverUrl: SENTRY.url,
        serverKey: SENTRY_KEY,
        name: 'Sentry',
      });
      expect(appStateMock.setCurrentView).not.toHaveBeenCalled();
    });

    it('falls back to Connectors when an `oauth-` key has no manifest record', async () => {
      registry.record('s1', {
        servers: [{ name: 'oauth-unknown-server', status: 'needs-auth' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });
      await openPopover();

      await component.authorize(component.rows()[0]);

      expect(callsTo('mcpDirectory:connectOAuth')).toHaveLength(0);
      expect(appStateMock.setMarketplaceActiveProvider).toHaveBeenCalledWith(
        'connectors',
      );
    });

    it('routes any other key to the Connectors surface', async () => {
      registry.record('s1', {
        servers: [{ name: 'some-local-server', status: 'failed' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });

      await component.authorize(component.rows()[0]);

      expect(appStateMock.setMarketplaceActiveProvider).toHaveBeenCalledWith(
        'connectors',
      );
      expect(appStateMock.setCurrentView).toHaveBeenCalledWith('marketplace');
    });

    it('closes the popover on any Authorize route', async () => {
      registry.record('s1', {
        servers: [{ name: 'smithery', status: 'needs-auth' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });
      await openPopover();
      expect(component.isOpen()).toBe(true);

      await component.authorize(component.rows()[0]);

      expect(component.isOpen()).toBe(false);
    });
  });

  // ── Labels ─────────────────────────────────────────────────────────────────

  describe('row labels', () => {
    it('names the namespace server Smithery and explains how it signs in', async () => {
      registry.record('s1', {
        servers: [{ name: 'smithery', status: 'connected' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });

      expect(component.rows()[0]?.label).toBe('Smithery');
      expect(component.rows()[0]?.hint).toBe('Managed by Smithery');
    });

    it('matches the catalog through the record serverUrl, not the key text', async () => {
      setResponder('mcpDirectory:listOAuthConnected', () =>
        ok({
          servers: [
            {
              serverKey: SENTRY_KEY,
              name: '',
              // Trailing slash and upper-case host: the normalizer handles both.
              serverUrl: `${SENTRY.url}/`.replace('https://', 'https://'),
              connectedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }),
      );
      registry.record('s1', {
        servers: [{ name: SENTRY_KEY, status: 'connected' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });
      await openPopover();

      expect(component.rows()[0]?.label).toBe(SENTRY.label);
      expect(component.rows()[0]?.hint).toBe('Signs in with your browser');
    });

    it('falls back to the raw key when nothing names the server', async () => {
      registry.record('s1', {
        servers: [{ name: 'oauth-mystery', status: 'connected' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });

      expect(component.rows()[0]?.label).toBe('oauth-mystery');
      expect(component.rows()[0]?.hint).toBeNull();
    });
  });

  // ── claude.ai notice ───────────────────────────────────────────────────────

  describe('claude.ai connectors notice', () => {
    it('renders the chip on a notice alone, with no servers', async () => {
      registry.record('s1', { servers: [], notices: [NOTICE] });
      await createComponent({ sessionId: 's1' });

      expect(hostElement.textContent).toContain('MCP');
      expect(component.rows()).toHaveLength(0);
    });

    it('words the row as information, not as an error', async () => {
      registry.record('s1', { servers: [], notices: [NOTICE] });
      await createComponent({ sessionId: 's1' });
      await openPopover();

      const text = hostElement.textContent ?? '';
      expect(text).toContain('claude.ai connectors are not loaded');
      expect(text).toContain('Switch the provider to Claude login');
      expect(text.toLowerCase()).not.toContain('error');
      expect(text.toLowerCase()).not.toContain('failed');
    });

    it('names the provider the session actually runs on', async () => {
      registry.record('s1', { servers: [], notices: [NOTICE] });
      await createComponent({ sessionId: 's1' });
      await openPopover();

      expect(component.providerLabel()).toBe('OpenAI Codex');
      expect(hostElement.textContent).toContain('OpenAI Codex');
    });

    it('says "another provider" rather than guessing when the read fails', async () => {
      setResponder('auth:getAuthStatus', () => fail('offline'));
      registry.record('s1', { servers: [], notices: [NOTICE] });
      await createComponent({ sessionId: 's1' });
      await openPopover();

      expect(component.providerLabel()).toBe('another provider');
    });

    it('does not read the provider when there is no notice to explain', async () => {
      registry.record('s1', {
        servers: [{ name: 'a', status: 'connected' }],
        notices: [],
      });
      await createComponent({ sessionId: 's1' });
      await openPopover();

      expect(callsTo('auth:getAuthStatus')).toHaveLength(0);
    });

    it('opens Settings from the notice row', async () => {
      registry.record('s1', { servers: [], notices: [NOTICE] });
      await createComponent({ sessionId: 's1' });

      component.openProviderSettings();

      expect(appStateMock.setCurrentView).toHaveBeenCalledWith('settings');
      expect(component.isOpen()).toBe(false);
    });
  });

  // ── Popover lazy loads ─────────────────────────────────────────────────────

  it('loads the OAuth manifest only when the popover opens', async () => {
    registry.record('s1', {
      servers: [{ name: SENTRY_KEY, status: 'connected' }],
      notices: [],
    });
    await createComponent({ sessionId: 's1' });
    expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(0);

    await openPopover();

    expect(callsTo('mcpDirectory:listOAuthConnected')).toHaveLength(1);
  });
});
