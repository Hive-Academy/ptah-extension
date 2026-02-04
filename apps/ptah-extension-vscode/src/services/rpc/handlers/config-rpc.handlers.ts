/**
 * Config RPC Handlers
 *
 * Handles config-related RPC methods: config:model-*, config:autopilot-*
 * Manages model selection and autopilot configuration persistence.
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  SdkAgentAdapter,
  ProviderModelsService,
  SDK_TOKENS,
  DEFAULT_PROVIDER_ID,
} from '@ptah-extension/agent-sdk';
import {
  ClaudeModel,
  PermissionLevel,
  ConfigModelSwitchParams,
  ConfigModelSwitchResult,
  ConfigModelGetResult,
  ConfigAutopilotToggleParams,
  ConfigAutopilotToggleResult,
  ConfigAutopilotGetResult,
  ConfigModelsListResult,
} from '@ptah-extension/shared';
import * as vscode from 'vscode';

/**
 * RPC handlers for configuration operations
 */
@injectable()
export class ConfigRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService
  ) {}

  /**
   * Register all config RPC methods
   */
  register(): void {
    this.registerModelSwitch();
    this.registerModelGet();
    this.registerAutopilotToggle();
    this.registerAutopilotGet();
    this.registerModelsList();

    this.logger.debug('Config RPC handlers registered', {
      methods: [
        'config:model-switch',
        'config:model-get',
        'config:autopilot-toggle',
        'config:autopilot-get',
        'config:models-list',
      ],
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

        this.logger.debug('RPC: config:model-switch called', {
          model,
          sessionId,
        });

        // Save the model (now using full API name)
        await this.configManager.set('model.selected', model, {
          target: vscode.ConfigurationTarget.Workspace,
        });

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
                : new Error(String(syncError))
            );
          }
        }

        this.logger.info('Model switched successfully', { model });

        return { model };
      } catch (error) {
        this.logger.error(
          'RPC: config:model-switch failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
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

          const model = this.configManager.getWithDefault<ClaudeModel>(
            'model.selected',
            'sonnet'
          );

          return { model };
        } catch (error) {
          this.logger.error(
            'RPC: config:model-get failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
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
        const validLevels = ['ask', 'auto-edit', 'yolo'] as const;
        if (
          !validLevels.includes(permissionLevel as (typeof validLevels)[number])
        ) {
          throw new Error(
            `Invalid permission level: ${permissionLevel}. Must be one of: ${validLevels.join(
              ', '
            )}`
          );
        }

        this.logger.debug('RPC: config:autopilot-toggle called', {
          enabled,
          permissionLevel,
          sessionId,
        });

        // Warn if YOLO mode is enabled (dangerous operation)
        if (enabled && permissionLevel === 'yolo') {
          this.logger.warn(
            'YOLO mode enabled - DANGEROUS: All permission prompts will be skipped',
            { enabled, permissionLevel }
          );
        }

        await this.configManager.set('autopilot.enabled', enabled, {
          target: vscode.ConfigurationTarget.Workspace,
        });
        await this.configManager.set(
          'autopilot.permissionLevel',
          permissionLevel,
          {
            target: vscode.ConfigurationTarget.Workspace,
          }
        );

        // Sync to active SDK session if provided and autopilot is enabled
        if (sessionId && enabled) {
          try {
            const sdkMode = this.mapPermissionToSdkMode(permissionLevel);
            await this.sdkAdapter.setSessionPermissionLevel(sessionId, sdkMode);
            this.logger.debug('Permission mode synced to active session', {
              sessionId,
              sdkMode,
            });
          } catch (syncError) {
            this.logger.warn(
              'Failed to sync permission mode to active session (config saved)',
              syncError instanceof Error
                ? syncError
                : new Error(String(syncError))
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
          error instanceof Error ? error : new Error(String(error))
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
            false
          );
          const permissionLevel =
            this.configManager.getWithDefault<PermissionLevel>(
              'autopilot.permissionLevel',
              'ask'
            );

          return { enabled, permissionLevel };
        } catch (error) {
          this.logger.error(
            'RPC: config:autopilot-get failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * config:models-list - Get available models with metadata (from SDK)
   */
  private registerModelsList(): void {
    this.rpcHandler.registerMethod<void, ConfigModelsListResult>(
      'config:models-list',
      async () => {
        try {
          this.logger.debug('RPC: config:models-list called');

          // Get saved model preference
          const savedModel = this.configManager.getWithDefault<string>(
            'model.selected',
            'claude-sonnet-4-20250514'
          );

          // Fetch models dynamically from SDK
          const sdkModels = await this.sdkAdapter.getSupportedModels();

          // Check if an Anthropic-compatible provider is active and get tier overrides
          const authMethod = this.configManager.getWithDefault<string>(
            'authMethod',
            'auto'
          );
          let tierOverrides: ReturnType<
            ProviderModelsService['getModelTiers']
          > | null = null;
          if (authMethod === 'openrouter') {
            try {
              const activeProviderId =
                this.configManager.getWithDefault<string>(
                  'anthropicProviderId',
                  DEFAULT_PROVIDER_ID
                );
              tierOverrides =
                this.providerModels.getModelTiers(activeProviderId);
            } catch (e) {
              this.logger.warn(
                'Failed to read provider tier overrides',
                e instanceof Error ? e : new Error(String(e))
              );
            }
          }

          // Transform to frontend format
          const models = sdkModels.map((m) => {
            let providerModelId: string | null = null;
            const valueLower = m.value.toLowerCase();

            if (tierOverrides) {
              // SDK returns 'default' for the sonnet-tier model, so match both
              if (
                (valueLower.includes('sonnet') || valueLower === 'default') &&
                tierOverrides.sonnet
              ) {
                providerModelId = tierOverrides.sonnet;
              } else if (valueLower.includes('opus') && tierOverrides.opus) {
                providerModelId = tierOverrides.opus;
              } else if (valueLower.includes('haiku') && tierOverrides.haiku) {
                providerModelId = tierOverrides.haiku;
              }
            }

            return {
              id: m.value,
              name: m.displayName,
              description: m.description,
              apiName: m.value,
              isSelected: m.value === savedModel,
              isRecommended:
                valueLower.includes('sonnet') || valueLower === 'default',
              providerModelId,
            };
          });

          this.logger.debug('RPC: config:models-list fetched from SDK', {
            count: models.length,
          });

          return { models };
        } catch (error) {
          this.logger.error(
            'RPC: config:models-list failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * Map frontend permission level to SDK permission mode
   */
  private mapPermissionToSdkMode(
    level: PermissionLevel
  ): 'default' | 'acceptEdits' | 'bypassPermissions' {
    const modeMap: Record<
      PermissionLevel,
      'default' | 'acceptEdits' | 'bypassPermissions'
    > = {
      ask: 'default',
      'auto-edit': 'acceptEdits',
      yolo: 'bypassPermissions',
    };
    return modeMap[level];
  }
}
