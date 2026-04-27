import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { PLANS, getPlanConfig, PlanName } from '../../config/plans.config';
import {
  calculateTrialExpirationDate,
  getTrialDurationDays,
} from '../../config/trial.config';
import { randomBytes, createPrivateKey, sign, KeyObject } from 'crypto';
import { Prisma, License } from '../../generated-prisma-client/client';
import { AuditLogService } from '../../audit/audit-log.service';
import { EmailService } from '../../email/services/email.service';
import {
  ComplimentaryDurationPreset,
  IssueComplimentaryLicenseDto,
} from '../dto/issue-complimentary-license.dto';

/**
 * Actor metadata for admin-initiated mutations (TASK_2025_292).
 * Sourced from `req.user.email` / `req.ip` / `req.headers['user-agent']` by
 * the controller — kept as a plain interface so the service stays free of
 * express typings.
 */
export interface AdminActor {
  email: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Result of `createComplimentaryLicense`. `warning` is populated when the
 * license persisted successfully but the post-create email delivery failed
 * (R-spec §6.3: email is best-effort, must not roll back the license).
 */
export interface ComplimentaryLicenseResult {
  license: License;
  warning?: { code: 'LICENSE_EMAIL_FAILED'; error: string };
}

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
  /** Ed25519 signature of the response payload (TASK_2025_188: MITM prevention) */
  signature?: string;
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

