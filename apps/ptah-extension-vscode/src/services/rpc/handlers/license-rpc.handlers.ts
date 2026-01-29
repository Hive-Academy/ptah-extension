/**
 * License RPC Handlers
 *
 * Handles license-related RPC methods: license:getStatus
 *
 * TASK_2025_079: License status exposure for frontend premium feature gating
 * TASK_2025_128: Freemium model (Community + Pro)
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
 * TASK_2025_128: Freemium model (Community + Pro)
 *
 * Exposes license status to the frontend for:
 * - Conditional settings visibility (premium sections)
 * - Feature gating (MCP port, LLM configurations)
 * - UI indicators for license tier (Community vs Pro)
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
   * TASK_2025_128: Updated for freemium model
   *
   * Returns tier, validity, and feature flags for frontend gating.
   * Uses cached status (1-hour TTL) to minimize API calls.
   *
   * Response:
   * - valid: boolean - Whether license is valid (Community = always true)
   * - tier: LicenseTier - Current tier (community, pro, trial_pro, expired)
   * - isPremium: boolean - Convenience flag (Pro tier or Pro trial)
   * - isCommunity: boolean - Convenience flag (Community tier)
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
          isCommunity: response.isCommunity,
          trialActive: response.trialActive,
        });

        return response;
      } catch (error) {
        this.logger.error(
          'RPC: license:getStatus failed',
          error instanceof Error ? error : new Error(String(error))
        );

        // TASK_2025_128: On error, check cached status to determine fallback.
        // If user was on Community tier (or no cached status exists, meaning
        // no license key), return Community instead of expired to avoid
        // blocking free-tier users due to transient errors.
        const cachedStatus = this.licenseService.getCachedStatus();
        if (!cachedStatus || cachedStatus.tier === 'community') {
          return {
            valid: true,
            tier: 'community' as LicenseTier,
            isPremium: false,
            isCommunity: true,
            daysRemaining: null,
            trialActive: false,
            trialDaysRemaining: null,
          };
        }

        // User had a Pro/trial license - return expired for real license holders
        return {
          valid: false,
          tier: 'expired' as LicenseTier,
          isPremium: false,
          isCommunity: false,
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
   * TASK_2025_128: Maps the internal LicenseStatus from LicenseService
   * to the LicenseGetStatusResponse format expected by the frontend.
   *
   * Tier mapping for convenience flags:
   * - isPremium: true for 'pro' and 'trial_pro' (has Pro features)
   * - isCommunity: true for 'community' (free tier)
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

    // Determine if user has Community tier (free tier)
    const isCommunity = status.tier === 'community';

    // Determine trial status from tier (only Pro has trial)
    const trialActive =
      status.trialActive ?? status.tier === 'trial_pro';

    // TASK_2025_126: Map reason field for context-aware welcome messaging
    // Backend uses: 'expired' | 'revoked' | 'not_found' | 'trial_ended'
    // Frontend expects: 'expired' | 'trial_ended' | 'no_license'
    let reason: 'expired' | 'trial_ended' | 'no_license' | undefined;
    if (status.reason) {
      switch (status.reason) {
        case 'expired':
        case 'revoked':
          reason = 'expired';
          break;
        case 'trial_ended':
          reason = 'trial_ended';
          break;
        case 'not_found':
          reason = 'no_license';
          break;
      }
    }

    return {
      valid: status.valid,
      tier: status.tier as LicenseTier,
      isPremium,
      isCommunity,  // RENAMED from isBasic
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
      reason,
    };
  }
}
