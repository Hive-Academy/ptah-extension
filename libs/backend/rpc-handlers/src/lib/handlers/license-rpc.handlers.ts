/**
 * License RPC Handlers
 *
 * Handles license-related RPC methods: license:getStatus.
 * Freemium model (Community + Pro).
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
  LicenseStatus,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import type { IPlatformCommands } from '@ptah-extension/platform-core';
import type {
  LicenseGetStatusParams,
  LicenseGetStatusResponse,
  LicenseSetKeyParams,
  LicenseSetKeyResponse,
  LicenseClearKeyParams,
  LicenseClearKeyResponse,
  LicenseTier,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';

/**
 * Rejection reasons the license server reports for a key it did NOT accept.
 *
 * `LicenseService.verifyLicense` deliberately launders these into a valid
 * `{ valid: true, tier: 'community', reason }` community fallback (so the
 * no-license community experience keeps working). On the SET path we must NOT
 * treat that as activation success — a rejected paid key would otherwise
 * report `success: true`.
 */
const LICENSE_REJECTION_REASONS: ReadonlySet<
  NonNullable<LicenseStatus['reason']>
> = new Set(['not_found', 'expired', 'revoked', 'trial_ended']);

/**
 * Decide whether a verification result represents a genuinely ACCEPTED license
 * key (as opposed to a community fallback synthesized after the server rejected
 * the key).
 *
 * Accepted when the status is valid AND it is not a community tier carrying a
 * rejection reason. Premium tiers (pro/trial_pro) are always acceptances; a
 * plain valid community status with no rejection reason is also fine.
 */
function isAcceptedLicense(status: LicenseStatus): boolean {
  if (!status.valid) return false;
  if (
    status.tier === 'community' &&
    status.reason !== undefined &&
    LICENSE_REJECTION_REASONS.has(status.reason)
  ) {
    return false;
  }
  return true;
}

/**
 * RPC handlers for license operations (Freemium model: Community + Pro).
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
  static readonly METHODS = [
    'license:getStatus',
    'license:setKey',
    'license:clearKey',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all license RPC methods
   */
  register(): void {
    this.registerGetStatus();
    this.registerSetKey();
    this.registerClearKey();

    this.logger.debug('License RPC handlers registered', {
      methods: ['license:getStatus', 'license:setKey', 'license:clearKey'],
    });
  }

  /**
   * license:getStatus - Get current license status (freemium model).
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
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'LicenseRpcHandlers.registerGetStatus' },
        );
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
          let normalizedKey: unknown = params?.licenseKey;
          if (Array.isArray(normalizedKey)) {
            normalizedKey = normalizedKey[0];
          }
          if (!normalizedKey || typeof normalizedKey !== 'string') {
            return {
              success: false,
              error: Array.isArray(params?.licenseKey)
                ? 'License key must be a single string, received array'
                : 'License key is required',
            };
          }
          const key = normalizedKey;
          if (!/^ptah_lic_[a-f0-9]{64}$/.test(key)) {
            return {
              success: false,
              error:
                'Invalid license key format. Keys start with ptah_lic_ followed by 64 hex characters.',
            };
          }

          this.logger.debug('RPC: license:setKey - storing and verifying key');
          await this.licenseService.setLicenseKey(key);
          const newStatus = await this.licenseService.verifyLicense();

          if (isAcceptedLicense(newStatus)) {
            this.logger.info('RPC: license:setKey - license activated', {
              tier: newStatus.tier,
            });
            setTimeout(() => this.platformCommands.reloadWindow(), 1500);

            return {
              success: true,
              tier: newStatus.tier,
              plan: newStatus.plan ? { name: newStatus.plan.name } : undefined,
            };
          } else {
            this.logger.warn('RPC: license:setKey - key was not accepted', {
              reason: newStatus.reason,
              tier: newStatus.tier,
              valid: newStatus.valid,
            });
            const reasonDetail = newStatus.reason ?? 'rejected';
            return {
              success: false,
              error: `License key was not accepted (${reasonDetail}). Please check your key and try again.`,
            };
          }
        } catch (error) {
          this.logger.error(
            'RPC: license:setKey failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LicenseRpcHandlers.registerSetKey' },
          );
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to verify license key',
          };
        }
      },
    );
  }

  /**
   * license:clearKey - Clear the license key and reload
   *
   * Called from the settings page logout button.
   * Removes the key from SecretStorage and triggers a window reload.
   */
  private registerClearKey(): void {
    this.rpcHandler.registerMethod<
      LicenseClearKeyParams,
      LicenseClearKeyResponse
    >('license:clearKey', async () => {
      try {
        this.logger.debug('RPC: license:clearKey called');

        await this.licenseService.clearLicenseKey();

        this.logger.info('RPC: license:clearKey - license key removed');
        setTimeout(() => this.platformCommands.reloadWindow(), 1500);

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: license:clearKey failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'LicenseRpcHandlers.registerClearKey' },
        );
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to clear license key',
        };
      }
    });
  }

  /**
   * Map internal LicenseStatus to RPC response format.
   *
   * Maps the internal LicenseStatus from LicenseService
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
    status: LicenseStatus,
  ): LicenseGetStatusResponse {
    const isPremium = status.tier === 'pro' || status.tier === 'trial_pro';
    const isCommunity = status.tier === 'community';
    const trialActive = status.trialActive ?? status.tier === 'trial_pro';
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
    const daysRemaining = status.daysRemaining ?? null;
    let expiryWarning: 'near_expiry' | 'critical' | null = null;
    if (
      status.tier === 'pro' &&
      typeof daysRemaining === 'number' &&
      daysRemaining < 30
    ) {
      expiryWarning = daysRemaining < 7 ? 'critical' : 'near_expiry';
      this.logger.warn(
        `License nearing expiry: tier=${status.tier} daysRemaining=${daysRemaining} warning=${expiryWarning}`,
      );
    }

    return {
      valid: status.valid,
      tier: status.tier as LicenseTier,
      isPremium,
      isCommunity,
      daysRemaining,
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
      user: status.user
        ? {
            email: status.user.email,
            firstName: status.user.firstName,
            lastName: status.user.lastName,
          }
        : undefined,
      expiryWarning,
    };
  }
}