  /**
   * Cached Ed25519 signing key for license response signing (TASK_2025_188).
   * Loaded lazily from LICENSE_SIGNING_PRIVATE_KEY environment variable.
   * null = not yet loaded, undefined = env var not configured (signing disabled).
   */
  private signingKey: KeyObject | undefined | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly eventsService: EventsService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  /**
   * Get the Ed25519 private key for signing license responses.
   *
   * TASK_2025_188: License response signing to prevent MITM attacks.
   * The key is loaded from the LICENSE_SIGNING_PRIVATE_KEY env var (base64-encoded DER, PKCS8).
   * Returns undefined if the env var is not set (graceful degradation).
   *
   * @returns Ed25519 KeyObject or undefined if not configured
   */
  private getSigningKey(): KeyObject | undefined {
    if (this.signingKey === null) {
      const keyBase64 = process.env['LICENSE_SIGNING_PRIVATE_KEY'];
      if (!keyBase64) {
        this.logger.warn(
          'LICENSE_SIGNING_PRIVATE_KEY not configured - license response signing disabled',
        );
        this.signingKey = undefined;
        return undefined;
      }
      try {
        this.signingKey = createPrivateKey({
          key: Buffer.from(keyBase64, 'base64'),
          format: 'der',
          type: 'pkcs8',
        });
        this.logger.log('Ed25519 signing key loaded successfully');
      } catch (error) {
        this.logger.error(
          `Failed to load Ed25519 signing key: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.signingKey = undefined;
      }
    }
    return this.signingKey;
  }

  /**
   * Sign a license response payload with Ed25519.
   *
   * TASK_2025_188: Creates a cryptographic signature of the JSON-serialized payload
   * so the VS Code extension can verify the response was not tampered with.
   *
   * @param payload - The license response object to sign (without the signature field)
   * @returns Base64-encoded Ed25519 signature, or undefined if signing is not configured
   */
  private signResponse(payload: object): string | undefined {
    const key = this.getSigningKey();
    if (!key) return undefined;

    try {
      const data = JSON.stringify(payload, Object.keys(payload).sort());
      return sign(null, Buffer.from(data), key).toString('base64');
    } catch (error) {
      this.logger.error(
        `Failed to sign license response: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  /**
   * Build a license response with an Ed25519 signature attached.
   *
   * TASK_2025_188: Signs the response payload and attaches the signature field.
   * If signing is not configured, returns the response without a signature.
   *
   * @param response - The unsigned license verification response
   * @returns The response with optional signature field
   */
  private buildSignedResponse(
    response: LicenseVerificationResponse,
  ): LicenseVerificationResponse {
    const signature = this.signResponse(response);
    if (signature) {
      return { ...response, signature };
    }
    return response;
  }

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
    licenseKey: string,
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
      return this.buildSignedResponse({
        valid: false,
        tier: 'expired',
        reason: 'not_found',
      });
    }

    // Step 3: Check if license is revoked
    if (license.status === 'revoked') {
      this.logger.debug(`License revoked: ${license.id}`);
      return this.buildSignedResponse({
        valid: false,
        tier: 'expired',
        reason: 'revoked',
      });
    }

    // Step 4: Check if license is expired
    if (license.expiresAt && new Date() > license.expiresAt) {
      this.logger.debug(
        `License expired: ${
          license.id
        }, expired at ${license.expiresAt.toISOString()}`,
      );
      return this.buildSignedResponse({
        valid: false,
        tier: 'expired',
        reason: 'expired',
      });
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
        }, trial ended at ${trialEnd.toISOString()}`,
      );
      return this.buildSignedResponse({
        valid: false,
        tier: 'expired',
        reason: 'trial_ended',
      });
    }

    // Step 6: Determine tier based on plan and trial status
    const tier = mapPlanToTier(license.plan, isInTrial);

    // If tier is 'expired' (unknown plan), return invalid
    if (tier === 'expired') {
      this.logger.debug(
        `License has expired tier: ${license.id}, plan: ${license.plan}`,
      );
      return this.buildSignedResponse({
        valid: false,
        tier: 'expired',
        reason: 'expired',
      });
    }

    // Step 7: Calculate days remaining (if expiration exists)
    const daysRemaining = license.expiresAt
      ? Math.ceil(
          (license.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        )
      : undefined;

    // Step 8: Calculate trial days remaining
    const trialDaysRemaining =
      isInTrial && trialEnd
        ? Math.max(
            0,
            Math.ceil(
              (trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            ),
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
      `License verified: ${license.id}, tier: ${tier}, trial: ${isInTrial}`,
    );

    // Step 10: Build valid license response and sign it (TASK_2025_188)
    return this.buildSignedResponse({
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
    });
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
            Date.now() + planConfig.expiresAfterDays * 24 * 60 * 60 * 1000,
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
   * Trial duration is configurable via TRIAL_DURATION_DAYS env var (default: 30 days).
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
    const normalizedForLookup = this.normalizeEmailForLookup(email);

    // Step 1: Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { email: normalizedEmail },
      });
    }

    // Step 2: Check for existing trial license (idempotent)
    // Only match trial-created licenses, not paid ones
    const existingLicense = await this.prisma.license.findFirst({
      where: {
        userId: user.id,
        status: 'active',
        createdBy: 'auto_trial_signup',
      },
    });

    if (existingLicense) {
      this.logger.debug(
        `User ${normalizedEmail} already has active trial license: ${existingLicense.id}`,
      );
      return {
        licenseKey: existingLicense.licenseKey,
        expiresAt: existingLicense.expiresAt ?? calculateTrialExpirationDate(),
      };
    }

    // Step 2b: Check for trial abuse via email aliasing (+tag, dots for Gmail)
    // Find ALL users in the system and check if any normalize to the same address.
    // This prevents user+1@gmail.com and u.s.e.r@gmail.com from getting separate trials.
    const allUsers = await this.prisma.user.findMany({
      select: { id: true, email: true },
    });
    const aliasUserIds = allUsers
      .filter(
        (u) =>
          u.id !== user!.id &&
          this.normalizeEmailForLookup(u.email) === normalizedForLookup,
      )
      .map((u) => u.id);

    if (aliasUserIds.length > 0) {
      const existingAliasTrial = await this.prisma.license.findFirst({
        where: {
          userId: { in: aliasUserIds },
          createdBy: 'auto_trial_signup',
        },
      });

      if (existingAliasTrial) {
        this.logger.warn(
          `Trial abuse detected: ${normalizedEmail} is an alias of an existing trial user`,
        );
        throw new Error(
          'A trial license already exists for this email address',
        );
      }
    }

    // Step 3: If no trial license, check if user already has a paid license
    const activePaidLicense = await this.prisma.license.findFirst({
      where: {
        userId: user.id,
        status: 'active',
        createdBy: { not: 'auto_trial_signup' },
      },
    });

    if (activePaidLicense) {
      this.logger.debug(
        `User ${normalizedEmail} already has paid license, skipping trial`,
      );
      return {
        licenseKey: activePaidLicense.licenseKey,
        expiresAt:
          activePaidLicense.expiresAt ??
          new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      };
    }

    // Step 4: Generate license key
    const licenseKey = this.generateLicenseKey();

    // Step 5: Set trial expiration (configurable via TRIAL_DURATION_DAYS env var)
    const expiresAt = calculateTrialExpirationDate();

    // Step 6: Create License + Subscription atomically in a transaction
    // Note: paddleSubscriptionId, paddleCustomerId, and priceId use synthetic
    // values since this trial is created outside Paddle's checkout flow.
    // These are prefixed with 'trial_' to distinguish from real Paddle data.
    const syntheticPaddleId = `trial_${user.id}_${Date.now()}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.license.create({
        data: {
          userId: user.id,
          licenseKey,
          plan: 'pro',
          status: 'active',
          expiresAt,
          createdBy: 'auto_trial_signup',
        },
      });

      await tx.subscription.create({
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
    });

    this.logger.log(
      `Trial license created for ${normalizedEmail}, expires: ${expiresAt.toISOString()} (${getTrialDurationDays()} days)`,
    );

    return { licenseKey, expiresAt };
  }

  /**
   * Manually downgrade user to Community plan
   *
   * Used when user explicitly chooses to downgrade from expired Pro trial
   * to Community plan via the trial-ended modal.
   *
   * Process:
   * 1. Validate user exists and has expired trial
   * 2. Update database in transaction:
   *    - License: plan → 'community'
   *    - Subscription: status → 'expired'
   * 3. Emit SSE event for real-time frontend update
   *
   * @param userId - Paddle ID of the user to downgrade
   * @returns Updated license data
   * @throws Error if user not found or no active license
   */
  async downgradeToCommunity(userId: string): Promise<{
    success: boolean;
    plan: string;
    status: string;
  }> {
    this.logger.log(`Manual downgrade initiated for userId: ${userId}`);

    // Step 1: Find user with license and subscription
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        licenses: {
          where: { status: 'active' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      this.logger.error(`User not found: ${userId}`);
      throw new Error('User not found');
    }

    const activeLicense = user.licenses[0];
    if (!activeLicense) {
      this.logger.error(`No active license found for userId: ${userId}`);
      throw new Error('No active license found');
    }

    const subscription = user.subscriptions[0];

    // Step 2: Perform downgrade in transaction (reuse pattern from trial-reminder)
    await this.prisma.$transaction(async (tx) => {
      // Update license to Community plan
      await tx.license.update({
        where: { id: activeLicense.id },
        data: {
          plan: 'community',
          expiresAt: null, // Community plan never expires
        },
      });

      // Update subscription status to 'expired' (if exists)
      if (subscription && subscription.status === 'trialing') {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'expired' },
        });
      }
    });

    this.logger.log(
      `Successfully downgraded ${user.email} to Community plan (manual)`,
    );

    // Step 3: Emit SSE event for real-time frontend update
    this.eventsService.emitLicenseUpdated({
      email: user.email,
      plan: 'community',
      status: 'active',
      expiresAt: null, // Community plan never expires
    });

    return {
      success: true,
      plan: 'community',
      status: 'active',
    };
  }

