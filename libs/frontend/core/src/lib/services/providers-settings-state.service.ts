import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  SCOPED_SETTING_KEYS,
  getAllAnthropicProviders,
  getAnthropicProvider,
  setCustomProviderEntries,
  CustomProviderEntryInputSchema,
  type AuthCancelDraftVerificationParams,
  type AuthCancelDraftVerificationResult,
  type AuthGetEffectiveRouteResult,
  type AuthSaveSettingsParams,
  type AuthVerifyDraftConnectionParams,
  type AuthVerifyDraftConnectionResult,
  type ConfigGetScopesResult,
  type ConfigClearScopeOverrideResult,
  type RpcMethodName,
  type RpcMethodParams,
  type RpcMethodResult,
  type ScopedSettingEntry,
  type SettingScope,
  type SkillLaneIdDto,
  type SkillSynthesisSettingsDto,
  type SkillSynthesisSettingsWriteDto,
  type PtahCliConfig,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { EffortSettingsChangeService } from './effort-settings-change.service';
import { WorkspaceScopeService } from './workspace-scope.service';

export interface ProvidersSettingsSection<T> {
  readonly status: 'unloaded' | 'loading' | 'ready' | 'error';
  /** null means not loaded; an empty collection is a successful empty read. */
  readonly data: T | null;
  readonly error: 'Could not load this section. Retry.' | null;
}

/** No raw stored auth method, including in resolver blocker strings. */
export type ProvidersEffectiveRoute = Omit<
  AuthGetEffectiveRouteResult,
  'storedAuthMethodDiagnostic'
>;
export type ProvidersJudgingSettings = Pick<
  SkillSynthesisSettingsDto,
  'judgeProvider' | 'judgeModel' | 'enhanceTimeoutMs'
>;
export type ProvidersJudgingPatch = Partial<
  Pick<
    SkillSynthesisSettingsWriteDto,
    'judgeProvider' | 'judgeModel' | 'enhanceTimeoutMs'
  >
>;
export interface ProvidersEditContext {
  readonly scopeKey: string;
  readonly activePath: string | null;
}
export interface ProvidersSettingsCommit {
  readonly status:
    | 'idle'
    | 'saving'
    | 'saved'
    | 'partial'
    | 'failed'
    | 'unconfirmed'
    | 'blocked';
  readonly saved: readonly string[];
  readonly unsaved: readonly string[];
  /** A rejected/timeout RPC can have written before failing. Never call it rolled back. */
  readonly unconfirmed: readonly string[];
  readonly refreshFailed: boolean;
  readonly message: string | null;
}

type OrchestrationField =
  | 'codexModel'
  | 'copilotModel'
  | 'cursorModel'
  | 'antigravityModel'
  | 'opencodeModel'
  | 'piModel'
  | 'codexReasoningEffort'
  | 'copilotReasoningEffort'
  | 'piReasoningEffort';
export interface ProvidersSettingsPatch {
  readonly auth?: AuthSaveSettingsParams;
  readonly model?: RpcMethodParams<'config:model-switch'>;
  readonly effort?: RpcMethodParams<'config:effort-set'>;
  readonly memory?: { curatorProvider?: string; curatorModel?: string };
  readonly lanes?: Partial<
    Record<SkillLaneIdDto, { provider?: string; model?: string }>
  >;
  readonly judging?: ProvidersJudgingPatch;
  readonly orchestration?: Partial<
    Pick<RpcMethodParams<'agent:setConfig'>, OrchestrationField>
  >;
  readonly tiers?: readonly RpcMethodParams<'provider:setModelTier'>[];
  readonly cli?: readonly (
    | { action: 'create'; params: RpcMethodParams<'ptahCli:create'> }
    | { action: 'update'; params: RpcMethodParams<'ptahCli:update'> }
    | { action: 'delete'; params: RpcMethodParams<'ptahCli:delete'> }
  )[];
}

/** Non-secret connection metadata. Connectivity comes separately from route/probe evidence. */
export interface ProvidersConnection {
  readonly id: string;
  readonly name: string;
  readonly hasKey: boolean;
  readonly configured: boolean;
  readonly custom: boolean;
  readonly defaultsResolvable: boolean;
  readonly authMode: AuthVerifyDraftConnectionParams['authMode'];
}
export type ProvidersCliModels = Readonly<Record<string, Pick<PtahCliConfig, 'selectedModel' | 'tierMappings'>>>;
export type ProvidersMainSources = Readonly<Partial<Record<'model' | 'effort', ScopedSettingEntry>>>;
/** Transient wizard command. The service never retains its credential in a signal. */
export interface ProvidersConnectionDraft {
  readonly providerId: string;
  readonly displayName: string;
  readonly authMode: AuthVerifyDraftConnectionParams['authMode'];
  readonly customName: string | null;
  readonly customProtocol: 'openai' | 'anthropic' | null;
  readonly credential: { kind: 'apiKey'; value: string } | null;
  readonly baseUrl: string | null;
  readonly verified: { readonly probeId: string } | null;
  readonly tiers: { readonly everyday: string; readonly complex: string; readonly fast: string };
  readonly saveTo: SettingScope;
  readonly activation: 'connect-only' | 'use-main-agent';
}
export type ProvidersExternalAuthAction = 'sign-in' | 'sign-in-cancel' | 'cli-login' | 'cli-check';
export interface ProvidersExternalAuth {
  readonly providerId: string | null;
  readonly signInState: 'idle' | 'in-flight' | 'signed-in' | 'failed';
  readonly accountLabel: string | null;
  readonly cliInstalled: boolean | null;
  readonly message: string | null;
}

