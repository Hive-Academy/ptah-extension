import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import { EventsService } from '../../events/events.service';
import { PLANS, getPlanConfig, PlanName } from '@ptah-api/core';
import { randomBytes, createPrivateKey, sign, KeyObject } from 'crypto';
import { Prisma, License, User } from '@ptah-api/core';
import { AuditLogService } from '@ptah-api/audit';
import { EmailService } from '@ptah-api/email';
import { WaitlistService } from '@ptah-api/marketing';
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
 * Input to {@link LicenseService.issueComplimentaryLicenseTx} — the `tx`-aware
 * complimentary-licence core (TASK_2026_201 R2, mechanism (b)).
 *
 * Deliberately NOT the DTO: the core is called both by
 * `createComplimentaryLicense` (which has a DTO) and by the waitlist
 * approve-to-cohort action (which has a waitlist row, not a DTO). Everything
 * the core needs is passed explicitly so neither caller has to fabricate a DTO.
 */
export interface IssueComplimentaryLicenseTxParams {
  /** Already-resolved recipient. The core never find-or-creates. */
  user: User;
  plan: PlanName;
  /**
   * Recorded verbatim in the `license.complimentary.issue` audit metadata.
   * The core does NOT recompute `expiresAt` from it — the caller owns that,
   * via {@link LicenseService.computeComplimentaryExpiresAt}, so a 400 for an
   * invalid custom date is still thrown before any write.
   */
  durationPreset: ComplimentaryDurationPreset;
  expiresAt: Date | null;
  /** Persisted to `License.createdBy`. Callers pass `actor.email`. */
  createdBy: string;
  actor: AdminActor;
  reason: string;
  /**
   * When `true`, skips the `EXISTING_ACTIVE_LICENSE` conflict guard. The
   * approve-to-cohort path never sets it (TASK_2026_201 R5.4).
   */
  stackOnTopOfPaid?: boolean;
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
    @Inject(WaitlistService) private readonly waitlist: WaitlistService,
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
   * @param licenseKey - The license key to verify. Format is `ptah_lic_{64-hex}`
   *   and nothing else. This docblock previously also advertised a legacy
   *   `PTAH-XXXX-XXXX-XXXX` form; that form is not produced by `generateLicenseKey()`
   *   below (see its "Format:" note) and no row has ever used it — TASK_2026_170
   *   data check D1 counted licences failing `^ptah_lic_[a-f0-9]{64}$` and returned
   *   D1 = 0 (2026-08-02). The claim was the only reason binding
   *   `VerifyLicenseDto`'s `@Matches` on this public endpoint looked risky.
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
   * @param params - Email, plan, and optional createdBy/source markers
   * @returns The generated license key and expiration date
   *
   * ⚠️ `source` DEFAULTS TO `'paddle'` AT THE SCHEMA LEVEL, so a caller that
   * omits it labels the row as a paid Paddle sale. Any caller that is NOT a
   * Paddle purchase MUST pass an explicit `source` — otherwise the admin
   * dashboard reconciles the row against a subscription that will never exist,
   * and MRR filters (`source = 'paddle'`) over-count.
   */
  async createLicense(params: {
    email: string;
    plan: PlanName;
    createdBy?: string;
    source?: string;
  }): Promise<{ licenseKey: string; expiresAt: Date | null }> {
    const { email, plan, createdBy = 'admin', source } = params;
    const { user } = await this.findOrCreateUserByEmail(email);
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
        // Omitted `source` falls through to the schema default ('paddle').
        ...(source ? { source } : {}),
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
   * Find an existing user by (lowercased) email or create a bare one.
   *
   * Shared by `createLicense` (admin gift-by-email), `createComplimentaryLicense`
   * (approval that starts from a waitlist email with no `User` yet) and — since
   * TASK_2026_201 — the waitlist approve-to-cohort action, which calls it
   * **inside** its per-row transaction.
   *
   * @param email - raw address; lowercased before any query.
   * @param client - optional interactive-transaction client. When supplied, both
   *   the read and the create run on the caller's transaction so a rollback
   *   removes a user this call created. Omit it to run on the base client.
   *   Same `tx ?? this.prisma` shape as `AuditLogService.write`.
   * @returns the resolved user and whether THIS call created it — the latter
   *   feeds `userWasCreated` in the `waitlist.approve` audit metadata (R7).
   */
  async findOrCreateUserByEmail(
    email: string,
    client?: Prisma.TransactionClient,
  ): Promise<{ user: User; created: boolean }> {
    const db: Prisma.TransactionClient = client ?? this.prisma;
    const normalized = email.toLowerCase();
    const existing = await db.user.findUnique({
      where: { email: normalized },
    });
    if (existing) {
      return { user: existing, created: false };
    }
    const created = await db.user.create({
      data: { email: normalized },
    });
    return { user: created, created: true };
  }

  /**
   * Compute the `expiresAt` for a complimentary license given a preset + optional
   * custom date. Throws `BadRequestException` on invalid input so the controller
   * returns a 400 with a precise error code.
   *
   * Public since TASK_2026_201 so the waitlist approve-to-cohort action resolves
   * `'1y'` through the SAME definition rather than re-deriving `365 * DAY_MS`.
   * Callers must invoke it BEFORE opening their transaction — the 400 it throws
   * has to precede every write.
   */
  computeComplimentaryExpiresAt(
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
   * Run `fn` under the 3-attempt licenseKey-collision retry.
   *
   * ⚠️ THE OWNER OF THE TRANSACTION OWNS THE RETRY. `fn` MUST open (and close)
   * its own transaction — pass `() => prisma.$transaction(...)`, never a
   * statement inside somebody else's open transaction.
   *
   * On PostgreSQL, any statement error inside an open transaction puts the
   * session into the aborted state (`25P02`) and every subsequent statement
   * fails until `ROLLBACK`. So a P2002 caught *inside* an interactive
   * transaction cannot be retried inside it: the retry would issue its next
   * statement into an aborted session and fail with an error that has nothing
   * to do with a key collision — while still LOOKING like a retry. Wrapping the
   * whole transaction is therefore the only correct shape, and it is the shape
   * this code has always had (TASK_2026_201 R5.6).
   *
   * Retrying the whole transaction also means a re-entered attempt cannot leave
   * the previous attempt's writes behind: attempt N rolled back in full.
   *
   * Only P2002 is retried. Every other error — including the
   * `EXISTING_ACTIVE_LICENSE` 409 raised by the conflict guard — propagates on
   * the first attempt.
   */
  async withLicenseKeyRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxAttempts = 3;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
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

    // Unreachable: the final attempt either returns or rethrows above. Kept as
    // the same defensive tail the pre-extraction loop carried.
    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to create complimentary license after retries');
  }

  /**
   * The complimentary-licence CORE, executed on a caller-supplied transaction
   * (TASK_2026_201 R2, mechanism (b)).
   *
   * Does exactly four things, in this order, and nothing else:
   *   1. the `EXISTING_ACTIVE_LICENSE` conflict guard, **read through `tx`**,
   *      unless `stackOnTopOfPaid === true`;
   *   2. generates a FRESH licence key — one per call, so a caller-level retry
   *      gets a new key rather than re-issuing the colliding one;
   *   3. writes the `license.complimentary.issue` audit row through `tx`
   *      (PRE-6: the audit row commits and rolls back with the mutation);
   *   4. `tx.license.create` with `source: 'complimentary'`.
   *
   * It **sends no email, stamps no waitlist row, and never opens a
   * transaction.** Suppression of `sendLicenseKey` on the approval path is
   * therefore structural, not conditional: there is no mail side effect here to
   * suppress, and each caller owns its own outbound message.
   *
   * It also does not retry. See {@link withLicenseKeyRetry} for why the retry
   * must live outside the transaction, and therefore outside this method.
   *
   * The conflict guard reading through `tx` rather than the base client is a
   * deliberate improvement over the pre-extraction code: it closes the TOCTOU
   * window between "no active paid licence" and the create. No observable
   * contract changes — same `findFirst`, same `ConflictException` body.
   *
   * @throws ConflictException `EXISTING_ACTIVE_LICENSE` when the user already
   *   holds an active NON-complimentary licence and stacking was not requested.
   */
  async issueComplimentaryLicenseTx(
    tx: Prisma.TransactionClient,
    params: IssueComplimentaryLicenseTxParams,
  ): Promise<License> {
    const {
      user,
      plan,
      durationPreset,
      expiresAt,
      createdBy,
      actor,
      reason,
      stackOnTopOfPaid,
    } = params;

    if (stackOnTopOfPaid !== true) {
      const conflict = await tx.license.findFirst({
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

    const licenseKey = this.generateLicenseKey();

    await this.auditLog.write({
      tx,
      actorEmail: actor.email,
      action: 'license.complimentary.issue',
      targetType: 'License',
      metadata: {
        userId: user.id,
        userEmail: user.email,
        durationPreset,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        reason,
        plan,
        stacked: stackOnTopOfPaid === true,
      },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });

    return tx.license.create({
      data: {
        licenseKey,
        userId: user.id,
        plan,
        status: 'active',
        source: 'complimentary',
        expiresAt,
        createdBy,
      },
    });
  }

  /**
   * Issue a complimentary (admin-gifted) license.
   *
   * Since TASK_2026_201 this is a thin composition over
   * {@link issueComplimentaryLicenseTx} + {@link withLicenseKeyRetry}; its
   * observable contract (signature, {@link ComplimentaryLicenseResult}, and the
   * `Conflict` / `BadRequest` / `NotFound` it throws) is unchanged.
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

    // Resolve the recipient. The DTO guarantees EXACTLY ONE of userId / email,
    // but resolution differs: userId must point at an existing User (404 if
    // not), while the Early-Adopter email path find-or-creates by lowercased
    // email (approval starts from a waitlist row that may have no User yet).
    let user: User | null;
    if (dto.userId) {
      user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
      });
    } else if (dto.email) {
      user = (await this.findOrCreateUserByEmail(dto.email)).user;
    } else {
      throw new BadRequestException({
        code: 'MISSING_RECIPIENT',
        message: 'Provide exactly one of userId or email',
      });
    }
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: `User ${dto.userId} not found`,
      });
    }
    // Narrowed alias: `user` is `User | null` above, and the closure below
    // needs the non-null form.
    const recipient: User = user;
    const expiresAt = this.computeComplimentaryExpiresAt(
      dto.durationPreset,
      dto.customExpiresAt,
      now,
    );

    // The retry wraps the WHOLE transaction (see `withLicenseKeyRetry`), and
    // the core generates a fresh key on every attempt.
    const createdLicense = await this.withLicenseKeyRetry(() =>
      this.prisma.$transaction((tx) =>
        this.issueComplimentaryLicenseTx(tx, {
          user: recipient,
          plan: dto.plan,
          durationPreset: dto.durationPreset,
          expiresAt,
          createdBy: actor.email,
          actor,
          reason: dto.reason,
          stackOnTopOfPaid: dto.stackOnTopOfPaid,
        }),
      ),
    );

    this.logger.log(
      `Complimentary license ${createdLicense.id} issued to ${recipient.email} by ${actor.email} (preset=${dto.durationPreset}, stacked=${dto.stackOnTopOfPaid === true})`,
    );

    // Best-effort: stamp the waitlist lead APPROVED — TASK_2026_201 R4.3.
    // A gift is not a conversion. This used to call `markConverted`, which
    // polluted the paid-conversion funnel with every free grant; `convertedAt`
    // is now written by exactly one thing, the Paddle provisioning fan-out.
    // We stamp for both recipient paths — `markApproved` is idempotent and a
    // no-op when no un-approved row matches (R4.6). A failure here must NEVER
    // fail an already-persisted grant.
    try {
      await this.waitlist.markApproved(recipient.email);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Complimentary license ${createdLicense.id} persisted but waitlist markApproved failed for ${recipient.email}: ${message}`,
      );
    }

    if (dto.sendEmail !== false) {
      try {
        await this.emailService.sendLicenseKey({
          email: recipient.email,
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
