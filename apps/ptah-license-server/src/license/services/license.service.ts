import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PLANS, getPlanConfig, PlanName } from '../../config/plans.config';
import { randomBytes } from 'crypto';

/**
 * License Tier type for TASK_2025_121
 *
 * Tier values:
 * - 'basic': Paid Basic plan (active subscription)
 * - 'pro': Paid Pro plan (active subscription)
 * - 'trial_basic': Basic plan in trial period
 * - 'trial_pro': Pro plan in trial period
 * - 'expired': License expired, revoked, or not found
 */
export type LicenseTier =
  | 'basic'
  | 'pro'
  | 'trial_basic'
  | 'trial_pro'
  | 'expired';

/**
 * License verification response structure
 */
export interface LicenseVerificationResponse {
  valid: boolean;
  tier: LicenseTier;
  plan?: (typeof PLANS)[keyof typeof PLANS];
  expiresAt?: string;
  daysRemaining?: number;
  trialActive?: boolean;
  trialDaysRemaining?: number;
  reason?: 'expired' | 'revoked' | 'not_found' | 'trial_ended';
}

/**
 * Map legacy tier values to new tier system
 *
 * TASK_2025_121: Backward compatibility for existing licenses
 *
 * Legacy mapping:
 * - 'early_adopter' -> 'pro' (grandfathered users keep Pro access)
 * - 'free' -> 'expired' (no more free tier, must subscribe)
 * - 'basic' | 'pro' | 'trial_basic' | 'trial_pro' -> pass through
 * - unknown -> 'expired'
 *
 * @param dbPlan - Plan value from database (may be legacy)
 * @param isInTrial - Whether subscription is in trial period
 * @returns Mapped LicenseTier value
 */
function mapLegacyTier(dbPlan: string, isInTrial: boolean): LicenseTier {
  switch (dbPlan) {
    case 'early_adopter':
      // Grandfathered users keep Pro access
      return 'pro';

    case 'free':
      // Legacy 'free' tier is now expired - must subscribe
      return 'expired';

    case 'basic':
      return isInTrial ? 'trial_basic' : 'basic';

    case 'pro':
      return isInTrial ? 'trial_pro' : 'pro';

    case 'trial_basic':
    case 'trial_pro':
      // Already trial-prefixed plans pass through
      return dbPlan as LicenseTier;

    default:
      // Unknown plan values are treated as expired
      return 'expired';
  }
}

/**
 * LicenseService - Core license management logic
 *
 * TASK_2025_121: Enhanced with new tier system and trial support
 *
 * Responsibilities:
 * - Verify license key validity and return plan details
 * - Support new tier values: basic, pro, trial_basic, trial_pro, expired
 * - Detect trial status from subscription.status === 'trialing'
 * - Map legacy tier values (early_adopter, free) for backward compatibility
 * - Create new licenses with proper expiration
 * - Generate cryptographically secure license keys
 */
