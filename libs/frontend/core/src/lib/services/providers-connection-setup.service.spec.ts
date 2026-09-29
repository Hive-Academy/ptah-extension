import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AuthVerifyDraftConnectionResult,
  ConfigGetScopesResult,
  RpcMethodName,
  SettingScope,
} from '@ptah-extension/shared';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import { ProvidersCommitService } from './providers-commit.service';
import {
  ProvidersConnectionSetupService,
  type ProvidersConnectionSetupHooks,
} from './providers-connection-setup.service';
import type {
  ProvidersConnection,
  ProvidersConnectionDraft,
  ProvidersEditContext,
  ProvidersSettingsSection,
} from './providers-settings.types';
import { WorkspaceScopeService } from './workspace-scope.service';

const success = <T>(data: T) => new RpcResult(true, data);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function probe(probeId: string, outcome: AuthVerifyDraftConnectionResult['outcome'] = 'verified'): AuthVerifyDraftConnectionResult {
  return { probeId, outcome, reason: null, detail: null, latencyMs: 10, modelUsed: 'm', checkedAt: '2026-09-29T00:00:00Z' };
}
const openrouter: ProvidersConnection = {
  id: 'openrouter', name: 'OpenRouter', hasKey: false, configured: false, custom: false,
  defaultsResolvable: true, authMode: 'apiKey',
};