  /**
   * Normalize an email address to prevent trial abuse via aliasing tricks.
   *
   * Applies:
   * - Lowercase the entire address
   * - Strip '+' aliases (user+tag@domain -> user@domain)
   * - Strip dots in the local part for Gmail/Googlemail domains
   *   (u.s.e.r@gmail.com -> user@gmail.com)
   *
   * The normalized form is used for LOOKUP/CHECK only.
   * The original email is still stored in the database.
   *
   * @param email - Raw email address
   * @returns Normalized email for comparison purposes
   */
  private normalizeEmailForLookup(email: string): string {
    const lower = email.toLowerCase();
    const atIndex = lower.indexOf('@');
    if (atIndex === -1) return lower;

    const localPart = lower.substring(0, atIndex);
    const domain = lower.substring(atIndex + 1);

    // Strip + aliases (user+tag@gmail.com -> user@gmail.com)
    const withoutAlias = localPart.split('+')[0];

    // Strip dots for Gmail/Googlemail (u.s.e.r@gmail.com -> user@gmail.com)
    const gmailDomains = ['gmail.com', 'googlemail.com'];
    const normalizedLocal = gmailDomains.includes(domain)
      ? withoutAlias.replace(/\./g, '')
      : withoutAlias;

    return `${normalizedLocal}@${domain}`;
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

  /**
   * Compute the `expiresAt` for a complimentary license given a preset + optional
   * custom date. Throws `BadRequestException` on invalid input so the controller
   * returns a 400 with a precise error code.
   */
  private computeComplimentaryExpiresAt(
    preset: ComplimentaryDurationPreset,
    customExpiresAt: string | undefined,
    now: Date,
  ): Date | null {
    const DAY_MS = 24 * 60 * 60 * 1000;
    switch (preset) {
      case '30d':
        return new Date(now.getTime() + 30 * DAY_MS);
      case '1y':
        return new Date(now.getTime() + 365 * DAY_MS);
      case '5y':
        return new Date(now.getTime() + 5 * 365 * DAY_MS);
      case 'never':
        return null;
      case 'custom': {
        if (!customExpiresAt) {
          throw new BadRequestException({
            code: 'INVALID_CUSTOM_DATE',
            message: 'customExpiresAt is required when durationPreset = custom',
          });
        }
        const parsed = new Date(customExpiresAt);
        if (
          Number.isNaN(parsed.getTime()) ||
          parsed.getTime() <= now.getTime()
        ) {
          throw new BadRequestException({
            code: 'INVALID_CUSTOM_DATE',
            message:
              'customExpiresAt must be a valid ISO-8601 date in the future',
          });
        }
        return parsed;
      }
      default: {
        // Exhaustiveness guard — DTO validator should prevent this branch.
        const exhaustive: never = preset;
        throw new BadRequestException(
          `Unsupported durationPreset: ${String(exhaustive)}`,
        );
      }
    }
  }

  /**
   * Issue a complimentary (admin-gifted) license.
   *
   * TASK_2025_292 §6.3 — DIFFERS from `createLicense` in several critical ways
   * the spec calls out explicitly:
   *  - MUST NOT revoke existing active licenses (R1). Comp licenses stack
   *    on top of paid ones when the admin explicitly opts in via
   *    `stackOnTopOfPaid: true`; otherwise a 409 is returned so the admin
   *    can make the decision consciously.
   *  - Persists `source: 'complimentary'` so MRR dashboards can filter it out.
   *  - Writes an `admin_audit_log` row in the same transaction as the
   *    license create (atomicity — the audit trail must match reality).
   *  - Email delivery is best-effort: a failed send returns a warning but
   *    DOES NOT roll back the license.
   *  - Retries up to 3 times on licenseKey P2002 collisions (vanishingly
   *    rare with 256-bit entropy, but deterministic tests want it covered).
   */
  async createComplimentaryLicense(
    dto: IssueComplimentaryLicenseDto,
    actor: AdminActor,
  ): Promise<ComplimentaryLicenseResult> {
    const now = new Date();

    // Step 1: Resolve user — 404 if missing (AC §4.2).
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: `User ${dto.userId} not found`,
      });
    }

    // Step 2: Compute expiration (may throw 400 INVALID_CUSTOM_DATE).
    const expiresAt = this.computeComplimentaryExpiresAt(
      dto.durationPreset,
      dto.customExpiresAt,
      now,
    );

    // Step 3: Conflict check — block unless caller explicitly stacks.
    // We ONLY care about non-complimentary actives (paddle/manual). Stacking
    // two complimentary licenses is fine and has no business implication.
    if (dto.stackOnTopOfPaid !== true) {
      const conflict = await this.prisma.license.findFirst({
        where: {
          userId: user.id,
          status: 'active',
          source: { not: 'complimentary' },
        },
        select: {
          id: true,
          plan: true,
          source: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      if (conflict) {
        throw new ConflictException({
          code: 'EXISTING_ACTIVE_LICENSE',
          message:
            'User has an existing active non-complimentary license. Pass stackOnTopOfPaid=true to override.',
          existingLicense: conflict,
        });
      }
    }

    // Step 4: Create in a transaction w/ up to 3 retries on P2002 (unique
    // violation on license_key). Audit log + license create share the tx so
    // either both commit or both roll back.
    const maxAttempts = 3;
    let lastError: unknown = null;
    let createdLicense: License | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const licenseKey = this.generateLicenseKey();
      try {
        createdLicense = await this.prisma.$transaction(async (tx) => {
          await this.auditLog.write({
            tx,
            actorEmail: actor.email,
            action: 'license.complimentary.issue',
            targetType: 'License',
            metadata: {
              userId: user.id,
              userEmail: user.email,
              durationPreset: dto.durationPreset,
              expiresAt: expiresAt ? expiresAt.toISOString() : null,
              reason: dto.reason,
              plan: dto.plan,
              stacked: dto.stackOnTopOfPaid === true,
            },
            ipAddress: actor.ip,
            userAgent: actor.userAgent,
          });

          return tx.license.create({
            data: {
              licenseKey,
              userId: user.id,
              plan: dto.plan,
              status: 'active',
              source: 'complimentary',
              expiresAt,
              createdBy: actor.email,
            },
          });
        });
        break; // Success — exit retry loop.
      } catch (err) {
        lastError = err;
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          attempt < maxAttempts
        ) {
          this.logger.warn(
            `License key collision on attempt ${attempt}/${maxAttempts}, retrying`,
          );
          continue;
        }
        throw err;
      }
    }

    if (!createdLicense) {
      // Defensive — only reachable if all 3 attempts hit P2002.
      throw lastError instanceof Error
        ? lastError
        : new Error('Failed to create complimentary license after retries');
    }

    this.logger.log(
      `Complimentary license ${createdLicense.id} issued to ${user.email} by ${actor.email} (preset=${dto.durationPreset}, stacked=${dto.stackOnTopOfPaid === true})`,
    );

    // Step 5: Best-effort email. Failure DOES NOT roll back the license —
    // we've already committed audit + license in the transaction above.
    if (dto.sendEmail !== false) {
      try {
        await this.emailService.sendLicenseKey({
          email: user.email,
          licenseKey: createdLicense.licenseKey,
          plan: dto.plan,
          expiresAt: createdLicense.expiresAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Complimentary license ${createdLicense.id} persisted but email failed: ${message}`,
        );
        return {
          license: createdLicense,
          warning: { code: 'LICENSE_EMAIL_FAILED', error: message },
        };
      }
    }

    return { license: createdLicense };
  }
}
