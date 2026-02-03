/**
 * Enhanced Prompts RPC Handlers
 *
 * Handles RPC methods for the Enhanced Prompts feature:
 * - enhancedPrompts:getStatus - Get current status
 * - enhancedPrompts:runWizard - Execute the wizard to generate prompts
 * - enhancedPrompts:setEnabled - Toggle the feature on/off
 * - enhancedPrompts:regenerate - Force regenerate the prompt
 *
 * TASK_2025_137: Intelligent Prompt Generation System
 */

/**
 * Timeout for license verification to prevent hanging requests (10 seconds)
 */
const LICENSE_VERIFICATION_TIMEOUT_MS = 10 * 1000;

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { EnhancedPromptsService, SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type {
  EnhancedPromptsGetStatusParams,
  EnhancedPromptsGetStatusResponse,
  EnhancedPromptsRunWizardParams,
  EnhancedPromptsRunWizardResponse,
  EnhancedPromptsSetEnabledParams,
  EnhancedPromptsSetEnabledResponse,
  EnhancedPromptsRegenerateParams,
  EnhancedPromptsRegenerateResponse,
} from '@ptah-extension/shared';

/**
 * RPC handlers for Enhanced Prompts operations
 *
 * TASK_2025_137: Premium feature for intelligent prompt generation
 *
 * Exposes Enhanced Prompts functionality to the frontend:
 * - Status checking (for settings display)
 * - Wizard execution (from empty chat screen)
 * - Toggle on/off (from settings)
 * - Regenerate prompt (from settings)
 *
 * Security:
 * - Generated prompt content is NEVER exposed (IP protection)
 * - Premium feature gating via LicenseService
 */
@injectable()
export class EnhancedPromptsRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE)
    private readonly enhancedPromptsService: EnhancedPromptsService,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService
  ) {}

  /**
   * Register all Enhanced Prompts RPC methods
   */
  register(): void {
    this.registerGetStatus();
    this.registerRunWizard();
    this.registerSetEnabled();
    this.registerRegenerate();

    this.logger.debug('Enhanced Prompts RPC handlers registered', {
      methods: [
        'enhancedPrompts:getStatus',
        'enhancedPrompts:runWizard',
        'enhancedPrompts:setEnabled',
        'enhancedPrompts:regenerate',
      ],
    });
  }

  /**
   * enhancedPrompts:getStatus - Get current Enhanced Prompts status
   *
   * Returns whether Enhanced Prompts is enabled, whether a prompt has been
   * generated, and the detected technology stack.
   *
   * Does NOT return the actual prompt content (security).
   */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<
      EnhancedPromptsGetStatusParams,
      EnhancedPromptsGetStatusResponse
    >('enhancedPrompts:getStatus', async (params) => {
      try {
        const workspacePath = params?.workspacePath;

        if (!workspacePath) {
          return {
            enabled: false,
            hasGeneratedPrompt: false,
            generatedAt: null,
            detectedStack: null,
            cacheValid: false,
            error: 'Workspace path is required',
          };
        }

        this.logger.debug('RPC: enhancedPrompts:getStatus called', {
          workspacePath,
        });

        const status = await this.enhancedPromptsService.getStatus(
          workspacePath
        );

        return {
          enabled: status.enabled,
          hasGeneratedPrompt: status.hasGeneratedPrompt,
          generatedAt: status.generatedAt,
          detectedStack: status.detectedStack,
          cacheValid: status.cacheValid,
          invalidationReason: status.invalidationReason,
        };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:getStatus failed',
          error instanceof Error ? error : new Error(String(error))
        );

        return {
          enabled: false,
          hasGeneratedPrompt: false,
          generatedAt: null,
          detectedStack: null,
          cacheValid: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * enhancedPrompts:runWizard - Execute the Enhanced Prompts wizard
   *
   * Requires premium license. Analyzes the workspace and generates
   * project-specific guidance using the PromptDesignerAgent.
   *
   * Flow:
   * 1. Verify premium license
   * 2. Analyze workspace
   * 3. Generate prompt via PromptDesignerAgent
   * 4. Cache and enable Enhanced Prompts
   * 5. Return success status
   */
  private registerRunWizard(): void {
    this.rpcHandler.registerMethod<
      EnhancedPromptsRunWizardParams,
      EnhancedPromptsRunWizardResponse
    >('enhancedPrompts:runWizard', async (params) => {
      try {
        const workspacePath = params?.workspacePath;

        if (!workspacePath) {
          return {
            success: false,
            error: 'Workspace path is required',
          };
        }

        this.logger.info('RPC: enhancedPrompts:runWizard started', {
          workspacePath,
        });

        // Verify premium license with timeout to prevent hanging
        const licenseStatus = await this.verifyLicenseWithTimeout();
        if (!licenseStatus) {
          return {
            success: false,
            error:
              'License verification timed out. Please check your network connection and try again.',
          };
        }

        const isPremium =
          licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro';

        if (!isPremium) {
          return {
            success: false,
            error:
              'Enhanced Prompts is a premium feature. Please upgrade to Pro.',
          };
        }

        // Run the wizard
        const result = await this.enhancedPromptsService.runWizard(
          workspacePath,
          params.config
        );

        if (result.success && result.state) {
          this.logger.info('RPC: enhancedPrompts:runWizard completed', {
            workspacePath,
            detectedStack: result.state.detectedStack,
          });

          return {
            success: true,
            generatedAt: result.state.generatedAt,
            detectedStack: result.state.detectedStack,
          };
        }

        return {
          success: false,
          error: result.error || 'Failed to generate enhanced prompt',
        };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:runWizard failed',
          error instanceof Error ? error : new Error(String(error))
        );

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * enhancedPrompts:setEnabled - Toggle Enhanced Prompts on/off
   *
   * Allows users to enable or disable Enhanced Prompts via settings.
   * When disabled, sessions will use the default claude_code preset.
   */
  private registerSetEnabled(): void {
    this.rpcHandler.registerMethod<
      EnhancedPromptsSetEnabledParams,
      EnhancedPromptsSetEnabledResponse
    >('enhancedPrompts:setEnabled', async (params) => {
      try {
        const { workspacePath, enabled } = params || {};

        if (!workspacePath) {
          return {
            success: false,
            error: 'Workspace path is required',
          };
        }

        if (typeof enabled !== 'boolean') {
          return {
            success: false,
            error: 'Enabled flag is required',
          };
        }

        this.logger.info('RPC: enhancedPrompts:setEnabled', {
          workspacePath,
          enabled,
        });

        await this.enhancedPromptsService.setEnabled(workspacePath, enabled);

        return {
          success: true,
          enabled,
        };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:setEnabled failed',
          error instanceof Error ? error : new Error(String(error))
        );

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * enhancedPrompts:regenerate - Force regenerate the enhanced prompt
   *
   * Requires premium license. Invalidates the existing cache and
   * runs the wizard again to generate fresh guidance.
   *
   * Use cases:
   * - Project structure changed significantly
   * - User wants updated guidance
   * - Cache invalidated due to config changes
   */
  private registerRegenerate(): void {
    this.rpcHandler.registerMethod<
      EnhancedPromptsRegenerateParams,
      EnhancedPromptsRegenerateResponse
    >('enhancedPrompts:regenerate', async (params) => {
      try {
        const workspacePath = params?.workspacePath;

        if (!workspacePath) {
          return {
            success: false,
            error: 'Workspace path is required',
          };
        }

        this.logger.info('RPC: enhancedPrompts:regenerate started', {
          workspacePath,
          force: params.force,
        });

        // Verify premium license with timeout to prevent hanging
        const licenseStatus = await this.verifyLicenseWithTimeout();
        if (!licenseStatus) {
          return {
            success: false,
            error:
              'License verification timed out. Please check your network connection and try again.',
          };
        }

        const isPremium =
          licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro';

        if (!isPremium) {
          return {
            success: false,
            error:
              'Enhanced Prompts is a premium feature. Please upgrade to Pro.',
          };
        }

        // Regenerate
        const result = await this.enhancedPromptsService.regenerate(
          workspacePath,
          {
            force: params.force ?? true,
            config: params.config,
          }
        );

        if (result.success && result.status) {
          this.logger.info('RPC: enhancedPrompts:regenerate completed', {
            workspacePath,
          });

          return {
            success: true,
            status: result.status,
          };
        }

        return {
          success: false,
          error: result.error || 'Failed to regenerate enhanced prompt',
        };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:regenerate failed',
          error instanceof Error ? error : new Error(String(error))
        );

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * Verify license with timeout to prevent hanging requests
   *
   * Uses Promise.race to enforce a timeout on license verification.
   * Returns null if verification times out, allowing caller to handle gracefully.
   */
  private async verifyLicenseWithTimeout(): Promise<Awaited<
    ReturnType<LicenseService['verifyLicense']>
  > | null> {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        this.logger.warn('RPC: License verification timed out', {
          timeoutMs: LICENSE_VERIFICATION_TIMEOUT_MS,
        });
        resolve(null);
      }, LICENSE_VERIFICATION_TIMEOUT_MS);
    });

    return Promise.race([this.licenseService.verifyLicense(), timeoutPromise]);
  }
}
