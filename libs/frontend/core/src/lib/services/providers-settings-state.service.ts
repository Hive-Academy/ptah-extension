import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  SCOPED_SETTING_KEYS,
  SUBAGENT_PROMPT_CACHE_TTL_SETTINGS,
  getAllAnthropicProviders,
  setCustomProviderEntries,
  type AuthCancelDraftVerificationParams,
  type AuthCancelDraftVerificationResult,
  type AuthVerifyDraftConnectionParams,
  type ConfigGetScopesResult,
  type ConfigClearScopeOverrideResult,
  type RpcMethodName,
  type RpcMethodParams,
  type RpcMethodResult,
  type ScopedSettingEntry,
  type SettingScope,
  type PtahCliConfig,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { AuthStateService } from './auth-state.service';
import { EffortSettingsChangeService } from './effort-settings-change.service';
import {
  ProvidersCommitService,
  type ProvidersCommitHooks,
  type ProvidersModelTier,
} from './providers-commit.service';
import {
  ProvidersConnectionSetupService,
  type ProvidersConnectionSetupHooks,
} from './providers-connection-setup.service';
import {
  createSectionStore,
  effortFreshSectionView,
  hostKeyHint,
  readSection,
  requireRpcData,
  sectionView,
  type SectionStore,
} from './providers-settings-sections';
import type {
  ProvidersCliModels,
  ProvidersConnection,
  ProvidersConnectionDraft,
  ProvidersEditContext,
  ProvidersEffectiveRoute,
  ProvidersExternalAuthAction,
  ProvidersJudgingSettings,
  ProvidersMainSources,
  ProvidersCliTest,
  ProvidersCustomEntry,
  ProvidersDetectedClis,
  ProvidersOrchestration,
  ProvidersSettingsPatch,
  SaveOperation,
} from './providers-settings.types';
import { WorkspaceScopeService } from './workspace-scope.service';

export type {
  ProvidersSettingsSection,
  ProvidersEffectiveRoute,
  ProvidersJudgingSettings,
  ProvidersJudgingPatch,
  ProvidersEditContext,
  ProvidersSettingsCommit,
  ProvidersSettingsPatch,
  ProvidersConnection,
  ProvidersCliModels,
  ProvidersMainSources,
  ProvidersConnectionDraft,
  ProvidersExternalAuthAction,
  ProvidersExternalAuth,
  ProvidersOrchestration,
  ProvidersCliTest,
  ProvidersCustomEntry,
  ProvidersDetectedClis,
} from './providers-settings.types';

/** Route statuses that do not block a driver. `unknown`/`skipped` mean "not checkable", not "failed". */
const ACTIVATABLE_STATUSES: ReadonlySet<string> = new Set([
  'connected',
  'reachable',
  'unknown',
  'skipped',
]);

/** Above the host's own 30 s abort of `ptahCli:testConnection` (`ptah-cli-registry.ts`). */
const CLI_TEST_TIMEOUT_MS = 45_000;
/** The registry's own FIXED test errors → fixed copy. Any other text (pattern-redacted host text) is dropped (M1). */
const CLI_TEST_REASONS: Readonly<Record<string, string>> = {
  'API key not configured': 'No API key is stored for this instance.',
  'No response received from provider': 'The provider did not respond.',
  'Agent configuration not found':
    'This instance was not found. Refresh and try again.',
};

