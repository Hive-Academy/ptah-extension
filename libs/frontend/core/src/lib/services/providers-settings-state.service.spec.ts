import { TestBed } from '@angular/core/testing';
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
import { ProvidersSettingsStateService, type ProvidersConnectionDraft } from './providers-settings-state.service';
import { WorkspaceScopeService } from './workspace-scope.service';

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
    preCompact: boolean;
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
      preCompact: true,
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
      ['llm:getProviderBaseUrl', async () => success({ baseUrl: null, defaultBaseUrl: null })],
      ['provider:listCustomEntries', async () => success({ entries: [] })],
      ['auth:getAuthStatus', async () => success({ authMethod: 'apiKey', anthropicProviderId: 'openrouter', availableProviders: [], hasApiKey: false, hasOpenRouterKey: false })],
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

  it('reads model and effort provenance from the current authentication namespace without guessing a group source', async () => {
    handlers.set('auth:getAuthStatus', async () => success({ authMethod: 'thirdParty', anthropicProviderId: 'openrouter' }));
    const modelKey = 'provider.thirdParty.openrouter.selectedModel';
    const effortKey = 'provider.thirdParty.openrouter.reasoningEffort';
    const sources = [entry(modelKey, { scope: 'workspace' }), entry(effortKey)];
    handlers.set('config:getScopes', async (params) => {
      const requested = params as { keys: string[] };
      return success({ activePath: '/workspace', entries: requested.keys.includes(modelKey) ? sources : scopeResponse.entries });
    });
    await service.refreshScopes();
    expect(service.groupScope(['authMethod', 'anthropicProviderId', modelKey, effortKey])).toBeNull();
    await service.refreshMainSources();
    expect(call).toHaveBeenCalledWith('config:getScopes', { keys: [modelKey, effortKey] }, undefined);
    expect(service.mainSources().data).toEqual({ model: sources[0], effort: sources[1] });
    expect(service.writeScopes(modelKey)).toEqual(['global', 'app', 'workspace']);
    expect(service.groupScope(['authMethod', 'anthropicProviderId', modelKey, effortKey])).toBe('mixed');
  });

  async function context() {
    await service.refreshScopes();
    const result = service.reviewContext();
    if (!result) throw new Error('Expected loaded scope');
    return result;
  }

  function connectionDraft(overrides: Partial<ProvidersConnectionDraft> = {}): ProvidersConnectionDraft {
    return { providerId: 'openrouter', displayName: 'OpenRouter', authMode: 'apiKey',
      customName: null, customProtocol: null, credential: { kind: 'apiKey', value: 'private-key' },
      baseUrl: null, verified: { probeId: 'draft-check' },
      tiers: { everyday: 'one', complex: 'two', fast: 'three' }, saveTo: 'global', activation: 'connect-only', ...overrides };
  }
  async function verifiedConnection() {
    handlers.set('auth:verifyDraftConnection', async () => success(probe('draft-check')));
    handlers.set('auth:setApiKey', async () => success({ success: true }));
    handlers.set('provider:setModelTier', async () => success({ success: true }));
    await service.open();
    await service.verifyDraft({ probeId: 'draft-check', providerId: 'openrouter', authMode: 'apiKey' });
    return context();
  }

  it('surfaces a real false cancellation acknowledgement and targets the requested probe', async () => {
    handlers.set('auth:cancelDraftVerification', async () => success({ cancelled: false }));
    expect(await service.cancelVerification({ probeId: 'finished-probe' })).toEqual({ cancelled: false });
    expect(call).toHaveBeenCalledWith('auth:cancelDraftVerification', { probeId: 'finished-probe' }, undefined);
  });

  it('does not cancel a newer verification when an older wizard requests cancellation', async () => {
    const pending = deferred<RpcResult<unknown>>();
    handlers.set('auth:verifyDraftConnection', () => pending.promise);
    const check = service.verifyDraft({ probeId: 'new-probe', providerId: 'openrouter', authMode: 'apiKey' });
    await service.cancelVerification({ probeId: 'old-probe' });
    pending.resolve(success(probe('new-probe')));
    await check;
    expect(service.verification().data?.probeId).toBe('new-probe');
  });

  it('keeps route usable when the catalogue fails and retries the catalogue independently', async () => {
    handlers.set('provider:listCustomEntries', async () => { throw new Error('raw credential'); });
    await service.open();
    expect(service.connections().status).toBe('error');
    expect(service.route().status).toBe('ready');
    handlers.set('provider:listCustomEntries', async () => success({ entries: [] }));
    call.mockClear();
    await service.refreshConnections();
    expect(service.connections().status).toBe('ready');
    expect(call.mock.calls.some(([method]) => method === 'auth:getEffectiveRoute')).toBe(false);
    expect(JSON.stringify(service.connections())).not.toContain('raw credential');
  });

  it('connects without writing main-route settings or main-agent tier mappings', async () => {
    const reviewed = await verifiedConnection(); call.mockClear();
    await service.connectProvider(connectionDraft(), reviewed);
    expect(service.commit().status).toBe('saved');
    expect(call).toHaveBeenCalledWith('auth:setApiKey', { provider: 'openrouter', apiKey: 'private-key' }, undefined);
    expect(call.mock.calls.some(([method]) => method === 'auth:saveSettings' || method === 'llm:setApiKey')).toBe(false);
    expect(call.mock.calls.filter(([method]) => method === 'provider:setModelTier').map(([, params]) => params)).toEqual([
      { providerId: 'openrouter', tier: 'sonnet', modelId: 'one', scope: 'cliAgent' },
      { providerId: 'openrouter', tier: 'opus', modelId: 'two', scope: 'cliAgent' },
      { providerId: 'openrouter', tier: 'haiku', modelId: 'three', scope: 'cliAgent' },
    ]);
    expect(JSON.stringify(service.commit())).not.toContain('private-key');
  });
  it('distinguishes a persisted local endpoint from a shipped endpoint default', async () => {
    handlers.set('llm:getProviderBaseUrl', async () => success({ baseUrl: null, defaultBaseUrl: 'http://localhost:11434' }));
    await service.refreshConnections();
    expect(service.connections().data?.find((entry) => entry.id === 'ollama')?.configured).toBe(false);
    handlers.set('llm:getProviderBaseUrl', async () => success({ baseUrl: 'http://localhost:11434', defaultBaseUrl: 'http://localhost:11434' }));
    await service.refreshConnections();
    expect(service.connections().data?.find((entry) => entry.id === 'ollama')?.configured).toBe(true);
  });

  it('does not activate after an unconfirmed credential write', async () => {
    const reviewed = await verifiedConnection();
    handlers.set('auth:setApiKey', async () => { throw new Error('secret'); }); call.mockClear();
    await service.connectProvider(connectionDraft({ activation: 'use-main-agent' }), reviewed);
    expect(service.commit().unconfirmed).toContain('Connection credential');
    expect(service.commit().unsaved).toContain('authMethod');
    expect(call.mock.calls.some(([method]) => method === 'auth:saveSettings')).toBe(false);
  });
  it('activates before copying the saved connection models over host defaults', async () => {
    const reviewed = await verifiedConnection();
    handlers.set('provider:getModelTiers', async () => success({ sonnet: 'one', opus: 'two', haiku: 'three' }));
    handlers.set('auth:saveSettings', async () => success({ success: true })); call.mockClear();
    await service.activateConnection('openrouter', 'global', reviewed);
    const writes = call.mock.calls.filter(([method]) => method === 'auth:saveSettings' || method === 'provider:setModelTier');
    expect(writes.map(([method]) => method)).toEqual(['auth:saveSettings', 'provider:setModelTier', 'provider:setModelTier', 'provider:setModelTier']);
    expect(writes[1][1]).toEqual({ providerId: 'openrouter', tier: 'sonnet', modelId: 'one', scope: 'mainAgent' });
    expect(service.commit().status).toBe('saved');
  });
  it('does not activate when the stored connection models could not be read', async () => {
    const reviewed = await verifiedConnection();
    handlers.set('provider:getModelTiers', async () => { throw new Error('raw failure'); }); call.mockClear();
    await service.activateConnection('openrouter', 'global', reviewed);
    expect(service.commit().status).toBe('blocked');
    expect(call.mock.calls.some(([method]) => method === 'auth:saveSettings')).toBe(false);
  });

  it('creates custom metadata separately from its credential without activating', async () => {
    const reviewed = await verifiedConnection();
    await service.verifyDraft({ probeId: 'draft-check', providerId: 'my-endpoint', authMode: 'custom' });
    handlers.set('provider:addCustomEntry', async (params) => success({ entry: params })); call.mockClear();
    await service.connectProvider(connectionDraft({ providerId: 'my-endpoint', customName: 'My endpoint',
      authMode: 'custom', customProtocol: 'openai', baseUrl: 'http://localhost:8080' }), reviewed);
    const metadata = call.mock.calls.find(([method]) => method === 'provider:addCustomEntry')?.[1];
    expect(metadata).toMatchObject({ entry: { id: 'my-endpoint', lane: 'openai', name: 'My endpoint' } });
    expect(JSON.stringify(metadata)).not.toContain('private-key');
    expect(service.commit().status).toBe('saved');
  });

  it('blocks stale workspace context and unsupported setup scope before writing credentials', async () => {
    const reviewed = await verifiedConnection(); call.mockClear();
    await service.connectProvider(connectionDraft({ saveTo: 'workspace' }), reviewed);
    expect(service.commit().status).toBe('blocked');
    expect(call).not.toHaveBeenCalled();
    workspace.switchTo('/another-workspace');
    await service.connectProvider(connectionDraft(), reviewed);
    expect(service.commit().status).toBe('blocked');
    expect(call.mock.calls.some(([method]) => method === 'auth:setApiKey')).toBe(false);
  });

  it('does not claim a launched Codex login is authenticated', async () => {
    handlers.set('auth:codexLogin', async () => success({ success: true }));
    handlers.set('auth:getAuthStatus', async () => success({ codexAuthenticated: false }));
    await service.performExternalAuth('openai-codex', 'sign-in');
    expect(service.externalAuth().data?.signInState).toBe('idle');
    expect(service.externalAuth().data?.message).toContain('not been confirmed');
  });

  it('does not fabricate external cancellation or guess the wizard provider', async () => {
    await service.performExternalAuth(null, 'sign-in');
    expect(service.externalAuth().data?.message).toContain('does not identify');
    await service.performExternalAuth('openai-codex', 'sign-in-cancel');
    expect(service.externalAuth().data?.message).toContain('cannot cancel');
    expect(call).not.toHaveBeenCalled();
  });
  it('reads only non-secret CLI model fields and isolates malformed persisted models', async () => {
    handlers.set('settings:get', async () => success({ success: true, value: [
      { id: 'cli-one', selectedModel: 'chosen', tierMappings: { sonnet: 'everyday' }, apiKey: 'must-not-enter-state' },
    ] }));
    await service.refreshCliModels();
    expect(service.cliModels().data).toEqual({ 'cli-one': { selectedModel: 'chosen', tierMappings: { sonnet: 'everyday' } } });
    expect(JSON.stringify(service.cliModels())).not.toContain('must-not-enter-state');
    handlers.set('settings:get', async () => success({ success: true, value: [{ id: 'cli-one', selectedModel: 42 }] }));
    await service.refreshCliModels();
    expect(service.cliModels().status).toBe('error');
    expect(service.cliAgents().status).toBe('unloaded');
  });
  it('keeps the existing host OAuth marker inside the state-owned CLI create command', async () => {
    handlers.set('ptahCli:create', async () => success({ success: true }));
    await service.saveSettings({ cli: [{ action: 'create', params: { name: 'Copilot', providerId: 'github-copilot', apiKey: '' } }] }, await context());
    expect(call).toHaveBeenCalledWith('ptahCli:create', { name: 'Copilot', providerId: 'github-copilot', apiKey: 'copilot-oauth' }, undefined);
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
    'unknown',
    'skipped',
    'unreachable',
    'needs-key',
    'unauthenticated',
    'not-installed',
    'missing',
  ] as const)('never marks %s evidence active', async (status) => {
    handlers.set('auth:getEffectiveRoute', async () =>
      success(route({ providers: [{ id: 'first', type: 'apiKey', status }] })),
    );
    await service.refreshRoute();
    expect(service.activeProviderId()).toBeNull();
  });

  it('requires positive inference evidence and rejects later failure or invalid timestamps', async () => {
    for (const overrides of [
      { lastSuccessfulProbeAt: null },
      { lastSuccessfulProbeAt: 'invalid' },
      { lastFailedProbeAt: '2026-09-22T10:01:00Z' },
      { ready: false },
    ]) {
      handlers.set('auth:getEffectiveRoute', async () =>
        success(route(overrides)),
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
    expect(service.commit()).toMatchObject({
      status: 'partial',
      saved: ['memory.curatorProvider'],
      unsaved: ['skillSynthesis.judgeModel'],
      unconfirmed: [],
    });
    expect(service.memory().data?.curatorProvider).toBe('second');
    expect(service.judging().data?.judgeModel).toBe('');
  });

  it('recognizes a persisted write even if its response fails', async () => {
    const reviewed = await context();
    handlers.set('memory:setTriggers', async () => {
      memoryResponse = { ...memoryResponse, curatorModel: 'persisted' };
      throw new Error('response failed after write');
    });
    await service.saveSettings(
      { memory: { curatorModel: 'persisted' } },
      reviewed,
    );
    expect(service.commit().saved).toEqual(['memory.curatorModel']);
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

  it('names each uncertain CLI update field without retaining its credential', async () => {
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
    expect(service.commit().unconfirmed).toEqual([
      'ptahCliAgents.agent-id.name',
      'ptahCliAgents.agent-id.apiKey',
    ]);
    expect(JSON.stringify(service.commit())).not.toContain('raw-key');
  });
});
