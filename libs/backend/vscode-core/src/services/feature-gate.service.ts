/**
 * Feature Gate Service
 *
 * Centralized feature access control based on license tier.
 * Determines which features are available to users based on their subscription level.
 *
 * TASK_2025_121 Batch 3: Two-tier paid model enforcement
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import { Logger } from '../logging';
import { TOKENS } from '../di/tokens';
import type { LicenseService, LicenseStatus } from './license.service';

/**
 * Pro-only features that require Pro tier subscription
 *
 * These features are NOT available to Basic tier users:
 * - mcp_server: Code Execution MCP server
 * - workspace_intelligence: Advanced workspace analysis (13+ project types)
 * - openrouter_proxy: OpenRouter proxy for 200+ models
 * - custom_tools: Custom tool creation and management
 * - setup_wizard: Intelligent setup wizard with agent generation
 * - cost_tracking: Real-time cost tracking and analytics
 */
export type ProOnlyFeature =
  | 'mcp_server'
  | 'workspace_intelligence'
  | 'openrouter_proxy'
  | 'custom_tools'
  | 'setup_wizard'
  | 'cost_tracking';

/**
 * All gated features (both Basic and Pro tiers)
 *
 * Basic tier features are available to all licensed users.
 * Pro tier features require Pro or trial_pro subscription.
 */
export type Feature =
  | ProOnlyFeature
  | 'basic_cli_wrapper'
  | 'session_history'
  | 'permission_management'
  | 'sdk_access'
  | 'real_time_streaming'
  | 'basic_workspace_context';

/**
 * Features that require Pro tier subscription
 *
 * This list is used by isFeatureEnabled() to determine
 * if a feature is Pro-only.
 */
const PRO_ONLY_FEATURES: readonly ProOnlyFeature[] = [
  'mcp_server',
  'workspace_intelligence',
  'openrouter_proxy',
  'custom_tools',
  'setup_wizard',
  'cost_tracking',
] as const;

/**
 * Feature Gate Service Implementation
 *
 * Provides centralized feature access control based on license tier.
 *
 * Usage:
 * ```typescript
 * const featureGate = container.resolve<FeatureGateService>(TOKENS.FEATURE_GATE_SERVICE);
 *
 * // Check if specific feature is enabled
 * if (await featureGate.isFeatureEnabled('mcp_server')) {
 *   // Start MCP server
 * }
 *
 * // Check if user has Pro tier
 * if (await featureGate.isProTier()) {
 *   // Show Pro features
 * }
 *
 * // Check if user has any valid license
 * if (await featureGate.hasValidLicense()) {
 *   // User can use extension
 * }
 * ```
 *
 * Caching:
 * - License status is cached to avoid repeated API calls
 * - Cache is invalidated when license changes (via invalidateCache())
 * - Cache TTL is managed by LicenseService (1 hour)
 *
 * Security:
 * - Feature checks are performed server-side via license verification
 * - Client-side caching is secondary to server validation
 * - Periodic revalidation ensures license changes are detected
 */
@injectable()
export class FeatureGateService {
  /**
   * Cached license status to avoid repeated API calls
   * Cache is invalidated when license changes
   */
  private cachedStatus: LicenseStatus | null = null;

  constructor(
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug('[FeatureGateService] Service initialized');
  }

  /**
   * Check if a feature is enabled for the current license tier
   *
   * Feature access rules:
   * - No valid license: All features disabled
   * - Basic tier (basic, trial_basic): Basic features only
   * - Pro tier (pro, trial_pro): All features enabled
   *
   * @param feature - Feature identifier to check
   * @returns true if feature is enabled, false otherwise
   *
   * @example
   * ```typescript
   * if (await featureGate.isFeatureEnabled('mcp_server')) {
   *   await mcpServer.start();
   * }
   * ```
   */
  async isFeatureEnabled(feature: Feature): Promise<boolean> {
    const status = await this.getLicenseStatus();

    // No valid license = no features
    if (!status.valid) {
      this.logger.debug(
        '[FeatureGateService.isFeatureEnabled] License invalid, feature disabled',
        {
          feature,
          tier: status.tier,
        }
      );
      return false;
    }

    // Pro-only features require Pro tier (or Pro trial)
    if (this.isProOnlyFeature(feature)) {
      const isEnabled = status.tier === 'pro' || status.tier === 'trial_pro';
      this.logger.debug(
        '[FeatureGateService.isFeatureEnabled] Pro feature check',
        {
          feature,
          tier: status.tier,
          enabled: isEnabled,
        }
      );
      return isEnabled;
    }

    // All other features are available to any valid license (Basic or Pro)
    this.logger.debug(
      '[FeatureGateService.isFeatureEnabled] Basic feature enabled',
      {
        feature,
        tier: status.tier,
      }
    );
    return true;
  }

