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
 * License Tier type — open-source + Builders model (exactly three values).
 *
 * Tier values:
 * - 'community': FREE and open source - no subscription required
 * - 'builders': Paid Ptah Builders membership (active subscription)
 * - 'expired': License expired, revoked, or payment failed
 *
 * Note: Community tier has no trial - it's always free. Premium signups go to
 * 'builders'. Legacy 'pro'/'trial_pro' have been removed entirely.
 */
export type LicenseTier = 'community' | 'builders' | 'expired';

/**
 * License verification response structure
 */
export interface LicenseVerificationResponse {
  valid: boolean;
  tier: LicenseTier;
  plan?: (typeof PLANS)[keyof typeof PLANS];
  expiresAt?: string;
  daysRemaining?: number;
  reason?: 'expired' | 'revoked' | 'not_found';
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
 * Map database plan to tier value.
 *
 * Open-source + Builders model. 'builders' is the only premium tier.
 *
 * @param dbPlan - Plan value from database ('community' | 'builders')
 * @returns LicenseTier value
 */
function mapPlanToTier(dbPlan: string): LicenseTier {
  switch (dbPlan) {
    case 'builders':
      return 'builders';

    case 'community':
      return 'community';

    default:
      return 'expired';
  }
}

/**
 * LicenseService - Core license management logic
 *
 * Open-source + Builders model (Community + Builders tiers).
 *
 * Responsibilities:
 * - Verify license key validity and return plan details
 * - Support tier values: community, builders, expired
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
   * @returns License status with validity, tier, plan details, and expiration
   *
   * Response cases:
   * - Valid license: { valid: true, tier, plan, expiresAt, daysRemaining }
   * - Expired: { valid: false, tier: "expired", reason: "expired" }
   * - Revoked: { valid: false, tier: "expired", reason: "revoked" }
   * - Not found: { valid: false, tier: "expired", reason: "not_found" }
   *
   * Plans: 'community' (free) and 'builders' (paid)
   */
  async verifyLicense(
    licenseKey: string,
  ): Promise<LicenseVerificationResponse> {
    const license = await this.prisma.license.findUnique({
      where: { licenseKey },
      include: { user: true },
    });
    if (!license) {
      this.logger.debug(`License not found: ${licenseKey.substring(0, 10)}...`);
      return this.buildSignedResponse({
        valid: false,
        tier: 'expired',
        reason: 'not_found',
      });
    }
    if (license.status === 'revoked') {
      this.logger.debug(`License revoked: ${license.id}`);
      return this.buildSignedResponse({
        valid: false,
        tier: 'expired',
        reason: 'revoked',
      });
    }
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
    const tier = mapPlanToTier(license.plan);
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
    const daysRemaining = license.expiresAt
      ? Math.ceil(
          (license.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        )
      : undefined;
    const isValidPlan = tier === 'community' || tier === 'builders';
    const planConfig = isValidPlan
      ? getPlanConfig(tier as PlanName)
      : undefined;

    this.logger.debug(`License verified: ${license.id}, tier: ${tier}`);
    return this.buildSignedResponse({
      valid: true,
      tier,
      plan: planConfig,
      expiresAt: license.expiresAt?.toISOString(),
      daysRemaining,
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
   * @param params - Email, plan, and optional createdBy marker for license creation
   * @returns The generated license key and expiration date
   */
  async createLicense(params: {
    email: string;
    plan: PlanName;
    createdBy?: string;
  }): Promise<{ licenseKey: string; expiresAt: Date | null }> {
    const { email, plan, createdBy = 'admin' } = params;
    let user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { email: email.toLowerCase() },
      });
    }
    await this.prisma.license.updateMany({
      where: {
        userId: user.id,
        status: 'active',
      },
      data: {
        status: 'revoked',
      },
    });
    const licenseKey = this.generateLicenseKey();
    const planConfig = getPlanConfig(plan);
    const expiresAt =
      planConfig.expiresAfterDays !== null
        ? new Date(
            Date.now() + planConfig.expiresAfterDays * 24 * 60 * 60 * 1000,
          )
        : null;
    await this.prisma.license.create({
      data: {
        userId: user.id,
        licenseKey,
        plan,
        status: 'active',
        expiresAt,
        createdBy,
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
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: `User ${dto.userId} not found`,
      });
    }
    const expiresAt = this.computeComplimentaryExpiresAt(
      dto.durationPreset,
      dto.customExpiresAt,
      now,
    );
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
      throw lastError instanceof Error
        ? lastError
        : new Error('Failed to create complimentary license after retries');
    }

    this.logger.log(
      `Complimentary license ${createdLicense.id} issued to ${user.email} by ${actor.email} (preset=${dto.durationPreset}, stacked=${dto.stackOnTopOfPaid === true})`,
    );
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