/** Page-owned lifecycle: call open() on entry. No constructor I/O or polling. */
@Injectable({ providedIn: 'root' })
export class ProvidersSettingsStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly authState = inject(AuthStateService);
  private readonly commits = inject(ProvidersCommitService);
  private readonly setup = inject(ProvidersConnectionSetupService);
  private readonly effortChanges = inject(EffortSettingsChangeService);
  private readonly opened = signal(false);
  private readonly effortRevision = signal(0);
  private readonly sourcesRevision = signal(0);
  private readonly workspace = inject(WorkspaceScopeService);
  private readonly routeStore = createSectionStore<ProvidersEffectiveRoute>();
  private readonly scopesStore = createSectionStore<ConfigGetScopesResult>();
  private readonly modelStore =
    createSectionStore<RpcMethodResult<'config:model-get'>>();
  private readonly effortStore =
    createSectionStore<RpcMethodResult<'config:effort-get'>>();
  private readonly memoryStore =
    createSectionStore<RpcMethodResult<'memory:getTriggers'>['triggers']>();
  private readonly lanesStore =
    createSectionStore<RpcMethodResult<'skillSynthesis:getLanes'>['lanes']>();
  private readonly judgingStore =
    createSectionStore<ProvidersJudgingSettings>();
  private readonly cliStore =
    createSectionStore<RpcMethodResult<'ptahCli:list'>['agents']>();
  private readonly orchestrationStore =
    createSectionStore<ProvidersOrchestration>();
  private readonly customEntriesStore =
    createSectionStore<readonly ProvidersCustomEntry[]>();
  private readonly detectionStore = createSectionStore<ProvidersDetectedClis>();
  private readonly tiersStore =
    createSectionStore<RpcMethodResult<'provider:getModelTiers'>>();
  private readonly connectionsStore =
    createSectionStore<readonly ProvidersConnection[]>();
  private readonly cliModelsStore = createSectionStore<ProvidersCliModels>();
  private readonly mainSourcesStore =
    createSectionStore<ProvidersMainSources>();
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
  /** Last explicit CLI re-detection (`redetectClis`); `loading` while it runs. */
  readonly cliDetection = this.view(this.detectionStore);
  private readonly customEntries = this.view(this.customEntriesStore);
  readonly tiers = this.view(this.tiersStore);
  readonly verification = this.setup.verification;
  readonly connections = this.view(this.connectionsStore);
  readonly cliModels = this.view(this.cliModelsStore);
  readonly mainSources = this.freshEffortView(
    this.mainSourcesStore,
    this.sourcesRevision,
  );
  readonly externalAuth = this.setup.externalAuth;
  readonly commit = this.commits.commit;
  /**
   * A scalar identity makes two active badges impossible. Derived from the effective route
   * (`driverProviderId` of a ready, resolved route). `auth:getEffectiveRoute` never reports
   * probe timestamps, so they are not required. `unknown`/`skipped` (e.g. local servers)
   * cannot be checked by the host and still qualify; a failing driver status never does.
   */
  readonly activeProviderId = computed(() => {
    const state = this.route();
    const route = state.data;
    if (
      state.status !== 'ready' ||
      this.commit().status === 'saving' ||
      !route?.ready ||
      route.route === 'unresolved' ||
      !route.driverProviderId
    )
      return null;
    const driver = route.providers.find(
      (provider) => provider.id === route.driverProviderId,
    );
    return driver && ACTIVATABLE_STATUSES.has(driver.status) ? driver.id : null;
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

  /**
   * Host catalogue and stored setup facts; never use the shipped default as configuration evidence.
   * Tiers are the MAIN-AGENT mapping: the wizard's Models step edits what the main agent uses on this
   * connection. CLI sub-agent tiers (`cliAgent`) belong to the CLI agent editor, not to connection setup.
   */
  private readonly setupStore = createSectionStore<{
    providerId: string;
    baseUrl: string | null;
    customName?: string;
    customProtocol?: 'openai' | 'anthropic';
    tiers: { sonnet: string | null; opus: string | null; haiku: string | null };
  }>();
  readonly connectionSetup = this.view(this.setupStore);
  async refreshConnectionSetup(providerId: string): Promise<void> {
    this.setupStore.value.set({ status: 'unloaded', data: null, error: null });
    await this.read(this.setupStore, async () => {
      const [endpoint, tiers] = await Promise.all([
        this.require('llm:getProviderBaseUrl', { provider: providerId }),
        this.require('provider:getModelTiers', {
          providerId,
          scope: 'mainAgent',
        }),
      ]);
      const custom = this.connections().data?.find(
        (entry) => entry.id === providerId,
      )?.custom
        ? (await this.require('provider:listCustomEntries', {})).entries.find(
            (entry) => entry.id === providerId,
          )
        : undefined;
      return {
        providerId,
        baseUrl: endpoint.baseUrl ?? endpoint.defaultBaseUrl,
        tiers,
        ...(custom
          ? { customName: custom.name, customProtocol: custom.lane }
          : {}),
      };
    });
  }

  /**
   * Model lists for the delegated CLIs (codex, copilot, cursor, antigravity, opencode, pi, grok). These are
   * CLI names, not provider-registry ids, so they come from agent:listCliModels, never provider:listModels.
   * Loaded on demand: the host may fetch remote catalogues.
   */
  private readonly delegatedModelsStore =
    createSectionStore<RpcMethodResult<'agent:listCliModels'>>();
  readonly delegatedModelOptions = this.view(this.delegatedModelsStore);
  async refreshDelegatedModelOptions(): Promise<void> {
    await this.read(this.delegatedModelsStore, () =>
      this.require('agent:listCliModels', undefined),
    );
  }

  private readonly cliTestStore = createSectionStore<ProvidersCliTest>();
  readonly cliTest = this.view(this.cliTestStore);
  /** The instance the current (or last) Test ran for. */
  private cliTestRunId: string | null = null;
  /**
   * One run's result only (Gate V 36 S1): the previous result is dropped before the call and never retained after a
   * failure, so a failed or timed-out run can never show an earlier pass. The RPC timeout is above the host's own 30 s
   * abort, so a slow host answer is still this run's. `reason` is fixed copy for the registry's own fixed strings and
   * `null` otherwise (M1): `sanitizeErrorMessage` is pattern-based, so host text never enters state.
   */
  async testCliConnection(id: string): Promise<void> {
    this.cliTestStore.value.set({
      status: 'unloaded',
      data: null,
      error: null,
    });
    this.cliTestRunId = id;
    await readSection(
      this.cliTestStore,
      this.workspace,
      async () => {
        const result = await this.require(
          'ptahCli:testConnection',
          { id },
          CLI_TEST_TIMEOUT_MS,
        );
        return {
          id,
          success: result.success,
          latencyMs: result.latencyMs ?? null,
          reason: result.success
            ? null
            : (CLI_TEST_REASONS[result.error ?? ''] ?? null),
        };
      },
      false,
    );
  }
  /**
   * M8: the last Test describes the key, name and tiers it ran with; a write to any of them drops it (and discards an
   * in-flight run for that instance, which started before the change).
   */
  clearCliTest(id: string): void {
    if (this.cliTestRunId !== id) return;
    this.cliTestRunId = null;
    this.cliTestStore.generation += 1;
    this.cliTestStore.value.set({
      status: 'unloaded',
      data: null,
      error: null,
    });
  }
  /**
   * An empty key clears the stored secret. Read-back checks the secrets store alone
   * (`cursorApiKeyStored`): `cursorApiKeyConfigured` also counts `CURSOR_API_KEY`, which would make
   * a successful clear read back as a failure while the env var is set (TASK_2026_551).
   */
  async saveCursorCredential(
    apiKey: string,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    const stored = !!apiKey.trim();
    return this.runCommit(
      [
        {
          fields: ['Cursor credential'],
          write: async () =>
            (await this.require('agent:setConfig', { cursorApiKey: apiKey }))
              .success,
          readBack: async () =>
            (await this.require('agent:getConfig', undefined))
              .cursorApiKeyStored === stored,
        },
      ],
      context,
    );
  }

  /** Non-secret metadata of a user-defined connection, read with the connections; null until loaded. */
  customEntry(id: string): ProvidersCustomEntry | null {
    return this.customEntries().data?.find((entry) => entry.id === id) ?? null;
  }

  async refreshConnections(): Promise<void> {
    // One host read feeds both sections; each keeps its own generation and workspace scope.
    const custom = this.require('provider:listCustomEntries', {}).then(
      (result) => setCustomProviderEntries(result.entries).accepted,
    );
    await Promise.all([
      this.read(this.customEntriesStore, async () =>
        (await custom).map(
          ({ id, name, baseUrl, lane, modelsEndpoint, helpUrl, pricing }) => ({
            id,
            name,
            baseUrl,
            lane,
            modelsEndpoint,
            helpUrl,
            pricing,
          }),
        ),
      ),
      this.readConnections(custom),
    ]);
  }
  private async readConnections(
    custom: Promise<readonly ProvidersCustomEntry[]>,
  ): Promise<void> {
    await this.read(
      this.connectionsStore,
      async (): Promise<readonly ProvidersConnection[]> => {
        const [status, accepted, auth] = await Promise.all([
          this.require('auth:getApiKeyStatus', {}),
          custom,
          this.require('auth:getAuthStatus', {}),
        ]);
        const customIds = new Set(accepted.map((entry) => entry.id));
        const entries = getAllAnthropicProviders();
        const savedSetupIds = new Set(
          await Promise.all(
            entries
              .filter((entry) => entry.isLocal)
              .map(async (entry) => {
                const endpoint = await this.require('llm:getProviderBaseUrl', {
                  provider: entry.id,
                });
                return endpoint.baseUrl ? entry.id : null;
              }),
          ),
        );
        const connections: ProvidersConnection[] = entries.map(
          (entry): ProvidersConnection => {
            const host = status.providers.find(
              (provider) => provider.provider === entry.id,
            );
            // Native CLI auth has no stored setup of its own; an installed CLI is the connection.
            const authenticated =
              entry.id === 'github-copilot'
                ? auth.copilotAuthenticated === true
                : entry.id === 'openai-codex'
                  ? auth.codexAuthenticated === true && !auth.codexTokenStale
                  : entry.nativeAuth
                    ? auth.claudeCliInstalled === true
                    : false;
            return {
              id: entry.id,
              name: entry.name,
              hasKey: host?.hasApiKey === true,
              ...hostKeyHint(host?.hasApiKey ? host.keyHint : undefined),
              // An unreadable key (M-6) is unknown, not absent: configured, with no hint and `hasKey` false.
              ...(host?.keyUnreadable === true ? { keyUnreadable: true } : {}),
              configured:
                host?.hasApiKey === true ||
                host?.keyUnreadable === true ||
                customIds.has(entry.id) ||
                savedSetupIds.has(entry.id) ||
                authenticated,
              custom: customIds.has(entry.id),
              defaultsResolvable: !!entry.defaultTiers,
              authMode: entry.nativeAuth
                ? 'cli'
                : entry.authType === 'oauth'
                  ? 'oauth'
                  : entry.isLocal
                    ? entry.requiresProxy
                      ? 'local-proxy'
                      : 'local-native'
                    : 'apiKey',
              accountLabel:
                entry.id === 'github-copilot' &&
                auth.copilotAuthenticated === true
                  ? (auth.copilotUsername ?? null)
                  : null,
              tokenStale:
                entry.id === 'openai-codex' && auth.codexTokenStale === true,
            };
          },
        );
        connections.unshift({
          id: 'anthropic',
          name: 'Claude API',
          authMode: 'apiKey',
          hasKey: auth.hasApiKey,
          configured: auth.hasApiKey,
          custom: false,
          defaultsResolvable: false,
          accountLabel: null,
          tokenStale: false,
          ...hostKeyHint(auth.hasApiKey ? auth.apiKeyHint : undefined),
        });
        return connections;
      },
    );
  }

  /** The drawer's "Check connection": the host check when it has one, then the route re-read carrying `lastCheck`. */
  readonly connectionCheck = this.setup.connectionCheck;
  checkProviderConnection(providerId: string): Promise<void> {
    return this.setup.checkConnection(providerId, this.setupHooks);
  }
  /** Only supported host login operations run; launch acknowledgements are not authentication. */
  performExternalAuth(
    providerId: string | null,
    action: ProvidersExternalAuthAction,
  ): Promise<void> {
    return this.setup.performExternalAuth(providerId, action, this.setupHooks);
  }
  /**
   * Store setup without selecting it, then optionally activate only after all earlier writes succeed.
   * Resolves `false` when refused because another save is in flight (see `ProvidersCommitService.run`).
   */
  connectProvider(
    draft: ProvidersConnectionDraft,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.setup.connectProvider(draft, context, this.setupHooks);
  }
  /**
   * Select an existing connection for the main agent. Tier mapping is left to `auth:saveSettings`,
   * whose autoMapProviderTiers fills only UNSET main-agent tiers; the user's existing tiers stay.
   */
  activateConnection(
    providerId: string,
    applyTo: SettingScope,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.setup.activateConnection(
      providerId,
      applyTo,
      context,
      this.setupHooks,
    );
  }
  /** Probe is non-mutating. A caller-owned credential is never copied into a signal. */
  verifyDraft(params: AuthVerifyDraftConnectionParams): Promise<void> {
    return this.setup.verifyDraft(params);
  }
  cancelVerification(
    params?: AuthCancelDraftVerificationParams,
  ): Promise<AuthCancelDraftVerificationResult> {
    return this.setup.cancelVerification(params);
  }

  // Writes for the redesigned surface. Each resolves `false` when refused because another save is
  // in flight, and reports through `commit()` like every other save (D15).
  /** D4: deletes one stored key without changing the auth method or resetting the SDK. */
  deleteStoredKey(
    providerId: string,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.setup.deleteStoredKey(providerId, context, this.setupHooks);
  }
  disconnectCopilot(context: ProvidersEditContext): Promise<boolean> {
    return this.setup.disconnectCopilot(context, this.setupHooks);
  }
  /** Blocked with "Switch the main agent first." while the connection drives the main agent. */
  removeCustomEntry(
    id: string,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.setup.removeCustomEntry(id, context, this.setupHooks);
  }
  /** Help URL and pricing: metadata, saved without a connection check. */
  updateCustomEntryFields(
    id: string,
    changes: Partial<Pick<ProvidersCustomEntry, 'helpUrl' | 'pricing'>>,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.setup.updateCustomEntryFields(
      id,
      changes,
      context,
      this.setupHooks,
    );
  }
  /** D7: base URL and/or models endpoint, saved only with a verified probe of this connection. */
  updateCustomEntryEndpoint(
    id: string,
    changes: Partial<Pick<ProvidersCustomEntry, 'baseUrl' | 'modelsEndpoint'>>,
    probeId: string,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.setup.updateCustomEntryEndpoint(
      id,
      changes,
      probeId,
      context,
      this.setupHooks,
    );
  }
  updateLocalBaseUrl(
    providerId: string,
    baseUrl: string,
    probeId: string,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.setup.updateLocalBaseUrl(
      providerId,
      baseUrl,
      probeId,
      context,
      this.setupHooks,
    );
  }
  /** An empty `modelId` clears the stored main-agent tier (the provider default applies). */
  setMainAgentTier(
    providerId: string,
    tier: ProvidersModelTier,
    modelId: string,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.runCommit(
      [this.commits.mainAgentTierOperation(providerId, tier, modelId)],
      context,
    );
  }
  /** D5: the instance's own tier mapping, always written as the full object. */
  setCliInstanceTiers(
    id: string,
    tiers: Partial<Record<ProvidersModelTier, string>>,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.runCommit(
      [this.commits.cliInstanceTiersOperation(id, tiers)],
      context,
    );
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
      const result = await this.require('settings:get', {
        key: 'ptahCliAgents',
      });
      if (!result.success || !Array.isArray(result.value))
        throw new Error('CLI models unavailable');
      const models: Record<
        string,
        Pick<PtahCliConfig, 'selectedModel' | 'tierMappings'>
      > = {};
      for (const item of result.value as unknown[]) {
        if (
          !item ||
          typeof item !== 'object' ||
          !('id' in item) ||
          typeof item.id !== 'string'
        )
          throw new Error('Invalid CLI configuration');
        const selectedModel =
          'selectedModel' in item ? item.selectedModel : undefined;
        if (selectedModel !== undefined && typeof selectedModel !== 'string')
          throw new Error('Invalid CLI model');
        const tiers = 'tierMappings' in item ? item.tierMappings : undefined;
        if (tiers !== undefined && (!tiers || typeof tiers !== 'object'))
          throw new Error('Invalid CLI tiers');
        const mappings: { sonnet?: string; opus?: string; haiku?: string } = {};
        for (const tier of ['sonnet', 'opus', 'haiku'] as const) {
          if (tiers && typeof tiers === 'object' && tier in tiers) {
            const value: unknown = (tiers as Record<string, unknown>)[tier];
            if (typeof value !== 'string')
              throw new Error('Invalid CLI tier model');
            mappings[tier] = value;
          }
        }
        Object.defineProperty(models, item.id, {
          enumerable: true,
          value: { selectedModel, tierMappings: mappings },
        });
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
      if (!['apiKey', 'claudeCli', 'thirdParty'].includes(auth.authMethod))
        throw new Error('Authentication source unavailable');
      // Public settings namespace: provider.<authKey>.selectedModel / reasoningEffort (plan target key map).
      const authKey =
        auth.authMethod === 'thirdParty'
          ? `thirdParty.${auth.anthropicProviderId}`
          : auth.authMethod;
      const model = `provider.${authKey}.selectedModel`,
        effort = `provider.${authKey}.reasoningEffort`;
      const scopes = await this.require('config:getScopes', {
        keys: [model, effort],
      });
      return {
        model: scopes.entries.find((entry) => entry.key === model),
        effort: scopes.entries.find((entry) => entry.key === effort),
      };
    });
  }
  /**
   * A failed read drops the previous value: a stale Cursor flag would read as a current "Set".
   * The section shows its error and Retry instead.
   */
  async refreshOrchestration(): Promise<void> {
    await readSection(
      this.orchestrationStore,
      this.workspace,
      async (): Promise<ProvidersOrchestration> => {
        const config = await this.require('agent:getConfig', undefined);
        return {
          codexModel: config.codexModel,
          copilotModel: config.copilotModel,
          cursorModel: config.cursorModel,
          antigravityModel: config.antigravityModel,
          grokModel: config.grokModel,
          opencodeModel: config.opencodeModel,
          piModel: config.piModel,
          codexReasoningEffort: config.codexReasoningEffort,
          copilotReasoningEffort: config.copilotReasoningEffort,
          piReasoningEffort: config.piReasoningEffort,
          detectedClis: config.detectedClis,
          disabledClis: config.disabledClis,
          preferredAgentOrder: config.preferredAgentOrder,
          maxConcurrentAgents: config.maxConcurrentAgents,
          copilotAutoApprove: config.copilotAutoApprove,
          // Both optional on the RPC result: a missing or unknown setting reads as 'auto', a missing override as none.
          subagentPromptCacheTtl:
            SUBAGENT_PROMPT_CACHE_TTL_SETTINGS.find(
              (value) => value === config.subagentPromptCacheTtl,
            ) ?? 'auto',
          subagentPromptCacheTtlEnvOverride:
            config.subagentPromptCacheTtlEnvOverride,
          cursorApiKeyConfigured: config.cursorApiKeyConfigured,
          cursorApiKeyStored: config.cursorApiKeyStored,
          cursorApiKeyEnvSet: config.cursorApiKeyEnvSet,
        };
      },
      false,
    );
  }
  /**
   * Re-detects installed CLIs, then rereads everything derived from them. A failed detection
   * leaves `cliDetection()` in error and rereads nothing. Each call decides on its own detection
   * result, not the shared section, which an overlapping call may have replaced.
   */
  async redetectClis(): Promise<void> {
    let detected = false;
    await this.read(this.detectionStore, async () => {
      const { clis } = await this.require('agent:detectClis', undefined);
      detected = true;
      return clis;
    });
    if (!detected) return;
    await Promise.all([
      this.refreshOrchestration(),
      this.refreshCliAgents(),
      this.refreshCliModels(),
    ]);
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
      Object.values(this.mainSources().data ?? {}).find(
        (entry) => entry?.key === key,
      ) ??
      null
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

  /**
   * Commands never retain credentials in service state; only field names enter commit feedback.
   * Every commit command resolves `false` when refused because another save is in flight (nothing
   * was written and `commit()` still describes the in-flight save), otherwise `true`.
   */
  async saveSettings(
    patch: ProvidersSettingsPatch,
    context: ProvidersEditContext,
  ): Promise<boolean> {
    const operations = this.commits.operations(patch);
    return this.runCommit(operations, context, () => {
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

  async clearWorkspaceOverride(
    context: ProvidersEditContext,
  ): Promise<boolean> {
    return this.runCommit(
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
  ): Promise<boolean> {
    let clearedResult: ConfigClearScopeOverrideResult | null = null;
    return this.runCommit(
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

  /** The commit pipeline reads and refreshes the sections this facade owns, in this order. */
  private readonly commitHooks: ProvidersCommitHooks = {
    refreshScopes: () => this.refreshScopes(),
    refresh: () => this.refresh(),
    scopes: () => this.scopes(),
    sectionsReady: () =>
      [
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
      ].every((state) => state.status === 'ready'),
  };
  /** Connection setup reads the catalogue and write targets, and commits through the same hooks. */
  private readonly setupHooks: ProvidersConnectionSetupHooks = {
    connections: () => this.connections(),
    writeScopes: (key) => this.writeScopes(key),
    commit: this.commitHooks,
    refreshConnections: () => this.refreshConnections(),
    refreshRoute: () => this.refreshRoute(),
    route: () => this.route(),
    refreshAuthStatus: () => this.authState.refreshAuthStatus(),
  };
  /** Resolves `false` when refused because another save is in flight (see `ProvidersCommitService.run`). */
  private runCommit(
    operations: readonly SaveOperation[],
    context: ProvidersEditContext,
    allowed?: () => boolean,
  ): Promise<boolean> {
    return this.commits.run(operations, context, this.commitHooks, allowed);
  }
  private freshEffortView<T>(
    store: SectionStore<T>,
    readRevision: () => number,
  ) {
    return effortFreshSectionView(
      store,
      readRevision,
      this.workspace,
      this.effortChanges,
    );
  }
  private view<T>(store: SectionStore<T>) {
    return sectionView(store, this.workspace);
  }
  private read<T>(
    store: SectionStore<T>,
    request: () => Promise<T>,
  ): Promise<void> {
    return readSection(store, this.workspace, request);
  }
  private require<T extends RpcMethodName>(
    method: T,
    params: RpcMethodParams<T>,
    timeout?: number,
  ): Promise<RpcMethodResult<T>> {
    return requireRpcData(this.rpc, method, params, timeout);
  }
}