function section<T>() {
  return {
    value: signal<ProvidersSettingsSection<T>>({
      status: 'unloaded',
      data: null,
      error: null,
    }),
    generation: 0,
    scopeKey: '',
  };
}
type SectionStore<T> = ReturnType<typeof section<T>>;
interface SaveOperation {
  readonly fields: readonly string[];
  readonly write: () => Promise<boolean>;
  readonly readBack?: () => Promise<boolean>;
  /** Connection creation must not activate an incomplete setup. */
  readonly dependsOnPrevious?: boolean;
}
const LOAD_ERROR = 'Could not load this section. Retry.';
const EMPTY_COMMIT: ProvidersSettingsCommit = {
  status: 'idle',
  saved: [],
  unsaved: [],
  unconfirmed: [],
  refreshFailed: false,
  message: null,
};

/** Page-owned lifecycle: call open() on entry. No constructor I/O or polling. */
@Injectable({ providedIn: 'root' })
export class ProvidersSettingsStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly effortChanges = inject(EffortSettingsChangeService);
  private readonly opened = signal(false);
  private readonly effortRevision = signal(0);
  private readonly sourcesRevision = signal(0);
  private readonly workspace = inject(WorkspaceScopeService);
  private readonly routeStore = section<ProvidersEffectiveRoute>();
  private readonly scopesStore = section<ConfigGetScopesResult>();
  private readonly modelStore = section<RpcMethodResult<'config:model-get'>>();
  private readonly effortStore =
    section<RpcMethodResult<'config:effort-get'>>();
  private readonly memoryStore =
    section<RpcMethodResult<'memory:getTriggers'>['triggers']>();
  private readonly lanesStore =
    section<RpcMethodResult<'skillSynthesis:getLanes'>['lanes']>();
  private readonly judgingStore = section<ProvidersJudgingSettings>();
  private readonly cliStore =
    section<RpcMethodResult<'ptahCli:list'>['agents']>();
  private readonly orchestrationStore =
    section<Pick<RpcMethodResult<'agent:getConfig'>, OrchestrationField>>();
  private readonly tiersStore =
    section<RpcMethodResult<'provider:getModelTiers'>>();
  private readonly probeStore = section<AuthVerifyDraftConnectionResult>();
  private readonly connectionsStore = section<readonly ProvidersConnection[]>();
  private readonly cliModelsStore = section<ProvidersCliModels>();
  private readonly mainSourcesStore = section<ProvidersMainSources>();
  private readonly externalAuthStore = section<ProvidersExternalAuth>();
  private externalAuthGeneration = 0;
  private readonly commitState = signal<ProvidersSettingsCommit>(EMPTY_COMMIT);
  private probeGeneration = 0;
  private probeId: string | null = null;
  private verifiedProviderId: string | null = null;
  private scopeKeys: readonly string[] = Object.keys(
    SCOPED_SETTING_KEYS,
  ).filter((key) => !key.includes('<'));
  private tierRequest: RpcMethodParams<'provider:getModelTiers'> | null = null;

  readonly route = this.view(this.routeStore);
  readonly scopes = this.view(this.scopesStore);
  readonly model = this.view(this.modelStore);
  readonly effort = this.freshEffortView(this.effortStore, this.effortRevision);
  readonly memory = this.view(this.memoryStore);
  readonly lanes = this.view(this.lanesStore);
  readonly judging = this.view(this.judgingStore);
  readonly cliAgents = this.view(this.cliStore);
  readonly orchestration = this.view(this.orchestrationStore);
  readonly tiers = this.view(this.tiersStore);
  readonly verification = this.view(this.probeStore);
  readonly connections = this.view(this.connectionsStore);
  readonly cliModels = this.view(this.cliModelsStore);
  readonly mainSources = this.freshEffortView(this.mainSourcesStore, this.sourcesRevision);
  readonly externalAuth = this.view(this.externalAuthStore);
  readonly commit = this.commitState.asReadonly();
  /** A scalar identity makes two active badges impossible. Unknown/skipped never qualify. */
  readonly activeProviderId = computed(() => {
    const state = this.route();
    const route = state.data;
    if (
      state.status !== 'ready' ||
      this.commit().status === 'saving' ||
      !route?.ready ||
      route.route === 'unresolved' ||
      !route.lastSuccessfulProbeAt
    )
      return null;
    const successAt = Date.parse(route.lastSuccessfulProbeAt);
    if (
      !Number.isFinite(successAt) ||
      (route.lastFailedProbeAt &&
        Date.parse(route.lastFailedProbeAt) >= successAt)
    )
      return null;
    const driver = route.providers.find(
      (provider) => provider.id === route.driverProviderId,
    );
    return driver &&
      (driver.status === 'connected' || driver.status === 'reachable')
      ? driver.id
      : null;
  });

  constructor() {
    effect(() => {
      const revision = this.effortChanges.revision();
      if (!this.opened() || this.effortChanges.pending()) return;
      untracked(() => {
        if (this.effortRevision() !== revision) void this.refreshEffort();
        if (this.sourcesRevision() !== revision) void this.refreshMainSources();
      });
    });
  }

  async open(): Promise<void> {
    this.opened.set(true);
    await this.refresh();
  }
  async checkConnection(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    await Promise.all([
      this.refreshRoute(),
      this.refreshScopes(),
      this.refreshMainSources(),
      this.refreshModel(),
      this.refreshEffort(),
      this.refreshMemory(),
      this.refreshLanes(),
      this.refreshJudging(),
      this.refreshCliAgents(),
      this.refreshCliModels(),
      this.refreshOrchestration(),
      this.refreshConnections(),
      ...(this.tierRequest ? [this.refreshTiers(this.tierRequest)] : []),
    ]);
  }

  async refreshRoute(): Promise<void> {
    await this.read(this.routeStore, async () => {
      const result = await this.require('auth:getEffectiveRoute', {
        refresh: true,
      });
      return {
        route: result.route,
        ready: result.ready,
        driverProviderId: result.driverProviderId,
        resolvedAuthModality: result.resolvedAuthModality,
        resolvedModel: result.resolvedModel,
        storedAuthMethodScope: result.storedAuthMethodScope,
        providers: result.providers,
        lastSuccessfulProbeAt: result.lastSuccessfulProbeAt,
        lastFailedProbeAt: result.lastFailedProbeAt,
        probedAt: result.probedAt,
        fromCache: result.fromCache,
        blockers: result.blockers.map((blocker) =>
          blocker.startsWith('authMethod is unset or unrecognized')
            ? 'Choose a provider to start the main agent.'
            : blocker,
        ),
      };
    });
  }

  /** Host catalogue and stored setup facts; never use the shipped default as configuration evidence. */
  private readonly setupStore = section<{ providerId: string; baseUrl: string | null; customName?: string; customProtocol?: 'openai' | 'anthropic'; tiers: { sonnet: string | null; opus: string | null; haiku: string | null } }>();
  readonly connectionSetup = this.view(this.setupStore);
  async refreshConnectionSetup(providerId: string): Promise<void> {
    this.setupStore.value.set({ status: 'unloaded', data: null, error: null });
    await this.read(this.setupStore, async () => {
      const [endpoint, tiers] = await Promise.all([
        this.require('llm:getProviderBaseUrl', { provider: providerId }),
        this.require('provider:getModelTiers', { providerId, scope: 'cliAgent' }),
      ]);
      const custom = this.connections().data?.find((entry) => entry.id === providerId)?.custom
        ? (await this.require('provider:listCustomEntries', {})).entries.find((entry) => entry.id === providerId) : undefined;
      return { providerId, baseUrl: endpoint.baseUrl ?? endpoint.defaultBaseUrl, tiers,
        ...(custom ? { customName: custom.name, customProtocol: custom.lane } : {}),
      };
    });
  }

  private readonly cliTestStore = section<{ id: string; success: boolean }>();
  readonly cliTest = this.view(this.cliTestStore);
  async testCliConnection(id: string): Promise<void> {
    await this.read(this.cliTestStore, async () => ({ id, success: (await this.require('ptahCli:testConnection', { id })).success }));
  }
  async saveCursorCredential(apiKey: string, context: ProvidersEditContext): Promise<void> {
    await this.runCommit([{ fields: ['Cursor credential'], write: async () => (await this.require('agent:setConfig', { cursorApiKey: apiKey })).success,
      readBack: async () => (await this.require('agent:getConfig', undefined)).cursorApiKeyConfigured === !!apiKey.trim(),
    }], context, () => true);
  }

  async refreshConnections(): Promise<void> {
    await this.read(this.connectionsStore, async (): Promise<readonly ProvidersConnection[]> => {
      const [status, custom, auth] = await Promise.all([
        this.require('auth:getApiKeyStatus', {}),
        this.require('provider:listCustomEntries', {}),
        this.require('auth:getAuthStatus', {}),
      ]);
      const validated = setCustomProviderEntries(custom.entries);
      const customIds = new Set(validated.accepted.map((entry) => entry.id));
      const entries = getAllAnthropicProviders();
      const savedSetupIds = new Set(await Promise.all(entries.filter((entry) => entry.isLocal || entry.nativeAuth).map(async (entry) => {
        if (entry.isLocal) {
          const endpoint = await this.require('llm:getProviderBaseUrl', { provider: entry.id });
          return endpoint.baseUrl ? entry.id : null;
        }
        const tiers = await this.require('provider:getModelTiers', { providerId: entry.id, scope: 'cliAgent' });
        return tiers.sonnet || tiers.opus || tiers.haiku ? entry.id : null;
      })));
      const connections: ProvidersConnection[] = entries.map((entry): ProvidersConnection => {
        const host = status.providers.find((provider) => provider.provider === entry.id);
        const authenticated = entry.id === 'github-copilot' ? auth.copilotAuthenticated === true
          : entry.id === 'openai-codex' ? auth.codexAuthenticated === true && !auth.codexTokenStale : false;
        return {
          id: entry.id, name: entry.name, hasKey: host?.hasApiKey === true,
          configured: host?.hasApiKey === true || customIds.has(entry.id) || savedSetupIds.has(entry.id) || authenticated,
          custom: customIds.has(entry.id), defaultsResolvable: !!entry.defaultTiers,
          authMode: entry.nativeAuth ? 'cli' : entry.authType === 'oauth' ? 'oauth'
            : entry.isLocal ? entry.requiresProxy ? 'local-proxy' : 'local-native' : 'apiKey',
        };
      });
      connections.unshift({ id: 'anthropic', name: 'Claude API', authMode: 'apiKey',
        hasKey: auth.hasApiKey, configured: auth.hasApiKey, custom: false, defaultsResolvable: false });
      return connections;
    });
  }

  /** Only supported host login operations run; launch acknowledgements are not authentication. */
  async performExternalAuth(providerId: string | null, action: ProvidersExternalAuthAction): Promise<void> {
    const generation = ++this.externalAuthGeneration;
    const empty: ProvidersExternalAuth = { providerId, signInState: 'idle', accountLabel: null, cliInstalled: null, message: null };
    if (action === 'sign-in-cancel' || !providerId ||
      !['github-copilot', 'openai-codex', 'claude-cli'].includes(providerId) ||
      (providerId === 'claude-cli' && action !== 'cli-check')) {
      ++this.externalAuthStore.generation;
      this.externalAuthStore.scopeKey = this.workspace.scopeKey();
      this.externalAuthStore.value.set({ status: 'ready', error: null, data: {
        ...empty, message: action === 'sign-in-cancel'
          ? 'This host cannot cancel external sign-in. Close the external sign-in window to stop it.'
          : !providerId ? 'Choose the named sign-in action on the Providers page. The setup dialog does not identify the requested account.'
          : providerId === 'claude-cli' ? 'Run claude login in your terminal, then choose Check again. If missing, install with npm install -g @anthropic-ai/claude-code.' : 'Complete login outside Ptah, then check again.',
      } });
      return;
    }
    this.externalAuthStore.scopeKey = this.workspace.scopeKey();
    this.externalAuthStore.value.set({ status: 'loading', error: null, data: { ...empty, signInState: 'in-flight' } });
    await this.read(this.externalAuthStore, async (): Promise<ProvidersExternalAuth> => {
      if (action !== 'cli-check') {
        const result = providerId === 'github-copilot'
          ? await this.require('auth:copilotLogin', {}, 310000)
          : await this.require('auth:codexLogin', {}, 310000);
        if (!result.success) throw new Error('Sign-in unavailable');
      }
      const result = await this.require('auth:getAuthStatus', { providerId });
      if (generation !== this.externalAuthGeneration) throw new Error('Superseded sign-in');
      const signedIn = providerId === 'github-copilot' ? result.copilotAuthenticated === true
        : providerId === 'openai-codex' ? result.codexAuthenticated === true && !result.codexTokenStale : false;
      return { ...empty, signInState: signedIn ? 'signed-in' : 'idle',
        cliInstalled: providerId === 'claude-cli' ? result.claudeCliInstalled ?? null : null,
        message: signedIn ? 'Sign-in detected. Verify the connection before using it.'
          : 'Login has not been confirmed. Complete external login, then check again.',
      };
    });
    await Promise.all([this.refreshConnections(), this.refreshRoute()]);
  }

  /** Store setup without selecting it, then optionally activate only after all earlier writes succeed. */
  async connectProvider(draft: ProvidersConnectionDraft, context: ProvidersEditContext): Promise<void> {
    const probe = this.verification();
    const invalid = (draft.providerId === 'anthropic' && draft.activation === 'connect-only') || draft.saveTo !== 'global' || this.connections().status !== 'ready' ||
      probe.status !== 'ready' || probe.data?.outcome !== 'verified' || probe.data.probeId !== draft.verified?.probeId ||
      this.verifiedProviderId !== draft.providerId;
    if (invalid) {
      this.commitState.set({ ...EMPTY_COMMIT, status: 'blocked', unsaved: ['Connection'],
        message: 'Verify this draft and review Global setup storage before saving.' });
      return;
    }
    const operations: SaveOperation[] = [];
    const custom = draft.authMode === 'custom';
    const mappings = { sonnet: draft.tiers.everyday, opus: draft.tiers.complex, haiku: draft.tiers.fast };
    if (custom) {
      const parsed = CustomProviderEntryInputSchema.safeParse({
        id: draft.providerId, name: draft.customName, baseUrl: draft.baseUrl, lane: draft.customProtocol,
        defaultTiers: mappings,
      });
      if (!parsed.success) {
        this.commitState.set({ ...EMPTY_COMMIT, status: 'blocked', unsaved: ['Custom connection'],
          message: 'Use a lower-case connection ID with dashes, an HTTP(S) endpoint and explicit models for all three tiers.' });
        return;
      }
      const exists = this.connections().data?.some((entry) => entry.id === draft.providerId && entry.custom);
      operations.push({ fields: ['Custom connection'], write: async () => {
        if (exists) await this.require('provider:updateCustomEntry', { id: draft.providerId, changes: parsed.data });
        else await this.require('provider:addCustomEntry', { entry: parsed.data });
        return true;
      } });
    }
    if (draft.providerId !== 'anthropic' && draft.credential?.value.trim()) {
      // llm:setApiKey ALSO selects the main route. auth:setApiKey only stores the provider key.
      operations.push({ fields: ['Connection credential'], dependsOnPrevious: true,
        write: async () => (await this.require('auth:setApiKey', { provider: draft.providerId, apiKey: draft.credential?.value ?? '' })).success });
    }
    if (!custom && draft.baseUrl) operations.push({ fields: ['Connection endpoint'], dependsOnPrevious: true,
      write: async () => (await this.require('llm:setProviderBaseUrl', { provider: draft.providerId, baseUrl: draft.baseUrl ?? '' })).success });
    const tiers = Object.entries(mappings) as [RpcMethodParams<'provider:setModelTier'>['tier'], string][];
    const defaults = getAnthropicProvider(draft.providerId)?.defaultTiers;
    if (tiers.some(([tier, model]) => !model && !defaults?.[tier])) {
      this.commitState.set({ ...EMPTY_COMMIT, status: 'blocked', unsaved: ['Connection models'], message: 'Choose explicit models where no provider default is available.' });
      return;
    }
    for (const [tier, model] of tiers) operations.push({ fields: [`Connection ${tier} model`], dependsOnPrevious: true,
      write: async () => (await this.require('provider:setModelTier', {
        providerId: draft.providerId, tier, modelId: model || defaults?.[tier] || '', scope: 'cliAgent',
      })).success });
    if (draft.activation === 'use-main-agent') {
      operations.push(...this.operations({ auth: { authMethod: draft.providerId === 'anthropic' ? 'apiKey' : draft.authMode === 'cli' ? 'claudeCli' : 'thirdParty',
        ...(draft.providerId === 'anthropic' ? { anthropicApiKey: draft.credential?.value } : { anthropicProviderId: draft.providerId }), applyTo: draft.saveTo } }).map((operation) => ({ ...operation, dependsOnPrevious: true })));
      for (const [tier, model] of tiers) operations.push({ fields: [`Main agent ${tier} model`], dependsOnPrevious: true,
        write: async () => (await this.require('provider:setModelTier', { providerId: draft.providerId, tier,
          modelId: model || defaults?.[tier] || '', scope: 'mainAgent' })).success });
    }
    await this.runCommit(operations, context, () => draft.activation !== 'use-main-agent' ||
      (this.writeScopes('authMethod').includes(draft.saveTo) && this.writeScopes('anthropicProviderId').includes(draft.saveTo)));
  }

  /** Copy the connection's saved model choices AFTER auth activation's host default mapping. */
  async activateConnection(providerId: string, applyTo: SettingScope, context: ProvidersEditContext): Promise<void> {
    if (this.commit().status === 'saving') return;
    await this.refreshTiers({ providerId, scope: 'cliAgent' });
    const connection = this.connections().data?.find((entry) => entry.id === providerId);
    const tiers = this.tiers();
    if (!connection || this.connections().status !== 'ready' || tiers.status !== 'ready' || !tiers.data ||
      this.tierRequest?.providerId !== providerId || this.tierRequest.scope !== 'cliAgent') {
      this.commitState.set({ ...EMPTY_COMMIT, status: 'blocked', unsaved: ['Main agent connection'],
        message: 'Refresh this connection and its model choices before activating it.' });
      return;
    }
    const mappings = (Object.entries(tiers.data) as [RpcMethodParams<'provider:setModelTier'>['tier'], string | null][])
      .filter((entry): entry is [RpcMethodParams<'provider:setModelTier'>['tier'], string] => entry[1] !== null);
    const operations = this.operations({ auth: {
      authMethod: connection.authMode === 'cli' ? 'claudeCli' : providerId === 'anthropic' ? 'apiKey' : 'thirdParty',
      anthropicProviderId: providerId, applyTo,
    }, tiers: mappings.map(([tier, modelId]) => ({ providerId, tier, modelId, scope: 'mainAgent' })) });
    await this.runCommit(operations.map((operation) => ({ ...operation, dependsOnPrevious: true })), context,
      () => this.writeScopes('authMethod').includes(applyTo) && this.writeScopes('anthropicProviderId').includes(applyTo));
  }

  /** Supply concrete provider/auth-key paths, never the allowlist's <...> families. */
  async refreshScopes(keys: readonly string[] = this.scopeKeys): Promise<void> {
    this.scopeKeys = [...new Set(keys)];
    const requested = this.scopeKeys;
    await this.read(this.scopesStore, () =>
      this.require('config:getScopes', { keys: requested }),
    );
  }
  async refreshModel(): Promise<void> {
    await this.read(this.modelStore, () =>
      this.require('config:model-get', {}),
    );
  }
  async refreshEffort(): Promise<void> {
    if (this.effortChanges.pending()) return;
    this.effortRevision.set(this.effortChanges.revision());
    await this.read(this.effortStore, () =>
      this.require('config:effort-get', {}),
    );
  }
  async refreshMemory(): Promise<void> {
    await this.read(
      this.memoryStore,
      async () => (await this.require('memory:getTriggers', {})).triggers,
    );
  }
  async refreshLanes(): Promise<void> {
    await this.read(
      this.lanesStore,
      async () => (await this.require('skillSynthesis:getLanes', {})).lanes,
    );
  }
  async refreshJudging(): Promise<void> {
    await this.read(this.judgingStore, async () => {
      const { judgeProvider, judgeModel, enhanceTimeoutMs } = (
        await this.require('skillSynthesis:getSettings', {})
      ).settings;
      return {
        judgeProvider,
        enhanceTimeoutMs,
        // model-resolver.ts:171 recognizes 'inherit'; the picker uses ''.
        judgeModel: judgeModel === 'inherit' ? '' : judgeModel,
      };
    });
  }
  async refreshCliAgents(): Promise<void> {
    await this.read(
      this.cliStore,
      async () => (await this.require('ptahCli:list', {})).agents,
    );
  }
  /** The CLI summary omits pinned models. Project only model fields from persisted non-secret configuration. */
  async refreshCliModels(): Promise<void> {
    await this.read(this.cliModelsStore, async () => {
      const result = await this.require('settings:get', { key: 'ptahCliAgents' });
      if (!result.success || !Array.isArray(result.value)) throw new Error('CLI models unavailable');
      const models: Record<string, Pick<PtahCliConfig, 'selectedModel' | 'tierMappings'>> = {};
      for (const item of result.value as unknown[]) {
        if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string') throw new Error('Invalid CLI configuration');
        const selectedModel = 'selectedModel' in item ? item.selectedModel : undefined;
        if (selectedModel !== undefined && typeof selectedModel !== 'string') throw new Error('Invalid CLI model');
        const tiers = 'tierMappings' in item ? item.tierMappings : undefined;
        if (tiers !== undefined && (!tiers || typeof tiers !== 'object')) throw new Error('Invalid CLI tiers');
        const mappings: { sonnet?: string; opus?: string; haiku?: string } = {};
        for (const tier of ['sonnet', 'opus', 'haiku'] as const) {
          if (tiers && typeof tiers === 'object' && tier in tiers) {
            const value: unknown = (tiers as Record<string, unknown>)[tier];
            if (typeof value !== 'string') throw new Error('Invalid CLI tier model');
            mappings[tier] = value;
          }
        }
        Object.defineProperty(models, item.id, { enumerable: true, value: { selectedModel, tierMappings: mappings } });
      }
      return models;
    });
  }
  /** Discover the concrete provider-scoped keys; raw authentication enum values never enter render state. */
  async refreshMainSources(): Promise<void> {
    if (this.effortChanges.pending()) return;
    this.sourcesRevision.set(this.effortChanges.revision());
    await this.read(this.mainSourcesStore, async () => {
      const auth = await this.require('auth:getAuthStatus', {});
      if (!['apiKey', 'claudeCli', 'thirdParty'].includes(auth.authMethod)) throw new Error('Authentication source unavailable');
      // Public settings namespace: provider.<authKey>.selectedModel / reasoningEffort (plan target key map).
      const authKey = auth.authMethod === 'thirdParty' ? `thirdParty.${auth.anthropicProviderId}` : auth.authMethod;
      const model = `provider.${authKey}.selectedModel`, effort = `provider.${authKey}.reasoningEffort`;
      const scopes = await this.require('config:getScopes', { keys: [model, effort] });
      return { model: scopes.entries.find((entry) => entry.key === model), effort: scopes.entries.find((entry) => entry.key === effort) };
    });
  }
  async refreshOrchestration(): Promise<void> {
    await this.read(this.orchestrationStore, async () => {
      const config = await this.require('agent:getConfig', undefined);
      return {
        codexModel: config.codexModel,
        copilotModel: config.copilotModel,
        cursorModel: config.cursorModel,
        antigravityModel: config.antigravityModel,
        opencodeModel: config.opencodeModel,
        piModel: config.piModel,
        codexReasoningEffort: config.codexReasoningEffort,
        copilotReasoningEffort: config.copilotReasoningEffort,
        piReasoningEffort: config.piReasoningEffort,
      };
    });
  }
  async refreshTiers(
    params: RpcMethodParams<'provider:getModelTiers'>,
  ): Promise<void> {
    const changed =
      this.tierRequest?.providerId !== params.providerId ||
      this.tierRequest?.scope !== params.scope;
    this.tierRequest = { ...params };
    // Never show the preceding provider's mappings while a different provider loads.
    if (changed)
      this.tiersStore.value.set({
        status: 'unloaded',
        data: null,
        error: null,
      });
    await this.read(this.tiersStore, () =>
      this.require('provider:getModelTiers', params),
    );
  }

  scopeEntry(key: string): ScopedSettingEntry | null {
    return (
      this.scopes().data?.entries.find((entry) => entry.key === key) ??
      Object.values(this.mainSources().data ?? {}).find((entry) => entry?.key === key) ?? null
    );
  }
  groupScope(keys: readonly string[]): SettingScope | 'mixed' | null {
    const entries = keys.map((key) => this.scopeEntry(key));
    if (!entries.length || entries.some((entry) => !entry)) return null;
    const scopes = new Set(entries.map((entry) => entry?.scope));
    return scopes.size === 1 ? (entries[0]?.scope ?? null) : 'mixed';
  }
  writeScopes(key: string): readonly SettingScope[] {
    if (this.scopes().status !== 'ready') return [];
    return (
      this.scopeEntry(key)?.supportedTargets.filter(
        (target) =>
          target !== 'workspace' || this.scopes().data?.activePath !== null,
      ) ?? []
    );
  }
  reviewContext(): ProvidersEditContext | null {
    const scopes = this.scopes();
    return scopes.status === 'ready' && scopes.data
      ? {
          scopeKey: this.workspace.scopeKey(),
          activePath: scopes.data.activePath,
        }
      : null;
  }

  /** Commands never retain credentials in service state; only field names enter commit feedback. */
  async saveSettings(
    patch: ProvidersSettingsPatch,
    context: ProvidersEditContext,
  ): Promise<void> {
    const operations = this.operations(patch);
    await this.runCommit(operations, context, () => {
      const authTarget = patch.auth?.applyTo ?? 'global';
      if (
        patch.auth &&
        (!this.writeScopes('authMethod').includes(authTarget) ||
          (patch.auth.anthropicProviderId !== undefined &&
            !this.writeScopes('anthropicProviderId').includes(authTarget)))
      )
        return false;
      return [patch.model, patch.effort].every(
        (value) =>
          !value ||
          value.applyTo !== 'workspace' ||
          context.activePath !== null,
      );
    });
  }

  async clearWorkspaceOverride(context: ProvidersEditContext): Promise<void> {
    await this.runCommit(
      [
        {
          fields: ['Main agent authentication overrides'],
          write: async () =>
            (await this.require('auth:clearWorkspaceOverride', {})).success,
        },
      ],
      context,
    );
  }

  async clearScopeOverride(
    key: string,
    target: 'nearest' | 'all-above-global',
    context: ProvidersEditContext,
  ): Promise<void> {
    let clearedResult: ConfigClearScopeOverrideResult | null = null;
    await this.runCommit(
      [
        {
          fields: [key],
          write: async () => {
            const result: ConfigClearScopeOverrideResult = await this.require(
              'config:clearScopeOverride',
              { key, target },
            );
            clearedResult = result;
            return (
              result.success &&
              (target !== 'all-above-global' ||
                result.resolvesFrom === 'global')
            );
          },
          readBack: async () => {
            if (!clearedResult) throw new Error('Clear result not confirmed');
            const scopes = await this.require('config:getScopes', {
              keys: [key],
            });
            if (scopes.activePath !== context.activePath)
              throw new Error('Workspace changed');
            const entry = scopes.entries.find((entry) => entry.key === key);
            if (!entry) throw new Error('Scope not confirmed');
            return (
              clearedResult.success &&
              entry.scope === clearedResult.resolvesFrom &&
              (target !== 'all-above-global' || entry.scope === 'global')
            );
          },
        },
      ],
      context,
      () => this.scopeEntry(key)?.hasOverride === true,
    );
  }

  /** Probe is non-mutating. A caller-owned credential is never copied into a signal. */
  async verifyDraft(params: AuthVerifyDraftConnectionParams): Promise<void> {
    const generation = ++this.probeGeneration;
    const previous = this.probeId;
    this.probeId = params.probeId;
    this.verifiedProviderId = null;
    // A failed best-effort abort cannot publish an old result: both generations are checked below.
    if (previous) void this.abortProbe(previous);
    this.probeStore.value.set({ status: 'unloaded', data: null, error: null });
    await this.read(this.probeStore, async () => {
      const result = await this.require(
        'auth:verifyDraftConnection',
        params,
        Math.max(30000, params.timeoutMs ?? 30000) + 5000,
      );
      if (
        generation !== this.probeGeneration ||
        result.probeId !== params.probeId
      )
        throw new Error('Superseded check');
      return result;
    });
    if (generation === this.probeGeneration) {
      this.probeId = null;
      if (this.verification().data?.outcome === 'verified') this.verifiedProviderId = params.providerId;
    }
  }
  async cancelVerification(params?: AuthCancelDraftVerificationParams): Promise<AuthCancelDraftVerificationResult> {
    const id = params?.probeId ?? this.probeId;
    if (params && id !== this.probeId) return this.require('auth:cancelDraftVerification', params);
    const generation = ++this.probeGeneration;
    ++this.probeStore.generation;
    this.probeId = null;
    this.verifiedProviderId = null;
    this.probeStore.scopeKey = this.workspace.scopeKey();
    this.probeStore.value.set({ status: 'unloaded', data: null, error: null });
    try {
      return id ? await this.require('auth:cancelDraftVerification', { probeId: id }) : { cancelled: false };
    } catch (error: unknown) {
      void error;
      if (generation === this.probeGeneration) {
      this.probeStore.value.set({
        status: 'error',
        data: null,
        error: LOAD_ERROR,
      });
      }
      throw new Error('Could not cancel this check.');
    }
  }

  private operations(patch: ProvidersSettingsPatch): SaveOperation[] {
    const operations: SaveOperation[] = [];
    if (patch.auth) {
      const params = { ...patch.auth };
      operations.push({
        fields: Object.entries(params)
          .filter(([key, value]) => key !== 'applyTo' && value !== undefined)
          .map(([key]) => key),
        write: async () =>
          (await this.require('auth:saveSettings', params)).success,
      });
    }
    if (patch.model) {
      const params = { ...patch.model };
      operations.push({
        fields: ['Main agent model'],
        write: async () => {
          await this.require('config:model-switch', params);
          return true;
        },
        readBack: async () =>
          (await this.require('config:model-get', {})).model === params.model,
      });
    }
    if (patch.effort) {
      const params = { ...patch.effort };
      operations.push({
        fields: ['Main agent reasoning effort'],
        write: async () => {
          await this.require('config:effort-set', params);
          return true;
        },
        readBack: async () =>
          (await this.require('config:effort-get', {})).effort ===
          params.effort,
      });
    }
    for (const field of ['curatorProvider', 'curatorModel'] as const) {
      const value = patch.memory?.[field];
      if (value !== undefined)
        operations.push({
          fields: [`memory.${field}`],
          write: async () => {
            await this.require('memory:setTriggers', {
              triggers: { [field]: value },
            });
            return true;
          },
          readBack: async () =>
            (await this.require('memory:getTriggers', {})).triggers[field] ===
            value,
        });
    }
    for (const lane of [
      'archaeologist',
      'synthesis',
      'judge',
      'replay',
    ] as const) {
      for (const field of ['provider', 'model'] as const) {
        const value = patch.lanes?.[lane]?.[field];
        if (value !== undefined)
          operations.push({
            fields: [`skillSynthesis.${lane}.${field}`],
            write: async () => {
              await this.require('skillSynthesis:setLanes', {
                lanes: { [lane]: { [field]: value } },
              });
              return true;
            },
            readBack: async () =>
              (await this.require('skillSynthesis:getLanes', {})).lanes[lane][
                field
              ] === value,
          });
      }
    }
    for (const field of [
      'judgeProvider',
      'judgeModel',
      'enhanceTimeoutMs',
    ] as const) {
      const requested = patch.judging?.[field];
      if (requested === undefined) continue;
      // model-resolver.ts:171 recognizes only 'inherit', not the picker's ''.
      const value =
        field === 'judgeModel' && typeof requested === 'string'
          ? requested.trim() || 'inherit'
          : requested;
      operations.push({
        fields: [`skillSynthesis.${field}`],
        write: async () => {
          const settings = { [field]: value };
          return (
            await this.require('skillSynthesis:updateSettings', { settings })
          ).updated;
        },
        readBack: async () => {
          const settings = (
            await this.require('skillSynthesis:getSettings', {})
          ).settings;
          return (
            (field === 'enhanceTimeoutMs'
              ? settings.enhanceTimeoutMs.value
              : settings[field]) === value
          );
        },
      });
    }
    for (const field of [
      'codexModel',
      'copilotModel',
      'cursorModel',
      'antigravityModel',
      'opencodeModel',
      'piModel',
      'codexReasoningEffort',
      'copilotReasoningEffort',
      'piReasoningEffort',
    ] as const) {
      const value = patch.orchestration?.[field];
      if (value !== undefined)
        operations.push({
          fields: [`agentOrchestration.${field}`],
          write: async () =>
            (await this.require('agent:setConfig', { [field]: value })).success,
          readBack: async () =>
            (await this.require('agent:getConfig', undefined))[field] === value,
        });
    }
    for (const tier of patch.tiers ?? []) {
      const params = { ...tier };
      operations.push({
        fields: [
          `provider.${params.providerId ?? 'active'}.modelTier.${params.tier}`,
        ],
        write: async () =>
          (await this.require('provider:setModelTier', params)).success,
        readBack: async () =>
          (
            await this.require('provider:getModelTiers', {
              providerId: params.providerId,
              scope: params.scope,
            })
          )[params.tier] === params.modelId,
      });
    }
    for (const command of patch.cli ?? []) {
      const key = `ptahCliAgents.${'id' in command.params ? command.params.id : 'new'}`;
      const fields =
        command.action === 'delete'
          ? [key]
          : Object.entries(command.params)
              .filter(([field, value]) => field !== 'id' && value !== undefined)
              .map(([field]) => `${key}.${field}`);
      operations.push({
        fields,
        write: async () => {
          switch (command.action) {
            case 'create':
              // Existing PtahCliConfigComponent's host contract: OAuth instances carry this non-secret marker.
              return (await this.require('ptahCli:create', { ...command.params,
                apiKey: command.params.providerId === 'github-copilot' ? 'copilot-oauth' : command.params.apiKey,
              })).success;
            case 'update':
              return (await this.require('ptahCli:update', command.params))
                .success;
            case 'delete':
              return (await this.require('ptahCli:delete', command.params))
                .success;
          }
        },
      });
    }
    return operations;
  }

  private async runCommit(
    operations: readonly SaveOperation[],
    context: ProvidersEditContext,
    allowed = () => true,
  ): Promise<void> {
    if (this.commit().status === 'saving') return;
    this.commitState.set({ ...EMPTY_COMMIT, status: 'saving' });
    await this.refreshScopes();
    if (!this.contextMatches(context) || !allowed()) {
      this.commitState.set({
        ...EMPTY_COMMIT,
        status: 'blocked',
        unsaved: operations.flatMap((operation) => operation.fields),
        message:
          'Review the current workspace and supported save target before saving.',
      });
      return;
    }
    const saved: string[] = [],
      unsaved: string[] = [],
      unconfirmed: string[] = [];
    for (const operation of operations) {
      if (operation.dependsOnPrevious && (unsaved.length || unconfirmed.length)) {
        unsaved.push(...operation.fields);
        continue;
      }
      if (!this.contextMatches(context)) {
        unsaved.push(...operation.fields);
        continue;
      }
      let acknowledged = false;
      try {
        acknowledged = await operation.write();
      } catch (error: unknown) {
        // RPC errors may contain credentials. Neither their message nor object enters UI state.
        void error;
      }
      if (operation.readBack && this.contextMatches(context)) {
        try {
          const matches = await operation.readBack();
          (this.contextMatches(context)
            ? matches
              ? saved
              : unsaved
            : unconfirmed
          ).push(...operation.fields);
        } catch (error: unknown) {
          void error;
          unconfirmed.push(...operation.fields);
        }
      } else {
        (acknowledged && this.contextMatches(context)
          ? saved
          : unconfirmed
        ).push(...operation.fields);
      }
    }
    // Always refresh, even after rejection: host handlers can fail after a partial write.
    await this.refresh();
    if (!this.contextMatches(context)) {
      unconfirmed.push(...saved);
      saved.length = 0;
    }
    const refreshFailed = [
      this.route(),
      this.scopes(),
      this.mainSources(),
      this.model(),
      this.effort(),
      this.memory(),
      this.lanes(),
      this.judging(),
      this.cliAgents(),
      this.cliModels(),
      this.orchestration(),
      this.connections(),
    ].some((state) => state.status !== 'ready');
    const status = unconfirmed.length
      ? 'unconfirmed'
      : unsaved.length
        ? saved.length
          ? 'partial'
          : 'failed'
        : 'saved';
    this.commitState.set({
      status,
      saved,
      unsaved,
      unconfirmed,
      refreshFailed,
      message: refreshFailed
        ? 'Some settings could not be refreshed. Retry those sections.'
        : null,
    });
  }

  private contextMatches(context: ProvidersEditContext): boolean {
    return (
      this.workspace.scopeKey() === context.scopeKey &&
      this.scopes().status === 'ready' &&
      this.scopes().data?.activePath === context.activePath
    );
  }
  private freshEffortView<T>(store: SectionStore<T>, readRevision: () => number) {
    const scoped = this.view(store);
    return computed<ProvidersSettingsSection<T>>(() => {
      const state = scoped();
      if (state.status === 'unloaded') return state;
      if (this.effortChanges.pending() || readRevision() !== this.effortChanges.revision()) {
        return { status: 'loading', data: null, error: null };
      }
      return state.status === 'ready' ? state : { ...state, data: null };
    });
  }
  private view<T>(store: SectionStore<T>) {
    return computed<ProvidersSettingsSection<T>>(() => {
      const state = store.value();
      return store.scopeKey === this.workspace.scopeKey()
        ? state
        : { status: 'unloaded', data: null, error: null };
    });
  }
  private async read<T>(
    store: SectionStore<T>,
    request: () => Promise<T>,
  ): Promise<void> {
    const generation = ++store.generation;
    const scopeKey = this.workspace.scopeKey();
    const previous = store.scopeKey === scopeKey ? store.value().data : null;
    store.scopeKey = scopeKey;
    store.value.set({ status: 'loading', data: previous, error: null });
    try {
      const data = await request();
      if (
        generation === store.generation &&
        scopeKey === this.workspace.scopeKey()
      )
        store.value.set({ status: 'ready', data, error: null });
    } catch (error: unknown) {
      void error;
      if (
        generation === store.generation &&
        scopeKey === this.workspace.scopeKey()
      )
        store.value.set({ status: 'error', data: previous, error: LOAD_ERROR });
    }
  }
  private async require<T extends RpcMethodName>(
    method: T,
    params: RpcMethodParams<T>,
    timeout?: number,
  ): Promise<RpcMethodResult<T>> {
    const result = await this.rpc.call(
      method,
      params,
      timeout ? { timeout } : undefined,
    );
    if (!result.isSuccess()) throw new Error('Settings request failed');
    return result.data;
  }
  private async abortProbe(probeId: string): Promise<boolean> {
    try {
      await this.require('auth:cancelDraftVerification', { probeId });
      return true;
    } catch (error: unknown) {
      void error;
      return false;
    }
  }
}