  /**
   * Check if user has any valid license (Basic or Pro)
   *
   * Use this for hard blocking (e.g., extension activation).
   * For feature-specific checks, use isFeatureEnabled().
   *
   * @returns true if user has valid license, false otherwise
   *
   * @example
   * ```typescript
   * if (!await featureGate.hasValidLicense()) {
   *   showLicenseBlockingModal();
   *   return;
   * }
   * ```
   */
  async hasValidLicense(): Promise<boolean> {
    const status = await this.getLicenseStatus();
    return status.valid;
  }

  /**
   * Check if user has Pro tier subscription (or Pro trial)
   *
   * Pro tier includes all Basic features plus:
   * - MCP Server
   * - Workspace Intelligence
   * - OpenRouter Proxy
   * - Custom Tools
   * - Setup Wizard
   * - Cost Tracking
   *
   * @returns true if user has Pro tier, false otherwise
   *
   * @example
   * ```typescript
   * if (await featureGate.isProTier()) {
   *   showProBadge();
   * }
   * ```
   */
  async isProTier(): Promise<boolean> {
    const status = await this.getLicenseStatus();
    return status.tier === 'pro' || status.tier === 'trial_pro';
  }

  /**
   * Check if user has Basic tier subscription (or Basic trial)
   *
   * Basic tier includes core features:
   * - Visual chat interface
   * - Session history
   * - Permission management
   * - SDK access
   * - Real-time streaming
   * - Basic workspace context
   *
   * @returns true if user has Basic tier, false otherwise
   */
  async isBasicTier(): Promise<boolean> {
    const status = await this.getLicenseStatus();
    return status.tier === 'basic' || status.tier === 'trial_basic';
  }

  /**
   * Check if user is in trial period (either Basic or Pro trial)
   *
   * @returns true if user is in trial, false otherwise
   */
  async isTrialActive(): Promise<boolean> {
    const status = await this.getLicenseStatus();
    return status.tier === 'trial_basic' || status.tier === 'trial_pro';
  }

  /**
   * Get days remaining in trial period
   *
   * @returns Number of days remaining, or null if not in trial
   */
  async getTrialDaysRemaining(): Promise<number | null> {
    const status = await this.getLicenseStatus();
    return status.trialDaysRemaining ?? null;
  }

  /**
   * Invalidate cached license status
   *
   * Call this when license changes (e.g., after license key entry, upgrade, downgrade).
   * Next call to any feature check will fetch fresh status from LicenseService.
   *
   * @example
   * ```typescript
   * await licenseService.setLicenseKey(newKey);
   * featureGate.invalidateCache();
   * const isValid = await featureGate.hasValidLicense();
   * ```
   */
  invalidateCache(): void {
    this.cachedStatus = null;
    this.logger.debug('[FeatureGateService.invalidateCache] Cache invalidated');
  }

  /**
   * Get current license status with caching
   *
   * Caching strategy:
   * - If cached status exists, return it immediately
   * - Otherwise, fetch from LicenseService and cache
   * - LicenseService handles its own TTL (1 hour)
   *
   * @returns Current license status
   */
  private async getLicenseStatus(): Promise<LicenseStatus> {
    if (this.cachedStatus) {
      return this.cachedStatus;
    }

    this.cachedStatus = await this.licenseService.verifyLicense();
    return this.cachedStatus;
  }

  /**
   * Check if a feature is Pro-only
   *
   * @param feature - Feature to check
   * @returns true if feature requires Pro tier
   */
  private isProOnlyFeature(feature: Feature): feature is ProOnlyFeature {
    return (PRO_ONLY_FEATURES as readonly Feature[]).includes(feature);
  }
}
