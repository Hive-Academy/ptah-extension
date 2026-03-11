/**
 * License RPC Handlers
 *
 * Handles license-related RPC methods: license:getStatus
 *
 * TASK_2025_079: License status exposure for frontend premium feature gating
 * TASK_2025_128: Freemium model (Community + Pro)
 */

import * as vscode from 'vscode';
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
  LicenseSetKeyParams,
  LicenseSetKeyResponse,
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
    this.registerSetKey();

    this.logger.debug('License RPC handlers registered', {
      methods: ['license:getStatus', 'license:setKey'],
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
   * license:setKey - Set and verify a license key
   *
   * Called from the welcome screen inline license input.
   * Validates format, stores the key, verifies with server,
   * and triggers window reload on success.
   *
   * Flow:
   * 1. Validate key format (ptah_lic_ + 64 hex chars)
   * 2. Store in SecretStorage
   * 3. Verify with license server
   * 4. Return result (reload handled by frontend)
   */
  private registerSetKey(): void {
    this.rpcHandler.registerMethod<LicenseSetKeyParams, LicenseSetKeyResponse>(
      'license:setKey',
      async (params) => {
        try {
          const key = params?.licenseKey;

          // Validate key is provided
          if (!key || typeof key !== 'string') {
            return { success: false, error: 'License key is required' };
          }

          // Validate format: ptah_lic_ + 64 hex characters
          if (!/^ptah_lic_[a-f0-9]{64}$/.test(key)) {
            return {
              success: false,
              error:
                'Invalid license key format. Keys start with ptah_lic_ followed by 64 hex characters.',
            };
          }

          this.logger.debug('RPC: license:setKey - storing and verifying key');

          // Store and verify
          await this.licenseService.setLicenseKey(key);
          const newStatus = await this.licenseService.verifyLicense();

          if (newStatus.valid) {
            this.logger.info('RPC: license:setKey - license activated', {
              tier: newStatus.tier,
            });

            // Schedule window reload to apply license changes
            // Delay allows the RPC response to reach the webview first
            setTimeout(
              () =>
                vscode.commands.executeCommand('workbench.action.reloadWindow'),
              1500
            );

            return {
              success: true,
              tier: newStatus.tier,
              plan: newStatus.plan ? { name: newStatus.plan.name } : undefined,
            };
          } else {
            this.logger.warn('RPC: license:setKey - verification failed', {
              reason: newStatus.reason,
            });
            return {
              success: false,
              error:
                'License verification failed. Please check your key and try again.',
            };
          }
        } catch (error) {
          this.logger.error(
            'RPC: license:setKey failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to verify license key',
          };
        }
      }
    );
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
    const trialActive = status.trialActive ?? status.tier === 'trial_pro';

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
      isCommunity,
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
      // TASK_2025_129: Forward user profile data
      user: status.user
        ? {
            email: status.user.email,
            firstName: status.user.firstName,
            lastName: status.user.lastName,
          }
        : undefined,
    };
  }
}
