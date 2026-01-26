/**
 * License RPC Handlers
 *
 * Handles license-related RPC methods: license:getStatus
 *
 * TASK_2025_079: License status exposure for frontend premium feature gating
 * TASK_2025_121: Updated for two-tier paid model (Basic + Pro)
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
  LicenseStatus,
} from '@ptah-extension/vscode-core';
import type {
  LicenseGetStatusParams,
  LicenseGetStatusResponse,
  LicenseTier,
} from '@ptah-extension/shared';

/**
 * RPC handlers for license operations
 *
 * TASK_2025_121: Two-tier paid model
 *
 * Exposes license status to the frontend for:
 * - Conditional settings visibility (premium sections)
 * - Feature gating (MCP port, LLM configurations)
 * - UI indicators for license tier (Basic vs Pro)
 * - Trial status display
 *
 * Security:
 * - License key is NEVER exposed (only tier/validity)
 * - Status cached for 1 hour (reduces API calls)
 */
@injectable()
export class LicenseRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService
  ) {}

  /**
   * Register all license RPC methods
   */
  register(): void {
    this.registerGetStatus();

    this.logger.debug('License RPC handlers registered', {
      methods: ['license:getStatus'],
    });
  }

  /**
   * license:getStatus - Get current license status
   *
   * TASK_2025_121: Updated for two-tier paid model
   *
   * Returns tier, validity, and feature flags for frontend gating.
   * Uses cached status (1-hour TTL) to minimize API calls.
   *
   * Response:
   * - valid: boolean - Whether license is valid
   * - tier: LicenseTier - Current tier (basic, pro, trial_basic, trial_pro, expired)
   * - isPremium: boolean - Convenience flag (Pro tier or Pro trial)
   * - isBasic: boolean - Convenience flag (Basic tier or Basic trial)
   * - daysRemaining: number | null - Days until subscription expires
   * - trialActive: boolean - Whether in trial period
   * - trialDaysRemaining: number | null - Days remaining in trial
   * - plan: { name, description, features } | undefined - Plan details if licensed
   */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<
      LicenseGetStatusParams,
      LicenseGetStatusResponse
    >('license:getStatus', async () => {
      try {
        this.logger.debug('RPC: license:getStatus called');

        const status = await this.licenseService.verifyLicense();
        const response = this.mapLicenseStatusToResponse(status);

        this.logger.debug('RPC: license:getStatus success', {
          tier: response.tier,
          isPremium: response.isPremium,
          isBasic: response.isBasic,
          trialActive: response.trialActive,
        });

        return response;
      } catch (error) {
        this.logger.error(
          'RPC: license:getStatus failed',
          error instanceof Error ? error : new Error(String(error))
        );

        // Return expired tier on error (extension blocked)
        // TASK_2025_121: No more 'free' tier - return 'expired' for failures
        return {
          valid: false,
          tier: 'expired' as LicenseTier,
          isPremium: false,
          isBasic: false,
          daysRemaining: null,
          trialActive: false,
          trialDaysRemaining: null,
        };
      }
    });
  }

  /**
   * Map internal LicenseStatus to RPC response format
   *
   * TASK_2025_121: Maps the internal LicenseStatus from LicenseService
   * to the LicenseGetStatusResponse format expected by the frontend.
   *
   * Tier mapping for convenience flags:
   * - isPremium: true for 'pro' and 'trial_pro' (has Pro features)
   * - isBasic: true for 'basic' and 'trial_basic' (has Basic features only)
   *
   * @param status - Internal license status from LicenseService
   * @returns RPC response format for frontend
   */
  private mapLicenseStatusToResponse(
    status: LicenseStatus
  ): LicenseGetStatusResponse {
    // Determine if user has premium (Pro) features
    // Pro tier and Pro trial both have premium features
    const isPremium = status.tier === 'pro' || status.tier === 'trial_pro';

    // Determine if user has basic features only
    // Basic tier and Basic trial have basic features
    const isBasic = status.tier === 'basic' || status.tier === 'trial_basic';

    // Determine trial status from tier
    const trialActive =
      status.trialActive ??
      (status.tier === 'trial_basic' || status.tier === 'trial_pro');

    return {
      valid: status.valid,
      tier: status.tier as LicenseTier,
      isPremium,
      isBasic,
      daysRemaining: status.daysRemaining ?? null,
      trialActive,
      trialDaysRemaining: status.trialDaysRemaining ?? null,
      plan: status.plan
        ? {
            name: status.plan.name,
            description: status.plan.description,
            features: status.plan.features,
          }
        : undefined,
    };
  }
}
