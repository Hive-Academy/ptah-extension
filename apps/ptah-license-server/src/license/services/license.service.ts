import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PLANS, getPlanConfig, PlanName } from '../../config/plans.config';
import {
  calculateTrialExpirationDate,
  getTrialDurationDays,
} from '../../config/trial.config';
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
 */
export type LicenseTier = 'community' | 'pro' | 'trial_pro' | 'expired';

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
  /** User profile data, only present for valid licenses (TASK_2025_129) */
  user?: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

/**
 * Map database plan to tier value with trial support
 *
 * TASK_2025_128: Freemium model (Community + Pro)
 *
 * @param dbPlan - Plan value from database ('community' | 'pro' | 'trial_pro')
 * @param isInTrial - Whether subscription is in trial period
 * @returns LicenseTier value
 */
function mapPlanToTier(dbPlan: string, isInTrial: boolean): LicenseTier {
  switch (dbPlan) {
    case 'pro':
      return isInTrial ? 'trial_pro' : 'pro';

    case 'trial_pro':
      return 'trial_pro';

    case 'community':
      return 'community';

    default:
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
   * Plans: 'community' (free) and 'pro' (paid, supports trial)
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
      // TASK_2025_129: Include user profile data
      user: license.user
        ? {
            email: license.user.email,
            firstName: license.user.firstName,
            lastName: license.user.lastName,
          }
        : undefined,
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
   * Create a trial license for a new user signup
   *
   * Provides a Pro trial license automatically on signup.
   * Trial duration is configurable via TRIAL_DURATION_DAYS env var (default: 14 days).
   * Idempotent: if user already has an active license, returns it.
   *
   * Process:
   * 1. Find or create user by email
   * 2. Check for existing active license (prevent duplicate trials)
   * 3. If existing, return it (idempotent)
   * 4. Generate license key and set trial expiration
   * 5. Create License record with plan: 'pro', createdBy: 'auto_trial_signup'
   * 6. Create Subscription record with status: 'trialing'
   *
   * @param params - Email for trial license creation
   * @returns The generated license key and expiration date
   */
  async createTrialLicense(params: {
    email: string;
  }): Promise<{ licenseKey: string; expiresAt: Date }> {
    const { email } = params;
    const normalizedEmail = email.toLowerCase();

    // Step 1: Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { email: normalizedEmail },
      });
    }

    // Step 2: Check for existing active license (idempotent)
    const existingLicense = await this.prisma.license.findFirst({
      where: {
        userId: user.id,
        status: 'active',
      },
    });

    if (existingLicense) {
      this.logger.debug(
        `User ${normalizedEmail} already has active license: ${existingLicense.id}`
      );
      return {
        licenseKey: existingLicense.licenseKey,
        expiresAt: existingLicense.expiresAt ?? calculateTrialExpirationDate(),
      };
    }

    // Step 3: Generate license key
    const licenseKey = this.generateLicenseKey();

    // Step 4: Set trial expiration (configurable via TRIAL_DURATION_DAYS env var)
    const expiresAt = calculateTrialExpirationDate();

    // Step 5: Create License record
    await this.prisma.license.create({
      data: {
        userId: user.id,
        licenseKey,
        plan: 'pro',
        status: 'active',
        expiresAt,
        createdBy: 'auto_trial_signup',
      },
    });

    // Step 6: Create Subscription record with trialing status
    // Note: paddleSubscriptionId, paddleCustomerId, and priceId use synthetic
    // values since this trial is created outside Paddle's checkout flow.
    // These are prefixed with 'trial_' to distinguish from real Paddle data.
    const syntheticPaddleId = `trial_${user.id}_${Date.now()}`;
    await this.prisma.subscription.create({
      data: {
        userId: user.id,
        paddleSubscriptionId: syntheticPaddleId,
        paddleCustomerId: `trial_customer_${user.id}`,
        priceId: 'auto_trial_pro',
        status: 'trialing',
        trialEnd: expiresAt,
        currentPeriodEnd: expiresAt,
      },
    });

    this.logger.log(
      `Trial license created for ${normalizedEmail}, expires: ${expiresAt.toISOString()} (${getTrialDurationDays()} days)`
    );

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
