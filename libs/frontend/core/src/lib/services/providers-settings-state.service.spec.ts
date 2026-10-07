import { TestBed } from '@angular/core/testing';
import { setCustomProviderEntries } from '@ptah-extension/shared';
import type {
  AuthGetEffectiveRouteResult,
  AuthVerifyDraftConnectionResult,
  ConfigGetScopesResult,
  RpcMethodName,
  ScopedSettingEntry,
  SkillLaneIdDto,
  SkillLanesDto,
} from '@ptah-extension/shared';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import {
  ProvidersSettingsStateService,
  type ProvidersConnectionDraft,
} from './providers-settings-state.service';
import { EffortStateService } from './effort-state.service';
import { WorkspaceScopeService } from './workspace-scope.service';
import { VSCodeService } from './vscode.service';

const success = <T>(data: T) => new RpcResult(true, data);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function route(
  overrides: Partial<AuthGetEffectiveRouteResult> = {},
): AuthGetEffectiveRouteResult {
  return {
    route: 'api-key',
    ready: true,
    blockers: [],
    driverProviderId: 'first',
    resolvedAuthModality: 'api-key',
    resolvedModel: { kind: 'model', id: 'pinned-model' },
    storedAuthMethodDiagnostic: 'private raw value',
    storedAuthMethodScope: 'app',
    providers: [
      { id: 'first', type: 'apiKey', status: 'connected' },
      { id: 'second', type: 'apiKey', status: 'connected' },
    ],
    lastSuccessfulProbeAt: '2026-09-22T10:00:00Z',
    lastFailedProbeAt: null,
    probedAt: '2026-09-22T10:00:00Z',
    fromCache: false,
    ...overrides,
  };
}
function entry(
  key: string,
  overrides: Partial<ScopedSettingEntry> = {},
): ScopedSettingEntry {
  return {
    key,
    scope: 'global',
    hasOverride: false,
    effectiveKey: key,
    supportedTargets: ['global', 'app', 'workspace'],
    fallbackPreview: null,
    credentialSource: 'not-a-secret',
    ...overrides,
  };
}
function lanes(): SkillLanesDto {
  const lane = (id: SkillLaneIdDto) => ({
    id,
    provider: '',
    model: '',
    defaultTier: 'haiku' as const,
    structuredOutput: 'sdk' as const,
    toolUse: 'none' as const,
    timeoutMs: 30000,
    maxInputChars: 1000,
    maxPasses: 1,
  });
  return {
    archaeologist: lane('archaeologist'),
    synthesis: lane('synthesis'),
    judge: lane('judge'),
    replay: lane('replay'),
  };
}
function probe(probeId: string): AuthVerifyDraftConnectionResult {
  return {
    probeId,
    outcome: 'verified',
    reason: null,
    detail: null,
    latencyMs: 100,
    modelUsed: 'model',
    checkedAt: '2026-09-22T10:00:00Z',
  };
}

