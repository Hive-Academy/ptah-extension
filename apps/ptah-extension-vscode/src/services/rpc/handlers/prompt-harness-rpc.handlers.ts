/**
 * Prompt Harness RPC Handlers (TASK_2025_135 Batch 4)
 *
 * Handles prompt harness configuration RPC methods:
 * - promptHarness:getConfig - Get power-up states, custom sections, available power-ups
 * - promptHarness:saveConfig - Save power-up states and/or custom sections
 * - promptHarness:getPreview - Get assembled prompt preview with layer breakdown
 * - promptHarness:exportConfig - Export configuration as JSON
 * - promptHarness:importConfig - Import configuration from JSON
 *
 * Pattern source: ./auth-rpc.handlers.ts
 */

import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  SDK_TOKENS,
  PromptHarnessService,
  UserPromptStore,
  POWER_UP_DEFINITIONS,
} from '@ptah-extension/agent-sdk';
import type {
  PromptHarnessGetConfigParams,
  PromptHarnessGetConfigResponse,
  PromptHarnessSaveConfigParams,
  PromptHarnessSaveConfigResponse,
  PromptHarnessGetPreviewParams,
  PromptHarnessGetPreviewResponse,
  PromptHarnessExportConfigParams,
  PromptHarnessExportConfigResponse,
  PromptHarnessImportConfigParams,
  PromptHarnessImportConfigResponse,
  PowerUpInfo,
  PowerUpStateInfo,
  UserPromptSectionInfo,
  PromptLayerInfo,
  PromptWarningInfo,
  PromptHarnessPowerUpCategory,
} from '@ptah-extension/shared';

/**
 * RPC handlers for prompt harness configuration operations
 *
 * TASK_2025_135: Prompt Harness System
 *
 * Exposes prompt harness configuration to the frontend for:
 * - Power-up toggle management
 * - Custom section editing
 * - Prompt preview
 * - Configuration import/export
 *
 * Security:
 * - Premium power-ups are marked unavailable for non-premium users
 * - Custom sections stored in SecretStorage (handled by UserPromptStore)
 */
