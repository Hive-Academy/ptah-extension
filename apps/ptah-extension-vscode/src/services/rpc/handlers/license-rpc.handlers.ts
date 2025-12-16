/**
 * License RPC Handlers
 *
 * Handles license-related RPC methods: license:getStatus
 *
 * TASK_2025_079: License status exposure for frontend premium feature gating
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
} from '@ptah-extension/vscode-core';
import type {
  LicenseGetStatusParams,
  LicenseGetStatusResponse,
} from '@ptah-extension/shared';

/**
 * RPC handlers for license operations
 *
 * Exposes license status to the frontend for:
 * - Conditional settings visibility (premium sections)
 * - Feature gating (MCP port, LLM configurations)
 * - UI indicators for license tier
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
   * Returns tier, validity, and feature flags for frontend gating.
   * Uses cached status (1-hour TTL) to minimize API calls.
   *
   * Response:
   * - valid: boolean - Whether license is valid
   * - tier: 'free' | 'early_adopter' - Current tier
   * - isPremium: boolean - Convenience flag (tier !== 'free')
   * - daysRemaining: number | null - Days until expiration
   * - plan: { name, description } | undefined - Plan details if premium
   */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<
      LicenseGetStatusParams,
      LicenseGetStatusResponse
    >('license:getStatus', async () => {
      try {
        this.logger.debug('RPC: license:getStatus called');

        const status = await this.licenseService.verifyLicense();

        const response: LicenseGetStatusResponse = {
          valid: status.valid,
          tier: status.tier,
          isPremium: status.tier !== 'free',
          daysRemaining: status.daysRemaining ?? null,
          plan: status.plan
            ? {
                name: status.plan.name,
                description: status.plan.description,
              }
            : undefined,
        };

        this.logger.debug('RPC: license:getStatus success', {
          tier: response.tier,
          isPremium: response.isPremium,
        });

        return response;
      } catch (error) {
        this.logger.error(
          'RPC: license:getStatus failed',
          error instanceof Error ? error : new Error(String(error))
        );

        // Return free tier on error (graceful degradation)
        return {
          valid: false,
          tier: 'free',
          isPremium: false,
          daysRemaining: null,
        };
      }
    });
  }
}