@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify a license key's validity and return plan details
   *
   * TASK_2025_121: Enhanced with trial detection and legacy tier mapping
   *
   * @param licenseKey - The license key to verify (format: ptah_lic_{64-hex} or PTAH-XXXX-XXXX-XXXX)
   * @returns License status with validity, tier, plan details, trial info, and expiration
   *
   * Response cases:
   * - Valid license: { valid: true, tier, plan, expiresAt, daysRemaining, trialActive?, trialDaysRemaining? }
   * - Expired: { valid: false, tier: "expired", reason: "expired" }
   * - Revoked: { valid: false, tier: "expired", reason: "revoked" }
   * - Not found: { valid: false, tier: "expired", reason: "not_found" }
   * - Trial ended: { valid: false, tier: "expired", reason: "trial_ended" }
   */
  async verifyLicense(
    licenseKey: string
  ): Promise<LicenseVerificationResponse> {
    // Step 1: Find license in database with user and subscription data for trial detection
    const license = await this.prisma.license.findUnique({
      where: { licenseKey },
      include: {
        user: {
          include: {
            subscriptions: {
              orderBy: { createdAt: 'desc' },
              take: 1, // Get most recent subscription
            },
          },
        },
      },
    });

    // Step 2: Check if license exists
    if (!license) {
      this.logger.debug(`License not found: ${licenseKey.substring(0, 10)}...`);
      return {
        valid: false,
        tier: 'expired',
        reason: 'not_found',
      };
    }

    // Step 3: Check if license is revoked
    if (license.status === 'revoked') {
      this.logger.debug(`License revoked: ${license.id}`);
      return {
        valid: false,
        tier: 'expired',
        reason: 'revoked',
      };
    }

    // Step 4: Check if license is expired
    if (license.expiresAt && new Date() > license.expiresAt) {
      this.logger.debug(
        `License expired: ${
          license.id
        }, expired at ${license.expiresAt.toISOString()}`
      );
      return {
        valid: false,
        tier: 'expired',
        reason: 'expired',
      };
    }

    // Step 5: Detect trial status from subscription
    const subscription = license.user.subscriptions[0];
    const isInTrial = subscription?.status === 'trialing';
    const trialEnd = subscription?.trialEnd;

    // Check if trial has ended (subscription.trialEnd < now)
    if (isInTrial && trialEnd && new Date() > trialEnd) {
      this.logger.debug(
        `Trial ended for license: ${
          license.id
        }, trial ended at ${trialEnd.toISOString()}`
      );
      return {
        valid: false,
        tier: 'expired',
        reason: 'trial_ended',
      };
    }

    // Step 6: Map legacy tier values and determine final tier
    const tier = mapLegacyTier(license.plan, isInTrial);

    // If tier mapped to 'expired' (e.g., legacy 'free' tier), return invalid
    if (tier === 'expired') {
      this.logger.debug(
        `License has expired tier: ${license.id}, plan: ${license.plan}`
      );
      return {
        valid: false,
        tier: 'expired',
        reason: 'expired',
      };
    }

    // Step 7: Calculate days remaining (if expiration exists)
    const daysRemaining = license.expiresAt
      ? Math.ceil(
          (license.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )
      : undefined;

    // Step 8: Calculate trial days remaining
    const trialDaysRemaining =
      isInTrial && trialEnd
        ? Math.max(
            0,
            Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          )
        : undefined;

    // Step 9: Get plan configuration - extract base plan from tier
    const basePlan = tier.replace('trial_', '') as PlanName;
    const planConfig =
      basePlan === 'basic' || basePlan === 'pro'
        ? getPlanConfig(basePlan)
        : undefined;

    this.logger.debug(
      `License verified: ${license.id}, tier: ${tier}, trial: ${isInTrial}`
    );

    // Step 10: Return valid license with full details
    return {
      valid: true,
      tier,
      plan: planConfig,
      expiresAt: license.expiresAt?.toISOString(),
      daysRemaining,
      trialActive: isInTrial,
      trialDaysRemaining,
    };
  }

  /**
   * Create a new license for a user
   *
   * Process:
   * 1. Find or create user by email
   * 2. Revoke any existing active licenses for the user
   * 3. Generate a new cryptographically secure license key
   * 4. Calculate expiration date from plan configuration
   * 5. Create license record in database
   *
   * @param params - Email and plan for license creation
   * @returns The generated license key and expiration date
   */
  async createLicense(params: {
    email: string;
    plan: PlanName;
  }): Promise<{ licenseKey: string; expiresAt: Date | null }> {
    const { email, plan } = params;

    // Step 1: Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { email: email.toLowerCase() },
      });
    }

    // Step 2: Revoke existing active licenses for this user
    // (Ensures only one active license per user at a time)
    await this.prisma.license.updateMany({
      where: {
        userId: user.id,
        status: 'active',
      },
      data: {
        status: 'revoked',
      },
    });

    // Step 3: Generate cryptographically secure license key
    const licenseKey = this.generateLicenseKey();

    // Step 4: Calculate expiration date from plan configuration
    const planConfig = getPlanConfig(plan);
    const expiresAt =
      planConfig.expiresAfterDays !== null
        ? new Date(
            Date.now() + planConfig.expiresAfterDays * 24 * 60 * 60 * 1000
          )
        : null;

    // Step 5: Create license record
    await this.prisma.license.create({
      data: {
        userId: user.id,
        licenseKey,
        plan,
        status: 'active',
        expiresAt,
        createdBy: 'admin',
      },
    });

    return { licenseKey, expiresAt };
  }

  /**
   * Generate a cryptographically secure license key
   *
   * Format: ptah_lic_{64 hex characters}
   * Entropy: 256 bits (32 bytes = 64 hex chars)
   *
   * @private
   * @returns A unique license key
   */
  private generateLicenseKey(): string {
    const random = randomBytes(32).toString('hex'); // 32 bytes = 64 hex chars
    return `ptah_lic_${random}`;
  }
}
