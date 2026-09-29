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
  ProvidersEffectiveRoute,
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
  let route: ProvidersSettingsSection<ProvidersEffectiveRoute>;

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
    route = { status: 'ready', error: null, data: { route: 'api-key', ready: true, blockers: [], driverProviderId: 'first',
      resolvedAuthModality: 'api-key', resolvedModel: null, storedAuthMethodScope: 'global', providers: [],
      lastSuccessfulProbeAt: null, lastFailedProbeAt: null, probedAt: null, fromCache: false } as unknown as ProvidersEffectiveRoute };
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
      route: () => route,
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

  describe('writes for the redesigned surface (Component 7)', () => {
    const endpointEntry = { id: 'my-endpoint', name: 'Mine', baseUrl: 'https://new.example.test', lane: 'openai',
      authEnvVar: 'ANTHROPIC_AUTH_TOKEN', keyPrefix: '', helpUrl: 'https://help.example.test',
      modelsEndpoint: '/v1/models', pricing: { inputPerMillion: 1, outputPerMillion: 2 } };
    const verified = async (providerId: string, probeId = 'p1') => {
      await service.verifyDraft({ probeId, providerId, authMode: 'apiKey' });
      call.mockClear();
    };
    interface WriteCase {
      readonly name: string;
      readonly setup?: () => Promise<void>;
      readonly run: () => Promise<boolean>;
      readonly write: RpcMethodName;
      readonly ok: unknown;
      readonly rejected: unknown;
      readonly readBack: RpcMethodName;
      readonly matches: unknown;
      readonly mismatches: unknown;
    }
    const cases: WriteCase[] = [
      { name: 'deleteStoredKey (provider slot)', run: () => service.deleteStoredKey('openrouter', context, hooks),
        write: 'auth:deleteStoredKey', ok: { success: true }, rejected: { success: false, error: 'Could not delete the stored key.' },
        readBack: 'auth:getApiKeyStatus', matches: { providers: [{ provider: 'openrouter', hasApiKey: false }] },
        mismatches: { providers: [{ provider: 'openrouter', hasApiKey: true }] } },
      { name: 'deleteStoredKey (Anthropic slot)', run: () => service.deleteStoredKey('anthropic', context, hooks),
        write: 'auth:deleteStoredKey', ok: { success: true }, rejected: { success: false },
        readBack: 'auth:getAuthStatus', matches: { hasApiKey: false }, mismatches: { hasApiKey: true } },
      { name: 'disconnectCopilot', run: () => service.disconnectCopilot(context, hooks),
        write: 'auth:copilotLogout', ok: { success: true }, rejected: { success: false },
        readBack: 'auth:getAuthStatus', matches: { copilotAuthenticated: false }, mismatches: { copilotAuthenticated: true } },
      { name: 'removeCustomEntry', run: () => service.removeCustomEntry('my-endpoint', context, hooks),
        write: 'provider:removeCustomEntry', ok: { removed: true }, rejected: { removed: false },
        readBack: 'provider:listCustomEntries', matches: { entries: [] }, mismatches: { entries: [endpointEntry] } },
      { name: 'updateCustomEntryFields', run: () => service.updateCustomEntryFields('my-endpoint',
        { helpUrl: 'https://help.example.test', pricing: { inputPerMillion: 1, outputPerMillion: 2 } }, context, hooks),
        write: 'provider:updateCustomEntry', ok: { entry: endpointEntry }, rejected: {},
        readBack: 'provider:listCustomEntries', matches: { entries: [endpointEntry] },
        mismatches: { entries: [{ ...endpointEntry, pricing: { inputPerMillion: 1, outputPerMillion: 3 } }] } },
      { name: 'updateCustomEntryEndpoint', setup: () => verified('my-endpoint'),
        run: () => service.updateCustomEntryEndpoint('my-endpoint', { baseUrl: 'https://new.example.test', modelsEndpoint: '/v1/models' },
          'p1', context, hooks),
        write: 'provider:updateCustomEntry', ok: { entry: endpointEntry }, rejected: {},
        readBack: 'provider:listCustomEntries', matches: { entries: [endpointEntry] },
        mismatches: { entries: [{ ...endpointEntry, modelsEndpoint: null }] } },
      { name: 'updateLocalBaseUrl', setup: () => verified('ollama'),
        run: () => service.updateLocalBaseUrl('ollama', 'http://localhost:11434', 'p1', context, hooks),
        write: 'llm:setProviderBaseUrl', ok: { success: true }, rejected: { success: false },
        readBack: 'llm:getProviderBaseUrl', matches: { baseUrl: 'http://localhost:11434', defaultBaseUrl: null },
        mismatches: { baseUrl: null, defaultBaseUrl: 'http://localhost:11434' } },
    ];
    const outcome = async (item: WriteCase, write: () => Promise<RpcResult<unknown>>, readBack: unknown) => {
      await item.setup?.();
      handlers.set(item.write, write);
      handlers.set(item.readBack, async () => success(readBack));
      call.mockClear();
      await expect(item.run()).resolves.toBe(true);
      return commits.commit();
    };

    describe.each(cases)('$name', (item) => {
      it('is saved when acknowledged and read back', async () => {
        const commit = await outcome(item, async () => success(item.ok), item.matches);
        expect(commit.status).toBe('saved');
        expect(call.mock.calls.map(([method]) => method)).toEqual([item.write, item.readBack]);
        expect(events).toEqual(['refreshScopes', 'refresh']);
      });
      it('is not saved, and not read back, when the host rejects it', async () => {
        const commit = await outcome(item, async () => success(item.rejected), item.matches);
        expect(commit).toMatchObject({ status: 'failed', saved: [], unconfirmed: [] });
        expect(call.mock.calls.map(([method]) => method)).toEqual([item.write]);
        expect(JSON.stringify(commit)).not.toContain('Could not delete');
      });
      it('is unconfirmed, with no host text, when the call fails', async () => {
        const commit = await outcome(item, async () => new RpcResult(false, undefined, 'raw sk-secret'), item.matches);
        expect(commit).toMatchObject({ status: 'unconfirmed', saved: [] });
        expect(JSON.stringify(commit)).not.toContain('sk-secret');
      });
      it('is not saved when the read-back disagrees', async () => {
        const commit = await outcome(item, async () => success(item.ok), item.mismatches);
        expect(commit).toMatchObject({ status: 'failed', saved: [] });
      });
    });

    it('refuses every write while another save is in flight', async () => {
      let release!: () => void;
      const gate = new Promise<void>((done) => (release = done));
      const first = commits.run([{ fields: ['slow'], write: async () => { await gate; return true; } }], context, hooks.commit);
      await Promise.resolve();
      await verified('ollama');
      const refused = await Promise.all([
        service.deleteStoredKey('openrouter', context, hooks),
        service.disconnectCopilot(context, hooks),
        service.removeCustomEntry('first', context, hooks),
        service.updateCustomEntryFields('x', { helpUrl: '' }, context, hooks),
        service.updateCustomEntryEndpoint('ollama', { baseUrl: 'https://x.test' }, 'p1', context, hooks),
        service.updateLocalBaseUrl('ollama', 'http://localhost:1', 'p1', context, hooks),
      ]);
      expect(refused).toEqual([false, false, false, false, false, false]);
      expect(commits.commit().status).toBe('saving');
      expect(methods()).toEqual([]);
      release();
      await first;
    });

    it('blocks removing the connection that drives the main agent, or when the route is not loaded', async () => {
      await service.removeCustomEntry('first', context, hooks);
      expect(commits.commit()).toMatchObject({ status: 'blocked', message: 'Switch the main agent first.', unsaved: ['Custom connection'] });
      route = { status: 'error', data: null, error: 'Could not load this section. Retry.' };
      await service.removeCustomEntry('my-endpoint', context, hooks);
      expect(commits.commit().status).toBe('blocked');
      expect(methods()).toEqual([]);
    });

    describe.each([
      ['updateLocalBaseUrl', (probeId: string) => service.updateLocalBaseUrl('ollama', 'http://localhost:1', probeId, context, hooks)],
      ['updateCustomEntryEndpoint', (probeId: string) =>
        service.updateCustomEntryEndpoint('ollama', { modelsEndpoint: '/v1/models' }, probeId, context, hooks)],
    ] as const)('%s verify gate (#27)', (_name, save) => {
      it.each([
        ['no check has run', async () => undefined, 'p1'],
        ['the check is for another probe', () => verified('ollama', 'other'), 'p1'],
        ['the check verified another connection', () => verified('openrouter'), 'p1'],
        ['the check failed', async () => {
          handlers.set('auth:verifyDraftConnection', async () => success(probe('p1', 'failed')));
          await verified('ollama');
        }, 'p1'],
      ])('refuses to save when %s', async (_label, arrange, probeId) => {
        await arrange();
        call.mockClear();
        await expect(save(probeId)).resolves.toBe(true);
        expect(commits.commit()).toMatchObject({ status: 'blocked', message: 'Verify this connection before saving its endpoint.' });
        expect(methods()).toEqual([]);
      });
    });

    it('blocks invalid or empty metadata and endpoint changes without writing', async () => {
      await service.updateCustomEntryFields('my-endpoint', { pricing: { inputPerMillion: -1, outputPerMillion: 1 } }, context, hooks);
      expect(commits.commit().status).toBe('blocked');
      await service.updateCustomEntryFields('my-endpoint', {}, context, hooks);
      expect(commits.commit().status).toBe('blocked');
      await verified('my-endpoint');
      await service.updateCustomEntryEndpoint('my-endpoint', { baseUrl: 'ftp://nope' }, 'p1', context, hooks);
      expect(commits.commit()).toMatchObject({ status: 'blocked', message: 'Use an http:// or https:// base URL.' });
      expect(methods()).toEqual([]);
    });
  });
});
