/**
 * Config RPC Handlers
 *
 * Handles config-related RPC methods: config:model-*, config:autopilot-*
 * Manages model selection and autopilot configuration persistence.
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_203: Moved to @ptah-extension/rpc-handlers (removed vscode.ConfigurationTarget)
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
  FeatureGateService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type {
  ModelSettings,
  ReasoningSettings,
} from '@ptah-extension/settings-core';
import {
  SdkAgentAdapter,
  SdkPermissionHandler,
  ProviderModelsService,
  SDK_TOKENS,
  DEFAULT_FALLBACK_MODEL_ID,
  TIER_TO_MODEL_ID,
} from '@ptah-extension/agent-sdk';
import type { ModelResolver } from '@ptah-extension/agent-sdk';
import {
  PermissionLevel,
  ConfigModelSwitchParams,
  ConfigModelSwitchResult,
  ConfigModelGetResult,
  ConfigAutopilotToggleParams,
  ConfigAutopilotToggleResult,
  ConfigAutopilotGetResult,
  ConfigModelsListResult,
  ConfigEffortSetParams,
  ConfigEffortSetResult,
  ConfigEffortGetResult,
  getModelPricingDescription,
  type EffortLevel,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';
import { parsePermissionLevel, parseEffortLevel } from './config-rpc.schema';

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
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private readonly permissionHandler: SdkPermissionHandler,
    @inject(SDK_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: ModelResolver,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(TOKENS.FEATURE_GATE_SERVICE)
    private readonly featureGate: FeatureGateService,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(SETTINGS_TOKENS.REASONING_SETTINGS)
    private readonly reasoningSettings: ReasoningSettings,
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

    // Initialize permission handler with saved autopilot config
    // This ensures canUseTool callback respects the permission level
    // even for sessions started before any toggle RPC is received
    const autopilotEnabled = this.configManager.getWithDefault<boolean>(
      'autopilot.enabled',
      false,
    );
    // Use parsePermissionLevel to validate the stored value — getWithDefault's
    // generic parameter is unchecked; if the stored string is unrecognized
    // (e.g. future format or external edit), fall back to 'ask'.
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
      ],
      initialPermissionLevel: effectiveLevel,
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

        // LOG 3/3: What the frontend sends back on model selection
        this.logger.info(
          '[ModelDiag] config:model-switch RECEIVED from frontend',
          {
            model,
            sessionId: sessionId ?? null,
            startsWithClaude: model.startsWith('claude-'),
          },
        );

        // Frontend sends full model IDs from the normalized models list.
        // No resolution needed — getSupportedModels() normalizes at source.
        await this.modelSettings.selectedModel.set(model);

        // Sync to active SDK session if provided
        if (sessionId) {
          try {
            await this.sdkAdapter.setSessionModel(sessionId, model);
            this.logger.debug('Model synced to active session', {
              sessionId,
              model,
            });
          } catch (syncError) {
            this.logger.warn(
              'Failed to sync model to active session (config saved)',
              syncError instanceof Error
                ? syncError
                : new Error(String(syncError)),
            );
          }
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
   * TASK_2026_107 Bug 6: Lifted from
   * `apps/ptah-electron/src/services/rpc/handlers/config-extended-rpc.handlers.ts`
   * so all three apps (VS Code, Electron, CLI) consume it via
   * `registerAllRpcHandlers()`. The original used `StorageService`; this shared
   * version goes through `ConfigManager` which already routes to the same
   * underlying store on every host.
   */
  private registerModelSet(): void {
    this.rpcHandler.registerMethod(
      'config:model-set',
      async (params: { model?: string; autopilot?: boolean } | undefined) => {
        try {
          if (params?.model !== undefined) {
            await this.modelSettings.selectedModel.set(params.model);
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
   * config:model-get - Get current model selection
   */
  private registerModelGet(): void {
    this.rpcHandler.registerMethod<void, ConfigModelGetResult>(
      'config:model-get',
      async () => {
        try {
          this.logger.debug('RPC: config:model-get called');

          const stored = this.modelSettings.selectedModel.get() || '';

          // 'default' is a valid SDK tier meaning "let the SDK choose" — preserve it as-is.
          if (stored === 'default') {
            return { model: stored };
          }

          // Legacy migration: old configs may have bare tier names.
          // Resolve once and re-save so future reads are already clean.
          if (stored && !stored.startsWith('claude-')) {
            const resolved = this.modelResolver.resolve(stored);
            this.logger.info(
              `RPC: config:model-get migrating legacy value '${stored}' → '${resolved}'`,
            );
            await this.modelSettings.selectedModel.set(resolved);
            return { model: resolved };
          }

          // Stale "latest" migration: if stored model is a tier's previous
          // "latest" alias (e.g., claude-opus-4-6) that has since been
          // superseded, migrate to the current version. Only migrates IDs
          // without a date suffix (dated versions like -20251101 are
          // intentional specific-version selections).
          if (stored) {
            const tier = this.modelResolver.detectTier(stored);
            if (tier) {
              const currentLatest =
                TIER_TO_MODEL_ID[tier as keyof typeof TIER_TO_MODEL_ID];
              const hasDateSuffix = /-\d{8}$/.test(stored);
              if (!hasDateSuffix && stored !== currentLatest) {
                this.logger.info(
                  `RPC: config:model-get migrating stale model '${stored}' → '${currentLatest}'`,
                );
                await this.modelSettings.selectedModel.set(currentLatest);
                return { model: currentLatest };
              }
            }
          }

          return { model: stored || DEFAULT_FALLBACK_MODEL_ID };
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

        // Validate permission level
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

        // YOLO mode is a Pro-tier feature — it bypasses all permission prompts,
        // which is a high-risk operation we only unlock for paid users.
        if (enabled && permissionLevel === 'yolo') {
          const isPro = await this.featureGate.isProTier();
          if (!isPro) {
            throw new Error(
              'YOLO mode requires a Pro subscription. Upgrade to enable unattended execution.',
            );
          }
          this.logger.warn(
            'YOLO mode enabled - DANGEROUS: All permission prompts will be skipped',
            { enabled, permissionLevel },
          );
        }

        await this.configManager.set('autopilot.enabled', enabled);
        await this.configManager.set(
          'autopilot.permissionLevel',
          permissionLevel,
        );

        // Sync permission level to canUseTool callback (defense-in-depth)
        // This ensures the callback respects the level even if SDK's
        // setPermissionMode fails or no active session exists
        const effectiveLevel = enabled
          ? (permissionLevel as PermissionLevel)
          : 'ask';
        this.permissionHandler.setPermissionLevel(effectiveLevel);

        // Sync to active SDK session — ALWAYS, including when disabled.
        // When disabled, reset SDK to 'default' so canUseTool is invoked again.
        // Without this, the SDK session stays in bypassPermissions/acceptEdits
        // and canUseTool is never called despite the UI showing "Manual".
        if (sessionId) {
          try {
            const sdkMode = enabled
              ? this.mapPermissionToSdkMode(permissionLevel)
              : 'default';
            await this.sdkAdapter.setSessionPermissionLevel(sessionId, sdkMode);
            this.logger.debug('Permission mode synced to active session', {
              sessionId,
              sdkMode,
              enabled,
            });
          } catch (syncError) {
            this.logger.warn(
              'Failed to sync permission mode to active session (config saved)',
              syncError instanceof Error
                ? syncError
                : new Error(String(syncError)),
            );
          }
        }

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
   * config:autopilot-get - Get current autopilot state
   */
  private registerAutopilotGet(): void {
    this.rpcHandler.registerMethod<void, ConfigAutopilotGetResult>(
      'config:autopilot-get',
      async () => {
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

          return { enabled, permissionLevel };
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
      },
    );
  }

  /**
   * config:models-list - Get available models with metadata
   *
   * TASK_2025_237: Merges two model sources:
   * 1. SDK's supportedModels() — 3 tier slots (opus/sonnet/haiku) as recommended shortcuts
   * 2. Anthropic /v1/models API — ALL available models for specific version selection
   *
   * SDK tier models appear first (as "latest" recommended options), followed by
   * additional API models not already covered by a tier. The SDK accepts any model
   * string in setModel(), so all models work regardless of source.
   */
  private registerModelsList(): void {
    this.rpcHandler.registerMethod<void, ConfigModelsListResult>(
      'config:models-list',
      async () => {
        try {
          this.logger.debug('RPC: config:models-list called');

          // Saved model preference — may be a full ID or a bare tier name (claudeCli auth
          // stores raw tier slots like 'opus'/'sonnet'). Resolve both sides when comparing
          // isSelected so full-ID config and tier-name dropdown entries match correctly.
          const savedModel =
            this.modelSettings.selectedModel.get() || DEFAULT_FALLBACK_MODEL_ID;
          const resolvedSavedModel = this.modelResolver.resolve(savedModel);

          // sdkModels may contain bare tier names for claudeCli auth (e.g. 'opus', 'sonnet').
          // apiModels always contains full versioned IDs from /v1/models.
          const sdkModels = await this.sdkAdapter.getSupportedModels();
          const apiModels = await this.sdkAdapter.getApiModels();

          this.logger.info('RPC: config:models-list sources', {
            sdkCount: sdkModels.length,
            apiCount: apiModels.length,
            sdkValues: sdkModels.map((m) => m.value),
            apiValues: apiModels.map((m) => m.value).slice(0, 10),
          });

          // Get provider tier overrides (for OpenRouter etc.)
          const tierOverrides = this.getTierOverrides();

          this.logger.info('RPC: config:models-list tier context', {
            activeProviderId: this.providerModels.resolveActiveProviderId(),
            tierOverrides: tierOverrides ?? 'null',
            savedModel,
          });

          // --- Build unified model list ---
          // SDK models come first (recommended tier shortcuts), then API models
          // not already covered. Both sources have .value as full model IDs.
          const sdkModelIds = new Set(sdkModels.map((m) => m.value));
          const models: Array<{
            id: string;
            name: string;
            description: string;
            isSelected: boolean;
            isRecommended: boolean;
            providerModelId: string | null;
            tier: 'opus' | 'sonnet' | 'haiku' | undefined;
          }> = [];

          for (const m of sdkModels) {
            let tier = this.modelResolver.detectTier(m.value);

            // If detectTier() returns undefined, m.value is a resolved provider model ID
            // (e.g. 'google/gemma-4-26b-a4b-it:free') from a stale cache where
            // applyTierMapping() already ran. Reverse-look up the tier from tierOverrides.
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
                ? getModelPricingDescription(providerModelId)
                : m.description,
              isSelected:
                m.value === savedModel ||
                // Resolve check only when savedModel is a full Claude ID (e.g. 'claude-opus-4-7').
                // Skipped when savedModel is a tier name like 'opus' or 'default' — direct
                // string match is exact. Without this guard, savedModel='default' would resolve
                // to opus and incorrectly mark both 'default' and 'opus' as selected.
                (savedModel.startsWith('claude-') &&
                  m.value.toLowerCase() !== 'default' &&
                  this.modelResolver.resolve(m.value) === resolvedSavedModel),
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
                ? getModelPricingDescription(providerModelId)
                : getModelPricingDescription(m.value),
              isSelected:
                m.value === savedModel ||
                // Resolve check only when savedModel is a full Claude ID (e.g. 'claude-opus-4-7').
                // Skipped when savedModel is a tier name like 'opus' or 'default' — direct
                // string match is exact. Without this guard, savedModel='default' would resolve
                // to opus and incorrectly mark both 'default' and 'opus' as selected.
                (savedModel.startsWith('claude-') &&
                  m.value.toLowerCase() !== 'default' &&
                  this.modelResolver.resolve(m.value) === resolvedSavedModel),
              isRecommended: false,
              providerModelId,
              tier,
            });
          }

          // Guarantee exactly one isSelected. The resolve-based check can mark multiple
          // entries true when both a tier name ('opus') and its full ID ('claude-opus-4-7')
          // appear across sdkModels and apiModels. Prefer the entry whose id exactly
          // matches savedModel; if none exists, keep the first resolve-matched entry.
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

          // LOG 2/3: What the dropdown will show (sent to frontend)
          this.logger.info(
            '[ModelDiag] config:models-list SENDING to frontend dropdown',
            {
              savedModel,
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

          return { models };
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
   * Get provider tier overrides for model mapping (OpenRouter etc.).
   *
   * Returns null for direct Anthropic — tier→model-id remapping only applies
   * to third-party providers that use different model IDs (e.g., OpenRouter's
   * 'anthropic/claude-sonnet-4'). For api.anthropic.com, model IDs are valid
   * as-is and the CLI/SDK handles tier resolution natively.
   */
  private getTierOverrides(): ReturnType<
    ProviderModelsService['getModelTiers']
  > | null {
    try {
      const providerId = this.providerModels.resolveActiveProviderId();
      if (providerId === 'anthropic') {
        return null;
      }
      return this.providerModels.getModelTiers(providerId, 'mainAgent');
    } catch (e) {
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
          // parseEffortLevel validates the stored string and returns undefined
          // for any unrecognized value rather than passing it through unchecked.
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

  /**
   * config:effort-set - Save reasoning effort level
   */
  private registerEffortSet(): void {
    this.rpcHandler.registerMethod<
      ConfigEffortSetParams,
      ConfigEffortSetResult
    >('config:effort-set', async (params) => {
      try {
        const { effort } = params;
        this.logger.debug('RPC: config:effort-set called', { effort });

        await this.reasoningSettings.effort.set(effort || '');

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

  /**
   * Map frontend permission level to SDK permission mode
   */
  private mapPermissionToSdkMode(
    level: PermissionLevel,
  ): 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' {
    const modeMap: Record<
      PermissionLevel,
      'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
    > = {
      ask: 'default',
      'auto-edit': 'acceptEdits',
      yolo: 'bypassPermissions',
      plan: 'plan',
    };
    return modeMap[level];
  }
}
