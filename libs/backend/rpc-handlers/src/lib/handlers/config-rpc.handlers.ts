/**
 * Config RPC Handlers
 *
 * Handles config-related RPC methods: config:model-*, config:autopilot-*.
 * Manages model selection and autopilot configuration persistence.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import {
  AUTH_METHOD_DEF,
  ANTHROPIC_PROVIDER_ID_DEF,
  providerSelectedModelDef,
  SETTINGS_TOKENS,
  WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import type {
  ModelSettings,
  ReasoningSettings,
} from '@ptah-extension/settings-core';
import {
  SdkAgentAdapter,
  SdkPermissionHandler,
  SDK_TOKENS,
  type SessionLifecycleManager,
} from '@ptah-extension/agent-sdk';
import type { IPricingProvider } from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  ProviderModelsService,
} from '@ptah-extension/auth-providers';
import type { ModelResolver } from '@ptah-extension/auth-providers';
import {
  ConfigModelSwitchParams,
  ConfigModelSwitchResult,
  ConfigModelGetResult,
  ConfigAutopilotToggleParams,
  ConfigAutopilotToggleResult,
  ConfigAutopilotGetParams,
  ConfigAutopilotGetResult,
  ConfigModelsListResult,
  SdkModelInfo,
  ConfigEffortSetParams,
  ConfigEffortSetResult,
  ConfigEffortGetResult,
  ConfigPricingGetResult,
  ANTHROPIC_DIRECT_PROVIDER_ID,
  DEFAULT_PROVIDER_ID,
  getModelPricingDescription,
  getPricingMap,
  normalizeAuthMethod,
  type AuthEnv,
  type SessionId,
  type SessionRuntimeControls,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';
import {
  parsePermissionLevel,
  parseEffortLevel,
  parseApplyTo,
  parseModelsListParams,
} from './config-rpc.schema';
import { configRuntimeControls } from './config-runtime-controls';
import { isTierAlias, savedModelOption } from './config-saved-model-option';

/**
 * Copy of an auth env taken for one `config:models-list` request.
 *
 * `ModelResolver` reads the shared `SDK_AUTH_ENV` object when no override is
 * passed, and that object is mutated when the active provider changes. A
 * shallow copy keeps the values from the moment of the request. The object
 * is a flat map of strings, so the copy does not share later writes.
 */
function snapshotAuthEnv(env: AuthEnv): AuthEnv {
  return { ...env };
}

/**
 * RPC handlers for configuration operations
 */