describe('ProvidersConnectionSetupService', () => {
  let service: ProvidersConnectionSetupService;
  let commits: ProvidersCommitService;
  let context: ProvidersEditContext;
  let handlers: Map<RpcMethodName, (params: unknown) => Promise<RpcResult<unknown>>>;
  let call: jest.Mock<Promise<RpcResult<unknown>>, [RpcMethodName, unknown, unknown?]>;
  let connections: ReturnType<typeof signal<ProvidersSettingsSection<readonly ProvidersConnection[]>>>;
  let targets: readonly SettingScope[];
  let events: string[];
  let hooks: ProvidersConnectionSetupHooks;

  const methods = () => call.mock.calls.map(([method]) => method);
  const draft = (overrides: Partial<ProvidersConnectionDraft> = {}): ProvidersConnectionDraft => ({
    providerId: 'openrouter', displayName: 'OpenRouter', authMode: 'apiKey', customName: null, customProtocol: null,
    credential: { kind: 'apiKey', value: 'private-key' }, baseUrl: null, verified: { probeId: 'p1' },
    tiers: { everyday: 'one', complex: 'two', fast: 'three' },
    tierSnapshot: { everyday: 'one', complex: 'two', fast: 'three' }, editedTiers: [],
    saveTo: 'global', activation: 'connect-only', ...overrides,
  });

  beforeEach(() => {
    events = [];
    targets = ['global', 'app'];
    handlers = new Map<RpcMethodName, (params: unknown) => Promise<RpcResult<unknown>>>([
      ['auth:verifyDraftConnection', async (params) => success(probe((params as { probeId: string }).probeId))],
      ['auth:cancelDraftVerification', async () => success({ cancelled: true })],
      ['auth:setApiKey', async () => success({ success: true })],
      ['auth:saveSettings', async () => success({ success: true })],
    ]);
    call = jest.fn(async (method, params) => {
      const handler = handlers.get(method);
      if (!handler) throw new Error(`Unexpected RPC: ${method}`);
      return handler(params);
    });
    TestBed.configureTestingModule({
      providers: [WorkspaceScopeService, { provide: ClaudeRpcService, useValue: { call } }],
    });
    const workspace = TestBed.inject(WorkspaceScopeService);
    workspace.switchTo('/workspace');
    service = TestBed.inject(ProvidersConnectionSetupService);
    commits = TestBed.inject(ProvidersCommitService);
    context = { scopeKey: workspace.scopeKey(), activePath: '/workspace' };
    connections = signal({ status: 'ready', data: [openrouter], error: null });
    const scopes: ProvidersSettingsSection<ConfigGetScopesResult> = {
      status: 'ready', data: { activePath: '/workspace', entries: [] }, error: null,
    };
    hooks = {
      connections: () => connections(),
      writeScopes: () => targets,
      commit: {
        refreshScopes: async () => void events.push('refreshScopes'),
        refresh: async () => void events.push('refresh'),
        scopes: () => scopes,
        sectionsReady: () => true,
      },
      refreshConnections: async () => void events.push('refreshConnections'),
      refreshRoute: async () => void events.push('refreshRoute'),
    };
  });
  afterEach(() => TestBed.resetTestingModule());

  describe('draft verification (one generation for verify, cancel and abort)', () => {
    it('publishes a verified probe for the requested id with the probe timeout', async () => {
      await service.verifyDraft({ probeId: 'p1', providerId: 'openrouter', authMode: 'apiKey', timeoutMs: 60000 });
      expect(service.verification()).toMatchObject({ status: 'ready', data: { probeId: 'p1', outcome: 'verified' } });
      expect(call).toHaveBeenCalledWith('auth:verifyDraftConnection', expect.anything(), { timeout: 65000 });
    });

    it('aborts the previous probe on the host and never publishes its late result', async () => {
      const old = deferred<RpcResult<unknown>>();
      handlers.set('auth:verifyDraftConnection', (params) => {
        const id = (params as { probeId: string }).probeId;
        return id === 'old' ? old.promise : Promise.resolve(success(probe(id)));
      });
      const first = service.verifyDraft({ probeId: 'old', providerId: 'a', authMode: 'apiKey' });
      await service.verifyDraft({ probeId: 'new', providerId: 'b', authMode: 'apiKey' });
      old.resolve(success(probe('old')));
      await first;
      expect(service.verification().data?.probeId).toBe('new');
      expect(methods()).toEqual(['auth:verifyDraftConnection', 'auth:cancelDraftVerification', 'auth:verifyDraftConnection']);
    });

    it('cancels the pending probe first, then ignores its eventual success', async () => {
      const pending = deferred<RpcResult<unknown>>();
      handlers.set('auth:verifyDraftConnection', () => pending.promise);
      const checking = service.verifyDraft({ probeId: 'c', providerId: 'a', authMode: 'apiKey' });
      await expect(service.cancelVerification()).resolves.toEqual({ cancelled: true });
      expect(service.verification().status).toBe('unloaded');
      pending.resolve(success(probe('c')));
      await checking;
      expect(service.verification().data).toBeNull();
      expect(call).toHaveBeenCalledWith('auth:cancelDraftVerification', { probeId: 'c' }, undefined);
    });

    it('forwards a cancel for another probe without touching the current one', async () => {
      await service.verifyDraft({ probeId: 'p1', providerId: 'openrouter', authMode: 'apiKey' });
      await service.cancelVerification({ probeId: 'someone-else' });
      expect(service.verification().data?.probeId).toBe('p1');
    });

    it('turns a failed cancel into a section error and a fixed message with no cause', async () => {
      const pending = deferred<RpcResult<unknown>>();
      handlers.set('auth:verifyDraftConnection', () => pending.promise);
      void service.verifyDraft({ probeId: 'c', providerId: 'a', authMode: 'apiKey' });
      handlers.set('auth:cancelDraftVerification', async () => {
        throw new Error('raw host text sk-secret');
      });
      const error = await service.cancelVerification().catch((caught: unknown) => caught);
      expect(error).toEqual(new Error('Could not cancel this check.'));
      expect((error as Error).cause).toBeUndefined();
      expect(service.verification()).toMatchObject({ status: 'error', data: null });
      pending.resolve(success(probe('c')));
    });
  });

  describe('connectProvider', () => {
    it('blocks an unverified draft without writing', async () => {
      await expect(service.connectProvider(draft(), context, hooks)).resolves.toBe(true);
      expect(commits.commit()).toMatchObject({ status: 'blocked', unsaved: ['Connection'] });
      expect(methods()).toEqual([]);
    });

    it('writes the credential through the commit hooks for a verified draft of the same provider', async () => {
      await service.verifyDraft({ probeId: 'p1', providerId: 'openrouter', authMode: 'apiKey' });
      call.mockClear();
      await expect(service.connectProvider(draft(), context, hooks)).resolves.toBe(true);
      expect(methods()).toEqual(['auth:setApiKey']);
      expect(events).toEqual(['refreshScopes', 'refresh']);
      expect(commits.commit()).toMatchObject({ status: 'saved', saved: ['Connection credential'] });
      expect(JSON.stringify(commits.commit())).not.toContain('private-key');
    });

    it('does not accept a probe verified for another provider', async () => {
      await service.verifyDraft({ probeId: 'p1', providerId: 'moonshot', authMode: 'apiKey' });
      await service.connectProvider(draft(), context, hooks);
      expect(commits.commit().status).toBe('blocked');
    });

    it('blocks activation when the host cannot write the provider to the chosen target', async () => {
      await service.verifyDraft({ probeId: 'p1', providerId: 'openrouter', authMode: 'apiKey' });
      targets = ['app'];
      call.mockClear();
      await service.connectProvider(draft({ activation: 'use-main-agent' }), context, hooks);
      expect(commits.commit()).toMatchObject({ status: 'blocked' });
      expect(methods()).toEqual([]);
    });
  });

  describe('activateConnection', () => {
    it.each([
      ['openrouter', { authMethod: 'thirdParty', anthropicProviderId: 'openrouter', applyTo: 'global' }],
      ['anthropic', { authMethod: 'apiKey', applyTo: 'global' }],
      ['claude-cli', { authMethod: 'claudeCli', applyTo: 'global' }],
    ])('activates %s with the native-auth rule', async (providerId, expected) => {
      connections.set({ status: 'ready', error: null, data: [openrouter,
        { ...openrouter, id: 'anthropic' }, { ...openrouter, id: 'claude-cli', authMode: 'cli' }] });
      await expect(service.activateConnection(providerId, 'global', context, hooks)).resolves.toBe(true);
      expect(call).toHaveBeenCalledWith('auth:saveSettings', expected, undefined);
      expect(commits.commit().status).toBe('saved');
    });

    it('blocks a connection that is not in the loaded catalogue', async () => {
      await service.activateConnection('unknown', 'global', context, hooks);
      expect(commits.commit()).toMatchObject({ status: 'blocked', unsaved: ['Main agent connection'] });
      expect(methods()).toEqual([]);
    });
  });

  describe('performExternalAuth', () => {
    it('explains unsupported actions without calling the host', async () => {
      await service.performExternalAuth('github-copilot', 'sign-in-cancel', hooks);
      expect(service.externalAuth().data?.message).toContain('cannot cancel external sign-in');
      expect(methods()).toEqual([]);
      expect(events).toEqual([]);
    });

    it('confirms a sign-in from the auth status, then re-reads connections and route', async () => {
      handlers.set('auth:copilotLogin', async () => success({ success: true }));
      handlers.set('auth:getAuthStatus', async () => success({ copilotAuthenticated: true }));
      await service.performExternalAuth('github-copilot', 'sign-in', hooks);
      expect(call).toHaveBeenCalledWith('auth:copilotLogin', {}, { timeout: 310000 });
      expect(service.externalAuth().data).toMatchObject({ providerId: 'github-copilot', signInState: 'signed-in' });
      expect(events).toEqual(['refreshConnections', 'refreshRoute']);
    });
  });
});