@injectable()
export class PromptHarnessRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(SDK_TOKENS.SDK_PROMPT_HARNESS_SERVICE)
    private readonly promptHarnessService: PromptHarnessService,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_STORE)
    private readonly userPromptStore: UserPromptStore
  ) {}

  /**
   * Register all prompt harness RPC methods
   */
  register(): void {
    this.registerGetConfig();
    this.registerSaveConfig();
    this.registerGetPreview();
    this.registerExportConfig();
    this.registerImportConfig();

    this.logger.debug('Prompt Harness RPC handlers registered', {
      methods: [
        'promptHarness:getConfig',
        'promptHarness:saveConfig',
        'promptHarness:getPreview',
        'promptHarness:exportConfig',
        'promptHarness:importConfig',
      ],
    });
  }

  /**
   * Check if user has premium features
   */
  private async isPremiumUser(): Promise<boolean> {
    try {
      const license = await this.licenseService.verifyLicense();
      return license.tier === 'pro' || license.tier === 'trial_pro';
    } catch (error) {
      this.logger.warn('Failed to verify license, defaulting to non-premium', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * promptHarness:getConfig - Get all power-up states, custom sections, and available power-ups
   *
   * Returns complete configuration for the prompt harness UI:
   * - All available power-ups with availability based on premium status
   * - User's power-up states (enabled/disabled)
   * - User's custom sections
   * - Premium status flag
   */
  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<
      PromptHarnessGetConfigParams,
      PromptHarnessGetConfigResponse
    >('promptHarness:getConfig', async () => {
      try {
        this.logger.debug('RPC: promptHarness:getConfig called');

        const isPremium = await this.isPremiumUser();
        const config = await this.userPromptStore.getConfig();

        // Map power-up definitions to frontend format
        const availablePowerUps: PowerUpInfo[] = POWER_UP_DEFINITIONS.map(
          (def) => ({
            id: def.id,
            name: def.name,
            description: def.description,
            category: def.category as PromptHarnessPowerUpCategory,
            isPremium: def.isPremium,
            version: def.version,
            tokenCount: def.tokenCount,
            isAvailable: def.isPremium ? isPremium : true,
            conflictsWith: def.conflictsWith,
          })
        );

        // Convert Map to array for JSON serialization
        const powerUpStates: Array<[string, PowerUpStateInfo]> = Array.from(
          config.powerUpStates.entries()
        ).map(([id, state]) => [
          id,
          {
            powerUpId: state.powerUpId,
            enabled: state.enabled,
            priority: state.priority,
            lastModified: state.lastModified,
          },
        ]);

        // Map custom sections to frontend format
        const customSections: UserPromptSectionInfo[] =
          config.customSections.map((section) => ({
            id: section.id,
            name: section.name,
            content: section.content,
            enabled: section.enabled,
            priority: section.priority,
            createdAt: section.createdAt,
            updatedAt: section.updatedAt,
          }));

        const response: PromptHarnessGetConfigResponse = {
          powerUpStates,
          customSections,
          isPremium,
          availablePowerUps,
        };

        this.logger.debug('RPC: promptHarness:getConfig success', {
          powerUpCount: availablePowerUps.length,
          statesCount: powerUpStates.length,
          customSectionCount: customSections.length,
          isPremium,
        });

        return response;
      } catch (error) {
        this.logger.error(
          'RPC: promptHarness:getConfig failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * promptHarness:saveConfig - Save power-up states and/or custom sections
   *
   * Validates input with Zod and saves to storage.
   * Supports partial saves (only states, only sections, or both).
   */
  private registerSaveConfig(): void {
    // Zod schema for validation
    const PowerUpStateSchema = z.object({
      powerUpId: z.string(),
      enabled: z.boolean(),
      priority: z.number().optional(),
      lastModified: z.number(),
    });

    const UserPromptSectionSchema = z.object({
      id: z.string(),
      name: z.string(),
      content: z.string(),
      enabled: z.boolean(),
      priority: z.number(),
      createdAt: z.number(),
      updatedAt: z.number(),
    });

    const SaveConfigSchema = z.object({
      powerUpStates: z
        .array(z.tuple([z.string(), PowerUpStateSchema]))
        .optional(),
      customSections: z.array(UserPromptSectionSchema).optional(),
    });

    this.rpcHandler.registerMethod<
      PromptHarnessSaveConfigParams,
      PromptHarnessSaveConfigResponse
    >('promptHarness:saveConfig', async (params) => {
      try {
        this.logger.debug('RPC: promptHarness:saveConfig called', {
          hasStates: !!params?.powerUpStates,
          hasSections: !!params?.customSections,
        });

        // Validate input
        const validated = SaveConfigSchema.parse(params);

        // Save power-up states if provided
        if (validated.powerUpStates && validated.powerUpStates.length > 0) {
          for (const [id, state] of validated.powerUpStates) {
            await this.userPromptStore.setPowerUpState(id, {
              powerUpId: state.powerUpId,
              enabled: state.enabled,
              priority: state.priority,
              lastModified: state.lastModified,
            });
          }
          this.logger.debug('RPC: promptHarness:saveConfig - states saved', {
            count: validated.powerUpStates.length,
          });
        }

        // Save custom sections if provided
        if (validated.customSections) {
          await this.userPromptStore.setCustomSections(
            validated.customSections.map((section) => ({
              id: section.id,
              name: section.name,
              content: section.content,
              enabled: section.enabled,
              priority: section.priority,
              createdAt: section.createdAt,
              updatedAt: section.updatedAt,
            }))
          );
          this.logger.debug('RPC: promptHarness:saveConfig - sections saved', {
            count: validated.customSections.length,
          });
        }

        this.logger.info(
          'RPC: promptHarness:saveConfig completed successfully'
        );
        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: promptHarness:saveConfig failed',
          error instanceof Error ? error : new Error(String(error))
        );

        // Return error instead of throwing for validation errors
        if (error instanceof z.ZodError) {
          return {
            success: false,
            error: `Validation error: ${error.issues
              .map((e: z.ZodIssue) => e.message)
              .join(', ')}`,
          };
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * promptHarness:getPreview - Get assembled prompt preview with layer breakdown
   *
   * Assembles the complete prompt from enabled power-ups and custom sections,
   * returns layer breakdown for UI visualization.
   */
  private registerGetPreview(): void {
    this.rpcHandler.registerMethod<
      PromptHarnessGetPreviewParams,
      PromptHarnessGetPreviewResponse
    >('promptHarness:getPreview', async () => {
      try {
        this.logger.debug('RPC: promptHarness:getPreview called');

        const isPremium = await this.isPremiumUser();
        const assembled = await this.promptHarnessService.assemblePrompt(
          isPremium
        );

        // Map layers to frontend format
        const layers: PromptLayerInfo[] = assembled.layers.map((layer) => ({
          name: layer.name,
          type: layer.type,
          content: layer.content,
          tokenCount: layer.tokenCount,
          source: layer.source,
        }));

        // Map warnings to frontend format
        const warnings: PromptWarningInfo[] = assembled.warnings.map(
          (warning) => ({
            type: warning.type,
            message: warning.message,
            severity: warning.severity,
          })
        );

        const response: PromptHarnessGetPreviewResponse = {
          text: assembled.text,
          totalTokens: assembled.totalTokens,
          layers,
          warnings,
        };

        this.logger.debug('RPC: promptHarness:getPreview success', {
          totalTokens: assembled.totalTokens,
          layerCount: layers.length,
          warningCount: warnings.length,
        });

        return response;
      } catch (error) {
        this.logger.error(
          'RPC: promptHarness:getPreview failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * promptHarness:exportConfig - Export configuration as JSON
   *
   * Exports the complete prompt harness configuration for backup/sharing.
   */
  private registerExportConfig(): void {
    this.rpcHandler.registerMethod<
      PromptHarnessExportConfigParams,
      PromptHarnessExportConfigResponse
    >('promptHarness:exportConfig', async () => {
      try {
        this.logger.debug('RPC: promptHarness:exportConfig called');

        const json = await this.userPromptStore.exportConfig();

        this.logger.info('RPC: promptHarness:exportConfig success', {
          jsonLength: json.length,
        });

        return { json };
      } catch (error) {
        this.logger.error(
          'RPC: promptHarness:exportConfig failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * promptHarness:importConfig - Import configuration from JSON
   *
   * Imports prompt harness configuration from JSON string.
   * Validates JSON structure before importing.
   */
  private registerImportConfig(): void {
    // Zod schema for validation
    const ImportConfigSchema = z.object({
      json: z.string().min(2, 'JSON string is required'),
    });

    this.rpcHandler.registerMethod<
      PromptHarnessImportConfigParams,
      PromptHarnessImportConfigResponse
    >('promptHarness:importConfig', async (params) => {
      try {
        this.logger.debug('RPC: promptHarness:importConfig called', {
          jsonLength: params?.json?.length ?? 0,
        });

        // Validate input
        const validated = ImportConfigSchema.parse(params);

        // Import configuration
        const result = await this.userPromptStore.importConfig(validated.json);

        if (result.success) {
          this.logger.info('RPC: promptHarness:importConfig success');
        } else {
          this.logger.warn('RPC: promptHarness:importConfig failed', {
            error: result.error,
          });
        }

        return result;
      } catch (error) {
        this.logger.error(
          'RPC: promptHarness:importConfig failed',
          error instanceof Error ? error : new Error(String(error))
        );

        // Return error instead of throwing for validation errors
        if (error instanceof z.ZodError) {
          return {
            success: false,
            error: `Validation error: ${error.issues
              .map((e: z.ZodIssue) => e.message)
              .join(', ')}`,
          };
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }
}