@injectable()
export class ConfigRpcHandlers {
  static readonly METHODS = [
    'config:model-switch',
    'config:model-set',
    'config:model-get',
    'config:autopilot-toggle',
    'config:autopilot-get',
    'config:models-list',
    'config:effort-get',
    'config:effort-set',
    'config:pricing-get',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private readonly permissionHandler: SdkPermissionHandler,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: ModelResolver,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(SETTINGS_TOKENS.REASONING_SETTINGS)
    private readonly reasoningSettings: ReasoningSettings,
    @inject(SDK_TOKENS.PRICING_PROVIDER)
    private readonly pricingProvider: IPricingProvider,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, { isOptional: true })
    private readonly lifecycle: SessionLifecycleManager | null = null,
    @inject(SDK_TOKENS.SESSION_RUNTIME_ROUTER, { isOptional: true })
    private readonly runtimeControls: SessionRuntimeControls | null = null,
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER, { isOptional: true })
    private readonly scopeResolver: WorkspaceScopeResolver | null = null,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV, { isOptional: true })
    private readonly authEnv: AuthEnv | null = null,
  ) {}

  /**
   * Register all config RPC methods
   */
  register(): void {
    this.registerModelSwitch();
    this.registerModelSet();
    this.registerModelGet();
    this.registerAutopilotToggle();
    this.registerAutopilotGet();
    this.registerModelsList();
    this.registerEffortGet();
    this.registerEffortSet();
    this.registerPricingGet();
    const autopilotEnabled = this.configManager.getWithDefault<boolean>(
      'autopilot.enabled',
      false,
    );
    const savedLevel = parsePermissionLevel(
      this.configManager.getWithDefault<string>(
        'autopilot.permissionLevel',
        'ask',
      ),
    );
    const effectiveLevel = autopilotEnabled ? savedLevel : 'ask';
    this.permissionHandler.setPermissionLevel(effectiveLevel);

    this.logger.debug('Config RPC handlers registered', {
      methods: [
        'config:model-switch',
        'config:model-set',
        'config:model-get',
        'config:autopilot-toggle',
        'config:autopilot-get',
        'config:models-list',
        'config:effort-get',
        'config:effort-set',
        'config:pricing-get',
      ],
      initialPermissionLevel: effectiveLevel,
    });
  }

  /**
   * config:pricing-get - Hand the runtime pricing map to the webview.
   *
   * `pricing.utils` stores its map in a module-level `let`, and the webview
   * bundle holds its OWN instance of that module. Every hydration path —
   * OpenRouter's catalog, `seedStaticModelPricing`, Ollama Cloud's metadata —
   * runs in the extension host, so the renderer's copy never held anything but
   * the handful of bundled entries. There is no way to share the map short of
   * sending it, which is what this does.
   *
   * Awaits {@link IPricingProvider.ensureHydrated} first so a webview that
   * boots faster than the catalog fetch does not cache the bundled table
   * forever. Hydration failure is reported, never thrown: a renderer holding
   * the bundled table is degraded, not broken, and `hydrated: false` tells it
   * the answer is worth asking for again.
   */
  private registerPricingGet(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      ConfigPricingGetResult
    >('config:pricing-get', async () => {
      let hydrated = false;
      try {
        hydrated = await this.pricingProvider.ensureHydrated();
      } catch (error) {
        // Not fatal — fall through and serve whatever the map holds.
        this.logger.warn(
          'RPC: config:pricing-get hydration failed, serving bundled pricing',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      const pricing = getPricingMap();
      this.logger.debug('RPC: config:pricing-get called', {
        entryCount: Object.keys(pricing).length,
        hydrated,
      });
      return { pricing, hydrated };
    });
  }

  /**
   * config:model-switch - Switch AI model
   */
  private registerModelSwitch(): void {
    this.rpcHandler.registerMethod<
      ConfigModelSwitchParams,
      ConfigModelSwitchResult
    >('config:model-switch', async (params) => {
      try {
        const { model, sessionId } = params;
        const applyTo = parseApplyTo(params.applyTo, 'app');
        this.logger.info(
          '[ModelDiag] config:model-switch RECEIVED from frontend',
          {
            model,
            sessionId: sessionId ?? null,
            startsWithClaude: model.startsWith('claude-'),
          },
        );
        if (sessionId && this.runtimeControls) {
          await this.runtimeControls.setModel(sessionId, model, { applyTo });
        } else {
          const previous = sessionId ? this.lifecycle?.find(sessionId)?.currentModel : undefined;
          await this.saveFallback(
            () => sessionId ? configRuntimeControls(null, this.sdkAdapter).setModel(sessionId, model) : Promise.resolve(false),
            () => this.modelSettings.selectedModel.set(model, applyTo),
            sessionId && previous !== undefined ? () => this.sdkAdapter.setSessionModel(sessionId, previous) : undefined,
          );
        }

        this.logger.info('Model switched successfully', { model });

        return { model };
      } catch (error) {
        this.logger.error(
          'RPC: config:model-switch failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'ConfigRpcHandlers.registerModelSwitch' },
        );
        throw error;
      }
    });
  }

  /**
   * config:model-set - Persist model selection and/or autopilot flag.
   *
   * Lifted from
   * `apps/ptah-electron/src/services/rpc/handlers/config-extended-rpc.handlers.ts`
   * so all three apps (VS Code, Electron, CLI) consume it via
   * `registerAllRpcHandlers()`. The original used `StorageService`; this shared
   * version goes through `ConfigManager` which already routes to the same
   * underlying store on every host.
   */
  private registerModelSet(): void {
    this.rpcHandler.registerMethod(
      'config:model-set',
      async (
        params:
          | {
              model?: string;
              autopilot?: boolean;
              applyTo?: 'global' | 'workspace';
            }
          | undefined,
      ) => {
        try {
          if (params?.model !== undefined) {
            await this.modelSettings.selectedModel.set(
              params.model,
              parseApplyTo(params.applyTo, 'app'),
            );
          }
          if (params?.autopilot !== undefined) {
            await this.configManager.set('autopilot.enabled', params.autopilot);
          }
          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: config:model-set failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'ConfigRpcHandlers.registerModelSet' },
          );
          throw error;
        }
      },
    );
  }

  /**
   * config:model-get - Get current model selection.
   *
   * A pure read: returns the stored value verbatim. It used to "migrate" every
   * value not starting with `claude-` by re-saving it at the default (global)
   * target, and `ComputedSettingHandle.set` then cleared the more specific
   * scopes. A model saved for "This workspace" (e.g. `gpt-6-luna`, `haiku`)
   * was therefore copied to the global key and its workspace override wiped by
   * the Settings read-back. Tier aliases and third-party ids are valid as
   * stored; `config:models-list` resolves them for the picker.
   */
  private registerModelGet(): void {
    this.rpcHandler.registerMethod<void, ConfigModelGetResult>(
      'config:model-get',
      async () => {
        try {
          this.logger.debug('RPC: config:model-get called');
          const stored = this.modelSettings.selectedModel.get() || '';
          return { model: stored || 'default' };
        } catch (error) {
          this.logger.error(
            'RPC: config:model-get failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'ConfigRpcHandlers.registerModelGet' },
          );
          throw error;
        }
      },
    );
  }

  /**
   * config:autopilot-toggle - Toggle autopilot and set permission level
   */
  private registerAutopilotToggle(): void {
    this.rpcHandler.registerMethod<
      ConfigAutopilotToggleParams,
      ConfigAutopilotToggleResult
    >('config:autopilot-toggle', async (params) => {
      try {
        const { enabled, permissionLevel, sessionId } = params;
        const validLevels = ['ask', 'auto-edit', 'yolo', 'plan'] as const;
        if (
          !validLevels.includes(permissionLevel as (typeof validLevels)[number])
        ) {
          throw new Error(
            `Invalid permission level: ${permissionLevel}. Must be one of: ${validLevels.join(
              ', ',
            )}`,
          );
        }

        this.logger.debug('RPC: config:autopilot-toggle called', {
          enabled,
          permissionLevel,
          sessionId,
        });
        if (enabled && permissionLevel === 'yolo') {
          this.logger.warn(
            'YOLO mode enabled - DANGEROUS: All permission prompts will be skipped',
            { enabled, permissionLevel },
          );
        }

        const effectiveLevel = enabled ? permissionLevel : 'ask';
        const targetSessionId = this.autopilotTargetSession(sessionId);
        if (targetSessionId && this.runtimeControls) {
          await this.runtimeControls.setPermission(targetSessionId, effectiveLevel, {
            applyTo: 'global',
            autopilot: { enabled, permissionLevel },
          });
        } else {
          const previousLive = targetSessionId ? this.lifecycle?.find(targetSessionId)?.permissionLevel : undefined;
          const previousEnabled = this.configManager.getWithDefault<boolean>('autopilot.enabled', false);
          const previousLevel = this.configManager.getWithDefault<string>('autopilot.permissionLevel', 'ask');
          await this.saveFallback(
            () => targetSessionId ? configRuntimeControls(null, this.sdkAdapter).setPermission(targetSessionId, effectiveLevel) : Promise.resolve(false),
            async () => {
              try {
                await this.configManager.set('autopilot.enabled', enabled);
                await this.configManager.set('autopilot.permissionLevel', permissionLevel);
              } catch (error) {
                const restores = await Promise.allSettled([
                  this.configManager.set('autopilot.enabled', previousEnabled),
                  this.configManager.set('autopilot.permissionLevel', previousLevel),
                ]);
                for (const restore of restores) {
                  if (restore.status === 'rejected')
                    this.logger.error('Permission settings restore failed', restore.reason instanceof Error ? restore.reason : new Error(String(restore.reason)));
                }
                throw error;
              }
            },
            targetSessionId && previousLive !== undefined ? () => this.sdkAdapter.setSessionPermissionLevel(targetSessionId, previousLive) : undefined,
          );
        }
        this.permissionHandler.setPermissionLevel(effectiveLevel);

        this.logger.info('Autopilot state updated', {
          enabled,
          permissionLevel,
        });

        return { enabled, permissionLevel };
      } catch (error) {
        this.logger.error(
          'RPC: config:autopilot-toggle failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'ConfigRpcHandlers.registerAutopilotToggle' },
        );
        throw error;
      }
    });
  }

  /**
   * The live session a `config:autopilot-toggle` re-gates, or undefined for
   * none. Permission gating is per-session (each session reads its own
   * level), so a toggle must reach a concrete session to affect a running turn.
   *
   * - A session id: that session.
   * - `null`: the webview's tab has no SDK session yet (TASK_2026_660). The
   *   toggle saves the default for new sessions and re-gates NO live session;
   *   falling back here would change an unrelated parent or gateway session.
   * - Omitted (legacy CLI/TUI callers): the most recently active session.
   *   An empty string counts as omitted: `??` alone kept it, and the
   *   truthiness check after it discarded it, so the fallback never fired.
   */
  private autopilotTargetSession(
    sessionId: ConfigAutopilotToggleParams['sessionId'],
  ): SessionId | undefined {
    if (sessionId === null) return undefined;
    if (sessionId) return sessionId;
    return this.sdkAdapter.getActiveSessionIds()[0];
  }

  /**
   * config:autopilot-get - Get current autopilot state: the saved default and,
   * when a `sessionId` is given, that session's live level (TASK_2026_660), so
   * each tab's popover shows its own session rather than the last toggle made
   * in any tab.
   */
  private registerAutopilotGet(): void {
    this.rpcHandler.registerMethod<
      ConfigAutopilotGetParams | undefined,
      ConfigAutopilotGetResult
    >('config:autopilot-get', async (params) => {
      try {
        this.logger.debug('RPC: config:autopilot-get called');

        const enabled = this.configManager.getWithDefault<boolean>(
          'autopilot.enabled',
          false,
        );
        const permissionLevel = parsePermissionLevel(
          this.configManager.getWithDefault<string>(
            'autopilot.permissionLevel',
            'ask',
          ),
        );

        const sessionId = params?.sessionId;
        if (!sessionId) return { enabled, permissionLevel };
        // No record → the session is not live; it starts at the saved
        // default when it resumes.
        const sessionPermissionLevel =
          this.lifecycle?.find(sessionId)?.permissionLevel ?? null;
        return { enabled, permissionLevel, sessionPermissionLevel };
      } catch (error) {
        this.logger.error(
          'RPC: config:autopilot-get failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'ConfigRpcHandlers.registerAutopilotGet' },
        );
        throw error;
      }
    });
  }

  /**
   * config:models-list - Get available models with metadata
   *
   * Merges two model sources:
   * 1. SDK's supportedModels() — 3 tier slots (opus/sonnet/haiku) as recommended shortcuts
   * 2. Anthropic /v1/models API — ALL available models for specific version selection
   *
   * SDK tier models appear first (as "latest" recommended options), followed by
   * additional API models not already covered by a tier. The SDK accepts any model
   * string in setModel(), so all models work regardless of source.
   *
   * Provider, saved model, and tier overrides are captured before those
   * awaits. The resolution env is a copy of the shared auth env for both
   * scopes, taken before the catalog awaits. That env belongs to the active
   * workspace once auth has resolved; the frontend starts a fresh read after
   * each workspace auth refresh, so a pre-auth read is superseded. Candidate matching and subscription labelling
   * use that copy. A later change to the ambient auth env must not rewrite
   * this answer.
   */
  private registerModelsList(): void {
    this.rpcHandler.registerMethod<unknown, ConfigModelsListResult>(
      'config:models-list',
      async (params) => {
        try {
          const requested = parseModelsListParams(params);
          const scope = this.captureModelsListScope(requested.workspacePath);
          this.logger.debug('RPC: config:models-list called', {
            workspacePath: scope.workspacePath,
          });
          const sdkModels = await this.sdkAdapter.getSupportedModels();
          const apiModels = await this.sdkAdapter.getApiModels();

          this.logger.info('RPC: config:models-list sources', {
            sdkCount: sdkModels.length,
            apiCount: apiModels.length,
            sdkValues: sdkModels.map((m) => m.value),
            apiValues: apiModels.map((m) => m.value).slice(0, 10),
          });
          const {
            savedModel,
            resolvedSavedModel,
            tierOverrides,
            resolutionEnv,
          } = scope;

          this.logger.info('RPC: config:models-list tier context', {
            activeProviderId: scope.providerId,
            tierOverrides: tierOverrides ?? 'null',
            savedModel,
            workspacePath: scope.workspacePath,
          });
          // Rates are the published ones either way. The pinned provider's
          // billing policy decides whether the line says they are charged
          // per token or absorbed by a flat fee.
          const pricingOptions = {
            subscriptionCovered: scope.subscriptionCovered,
          };
          const sdkModelIds = new Set(sdkModels.map((m) => m.value));
          // A saved Claude id or bare tier alias selects the entry it
          // resolves to (Codex `haiku` -> the listed `gpt-6-luna`), so a
          // workspace saved as `haiku` no longer shows "Default".
          // `resolutionEnv` is the snapshot from before the catalog awaits.
          const resolvesSaved =
            savedModel.startsWith('claude-') || isTierAlias(savedModel);
          const matchesSaved = (value: string): boolean =>
            value === savedModel ||
            (resolvesSaved &&
              value.toLowerCase() !== 'default' &&
              this.modelResolver.resolve(value, resolutionEnv) ===
                resolvedSavedModel);
          const models: SdkModelInfo[] = [];

          for (const m of sdkModels) {
            let tier = this.modelResolver.detectTier(m.value);
            if (!tier && tierOverrides) {
              const match = Object.entries(tierOverrides).find(
                ([, v]) => v === m.value,
              );
              if (match) {
                tier = match[0] as 'opus' | 'sonnet' | 'haiku';
              }
            }

            const providerModelId =
              tierOverrides && tier ? (tierOverrides[tier] ?? null) : null;

            models.push({
              id: m.value,
              name: m.displayName,
              description: providerModelId
                ? getModelPricingDescription(providerModelId, pricingOptions)
                : m.description,
              isSelected: matchesSaved(m.value),
              isRecommended: m.value.toLowerCase().includes('sonnet'),
              providerModelId,
              tier,
            });
          }

          for (const m of apiModels) {
            if (sdkModelIds.has(m.value)) continue;

            const tier = this.modelResolver.detectTier(m.value);

            const providerModelId =
              tierOverrides && tier ? (tierOverrides[tier] ?? null) : null;

            models.push({
              id: m.value,
              name: m.displayName,
              description: providerModelId
                ? getModelPricingDescription(providerModelId, pricingOptions)
                : getModelPricingDescription(m.value, pricingOptions),
              isSelected: matchesSaved(m.value),
              isRecommended: false,
              providerModelId,
              tier,
            });
          }
          if (!models.some((m) => m.isSelected)) {
            this.appendSavedModel(
              models,
              savedModel,
              pricingOptions,
              scope.providerId,
              scope.cachedModelIds,
            );
          }
          const exactMatchIndex = models.findIndex((m) => m.id === savedModel);
          if (exactMatchIndex !== -1) {
            models.forEach((m, i) => {
              m.isSelected = i === exactMatchIndex;
            });
          } else {
            const firstSelected = models.findIndex((m) => m.isSelected);
            models.forEach((m, i) => {
              m.isSelected = i === firstSelected;
            });
          }
          this.logger.info(
            '[ModelDiag] config:models-list SENDING to frontend dropdown',
            {
              savedModel,
              workspacePath: scope.workspacePath,
              tierOverrides: tierOverrides ?? 'none',
              models: models.map((m) => ({
                id: m.id,
                name: m.name,
                isSelected: m.isSelected,
                tier: m.tier ?? 'none',
                providerModelId: m.providerModelId ?? 'none',
              })),
            },
          );

          return { models, workspacePath: scope.workspacePath };
        } catch (error) {
          this.logger.error(
            'RPC: config:models-list failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'ConfigRpcHandlers.registerModelsList' },
          );
          throw error;
        }
      },
    );
  }

  /**
   * Provider, saved main-agent model, and catalog for one request scope.
   * Those reads happen before `getSupportedModels` / `getApiModels` await,
   * so a workspace switch during the catalog fetch cannot replace them.
   *
   * Both scopes copy the shared auth env before the first catalog await.
   * Workspace switches make other-workspace replies stale in ModelStateService.
   */
  private captureModelsListScope(workspacePath: string | null): {
    workspacePath: string | null;
    providerId: string;
    savedModel: string;
    resolvedSavedModel: string;
    cachedModelIds: readonly string[] | null;
    tierOverrides: ReturnType<ProviderModelsService['getModelTiers']> | null;
    subscriptionCovered: boolean;
    resolutionEnv: AuthEnv;
  } {
    const pinned = workspacePath
      ? this.readWorkspaceModelScope(workspacePath)
      : {
          providerId: this.providerModels.resolveActiveProviderId(),
          savedModel: this.modelSettings.selectedModel.get() || 'default',
        };
    const cached = this.providerModels.getCachedModelIds(pinned.providerId);
    const savedModel = pinned.savedModel;
    const tierOverrides = this.getTierOverrides(pinned.providerId);
    // The shared env belongs to the active workspace; a workspace switch
    // makes a reply for another scope stale before ModelStateService uses it.
    const resolutionEnv = this.snapshotSharedAuthEnv();
    return {
      workspacePath,
      providerId: pinned.providerId,
      savedModel,
      resolvedSavedModel: this.modelResolver.resolve(
        savedModel,
        resolutionEnv,
      ),
      cachedModelIds: cached ? cached.slice() : null,
      tierOverrides,
      subscriptionCovered:
        this.modelResolver.isSubscriptionCovered(resolutionEnv),
      resolutionEnv,
    };
  }

  /** Shallow copy of the shared auth env `ModelResolver` defaults to. */
  private snapshotSharedAuthEnv(): AuthEnv {
    return snapshotAuthEnv(this.authEnv ?? {});
  }

  /**
   * Saved model and provider for an explicit workspace, not the ambient one.
   * Resolution matches `ModelSettings.selectedModel` (app-scopable provider
   * key) and `ActiveProviderResolver.resolveActiveAuthForPath`.
   */
  private readWorkspaceModelScope(workspacePath: string): {
    providerId: string;
    savedModel: string;
  } {
    const resolver = this.scopeResolver;
    if (!resolver) {
      throw new Error(
        'config:models-list cannot read a workspace scope without a scope resolver',
      );
    }
    const authMethod = normalizeAuthMethod(
      resolver.readForPath<string>(AUTH_METHOD_DEF.key, workspacePath, true),
    );
    const storedProviderId = resolver.readForPath<string>(
      ANTHROPIC_PROVIDER_ID_DEF.key,
      workspacePath,
      true,
    );
    const providerIdForKey = storedProviderId ?? DEFAULT_PROVIDER_ID;
    const authKey = resolveAuthProviderKey(authMethod, providerIdForKey);
    const providerId =
      authMethod === 'thirdParty'
        ? providerIdForKey
        : ANTHROPIC_DIRECT_PROVIDER_ID;
    const savedRaw = resolver.readForPath<string>(
      providerSelectedModelDef(authKey).key,
      workspacePath,
      true,
    );
    const savedModel =
      savedRaw && savedRaw.length > 0 ? savedRaw : 'default';
    return { providerId, savedModel };
  }

  /**
   * Offer a saved model the list did not carry (D1): a concrete id the active
   * provider declares but that is not one of its tier mappings. Without this
   * the picker selected nothing and "Default" ran the turn on the opus tier.
   *
   * `providerId` and `cachedModelIds` are the snapshot from the start of the
   * request. Re-reading them here would follow a workspace switch that happened
   * while the catalog fetch was in flight.
   */
  private appendSavedModel(
    models: SdkModelInfo[],
    savedModel: string,
    pricingOptions: { subscriptionCovered: boolean },
    providerId: string,
    cachedModelIds: readonly string[] | null,
  ): void {
    const option = savedModelOption(providerId, savedModel, cachedModelIds);
    if (!option) return;
    models.push({
      id: option.id,
      name: option.name,
      description:
        option.description ||
        getModelPricingDescription(option.id, pricingOptions),
      isSelected: true,
      isRecommended: false,
      providerModelId: null,
      tier: undefined,
    });
  }

  /**
   * Get provider tier overrides for model mapping (OpenRouter etc.).
   *
   * Returns null for direct Anthropic — tier→model-id remapping only applies
   * to third-party providers that use different model IDs (e.g., OpenRouter's
   * 'anthropic/claude-sonnet-4'). For api.anthropic.com, model IDs are valid
   * as-is and the CLI/SDK handles tier resolution natively.
   *
   * `providerId` is the scope captured for this request, not a fresh ambient read.
   */
  private getTierOverrides(
    providerId: string,
  ): ReturnType<ProviderModelsService['getModelTiers']> | null {
    try {
      if (providerId === ANTHROPIC_DIRECT_PROVIDER_ID) {
        return null;
      }
      return this.providerModels.getModelTiers(providerId, 'mainAgent');
    } catch (e) {
      // degradation-audit: optional-capability - tier overrides are a
      // third-party-provider remapping layer; null uses the model ids as
      // written, which is the Anthropic-direct behaviour.
      this.logger.warn(
        'Failed to read provider tier overrides',
        e instanceof Error ? e : new Error(String(e)),
      );
      return null;
    }
  }

  /**
   * config:effort-get - Get saved reasoning effort level
   */
  private registerEffortGet(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      ConfigEffortGetResult
    >('config:effort-get', async () => {
      try {
        this.logger.debug('RPC: config:effort-get called');
        const effortRaw = this.reasoningSettings.effort.get();
        return {
          effort: parseEffortLevel(effortRaw),
        };
      } catch (error) {
        this.logger.error(
          'RPC: config:effort-get failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'ConfigRpcHandlers.registerEffortGet' },
        );
        throw error;
      }
    });
  }

  /** Restore only authoritative live snapshots; persisted defaults may differ. */
  private async saveFallback(
    apply: () => Promise<unknown>,
    save: () => Promise<void>,
    rollback?: () => Promise<void>,
  ): Promise<void> {
    const applied = await apply();
    try {
      await save();
    } catch (error) {
      if (applied !== false) {
        if (rollback) {
          try {
            await rollback();
          } catch (restoreError) {
            this.logger.error('Live setting restore failed', restoreError instanceof Error ? restoreError : new Error(String(restoreError)));
          }
        } else {
          this.logger.warn('Cannot restore live setting: previous session value unavailable');
        }
      }
      throw error;
    }
  }

  private registerEffortSet(): void {
    this.rpcHandler.registerMethod<
      ConfigEffortSetParams,
      ConfigEffortSetResult
    >('config:effort-set', async (params) => {
      try {
        const effort = parseEffortLevel(params.effort);
        const sessionId = params.sessionId;
        const applyTo = parseApplyTo(params.applyTo, 'app');
        this.logger.debug('RPC: config:effort-set called', {
          effort,
          sessionId: sessionId ?? null,
        });

        if (sessionId && this.runtimeControls) {
          await this.runtimeControls.setEffort(sessionId, effort, { applyTo });
        } else {
          // SessionControl does not track live effort; config.effort is only the launch value.
          await this.saveFallback(
            () => sessionId ? configRuntimeControls(null, this.sdkAdapter).setEffort(sessionId, effort) : Promise.resolve(false),
            () => this.reasoningSettings.effort.set(effort || '', applyTo),
          );
        }

        this.logger.info('Reasoning effort saved', { effort });
        return { effort };
      } catch (error) {
        this.logger.error(
          'RPC: config:effort-set failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'ConfigRpcHandlers.registerEffortSet' },
        );
        throw error;
      }
    });
  }
}