describe('ProvidersSettingsStateService', () => {
  let service: ProvidersSettingsStateService;
  let workspace: WorkspaceScopeService;
  let scopeResponse: ConfigGetScopesResult;
  let judgingResponse: {
    judgeProvider: string;
    judgeModel: string;
    enhanceTimeoutMs: {
      value: number;
      default: number;
      min: number;
      max: number;
    };
  };
  let memoryResponse: {
    idleMs: number;
    turnThreshold: number;
    bootScan: boolean;
    curatorProvider: string;
    curatorModel: string;
  };
  let handlers: Map<
    RpcMethodName,
    (params: unknown) => Promise<RpcResult<unknown>>
  >;
  let call: jest.Mock<
    Promise<RpcResult<unknown>>,
    [RpcMethodName, unknown, unknown?]
  >;

  beforeEach(() => {
    scopeResponse = {
      activePath: '/workspace',
      entries: [entry('authMethod'), entry('anthropicProviderId')],
    };
    judgingResponse = {
      judgeProvider: '',
      judgeModel: 'inherit',
      enhanceTimeoutMs: {
        value: 120000,
        default: 120000,
        min: 15000,
        max: 600000,
      },
    };
    memoryResponse = {
      idleMs: 1000,
      turnThreshold: 4,
      bootScan: false,
      curatorProvider: '',
      curatorModel: '',
    };
    handlers = new Map<
      RpcMethodName,
      (params: unknown) => Promise<RpcResult<unknown>>
    >([
      ['auth:getApiKeyStatus', async () => success({ providers: [] })],
      ['settings:get', async () => success({ success: true, value: [] })],
      [
        'llm:getProviderBaseUrl',
        async () => success({ baseUrl: null, defaultBaseUrl: null }),
      ],
      ['provider:listCustomEntries', async () => success({ entries: [] })],
      [
        'auth:getAuthStatus',
        async () =>
          success({
            authMethod: 'apiKey',
            anthropicProviderId: 'openrouter',
            availableProviders: [],
            hasApiKey: false,
            hasOpenRouterKey: false,
          }),
      ],
      ['auth:getEffectiveRoute', async () => success(route())],
      ['config:getScopes', async () => success(scopeResponse)],
      ['config:model-get', async () => success({ model: 'pinned-model' })],
      ['config:effort-get', async () => success({ effort: undefined })],
      ['memory:getTriggers', async () => success({ triggers: memoryResponse })],
      ['skillSynthesis:getLanes', async () => success({ lanes: lanes() })],
      [
        'skillSynthesis:getSettings',
        async () => success({ settings: judgingResponse }),
      ],
      ['ptahCli:list', async () => success({ agents: [] })],
      [
        'agent:getConfig',
        async () =>
          success({
            codexModel: '',
            copilotModel: '',
            cursorModel: '',
            codexReasoningEffort: '',
            copilotReasoningEffort: '',
            cursorApiKeyConfigured: false,
            cursorApiKeyStored: false,
            cursorApiKeyEnvSet: false,
          }),
      ],
      [
        'provider:getModelTiers',
        async () => success({ sonnet: null, opus: null, haiku: null }),
      ],
      [
        'auth:cancelDraftVerification',
        async () => success({ cancelled: true }),
      ],
    ]);
    call = jest.fn(async (method, params) => {
      const handler = handlers.get(method);
      if (!handler) throw new Error(`Unexpected RPC: ${method}`);
      return handler(params);
    });
    TestBed.configureTestingModule({
      providers: [
        ProvidersSettingsStateService,
        WorkspaceScopeService,
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    });
    workspace = TestBed.inject(WorkspaceScopeService);
    workspace.switchTo('/workspace');
    service = TestBed.inject(ProvidersSettingsStateService);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('rereads effective effort on open and refresh without exposing the cached value during loading', async () => {
    handlers.set('config:effort-get', async () => success({ effort: 'low' }));
    await service.open();
    expect(service.effort().data?.effort).toBe('low');
    const read = deferred<RpcResult<unknown>>();
    handlers.set('config:effort-get', () => read.promise);
    const refresh = service.refresh();
    expect(service.effort()).toMatchObject({ status: 'loading', data: null });
    read.resolve(success({ effort: 'xhigh' }));
    await refresh;
    expect(service.effort()).toMatchObject({
      status: 'ready',
      data: { effort: 'xhigh' },
    });
  });

  it('invalidates displayed effort immediately and rereads after a runtime xhigh write settles', async () => {
    handlers.set('config:effort-get', async () => success({ effort: 'low' }));
    await service.open();
    const runtime = TestBed.inject(EffortStateService);
    await Promise.resolve();
    const write = deferred<RpcResult<unknown>>();
    handlers.set('config:effort-set', () => write.promise);
    const pending = runtime.setEffort('xhigh');
    expect(service.effort()).toMatchObject({ status: 'loading', data: null });
    expect(service.mainSources()).toMatchObject({
      status: 'loading',
      data: null,
    });
    TestBed.tick();
    const read = deferred<RpcResult<unknown>>();
    handlers.set('config:effort-get', () => read.promise);
    write.resolve(success({ effort: 'xhigh' }));
    await pending;
    TestBed.tick();
    expect(service.effort()).toMatchObject({ status: 'loading', data: null });
    read.resolve(success({ effort: 'xhigh' }));
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    expect(service.effort()).toMatchObject({
      status: 'ready',
      data: { effort: 'xhigh' },
    });
    expect(call).toHaveBeenCalledWith('config:effort-get', {}, undefined);
  });

  it('does not restore stale effort when readback after a runtime write fails', async () => {
    handlers.set('config:effort-get', async () => success({ effort: 'low' }));
    await service.open();
    const runtime = TestBed.inject(EffortStateService);
    await Promise.resolve();
    handlers.set('config:effort-set', async () => success({ effort: 'xhigh' }));
    await runtime.setEffort('xhigh');
    handlers.set('config:effort-get', async () => {
      throw new Error('private host failure');
    });
    TestBed.tick();
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    expect(service.effort()).toEqual({
      status: 'error',
      data: null,
      error: 'Could not load this section. Retry.',
    });
    expect(service.model().status).toBe('ready');
  });

  it('reads model and effort provenance from the current authentication namespace without guessing a group source', async () => {
    handlers.set('auth:getAuthStatus', async () =>
      success({ authMethod: 'thirdParty', anthropicProviderId: 'openrouter' }),
    );
    const modelKey = 'provider.thirdParty.openrouter.selectedModel';
    const effortKey = 'provider.thirdParty.openrouter.reasoningEffort';
    const sources = [entry(modelKey, { scope: 'workspace' }), entry(effortKey)];
    handlers.set('config:getScopes', async (params) => {
      const requested = params as { keys: string[] };
      return success({
        activePath: '/workspace',
        entries: requested.keys.includes(modelKey)
          ? sources
          : scopeResponse.entries,
      });
    });
    await service.refreshScopes();
    expect(
      service.groupScope([
        'authMethod',
        'anthropicProviderId',
        modelKey,
        effortKey,
      ]),
    ).toBeNull();
    await service.refreshMainSources();
    expect(call).toHaveBeenCalledWith(
      'config:getScopes',
      { keys: [modelKey, effortKey] },
      undefined,
    );
    expect(service.mainSources().data).toEqual({
      model: sources[0],
      effort: sources[1],
    });
    expect(service.writeScopes(modelKey)).toEqual([
      'global',
      'app',
      'workspace',
    ]);
    expect(
      service.groupScope([
        'authMethod',
        'anthropicProviderId',
        modelKey,
        effortKey,
      ]),
    ).toBe('mixed');
  });

  async function context() {
    await service.refreshScopes();
    const result = service.reviewContext();
    if (!result) throw new Error('Expected loaded scope');
    return result;
  }

  function connectionDraft(
    overrides: Partial<ProvidersConnectionDraft> = {},
  ): ProvidersConnectionDraft {
    return {
      providerId: 'openrouter',
      displayName: 'OpenRouter',
      authMode: 'apiKey',
      customName: null,
      customProtocol: null,
      credential: { kind: 'apiKey', value: 'private-key' },
      baseUrl: null,
      verified: { probeId: 'draft-check' },
      tiers: { everyday: 'one', complex: 'two', fast: 'three' },
      tierSnapshot: { everyday: 'one', complex: 'two', fast: 'three' },
      editedTiers: [],
      saveTo: 'global',
      activation: 'connect-only',
      ...overrides,
    };
  }
  /** Host-side main-agent tier store behind provider:get/set/clearModelTier, so tests assert end state. */
  function tierStore(
    initial: Record<'sonnet' | 'opus' | 'haiku', string | null>,
  ) {
    const store = { ...initial };
    handlers.set('provider:getModelTiers', async () => success({ ...store }));
    handlers.set('provider:setModelTier', async (params) => {
      const { tier, modelId, scope } = params as {
        tier: 'sonnet' | 'opus' | 'haiku';
        modelId: string;
        scope: string;
      };
      if (scope !== 'mainAgent') throw new Error('unexpected scope ' + scope);
      store[tier] = modelId;
      return success({ success: true });
    });
    handlers.set('provider:clearModelTier', async (params) => {
      store[(params as { tier: 'sonnet' | 'opus' | 'haiku' }).tier] = null;
      return success({ success: true });
    });
    return store;
  }
  async function verifiedConnection() {
    handlers.set('auth:verifyDraftConnection', async () =>
      success(probe('draft-check')),
    );
    handlers.set('auth:setApiKey', async () => success({ success: true }));
    handlers.set('provider:setModelTier', async () =>
      success({ success: true }),
    );
    await service.open();
    await service.verifyDraft({
      probeId: 'draft-check',
      providerId: 'openrouter',
      authMode: 'apiKey',
    });
    return context();
  }

  it('stores direct Anthropic credentials only with explicit activation and never in a provider slot', async () => {
    const reviewed = await verifiedConnection();
    await service.verifyDraft({
      probeId: 'draft-check',
      providerId: 'anthropic',
      authMode: 'apiKey',
      credential: { kind: 'apiKey', value: 'private-key' },
    });
    call.mockClear();
    await service.connectProvider(
      connectionDraft({ providerId: 'anthropic' }),
      reviewed,
    );
    expect(service.commit().status).toBe('blocked');
    expect(call).not.toHaveBeenCalled();
    handlers.set('auth:saveSettings', async () => success({ success: true }));
    await service.connectProvider(
      connectionDraft({
        providerId: 'anthropic',
        activation: 'use-main-agent',
      }),
      reviewed,
    );
    expect(call).toHaveBeenCalledWith(
      'auth:saveSettings',
      {
        authMethod: 'apiKey',
        anthropicApiKey: 'private-key',
        applyTo: 'global',
      },
      undefined,
    );
    expect(
      call.mock.calls.some(([method]) => method === 'auth:setApiKey'),
    ).toBe(false);
    expect(JSON.stringify(service.commit())).not.toContain('private-key');
  });
  it('reads existing connection endpoint and models without returning credentials', async () => {
    await service.open();
    handlers.set('llm:getProviderBaseUrl', async () =>
      success({ baseUrl: 'http://saved.example', defaultBaseUrl: null }),
    );
    handlers.set('provider:getModelTiers', async () =>
      success({ sonnet: 'saved-model', opus: null, haiku: null }),
    );
    await service.refreshConnectionSetup('ollama');
    expect(service.connectionSetup().data).toEqual({
      providerId: 'ollama',
      baseUrl: 'http://saved.example',
      tiers: { sonnet: 'saved-model', opus: null, haiku: null },
    });
    // The wizard edits the main-agent mapping; CLI sub-agent tiers are not connection setup.
    expect(call).toHaveBeenCalledWith(
      'provider:getModelTiers',
      { providerId: 'ollama', scope: 'mainAgent' },
      undefined,
    );
    expect(call).not.toHaveBeenCalledWith(
      'provider:getModelTiers',
      expect.objectContaining({ scope: 'cliAgent' }),
      undefined,
    );
  });
  it('treats an installed Claude CLI as a configured connection without reading CLI sub-agent tiers', async () => {
    handlers.set('auth:getAuthStatus', async () =>
      success({
        authMethod: 'apiKey',
        hasApiKey: false,
        claudeCliInstalled: true,
      }),
    );
    await service.refreshConnections();
    expect(
      service.connections().data?.find((entry) => entry.id === 'claude-cli')
        ?.configured,
    ).toBe(true);
    expect(
      call.mock.calls.some(([method]) => method === 'provider:getModelTiers'),
    ).toBe(false);
    handlers.set('auth:getAuthStatus', async () =>
      success({
        authMethod: 'apiKey',
        hasApiKey: false,
        claudeCliInstalled: false,
      }),
    );
    await service.refreshConnections();
    expect(
      service.connections().data?.find((entry) => entry.id === 'claude-cli')
        ?.configured,
    ).toBe(false);
  });
  it('R3.11: loads delegated CLI model lists from agent:listCliModels on demand, never provider:listModels', async () => {
    const lists = {
      codex: [],
      copilot: [],
      cursor: [{ id: 'cursor-fast', name: 'Cursor Fast' }],
      antigravity: [],
      opencode: [],
      pi: [],
    };
    handlers.set('agent:listCliModels', async () => success(lists));
    await service.open();
    expect(
      call.mock.calls.some(([method]) => method === 'agent:listCliModels'),
    ).toBe(false);
    await service.refreshDelegatedModelOptions();
    expect(call).toHaveBeenCalledWith(
      'agent:listCliModels',
      undefined,
      undefined,
    );
    expect(service.delegatedModelOptions().data).toEqual(lists);
    expect(
      call.mock.calls.some(([method]) => method === 'provider:listModels'),
    ).toBe(false);
  });

  it('surfaces a real false cancellation acknowledgement and targets the requested probe', async () => {
    handlers.set('auth:cancelDraftVerification', async () =>
      success({ cancelled: false }),
    );
    expect(
      await service.cancelVerification({ probeId: 'finished-probe' }),
    ).toEqual({ cancelled: false });
    expect(call).toHaveBeenCalledWith(
      'auth:cancelDraftVerification',
      { probeId: 'finished-probe' },
      undefined,
    );
  });

  it('does not cancel a newer verification when an older wizard requests cancellation', async () => {
    const pending = deferred<RpcResult<unknown>>();
    handlers.set('auth:verifyDraftConnection', () => pending.promise);
    const check = service.verifyDraft({
      probeId: 'new-probe',
      providerId: 'openrouter',
      authMode: 'apiKey',
    });
    await service.cancelVerification({ probeId: 'old-probe' });
    pending.resolve(success(probe('new-probe')));
    await check;
    expect(service.verification().data?.probeId).toBe('new-probe');
  });

  it('keeps route usable when the catalogue fails and retries the catalogue independently', async () => {
    handlers.set('provider:listCustomEntries', async () => {
      throw new Error('raw credential');
    });
    await service.open();
    expect(service.connections().status).toBe('error');
    expect(service.route().status).toBe('ready');
    handlers.set('provider:listCustomEntries', async () =>
      success({ entries: [] }),
    );
    call.mockClear();
    await service.refreshConnections();
    expect(service.connections().status).toBe('ready');
    expect(
      call.mock.calls.some(([method]) => method === 'auth:getEffectiveRoute'),
    ).toBe(false);
    expect(JSON.stringify(service.connections())).not.toContain(
      'raw credential',
    );
  });

  it('connects without writing main-route settings, main-agent tiers or CLI sub-agent tiers', async () => {
    const reviewed = await verifiedConnection();
    call.mockClear();
    await service.connectProvider(connectionDraft(), reviewed);
    expect(service.commit().status).toBe('saved');
    expect(call).toHaveBeenCalledWith(
      'auth:setApiKey',
      { provider: 'openrouter', apiKey: 'private-key' },
      undefined,
    );
    expect(
      call.mock.calls.some(
        ([method]) =>
          method === 'auth:saveSettings' || method === 'llm:setApiKey',
      ),
    ).toBe(false);
    // R1.4: provider.<id>.cliAgent.modelTier.* is read by PtahCliRegistry for every CLI agent on the provider.
    expect(
      call.mock.calls.some(([method]) => method === 'provider:setModelTier'),
    ).toBe(false);
    expect(JSON.stringify(service.commit())).not.toContain('private-key');
  });
  it('R1.4: activating from setup writes no cliAgent tier', async () => {
    const reviewed = await verifiedConnection();
    handlers.set('auth:saveSettings', async () => success({ success: true }));
    call.mockClear();
    await service.connectProvider(
      connectionDraft({ activation: 'use-main-agent' }),
      reviewed,
    );
    const scopes = call.mock.calls
      .filter(([method]) => method === 'provider:setModelTier')
      .map(([, params]) => (params as { scope: string }).scope);
    expect(scopes).not.toContain('cliAgent');
  });
  it('review #4: sends only edited tiers; unchanged tiers keep a newer stored value', async () => {
    const reviewed = await verifiedConnection();
    handlers.set('auth:saveSettings', async () => success({ success: true }));
    // Another window changed sonnet to 'newer' after this wizard loaded 'one'.
    const store = tierStore({ sonnet: 'newer', opus: 'two', haiku: null });
    call.mockClear();
    await service.connectProvider(
      connectionDraft({
        activation: 'use-main-agent',
        tiers: { everyday: 'one', complex: 'edited-opus', fast: 'three' },
        tierSnapshot: { everyday: 'one', complex: 'two', fast: null },
        editedTiers: ['complex', 'fast'],
      }),
      reviewed,
    );
    expect(service.commit().status).toBe('saved');
    expect(call).toHaveBeenCalledWith(
      'auth:saveSettings',
      {
        authMethod: 'thirdParty',
        anthropicProviderId: 'openrouter',
        applyTo: 'global',
      },
      undefined,
    );
    // The unedited sonnet tier kept the newer value; edits landed in the main-agent scope.
    expect(store).toEqual({
      sonnet: 'newer',
      opus: 'edited-opus',
      haiku: 'three',
    });
  });
  it('review #4: an edited tier whose stored value changed since setup opened is a conflict, not an overwrite', async () => {
    const reviewed = await verifiedConnection();
    const store = tierStore({
      sonnet: 'changed-elsewhere',
      opus: null,
      haiku: null,
    });
    call.mockClear();
    await service.connectProvider(
      connectionDraft({
        tiers: { everyday: 'mine', complex: 'two', fast: 'three' },
        tierSnapshot: { everyday: 'one', complex: null, fast: null },
        editedTiers: ['everyday'],
      }),
      reviewed,
    );
    expect(store.sonnet).toBe('changed-elsewhere');
    expect(
      call.mock.calls.some(([method]) => method === 'provider:setModelTier'),
    ).toBe(false);
    expect(service.commit()).toMatchObject({
      status: 'partial',
      unsaved: ['Main agent sonnet model'],
    });
    expect(service.commit().message).toContain(
      'Changed elsewhere since setup opened, not overwritten: Main agent sonnet model',
    );
  });
  it('review round 2 N2: first activation keeps the chosen model; the host auto-map runs after the tier writes', async () => {
    const reviewed = await verifiedConnection();
    const store = tierStore({ sonnet: null, opus: null, haiku: null });
    // The real auth:saveSettings runs autoMapProviderTiers, which fills every UNSET main-agent tier.
    handlers.set('auth:saveSettings', async () => {
      for (const tier of ['sonnet', 'opus', 'haiku'] as const)
        store[tier] ??= `default-${tier}`;
      return success({ success: true });
    });
    call.mockClear();
    await service.connectProvider(
      connectionDraft({
        activation: 'use-main-agent',
        tiers: {
          everyday: 'chosen-sonnet',
          complex: 'unedited-opus',
          fast: 'unedited-haiku',
        },
        tierSnapshot: { everyday: null, complex: null, fast: null },
        editedTiers: ['everyday'],
      }),
      reviewed,
    );
    expect(service.commit().status).toBe('saved');
    expect(store).toEqual({
      sonnet: 'chosen-sonnet',
      opus: 'default-opus',
      haiku: 'default-haiku',
    });
    const order = call.mock.calls
      .map(([method]) => method)
      .filter(
        (method) =>
          method === 'provider:setModelTier' || method === 'auth:saveSettings',
      );
    expect(order).toEqual(['provider:setModelTier', 'auth:saveSettings']);
  });
  it('review round 2 N2: a conflicting tier write stops activation', async () => {
    const reviewed = await verifiedConnection();
    tierStore({ sonnet: 'changed-elsewhere', opus: null, haiku: null });
    handlers.set('auth:saveSettings', async () => success({ success: true }));
    call.mockClear();
    await service.connectProvider(
      connectionDraft({
        activation: 'use-main-agent',
        tiers: { everyday: 'mine', complex: 'two', fast: 'three' },
        tierSnapshot: { everyday: null, complex: null, fast: null },
        editedTiers: ['everyday'],
      }),
      reviewed,
    );
    expect(
      call.mock.calls.some(([method]) => method === 'auth:saveSettings'),
    ).toBe(false);
    expect(service.commit().status).toBe('partial');
  });
  it('552: a conflict on the first edited tier still saves the second tier and does not activate', async () => {
    const reviewed = await verifiedConnection();
    const store = tierStore({
      sonnet: 'changed-elsewhere',
      opus: 'old-opus',
      haiku: null,
    });
    handlers.set('auth:saveSettings', async () => success({ success: true }));
    call.mockClear();
    await service.connectProvider(
      connectionDraft({
        activation: 'use-main-agent',
        tiers: { everyday: 'mine', complex: 'new-opus', fast: 'three' },
        tierSnapshot: { everyday: 'one', complex: 'old-opus', fast: null },
        editedTiers: ['everyday', 'complex'],
      }),
      reviewed,
    );
    expect(store).toEqual({
      sonnet: 'changed-elsewhere',
      opus: 'new-opus',
      haiku: null,
    });
    expect(
      call.mock.calls.some(([method]) => method === 'auth:saveSettings'),
    ).toBe(false);
    expect(service.commit()).toMatchObject({
      status: 'partial',
      saved: ['Connection credential', 'Main agent opus model'],
      unsaved: ['Main agent sonnet model', 'authMethod', 'anthropicProviderId'],
      unconfirmed: [],
    });
    const message = service.commit().message ?? '';
    expect(message).toContain('not overwritten: Main agent sonnet model.');
    expect(message).not.toContain('opus');
  });
  it('552: tier writes still wait for the setup writes', async () => {
    const reviewed = await verifiedConnection();
    const store = tierStore({ sonnet: null, opus: null, haiku: null });
    handlers.set('auth:setApiKey', async () => success({ success: false }));
    handlers.set('auth:saveSettings', async () => success({ success: true }));
    call.mockClear();
    await service.connectProvider(
      connectionDraft({
        activation: 'use-main-agent',
        baseUrl: 'https://example.test',
        tiers: { everyday: 'one', complex: 'two', fast: 'three' },
        tierSnapshot: { everyday: null, complex: null, fast: null },
        editedTiers: ['everyday', 'fast'],
      }),
      reviewed,
    );
    // The rejected credential stops the dependent endpoint, both tiers and activation.
    expect(
      call.mock.calls
        .map(([method]) => method)
        .filter((method) =>
          [
            'llm:setProviderBaseUrl',
            'provider:setModelTier',
            'auth:saveSettings',
          ].includes(method),
        ),
    ).toEqual([]);
    expect(store).toEqual({ sonnet: null, opus: null, haiku: null });
    expect(service.commit()).toMatchObject({
      status: 'failed',
      saved: [],
      unsaved: [
        'Connection credential',
        'Connection endpoint',
        'Main agent sonnet model',
        'Main agent haiku model',
        'authMethod',
        'anthropicProviderId',
      ],
    });
  });
  it('B2-2: Connect only persists edited tiers as main-agent tiers without selecting the provider', async () => {
    const reviewed = await verifiedConnection();
    await service.verifyDraft({
      probeId: 'draft-check',
      providerId: 'moonshot',
      authMode: 'apiKey',
    });
    const store = tierStore({ sonnet: null, opus: null, haiku: null });
    call.mockClear();
    await service.connectProvider(
      connectionDraft({
        providerId: 'moonshot',
        tiers: { everyday: 'one', complex: '', fast: 'three' },
        tierSnapshot: { everyday: null, complex: null, fast: null },
        editedTiers: ['everyday', 'fast'],
      }),
      reviewed,
    );
    expect(service.commit().status).toBe('saved');
    expect(store).toEqual({ sonnet: 'one', opus: null, haiku: 'three' });
    expect(
      call.mock.calls.some(([method]) => method === 'auth:saveSettings'),
    ).toBe(false);
    expect(
      call.mock.calls
        .filter(([method]) => method === 'provider:setModelTier')
        .every(
          ([, params]) => (params as { scope: string }).scope === 'mainAgent',
        ),
    ).toBe(true);
  });
  it('B2-2: an edit back to the provider default clears the stored main-agent tier', async () => {
    const reviewed = await verifiedConnection();
    await service.verifyDraft({
      probeId: 'draft-check',
      providerId: 'moonshot',
      authMode: 'apiKey',
    });
    const store = tierStore({
      sonnet: 'user-sonnet',
      opus: 'user-opus',
      haiku: 'user-haiku',
    });
    call.mockClear();
    await service.connectProvider(
      connectionDraft({
        providerId: 'moonshot',
        tiers: { everyday: '', complex: 'user-opus', fast: 'user-haiku' },
        tierSnapshot: {
          everyday: 'user-sonnet',
          complex: 'user-opus',
          fast: 'user-haiku',
        },
        editedTiers: ['everyday'],
      }),
      reviewed,
    );
    expect(service.commit().status).toBe('saved');
    expect(store).toEqual({
      sonnet: null,
      opus: 'user-opus',
      haiku: 'user-haiku',
    });
  });
  it.each(['claude-cli', 'anthropic'])(
    'R1.1/R1.2: %s setup activation sends no provider id and writes no tiers',
    async (providerId) => {
      const reviewed = await verifiedConnection();
      await service.verifyDraft({
        probeId: 'draft-check',
        providerId,
        authMode: providerId === 'anthropic' ? 'apiKey' : 'cli',
      });
      handlers.set('auth:saveSettings', async () => success({ success: true }));
      // anthropicProviderId is not writable here: native auth must not need it.
      scopeResponse = {
        activePath: '/workspace',
        entries: [entry('authMethod')],
      };
      call.mockClear();
      // Native auth collects no tiers: blank tiers are not blocked, and even a stray edit is not written.
      await service.connectProvider(
        connectionDraft({
          providerId,
          authMode: providerId === 'anthropic' ? 'apiKey' : 'cli',
          credential:
            providerId === 'anthropic'
              ? { kind: 'apiKey', value: 'private-key' }
              : null,
          activation: 'use-main-agent',
          tiers: { everyday: '', complex: '', fast: '' },
          editedTiers: ['everyday'],
        }),
        reviewed,
      );
      expect(service.commit().status).toBe('saved');
      const saved = call.mock.calls.find(
        ([method]) => method === 'auth:saveSettings',
      )?.[1];
      expect(saved).toEqual(
        providerId === 'anthropic'
          ? {
              authMethod: 'apiKey',
              anthropicApiKey: 'private-key',
              applyTo: 'global',
            }
          : { authMethod: 'claudeCli', applyTo: 'global' },
      );
      expect(
        call.mock.calls.some(([method]) => method === 'provider:setModelTier'),
      ).toBe(false);
    },
  );
  it('distinguishes a persisted local endpoint from a shipped endpoint default', async () => {
    handlers.set('llm:getProviderBaseUrl', async () =>
      success({ baseUrl: null, defaultBaseUrl: 'http://localhost:11434' }),
    );
    await service.refreshConnections();
    expect(
      service.connections().data?.find((entry) => entry.id === 'ollama')
        ?.configured,
    ).toBe(false);
    handlers.set('llm:getProviderBaseUrl', async () =>
      success({
        baseUrl: 'http://localhost:11434',
        defaultBaseUrl: 'http://localhost:11434',
      }),
    );
    await service.refreshConnections();
    expect(
      service.connections().data?.find((entry) => entry.id === 'ollama')
        ?.configured,
    ).toBe(true);
  });

  it('does not activate after an unconfirmed credential write', async () => {
    const reviewed = await verifiedConnection();
    handlers.set('auth:setApiKey', async () => {
      throw new Error('secret');
    });
    call.mockClear();
    await service.connectProvider(
      connectionDraft({ activation: 'use-main-agent' }),
      reviewed,
    );
    expect(service.commit().unconfirmed).toContain('Connection credential');
    expect(service.commit().unsaved).toContain('authMethod');
    expect(
      call.mock.calls.some(([method]) => method === 'auth:saveSettings'),
    ).toBe(false);
  });
  it('R1.3: activates a third-party connection without copying any tier over the main-agent tiers', async () => {
    const reviewed = await verifiedConnection();
    handlers.set('provider:getModelTiers', async () =>
      success({ sonnet: 'cli-one', opus: 'cli-two', haiku: 'cli-three' }),
    );
    handlers.set('auth:saveSettings', async () => success({ success: true }));
    call.mockClear();
    await service.activateConnection('openrouter', 'global', reviewed);
    // auth:saveSettings -> autoMapProviderTiers fills only UNSET main-agent tiers on the host.
    expect(call).toHaveBeenCalledWith(
      'auth:saveSettings',
      {
        authMethod: 'thirdParty',
        anthropicProviderId: 'openrouter',
        applyTo: 'global',
      },
      undefined,
    );
    expect(
      call.mock.calls.some(([method]) => method === 'provider:setModelTier'),
    ).toBe(false);
    expect(service.commit().status).toBe('saved');
  });
  it.each([
    ['anthropic', { authMethod: 'apiKey', applyTo: 'global' }],
    ['claude-cli', { authMethod: 'claudeCli', applyTo: 'global' }],
  ])(
    'R1.1/R1.2: activating %s sends no anthropicProviderId and writes no main-agent tier',
    async (providerId, expected) => {
      const reviewed = await verifiedConnection();
      handlers.set('auth:saveSettings', async () => success({ success: true }));
      scopeResponse = {
        activePath: '/workspace',
        entries: [entry('authMethod')],
      };
      call.mockClear();
      await service.activateConnection(providerId, 'global', reviewed);
      expect(
        call.mock.calls
          .filter(([method]) => method === 'auth:saveSettings')
          .map(([, params]) => params),
      ).toEqual([expected]);
      expect(
        call.mock.calls.some(([method]) => method === 'provider:setModelTier'),
      ).toBe(false);
      expect(service.commit().status).toBe('saved');
    },
  );
  it('does not activate a connection that is not in the loaded catalogue', async () => {
    const reviewed = await verifiedConnection();
    call.mockClear();
    await service.activateConnection('not-a-provider', 'global', reviewed);
    expect(service.commit().status).toBe('blocked');
    expect(
      call.mock.calls.some(([method]) => method === 'auth:saveSettings'),
    ).toBe(false);
  });

  it('creates custom metadata separately from its credential without activating', async () => {
    const reviewed = await verifiedConnection();
    await service.verifyDraft({
      probeId: 'draft-check',
      providerId: 'my-endpoint',
      authMode: 'custom',
    });
    handlers.set('provider:addCustomEntry', async (params) =>
      success({ entry: params }),
    );
    call.mockClear();
    await service.connectProvider(
      connectionDraft({
        providerId: 'my-endpoint',
        customName: 'My endpoint',
        authMode: 'custom',
        customProtocol: 'openai',
        baseUrl: 'http://localhost:8080',
      }),
      reviewed,
    );
    const metadata = call.mock.calls.find(
      ([method]) => method === 'provider:addCustomEntry',
    )?.[1];
    expect(metadata).toMatchObject({
      entry: { id: 'my-endpoint', lane: 'openai', name: 'My endpoint' },
    });
    expect(JSON.stringify(metadata)).not.toContain('private-key');
    expect(service.commit().status).toBe('saved');
  });

  it('blocks stale workspace context and unsupported setup scope before writing credentials', async () => {
    const reviewed = await verifiedConnection();
    call.mockClear();
    await service.connectProvider(
      connectionDraft({ saveTo: 'workspace' }),
      reviewed,
    );
    expect(service.commit().status).toBe('blocked');
    expect(call).not.toHaveBeenCalled();
    workspace.switchTo('/another-workspace');
    await service.connectProvider(connectionDraft(), reviewed);
    expect(service.commit().status).toBe('blocked');
    expect(
      call.mock.calls.some(([method]) => method === 'auth:setApiKey'),
    ).toBe(false);
  });

  it('does not claim a launched Codex login is authenticated', async () => {
    handlers.set('auth:codexLogin', async () => success({ success: true }));
    handlers.set('auth:getAuthStatus', async () =>
      success({ codexAuthenticated: false }),
    );
    await service.performExternalAuth('openai-codex', 'sign-in');
    expect(service.externalAuth().data?.signInState).toBe('idle');
    expect(service.externalAuth().data?.message).toContain(
      'not been confirmed',
    );
  });

  it('does not fabricate external cancellation or guess the wizard provider', async () => {
    await service.performExternalAuth(null, 'sign-in');
    expect(service.externalAuth().data?.message).toContain('does not identify');
    await service.performExternalAuth('openai-codex', 'sign-in-cancel');
    expect(service.externalAuth().data?.message).toContain('cannot cancel');
    expect(call).not.toHaveBeenCalled();
  });
  it('reads only non-secret CLI model fields and isolates malformed persisted models', async () => {
    handlers.set('settings:get', async () =>
      success({
        success: true,
        value: [
          {
            id: 'cli-one',
            selectedModel: 'chosen',
            tierMappings: { sonnet: 'everyday' },
            apiKey: 'must-not-enter-state',
          },
        ],
      }),
    );
    await service.refreshCliModels();
    expect(service.cliModels().data).toEqual({
      'cli-one': {
        selectedModel: 'chosen',
        tierMappings: { sonnet: 'everyday' },
      },
    });
    expect(JSON.stringify(service.cliModels())).not.toContain(
      'must-not-enter-state',
    );
    handlers.set('settings:get', async () =>
      success({ success: true, value: [{ id: 'cli-one', selectedModel: 42 }] }),
    );
    await service.refreshCliModels();
    expect(service.cliModels().status).toBe('error');
    expect(service.cliAgents().status).toBe('unloaded');
  });
  it('keeps the existing host OAuth marker inside the state-owned CLI create command', async () => {
    handlers.set('ptahCli:create', async () => success({ success: true }));
    await service.saveSettings(
      {
        cli: [
          {
            action: 'create',
            params: {
              name: 'Copilot',
              providerId: 'github-copilot',
              apiKey: '',
            },
          },
        ],
      },
      await context(),
    );
    expect(call).toHaveBeenCalledWith(
      'ptahCli:create',
      {
        name: 'Copilot',
        providerId: 'github-copilot',
        apiKey: 'copilot-oauth',
      },
      undefined,
    );
  });

  it('does not fetch on injection or invent a default; loaded-empty differs from unloaded', async () => {
    expect(call).not.toHaveBeenCalled();
    expect(service.route()).toEqual({
      status: 'unloaded',
      data: null,
      error: null,
    });
    expect(service.cliAgents().data).toBeNull();
    expect(service.activeProviderId()).toBeNull();
    await service.open();
    expect(service.cliAgents()).toEqual({
      status: 'ready',
      data: [],
      error: null,
    });
    expect(service.judging().data?.judgeModel).toBe('');
    expect(service.model().data?.model).toBe('pinned-model');
  });

  it('isolates a rejected section and retries it without rereading healthy sections', async () => {
    handlers.set('memory:getTriggers', async () => {
      throw new Error('secret-token');
    });
    await service.open();
    expect(service.memory()).toEqual({
      status: 'error',
      data: null,
      error: 'Could not load this section. Retry.',
    });
    expect(service.lanes().status).toBe('ready');
    expect(service.route().status).toBe('ready');
    call.mockClear();
    handlers.set('memory:getTriggers', async () =>
      success({ triggers: memoryResponse }),
    );
    await service.refreshMemory();
    expect(service.memory().status).toBe('ready');
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      'memory:getTriggers',
    ]);
  });

  it('retains saved section data on loading and failure but never keeps a healthy badge', async () => {
    await service.refreshRoute();
    const pending = deferred<RpcResult<unknown>>();
    handlers.set('auth:getEffectiveRoute', () => pending.promise);
    const refresh = service.refreshRoute();
    expect(service.route().status).toBe('loading');
    expect(service.route().data?.driverProviderId).toBe('first');
    expect(service.activeProviderId()).toBeNull();
    pending.resolve(new RpcResult(false, undefined, 'raw secret failure'));
    await refresh;
    expect(service.route().data?.driverProviderId).toBe('first');
    expect(service.route().error).not.toContain('secret');
    expect(service.activeProviderId()).toBeNull();
  });

  it.each([
    'unreachable',
    'needs-key',
    'unauthenticated',
    'not-installed',
    'missing',
  ] as const)('never marks a %s driver active', async (status) => {
    handlers.set('auth:getEffectiveRoute', async () =>
      success(route({ providers: [{ id: 'first', type: 'apiKey', status }] })),
    );
    await service.refreshRoute();
    expect(service.activeProviderId()).toBeNull();
  });

  it.each(['unknown', 'skipped'] as const)(
    'R2.5: marks an uncheckable (%s) driver of a ready route active',
    async (status) => {
      handlers.set('auth:getEffectiveRoute', async () =>
        success(
          route({ providers: [{ id: 'first', type: 'local-native', status }] }),
        ),
      );
      await service.refreshRoute();
      expect(service.activeProviderId()).toBe('first');
    },
  );

  it('R2.5: derives the active provider from the effective route, which never carries probe timestamps', async () => {
    // auth:getEffectiveRoute always returns null probe timestamps (auth-rpc.handlers.ts).
    handlers.set('auth:getEffectiveRoute', async () =>
      success(route({ lastSuccessfulProbeAt: null, lastFailedProbeAt: null })),
    );
    await service.refreshRoute();
    expect(service.activeProviderId()).toBe('first');
    for (const overrides of [
      { ready: false },
      { route: 'unresolved' as const, driverProviderId: null },
      { driverProviderId: 'not-in-catalogue' },
    ]) {
      handlers.set('auth:getEffectiveRoute', async () =>
        success(route({ lastSuccessfulProbeAt: null, ...overrides })),
      );
      await service.refreshRoute();
      expect(service.activeProviderId()).toBeNull();
    }
  });

  it('exposes one active identity and strips diagnostic auth strings', async () => {
    handlers.set('auth:getEffectiveRoute', async () =>
      success(
        route({
          blockers: [
            "authMethod is unset or unrecognized ('private raw value')",
          ],
          driverProviderId: 'second',
        }),
      ),
    );
    await service.refreshRoute();
    expect(service.activeProviderId()).toBe('second');
    expect(service.route().data).not.toHaveProperty(
      'storedAuthMethodDiagnostic',
    );
    expect(JSON.stringify(service.route())).not.toContain('private raw value');
  });

  it('discards a superseded read and invalidates data immediately when the workspace changes', async () => {
    const old = deferred<RpcResult<unknown>>();
    handlers.set('auth:getEffectiveRoute', () => old.promise);
    const first = service.refreshRoute();
    handlers.set('auth:getEffectiveRoute', async () =>
      success(route({ driverProviderId: 'second' })),
    );
    await service.refreshRoute();
    old.resolve(success(route()));
    await first;
    expect(service.activeProviderId()).toBe('second');
    workspace.switchTo('/other');
    expect(service.route().status).toBe('unloaded');
    expect(service.activeProviderId()).toBeNull();
  });

  it('shows mixed sources and only offers host-supported writable targets', async () => {
    scopeResponse = {
      activePath: null,
      entries: [
        entry('authMethod', { scope: 'app' }),
        entry('anthropicProviderId', { scope: 'workspace' }),
        entry('memory.curatorProvider', { supportedTargets: ['global'] }),
      ],
    };
    expect(service.writeScopes('authMethod')).toEqual([]);
    await service.refreshScopes();
    expect(service.groupScope(['authMethod', 'anthropicProviderId'])).toBe(
      'mixed',
    );
    expect(service.groupScope(['missing'])).toBeNull();
    expect(service.writeScopes('memory.curatorProvider')).toEqual(['global']);
    expect(service.writeScopes('authMethod')).toEqual(['global', 'app']);
  });

  // Batch 27b: every host writes and reads its own App layer (`app.vscode.*` in VS Code,
  // `app.electron.*` in the desktop app; backend `resolveAppPrefix`), so `writeScopes` passes the
  // host's `app` target through in both hosts. Only the label differs, and the chat components own it.
  it.each([
    { host: 'VS Code', isElectron: false },
    { host: 'Electron', isElectron: true },
  ])(
    'keeps the App target the host reports ($host host)',
    async ({ isElectron }) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ProvidersSettingsStateService,
          WorkspaceScopeService,
          { provide: ClaudeRpcService, useValue: { call } },
          { provide: VSCodeService, useValue: { isElectron } },
        ],
      });
      TestBed.inject(WorkspaceScopeService).switchTo('/workspace');
      service = TestBed.inject(ProvidersSettingsStateService);
      scopeResponse = {
        activePath: '/workspace',
        entries: [
          entry('authMethod', { scope: 'app', hasOverride: true }),
          entry('provider.apiKey.selectedModel'),
        ],
      };
      await service.refreshScopes();
      expect(service.writeScopes('authMethod')).toEqual([
        'global',
        'app',
        'workspace',
      ]);
      expect(service.writeScopes('provider.apiKey.selectedModel')).toEqual([
        'global',
        'app',
        'workspace',
      ]);
      // A value already stored at App keeps its provenance, so the page can show it.
      expect(service.scopeEntry('authMethod')).toMatchObject({
        scope: 'app',
        hasOverride: true,
      });
    },
  );

  it('requests concrete scope keys and preserves host fallback provenance', async () => {
    const scope = entry('provider.first.selectedModel', {
      scope: 'workspace',
      hasOverride: true,
      fallbackPreview: { scope: 'app', value: 'app-model' },
    });
    scopeResponse = { activePath: '/workspace', entries: [scope] };
    await service.refreshScopes([scope.key]);
    expect(call).toHaveBeenCalledWith(
      'config:getScopes',
      { keys: [scope.key] },
      undefined,
    );
    expect(service.scopeEntry(scope.key)).toEqual(scope);
  });

  it('owns the inherit conversion both directions and writes timeout as a number', async () => {
    const reviewed = await context();
    handlers.set('skillSynthesis:updateSettings', async (params) => {
      const patch = (params as { settings: Record<string, string | number> })
        .settings;
      if (typeof patch['judgeModel'] === 'string')
        judgingResponse.judgeModel = patch['judgeModel'];
      if (typeof patch['judgeProvider'] === 'string')
        judgingResponse.judgeProvider = patch['judgeProvider'];
      if (typeof patch['enhanceTimeoutMs'] === 'number')
        judgingResponse.enhanceTimeoutMs.value = patch['enhanceTimeoutMs'];
      return success({ updated: true });
    });
    await service.saveSettings(
      {
        judging: {
          judgeModel: '   ',
          judgeProvider: 'first',
          enhanceTimeoutMs: 90000,
        },
      },
      reviewed,
    );
    expect(call).toHaveBeenCalledWith(
      'skillSynthesis:updateSettings',
      { settings: { judgeModel: 'inherit' } },
      undefined,
    );
    expect(call).toHaveBeenCalledWith(
      'skillSynthesis:updateSettings',
      { settings: { enhanceTimeoutMs: 90000 } },
      undefined,
    );
    expect(service.judging().data).toEqual({
      judgeProvider: 'first',
      judgeModel: '',
      enhanceTimeoutMs: {
        value: 90000,
        default: 120000,
        min: 15000,
        max: 600000,
      },
    });
    expect(service.commit().status).toBe('saved');
  });

  it('names saved and unsaved fields after partial failure and refreshes effective values', async () => {
    const reviewed = await context();
    handlers.set('memory:setTriggers', async () => {
      memoryResponse = { ...memoryResponse, curatorProvider: 'second' };
      return success({ triggers: memoryResponse });
    });
    handlers.set(
      'skillSynthesis:updateSettings',
      async () => new RpcResult(false, undefined, 'secret error'),
    );
    await service.saveSettings(
      {
        memory: { curatorProvider: 'second' },
        judging: { judgeModel: 'wanted' },
      },
      reviewed,
    );
    // D15 (deliberate change): an error envelope throws in require(), so the host may have written.
    // The field is unconfirmed, not unsaved, and read-back no longer runs after the throw.
    expect(service.commit()).toMatchObject({
      status: 'unconfirmed',
      saved: ['memory.curatorProvider'],
      unsaved: [],
      unconfirmed: ['skillSynthesis.judgeModel'],
    });
    expect(service.memory().data?.curatorProvider).toBe('second');
    expect(service.judging().data?.judgeModel).toBe('');
  });

  it('D15: a thrown write is unconfirmed even when read-back would match, and is never saved', async () => {
    const reviewed = await context();
    handlers.set('memory:setTriggers', async () => {
      memoryResponse = { ...memoryResponse, curatorModel: 'persisted' };
      throw new Error('response failed after write');
    });
    await service.saveSettings(
      { memory: { curatorModel: 'persisted' } },
      reviewed,
    );
    // D15 (deliberate change): this spec used to assert saved: ['memory.curatorModel'].
    expect(service.commit()).toMatchObject({
      status: 'unconfirmed',
      saved: [],
      unsaved: [],
      unconfirmed: ['memory.curatorModel'],
    });
    // The post-commit refresh still shows what the host holds.
    expect(service.memory().data?.curatorModel).toBe('persisted');
  });
  it('D15: a write the host rejects is unsaved and skips a read-back that would match', async () => {
    const reviewed = await context();
    handlers.set('agent:setConfig', async () => success({ success: false }));
    // The stored value already equals the request: read-back alone would have claimed "Saved".
    handlers.set('agent:getConfig', async () =>
      success({
        codexModel: 'gpt-x',
        copilotModel: '',
        cursorModel: '',
        codexReasoningEffort: '',
        copilotReasoningEffort: '',
        cursorApiKeyConfigured: false,
        cursorApiKeyStored: false,
        cursorApiKeyEnvSet: false,
      }),
    );
    call.mockClear();
    await service.saveSettings(
      { orchestration: { codexModel: 'gpt-x' } },
      reviewed,
    );
    expect(service.commit()).toMatchObject({
      status: 'failed',
      saved: [],
      unsaved: ['agentOrchestration.codexModel'],
      unconfirmed: [],
    });
    // The only agent:getConfig read is the post-commit refresh, not a read-back.
    expect(
      call.mock.calls.filter(([method]) => method === 'agent:getConfig'),
    ).toHaveLength(1);
  });
  it('D15: an acknowledged write whose read-back mismatches is unsaved', async () => {
    const reviewed = await context();
    // Acknowledged, but the host kept (or another writer restored) a different value.
    handlers.set('memory:setTriggers', async () =>
      success({ triggers: memoryResponse }),
    );
    await service.saveSettings(
      { memory: { curatorModel: 'wanted' } },
      reviewed,
    );
    expect(service.commit()).toMatchObject({
      status: 'failed',
      saved: [],
      unsaved: ['memory.curatorModel'],
      unconfirmed: [],
    });
  });

  it('does not claim rollback when auth can have partially written and never stores secrets', async () => {
    const reviewed = await context();
    handlers.set('auth:saveSettings', async () => {
      throw new Error('my-raw-secret');
    });
    await service.saveSettings(
      { auth: { authMethod: 'apiKey', providerApiKey: 'my-raw-secret' } },
      reviewed,
    );
    expect(service.commit()).toMatchObject({
      status: 'unconfirmed',
      unconfirmed: ['authMethod', 'providerApiKey'],
    });
    expect(JSON.stringify(service.commit())).not.toContain('my-raw-secret');
    expect(call).toHaveBeenCalledWith(
      'auth:getEffectiveRoute',
      { refresh: true },
      undefined,
    );
  });

  it('withholds a badge until the post-save effective route reread completes', async () => {
    await service.open();
    const reviewed = service.reviewContext();
    if (!reviewed) throw new Error('Expected context');
    const reread = deferred<RpcResult<unknown>>();
    const started = deferred<void>();
    handlers.set('auth:saveSettings', async () => {
      handlers.set('auth:getEffectiveRoute', () => {
        started.resolve();
        return reread.promise;
      });
      return success({ success: true });
    });
    const save = service.saveSettings(
      { auth: { authMethod: 'apiKey', anthropicProviderId: 'second' } },
      reviewed,
    );
    await started.promise;
    expect(service.commit().status).toBe('saving');
    expect(service.activeProviderId()).toBeNull();
    expect(service.route().data?.driverProviderId).toBe('first');
    reread.resolve(success(route({ driverProviderId: 'second' })));
    await save;
    expect(service.activeProviderId()).toBe('second');
  });

  it('blocks stale workspace drafts and unsupported auth write scopes', async () => {
    const reviewed = await context();
    scopeResponse = { ...scopeResponse, activePath: '/other' };
    await service.saveSettings(
      { auth: { authMethod: 'apiKey', applyTo: 'workspace' } },
      reviewed,
    );
    expect(service.commit().status).toBe('blocked');
    expect(
      call.mock.calls.some(([method]) => method === 'auth:saveSettings'),
    ).toBe(false);
    scopeResponse = {
      activePath: '/workspace',
      entries: [entry('authMethod', { supportedTargets: ['global'] })],
    };
    await service.saveSettings(
      { auth: { authMethod: 'apiKey', applyTo: 'app' } },
      reviewed,
    );
    expect(service.commit().status).toBe('blocked');
  });

  it('refreshes after both clear paths and never claims global when an app layer remains', async () => {
    scopeResponse.entries = [
      entry('authMethod', { hasOverride: true, scope: 'workspace' }),
    ];
    const reviewed = await context();
    handlers.set('config:clearScopeOverride', async () =>
      success({
        success: true,
        cleared: ['workspace-key'],
        resolvesFrom: 'app',
      }),
    );
    handlers.set('auth:clearWorkspaceOverride', async () =>
      success({ success: true }),
    );
    await service.clearScopeOverride(
      'authMethod',
      'all-above-global',
      reviewed,
    );
    expect(service.commit().status).toBe('failed');
    await service.clearWorkspaceOverride(reviewed);
    expect(service.commit().status).toBe('saved');
    expect(
      call.mock.calls.filter(([method]) => method === 'auth:getEffectiveRoute'),
    ).toHaveLength(2);
    expect(
      call.mock.calls.filter(
        ([method]) => method === 'config:clearScopeOverride',
      ),
    ).toHaveLength(1);
  });

  it('reports a readback failure separately from acknowledged writes', async () => {
    const reviewed = await context();
    handlers.set('auth:saveSettings', async () => success({ success: true }));
    handlers.set(
      'auth:getEffectiveRoute',
      async () => new RpcResult(false, undefined, 'raw failure'),
    );
    await service.saveSettings({ auth: { authMethod: 'apiKey' } }, reviewed);
    expect(service.commit()).toMatchObject({
      saved: ['authMethod'],
      refreshFailed: true,
    });
    expect(service.activeProviderId()).toBeNull();
  });

  it('uses draft verification without saving, aborts superseded work and discards late results', async () => {
    const old = deferred<RpcResult<unknown>>();
    handlers.set('auth:verifyDraftConnection', (params) => {
      const id = (params as { probeId: string }).probeId;
      return id === 'old' ? old.promise : Promise.resolve(success(probe(id)));
    });
    const first = service.verifyDraft({
      probeId: 'old',
      providerId: 'first',
      authMode: 'apiKey',
      credential: { kind: 'apiKey', value: 'secret' },
    });
    await service.verifyDraft({
      probeId: 'new',
      providerId: 'second',
      authMode: 'apiKey',
    });
    old.resolve(success(probe('old')));
    await first;
    expect(service.verification().data?.probeId).toBe('new');
    expect(call).toHaveBeenCalledWith(
      'auth:cancelDraftVerification',
      { probeId: 'old' },
      undefined,
    );
    expect(
      call.mock.calls.some(([method]) => method === 'auth:saveSettings'),
    ).toBe(false);
    expect(JSON.stringify(service.verification())).not.toContain('secret');
  });

  it('cancels a draft on the host and ignores its eventual success', async () => {
    const pending = deferred<RpcResult<unknown>>();
    handlers.set('auth:verifyDraftConnection', () => pending.promise);
    const checking = service.verifyDraft({
      probeId: 'cancel',
      providerId: 'first',
      authMode: 'apiKey',
    });
    await service.cancelVerification();
    pending.resolve(success(probe('cancel')));
    await checking;
    expect(service.verification().data).toBeNull();
    expect(call).toHaveBeenCalledWith(
      'auth:cancelDraftVerification',
      { probeId: 'cancel' },
      undefined,
    );
  });

  it('does not accept a mismatched probe identifier', async () => {
    handlers.set('auth:verifyDraftConnection', async () =>
      success(probe('wrong')),
    );
    await service.verifyDraft({
      probeId: 'requested',
      providerId: 'first',
      authMode: 'apiKey',
    });
    expect(service.verification().status).toBe('error');
    expect(service.verification().data).toBeNull();
  });

  it('makes no polling calls after opening', async () => {
    jest.useFakeTimers();
    try {
      await service.open();
      const count = call.mock.calls.length;
      jest.advanceTimersByTime(60000);
      expect(call).toHaveBeenCalledTimes(count);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retains tier mappings during a same-provider retry but clears them for another provider', async () => {
    handlers.set('provider:getModelTiers', async () =>
      success({ sonnet: 'saved-model', opus: null, haiku: null }),
    );
    await service.refreshTiers({ providerId: 'first', scope: 'mainAgent' });
    const pending = deferred<RpcResult<unknown>>();
    handlers.set('provider:getModelTiers', () => pending.promise);
    const retry = service.refreshTiers({
      providerId: 'first',
      scope: 'mainAgent',
    });
    expect(service.tiers().data?.sonnet).toBe('saved-model');
    pending.resolve(new RpcResult(false, undefined, 'raw failure'));
    await retry;
    expect(service.tiers().data?.sonnet).toBe('saved-model');
    await service.refreshTiers({ providerId: 'second', scope: 'mainAgent' });
    expect(service.tiers().data).toBeNull();
  });

  it('rejects concurrent commits without replacing the in-flight feedback', async () => {
    const reviewed = await context();
    const pending = deferred<RpcResult<unknown>>();
    const started = deferred<void>();
    handlers.set('auth:saveSettings', () => {
      started.resolve();
      return pending.promise;
    });
    const first = service.saveSettings(
      { auth: { authMethod: 'apiKey' } },
      reviewed,
    );
    await started.promise;
    await service.saveSettings({ auth: { authMethod: 'apiKey' } }, reviewed);
    expect(service.commit().status).toBe('saving');
    pending.resolve(success({ success: true }));
    await first;
    expect(
      call.mock.calls.filter(([method]) => method === 'auth:saveSettings'),
    ).toHaveLength(1);
  });

  it('tells the caller a save was refused while another is in flight, for every commit command', async () => {
    const reviewed = await verifiedConnection();
    const pending = deferred<RpcResult<unknown>>();
    const started = deferred<void>();
    handlers.set('auth:saveSettings', () => {
      started.resolve();
      return pending.promise;
    });
    const first = service.saveSettings(
      { auth: { authMethod: 'apiKey' } },
      reviewed,
    );
    await started.promise;
    call.mockClear();
    const refused = await Promise.all([
      service.saveSettings({ memory: { curatorModel: 'x' } }, reviewed),
      service.connectProvider(connectionDraft(), reviewed),
      // An unverifiable draft would otherwise set 'blocked' over the in-flight feedback.
      service.connectProvider(
        connectionDraft({ saveTo: 'workspace' }),
        reviewed,
      ),
      service.activateConnection('openrouter', 'global', reviewed),
      service.clearWorkspaceOverride(reviewed),
      service.clearScopeOverride('authMethod', 'nearest', reviewed),
      service.saveCursorCredential('key', reviewed),
    ]);
    expect(refused).toEqual([false, false, false, false, false, false, false]);
    expect(service.commit().status).toBe('saving');
    expect(call).not.toHaveBeenCalled();
    pending.resolve(success({ success: true }));
    await expect(first).resolves.toBe(true);
    expect(service.commit().status).toBe('saved');
  });

  it('stops the remaining writes if workspace changes during a commit', async () => {
    const reviewed = await context();
    handlers.set('auth:saveSettings', async () => {
      workspace.switchTo('/other');
      scopeResponse = { ...scopeResponse, activePath: '/other' };
      return success({ success: true });
    });
    await service.saveSettings(
      {
        auth: { authMethod: 'apiKey' },
        memory: { curatorModel: 'never-sent' },
      },
      reviewed,
    );
    expect(service.commit()).toMatchObject({
      unconfirmed: ['authMethod'],
      unsaved: ['memory.curatorModel'],
    });
    expect(
      call.mock.calls.some(([method]) => method === 'memory:setTriggers'),
    ).toBe(false);
  });

  it('marks an acknowledged field unconfirmed when its readback fails', async () => {
    const reviewed = await context();
    handlers.set('memory:setTriggers', async () =>
      success({ triggers: memoryResponse }),
    );
    handlers.set('memory:getTriggers', async () => {
      throw new Error('raw failure');
    });
    await service.saveSettings(
      { memory: { curatorModel: 'new-model' } },
      reviewed,
    );
    expect(service.commit()).toMatchObject({
      status: 'unconfirmed',
      saved: [],
      unconfirmed: ['memory.curatorModel'],
      refreshFailed: true,
    });
  });

  it('does not trust a global-clear acknowledgement when the reread still shows an override', async () => {
    scopeResponse.entries = [
      entry('authMethod', { hasOverride: true, scope: 'workspace' }),
    ];
    const reviewed = await context();
    handlers.set('config:clearScopeOverride', async () =>
      success({ success: true, cleared: ['old'], resolvesFrom: 'global' }),
    );
    await service.clearScopeOverride(
      'authMethod',
      'all-above-global',
      reviewed,
    );
    expect(service.commit()).toMatchObject({
      status: 'failed',
      unsaved: ['authMethod'],
    });
  });

  it('routes lane and tier assignments through their owners, preserving tier usage scope', async () => {
    const reviewed = await context();
    const savedLanes = lanes();
    handlers.set('skillSynthesis:setLanes', async () => {
      handlers.set('skillSynthesis:getLanes', async () =>
        success({
          lanes: {
            ...savedLanes,
            judge: { ...savedLanes.judge, provider: 'second' },
          },
        }),
      );
      return success({ lanes: savedLanes });
    });
    handlers.set('provider:setModelTier', async () => {
      handlers.set('provider:getModelTiers', async () =>
        success({ sonnet: null, opus: null, haiku: 'tier-model' }),
      );
      return success({ success: true });
    });
    await service.saveSettings(
      {
        lanes: { judge: { provider: 'second' } },
        tiers: [
          {
            providerId: 'second',
            scope: 'cliAgent',
            tier: 'haiku',
            modelId: 'tier-model',
          },
        ],
      },
      reviewed,
    );
    expect(service.commit().status).toBe('saved');
    expect(call).toHaveBeenCalledWith(
      'skillSynthesis:setLanes',
      { lanes: { judge: { provider: 'second' } } },
      undefined,
    );
    expect(call).toHaveBeenCalledWith(
      'provider:setModelTier',
      {
        providerId: 'second',
        scope: 'cliAgent',
        tier: 'haiku',
        modelId: 'tier-model',
      },
      undefined,
    );
  });

  it('preserves classified draft failures without mutating the main route', async () => {
    await service.refreshRoute();
    handlers.set('auth:verifyDraftConnection', async () =>
      success({
        ...probe('failure'),
        outcome: 'failed',
        reason: 'permission-denied',
        detail: 'This account cannot use this model.',
      }),
    );
    await service.verifyDraft({
      probeId: 'failure',
      providerId: 'second',
      authMode: 'apiKey',
    });
    expect(service.verification().data?.reason).toBe('permission-denied');
    expect(service.activeProviderId()).toBe('first');
    expect(
      call.mock.calls.some(([method]) => method === 'auth:saveSettings'),
    ).toBe(false);
  });

  it('names each rejected CLI update field without retaining its credential', async () => {
    const reviewed = await context();
    handlers.set('ptahCli:update', async () =>
      success({ success: false, error: 'raw-key' }),
    );
    await service.saveSettings(
      {
        cli: [
          {
            action: 'update',
            params: { id: 'agent-id', name: 'Worker', apiKey: 'raw-key' },
          },
        ],
      },
      reviewed,
    );
    // D15 (deliberate change): `success:false` is a rejection, so the fields are unsaved (was unconfirmed).
    expect(service.commit()).toMatchObject({
      status: 'failed',
      unconfirmed: [],
    });
    expect(service.commit().unsaved).toEqual([
      'ptahCliAgents.agent-id.name',
      'ptahCliAgents.agent-id.apiKey',
    ]);
    expect(JSON.stringify(service.commit())).not.toContain('raw-key');
  });

  describe('Cursor credential read-back (551)', () => {
    /** Host secret store behind agent:setConfig/getConfig, with CURSOR_API_KEY set or not. */
    function cursorHost(envSet: boolean, initiallyStored: boolean) {
      const host = { stored: initiallyStored, ignoreWrites: false };
      handlers.set('agent:setConfig', async (params) => {
        const key = (params as { cursorApiKey?: string }).cursorApiKey;
        if (key !== undefined && !host.ignoreWrites) host.stored = !!key.trim();
        return success({ success: true });
      });
      handlers.set('agent:getConfig', async () =>
        success({
          codexModel: '',
          copilotModel: '',
          cursorModel: '',
          codexReasoningEffort: '',
          copilotReasoningEffort: '',
          cursorApiKeyConfigured: envSet || host.stored,
          cursorApiKeyStored: host.stored,
          cursorApiKeyEnvSet: envSet,
        }),
      );
      return host;
    }

    it.each([true, false])(
      'saves and then clears the stored key with CURSOR_API_KEY set=%s',
      async (envSet) => {
        const reviewed = await context();
        const host = cursorHost(envSet, false);
        await expect(
          service.saveCursorCredential('cursor-secret', reviewed),
        ).resolves.toBe(true);
        expect(host.stored).toBe(true);
        expect(service.commit()).toMatchObject({
          status: 'saved',
          saved: ['Cursor credential'],
        });
        await service.saveCursorCredential('', reviewed);
        expect(host.stored).toBe(false);
        // With the env var set, cursorApiKeyConfigured stays true after the clear; it is not the read-back.
        expect(service.commit()).toMatchObject({
          status: 'saved',
          saved: ['Cursor credential'],
        });
        expect(JSON.stringify(service.commit())).not.toContain('cursor-secret');
      },
    );
    it('reports a clear the store did not apply as not saved, even though the env var is set', async () => {
      const reviewed = await context();
      const host = cursorHost(true, true);
      host.ignoreWrites = true;
      await service.saveCursorCredential('   ', reviewed);
      expect(service.commit()).toMatchObject({
        status: 'failed',
        saved: [],
        unsaved: ['Cursor credential'],
      });
    });
    it('never reports "Saved" when the secret store cannot be read back', async () => {
      const reviewed = await context();
      cursorHost(true, false);
      handlers.set(
        'agent:getConfig',
        async () => new RpcResult(false, undefined, 'keychain unavailable'),
      );
      await service.saveCursorCredential('cursor-secret', reviewed);
      expect(service.commit()).toMatchObject({
        status: 'unconfirmed',
        saved: [],
        unconfirmed: ['Cursor credential'],
        refreshFailed: true,
      });
      // The orchestration section reports its own read error (Retry), not a stale value.
      expect(service.orchestration()).toMatchObject({
        status: 'error',
        error: 'Could not load this section. Retry.',
      });
      expect(JSON.stringify(service.commit())).not.toContain('keychain');
    });
  });

  describe('reads for the redesigned Settings page (Component 7)', () => {
    // refreshConnections registers custom entries in the shared provider registry.
    afterEach(() => setCustomProviderEntries([]));
    const detected = [{ cli: 'codex', installed: true, messagingMode: 'none' }];
    const fullConfig = {
      codexModel: 'gpt-x',
      copilotModel: '',
      cursorModel: '',
      antigravityModel: '',
      grokModel: '',
      opencodeModel: '',
      piModel: '',
      codexReasoningEffort: 'high',
      copilotReasoningEffort: '',
      piReasoningEffort: '',
      detectedClis: detected,
      disabledClis: ['copilot'],
      preferredAgentOrder: ['codex', 'ptah-cli-1'],
      maxConcurrentAgents: 3,
      copilotAutoApprove: false,
      cursorApiKeyConfigured: true,
      cursorApiKeyStored: true,
      cursorApiKeyEnvSet: false,
      // Fields the page does not render never enter the section.
      mcpPort: 51820,
      disabledMcpNamespaces: ['browser'],
    };

    it('projects the CLI matrix inputs and Cursor flags, and nothing else', async () => {
      handlers.set('agent:getConfig', async () => success(fullConfig));
      await service.refreshOrchestration();
      const { mcpPort, disabledMcpNamespaces, ...expected } = fullConfig;
      void mcpPort;
      void disabledMcpNamespaces;
      // A host without the TTL fields reads as 'auto' with no env override.
      expect(service.orchestration()).toEqual({
        status: 'ready',
        data: { ...expected, subagentPromptCacheTtl: 'auto' },
        error: null,
      });
      expect(
        service.orchestration().data?.subagentPromptCacheTtlEnvOverride,
      ).toBeUndefined();
    });

    it('reads the subagent prompt-cache TTL setting and its env override', async () => {
      handlers.set('agent:getConfig', async () =>
        success({
          ...fullConfig,
          subagentPromptCacheTtl: '5m',
          subagentPromptCacheTtlEnvOverride: 'invalid',
        }),
      );
      await service.refreshOrchestration();
      expect(service.orchestration().data).toMatchObject({
        subagentPromptCacheTtl: '5m',
        subagentPromptCacheTtlEnvOverride: 'invalid',
      });
    });

    it('reads an unknown subagent prompt-cache TTL value as auto', async () => {
      handlers.set('agent:getConfig', async () =>
        success({ ...fullConfig, subagentPromptCacheTtl: '10m' }),
      );
      await service.refreshOrchestration();
      expect(service.orchestration().data?.subagentPromptCacheTtl).toBe('auto');
    });

    it('drops a stale "Set" Cursor flag when agent:getConfig fails, and shows Retry', async () => {
      handlers.set('agent:getConfig', async () => success(fullConfig));
      await service.refreshOrchestration();
      handlers.set(
        'agent:getConfig',
        async () => new RpcResult(false, undefined, 'keychain unavailable'),
      );
      await service.refreshOrchestration();
      expect(service.orchestration()).toEqual({
        status: 'error',
        data: null,
        error: 'Could not load this section. Retry.',
      });
    });

    it('re-detects CLIs, then rereads orchestration, CLI agents and CLI models', async () => {
      const order: string[] = [];
      const record = (method: RpcMethodName, data: unknown) =>
        handlers.set(method, async () => {
          order.push(method);
          return success(data);
        });
      record('agent:detectClis', { clis: detected });
      record('agent:getConfig', fullConfig);
      record('ptahCli:list', { agents: [] });
      record('settings:get', { success: true, value: [] });
      await expect(service.redetectClis()).resolves.toBe(true);
      expect(order[0]).toBe('agent:detectClis');
      expect([...order.slice(1)].sort()).toEqual([
        'agent:getConfig',
        'ptahCli:list',
        'settings:get',
      ]);
      expect(service.cliDetection()).toMatchObject({
        status: 'ready',
        data: detected,
      });
      expect(service.orchestration().data?.detectedClis).toEqual(detected);
    });

    it('rereads nothing when detection fails and reports it on cliDetection', async () => {
      handlers.set(
        'agent:detectClis',
        async () => new RpcResult(false, undefined, 'raw detection failure'),
      );
      call.mockClear();
      await expect(service.redetectClis()).resolves.toBe(false);
      expect(call.mock.calls.map(([method]) => method)).toEqual([
        'agent:detectClis',
      ]);
      expect(service.cliDetection()).toEqual({
        status: 'error',
        data: null,
        error: 'Could not load this section. Retry.',
      });
    });

    it.each([
      ['the first fails and the second succeeds', false, true],
      ['the first succeeds and the second fails', true, false],
    ])(
      'overlapping re-detects each cascade on their own result: %s',
      async (_label, firstOk, secondOk) => {
        const first = deferred<RpcResult<unknown>>();
        const second = deferred<RpcResult<unknown>>();
        const pending = [first, second];
        handlers.set('agent:detectClis', () => {
          const next = pending.shift();
          if (!next) throw new Error('Unexpected detection');
          return next.promise;
        });
        handlers.set('agent:getConfig', async () => success(fullConfig));
        const outcome = (ok: boolean) =>
          ok
            ? success({ clis: detected })
            : new RpcResult(false, undefined, 'raw failure');
        call.mockClear();
        const calls = [service.redetectClis(), service.redetectClis()];
        // Resolve in reverse order so the shared section ends up describing the other call.
        second.resolve(outcome(secondOk));
        first.resolve(outcome(firstOk));
        // Each call reports its own outcome, whatever the shared section says now.
        expect(await Promise.all(calls)).toEqual([firstOk, secondOk]);
        // Exactly one call detected successfully, so exactly one cascade ran.
        expect(
          call.mock.calls.filter(([method]) => method === 'agent:getConfig'),
        ).toHaveLength(1);
        expect(
          call.mock.calls.filter(([method]) => method === 'ptahCli:list'),
        ).toHaveLength(1);
        expect(
          call.mock.calls.filter(([method]) => method === 'settings:get'),
        ).toHaveLength(1);
      },
    );

    it('keeps the test latency; a failure reason is fixed copy for the registry fixed strings, never host text (M1)', async () => {
      handlers.set('ptahCli:testConnection', async () =>
        success({
          success: false,
          latencyMs: 812,
          error: 'Invalid API key for org acme-corp',
        }),
      );
      await service.testCliConnection('agent-1');
      expect(service.cliTest().data).toEqual({
        id: 'agent-1',
        success: false,
        latencyMs: 812,
        reason: null,
      });
      expect(JSON.stringify(service.cliTest())).not.toContain('acme');
      handlers.set('ptahCli:testConnection', async () =>
        success({ success: false, error: 'API key not configured' }),
      );
      await service.testCliConnection('agent-1');
      expect(service.cliTest().data?.reason).toBe(
        'No API key is stored for this instance.',
      );
      handlers.set('ptahCli:testConnection', async () =>
        success({
          success: false,
          error: 'No response received from provider',
        }),
      );
      await service.testCliConnection('agent-1');
      expect(service.cliTest().data?.reason).toBe(
        'The provider did not respond.',
      );
      handlers.set('ptahCli:testConnection', async () =>
        success({ success: true, latencyMs: 90, error: 'ignored' }),
      );
      await service.testCliConnection('agent-1');
      expect(service.cliTest().data).toEqual({
        id: 'agent-1',
        success: true,
        latencyMs: 90,
        reason: null,
      });
      handlers.set('ptahCli:testConnection', async () =>
        success({ success: true }),
      );
      await service.testCliConnection('agent-2');
      expect(service.cliTest().data).toEqual({
        id: 'agent-2',
        success: true,
        latencyMs: null,
        reason: null,
      });
      handlers.set(
        'ptahCli:testConnection',
        async () => new RpcResult(false, undefined, 'raw transport text'),
      );
      await service.testCliConnection('agent-3');
      expect(service.cliTest().status).toBe('error');
      expect(JSON.stringify(service.cliTest())).not.toContain(
        'raw transport text',
      );
    });

    it('S1: a new Test drops the earlier pass at once, and a failed or timed-out run never keeps it', async () => {
      handlers.set('ptahCli:testConnection', async () =>
        success({ success: true, latencyMs: 900 }),
      );
      await service.testCliConnection('agent-1');
      expect(service.cliTest().data).toMatchObject({
        id: 'agent-1',
        success: true,
      });
      const pending = deferred<RpcResult<unknown>>();
      handlers.set('ptahCli:testConnection', () => pending.promise);
      const run = service.testCliConnection('agent-1');
      // While this run is loading, nothing of the earlier pass is visible.
      expect(service.cliTest()).toMatchObject({
        status: 'loading',
        data: null,
      });
      pending.resolve(new RpcResult(false, undefined, 'Request timed out'));
      await run;
      expect(service.cliTest()).toMatchObject({ status: 'error', data: null });
    });

    it('S1: the Test RPC timeout is above the host 30 s abort', async () => {
      handlers.set('ptahCli:testConnection', async () =>
        success({ success: true, latencyMs: 1 }),
      );
      call.mockClear();
      await service.testCliConnection('agent-1');
      const testCall = call.mock.calls.find(
        ([method]) => method === 'ptahCli:testConnection',
      );
      expect(testCall?.[2]).toEqual({ timeout: 45_000 });
    });

    it('M8: clearCliTest drops that instance result (and an in-flight run for it), never another instance result', async () => {
      handlers.set('ptahCli:testConnection', async () =>
        success({ success: true, latencyMs: 5 }),
      );
      await service.testCliConnection('agent-1');
      service.clearCliTest('agent-2');
      expect(service.cliTest().data?.id).toBe('agent-1');
      service.clearCliTest('agent-1');
      expect(service.cliTest()).toMatchObject({
        status: 'unloaded',
        data: null,
      });
      const pending = deferred<RpcResult<unknown>>();
      handlers.set('ptahCli:testConnection', () => pending.promise);
      const run = service.testCliConnection('agent-1');
      service.clearCliTest('agent-1');
      pending.resolve(success({ success: true, latencyMs: 7 }));
      await run;
      expect(service.cliTest().data).toBeNull();
    });

    it('labels the signed-in Copilot account and flags a stale Codex token', async () => {
      handlers.set('auth:getAuthStatus', async () =>
        success({
          authMethod: 'apiKey',
          hasApiKey: false,
          copilotAuthenticated: true,
          copilotUsername: 'octocat',
          codexAuthenticated: true,
          codexTokenStale: true,
        }),
      );
      await service.refreshConnections();
      const byId = (id: string) =>
        service.connections().data?.find((entry) => entry.id === id);
      expect(byId('github-copilot')).toMatchObject({
        accountLabel: 'octocat',
        tokenStale: false,
        configured: true,
      });
      expect(byId('openai-codex')).toMatchObject({
        accountLabel: null,
        tokenStale: true,
        configured: false,
      });
      expect(byId('anthropic')).toMatchObject({
        accountLabel: null,
        tokenStale: false,
      });
      handlers.set('auth:getAuthStatus', async () =>
        success({
          authMethod: 'apiKey',
          hasApiKey: false,
          copilotAuthenticated: false,
          copilotUsername: 'octocat',
        }),
      );
      await service.refreshConnections();
      expect(byId('github-copilot')?.accountLabel).toBeNull();
    });

    it("maps the host's masked key hints onto stored-key connections and drops any other shape (Batch 28d)", async () => {
      const hint = '•••• 8f21';
      handlers.set('auth:getApiKeyStatus', async () =>
        success({
          providers: [
            {
              provider: 'moonshot',
              displayName: 'Moonshot',
              hasApiKey: true,
              isDefault: false,
              keyHint: hint,
            },
            // A whole key, a longer tail and a hint without a stored key never enter state.
            {
              provider: 'openrouter',
              displayName: 'OpenRouter',
              hasApiKey: true,
              isDefault: false,
              keyHint: 'sk-or-v1-0123456789abcdef',
            },
            {
              provider: 'z-ai',
              displayName: 'Z.AI',
              hasApiKey: true,
              isDefault: false,
              keyHint: '•••• abcdefgh',
            },
            {
              provider: 'sakana',
              displayName: 'Sakana',
              hasApiKey: false,
              isDefault: false,
              keyHint: hint,
            },
          ],
        }),
      );
      handlers.set('auth:getAuthStatus', async () =>
        success({
          authMethod: 'apiKey',
          hasApiKey: true,
          apiKeyHint: '•••• wxyz',
        }),
      );
      await service.refreshConnections();
      const byId = (id: string) =>
        service.connections().data?.find((entry) => entry.id === id);
      expect(byId('moonshot')?.keyHint).toBe(hint);
      expect(byId('anthropic')?.keyHint).toBe('•••• wxyz');
      for (const id of ['openrouter', 'z-ai', 'sakana']) {
        expect(byId(id)).toBeDefined();
        expect(Object.hasOwn(byId(id) ?? {}, 'keyHint')).toBe(false);
      }
      expect(JSON.stringify(service.connections())).not.toContain('sk-or-v1');
    });

    it('maps a keyUnreadable row as configured with an unknown key: keyUnreadable set, hasKey false, no hint (final review M-6)', async () => {
      handlers.set('auth:getApiKeyStatus', async () =>
        success({
          providers: [
            {
              provider: 'moonshot',
              displayName: 'Moonshot',
              hasApiKey: false,
              isDefault: false,
              keyUnreadable: true,
            },
            {
              provider: 'openrouter',
              displayName: 'OpenRouter',
              hasApiKey: true,
              isDefault: false,
              keyHint: '•••• 8f21',
            },
          ],
        }),
      );
      await service.refreshConnections();
      const byId = (id: string) =>
        service.connections().data?.find((entry) => entry.id === id);
      expect(byId('moonshot')).toMatchObject({
        keyUnreadable: true,
        hasKey: false,
        configured: true,
      });
      expect(Object.hasOwn(byId('moonshot') ?? {}, 'keyHint')).toBe(false);
      // A readable row carries no flag at all.
      expect(Object.hasOwn(byId('openrouter') ?? {}, 'keyUnreadable')).toBe(
        false,
      );
      expect(byId('openrouter')).toMatchObject({
        hasKey: true,
        configured: true,
      });
    });

    it('reads custom connection metadata with the connections, in one host call', async () => {
      const stored = {
        id: 'my-endpoint',
        name: 'My endpoint',
        baseUrl: 'https://llm.example.test',
        lane: 'openai',
        authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
        keyPrefix: 'sk-',
        helpUrl: 'https://help.example.test',
        modelsEndpoint: '/v1/models',
        pricing: null,
        createdAt: '2026-09-29T00:00:00Z',
      };
      handlers.set('provider:listCustomEntries', async () =>
        success({ entries: [stored] }),
      );
      expect(service.customEntry('my-endpoint')).toBeNull();
      call.mockClear();
      await service.refreshConnections();
      expect(
        call.mock.calls.filter(
          ([method]) => method === 'provider:listCustomEntries',
        ),
      ).toHaveLength(1);
      expect(service.customEntry('my-endpoint')).toEqual({
        id: 'my-endpoint',
        name: 'My endpoint',
        baseUrl: 'https://llm.example.test',
        lane: 'openai',
        modelsEndpoint: '/v1/models',
        helpUrl: 'https://help.example.test',
        pricing: null,
      });
      expect(service.customEntry('unknown')).toBeNull();
      expect(
        service.connections().data?.find((entry) => entry.id === 'my-endpoint')
          ?.custom,
      ).toBe(true);
    });
  });

  describe('writes for the redesigned surface (facade delegation)', () => {
    it('saves a main-agent tier and a CLI instance mapping through commit(), then refreshes the page', async () => {
      const reviewed = await context();
      const store = tierStore({ sonnet: null, opus: null, haiku: null });
      await expect(
        service.setMainAgentTier('openrouter', 'haiku', 'fast-model', reviewed),
      ).resolves.toBe(true);
      expect(store.haiku).toBe('fast-model');
      expect(service.commit()).toMatchObject({
        status: 'saved',
        saved: ['Main agent haiku model'],
      });
      handlers.set('ptahCli:update', async () => success({ success: true }));
      handlers.set('settings:get', async () =>
        success({
          success: true,
          value: [{ id: 'agent-1', tierMappings: { opus: 'big' } }],
        }),
      );
      call.mockClear();
      await expect(
        service.setCliInstanceTiers('agent-1', { opus: 'big' }, reviewed),
      ).resolves.toBe(true);
      expect(call).toHaveBeenCalledWith(
        'ptahCli:update',
        { id: 'agent-1', tierMappings: { opus: 'big' } },
        undefined,
      );
      expect(service.commit()).toMatchObject({
        status: 'saved',
        saved: ['ptahCliAgents.agent-1.tierMappings'],
      });
      expect(call).toHaveBeenCalledWith(
        'auth:getEffectiveRoute',
        { refresh: true },
        undefined,
      );
      expect(service.cliModels().data).toEqual({
        'agent-1': { selectedModel: undefined, tierMappings: { opus: 'big' } },
      });
    });

    it('blocks removing the custom connection that drives the main agent', async () => {
      await service.open();
      const reviewed = service.reviewContext();
      if (!reviewed) throw new Error('Expected context');
      call.mockClear();
      await expect(service.removeCustomEntry('first', reviewed)).resolves.toBe(
        true,
      );
      expect(service.commit()).toMatchObject({
        status: 'blocked',
        message: 'Switch the main agent first.',
      });
      expect(
        call.mock.calls.some(
          ([method]) => method === 'provider:removeCustomEntry',
        ),
      ).toBe(false);
    });
  });
});
