import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PLANS, getPlanConfig, PlanName } from '../../config/plans.config';
import { randomBytes } from 'crypto';

/**
 * License Tier type for TASK_2025_128: Freemium Model
 *
 * Tier values:
 * - 'community': FREE forever - no subscription required
 * - 'pro': Paid Pro plan (active subscription)
 * - 'trial_pro': Pro plan in trial period
 * - 'expired': License expired, revoked, or payment failed
 *
 * Note: Community tier has no trial - it's always free.
 * 'trial_basic' is removed since Community doesn't need trials.
 */
export type LicenseTier =
  | 'community'
  | 'pro'
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
 * Map database plan to tier value with trial support
 *
 * TASK_2025_128: Freemium model conversion with migration compatibility
 *
 * Migration compatibility:
 * - 'basic' -> 'community' (legacy paid Basic users become Community)
 * - 'trial_basic' -> 'community' (legacy trial users become Community)
 * - 'community' -> 'community' (new Community tier)
 * - 'pro' -> 'pro' or 'trial_pro' (unchanged)
 *
 * @param dbPlan - Plan value from database ('community' | 'pro' | 'basic' | 'trial_basic' | 'trial_pro')
 * @param isInTrial - Whether subscription is in trial period
 * @returns LicenseTier value
 */
function mapPlanToTier(dbPlan: string, isInTrial: boolean): LicenseTier {
  switch (dbPlan) {
    // Pro plan - supports trial
    case 'pro':
      return isInTrial ? 'trial_pro' : 'pro';

    // Already trial_pro - pass through
    case 'trial_pro':
      return 'trial_pro';

    // Community tier (new freemium model)
    case 'community':
      return 'community';

    // Migration: Legacy 'basic' becomes 'community' (FREE)
    // These users had paid Basic subscriptions, now get Community for free
    case 'basic':
      return 'community';

    // Migration: Legacy 'trial_basic' becomes 'community' (FREE)
    // These users were trialing Basic, now get Community for free
    case 'trial_basic':
      return 'community';

    default:
      // Unknown plan values are treated as expired
      return 'expired';
  }
}

/**
 * LicenseService - Core license management logic
 *
 * TASK_2025_128: Freemium model with Community + Pro tiers
 *
 * Responsibilities:
 * - Verify license key validity and return plan details
 * - Support tier values: community, pro, trial_pro, expired
 * - Detect trial status from subscription.status === 'trialing'
 * - Create new licenses with proper expiration
 * - Generate cryptographically secure license keys
 * - Handle migration from legacy 'basic' and 'trial_basic' database values
 */
@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify a license key's validity and return plan details
   *
   * TASK_2025_128: Freemium model with migration compatibility
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
   *
   * Migration: Legacy 'basic' and 'trial_basic' database values map to 'community' tier
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

    // Step 6: Determine tier based on plan and trial status
    const tier = mapPlanToTier(license.plan, isInTrial);

    // If tier is 'expired' (unknown plan), return invalid
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
    // TASK_2025_128: tier could be 'community', 'pro', 'trial_pro', or 'expired'
    // For trial_pro, extract base plan 'pro'. For community, use 'community'.
    const basePlan = tier.replace('trial_', '');
    const isValidPlan = basePlan === 'community' || basePlan === 'pro';
    const planConfig = isValidPlan
      ? getPlanConfig(basePlan as PlanName)
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
