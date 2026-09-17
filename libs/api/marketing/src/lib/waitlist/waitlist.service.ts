import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import { EmailService } from '@ptah-api/email';

export type WaitlistJoinStatus = 'joined' | 'already_joined';

export interface WaitlistJoinResult {
  status: WaitlistJoinStatus;
}

/**
 * The projection of a `Waitlist` row the approve-to-cohort path reads.
 *
 * Deliberately narrow: the approve transaction needs the address to grant to,
 * the row id to audit against, `notifiedAt` for R6's `wasNotified` metadata,
 * `approvedAt` only to distinguish an already-stamped row from a fresh one,
 * and `convertedAt` to tell a PAID row from an approved one when the claim
 * loses (TASK_2026_462 Component 4). Nothing else on the row is any of that
 * path's business.
 */
export interface WaitlistApprovalRow {
  id: string;
  email: string;
  notifiedAt: Date | null;
  approvedAt: Date | null;
  convertedAt: Date | null;
}

/**
 * Outcome of {@link WaitlistService.claimForApproval} — the conditional claim
 * that IS the idempotency guard for approve-to-cohort (TASK_2026_201 R5).
 *
 * Discriminated on `outcome` so the caller cannot read `row` on the one branch
 * where there is no row:
 *   - `claimed`          — this call won the claim; the caller owns the grant.
 *   - `already_approved` — someone else got there first; skip the row.
 *   - `already_paid`     — the row paid; the claim refuses to gift over a
 *                          conversion (TASK_2026_462 Component 4).
 *   - `not_found`        — no such waitlist row.
 */
export type WaitlistClaimResult =
  | { outcome: 'claimed'; row: WaitlistApprovalRow }
  | { outcome: 'already_approved'; row: WaitlistApprovalRow }
  | { outcome: 'already_paid'; row: WaitlistApprovalRow }
  | { outcome: 'not_found' };

/**
 * WaitlistService - Builders premium-tier lead capture.
 *
 * Dedupes by lowercased email. On first join, persists the row and fires a
 * confirmation email (best-effort — email failure never fails the signup).
 *
 * This service owns EVERY write to the `Waitlist` table, including the two
 * disjoint stamps that survive TASK_2026_201:
 *   - {@link markApproved} / {@link claimForApproval} → `approvedAt`, the free
 *     founding-cohort grant;
 *   - {@link markConverted} → `convertedAt`, the Paddle fan-out ONLY (they paid).
 *
 * The third stamp, `notifiedAt`, is HISTORICAL: it belonged to the paid founding
 * invite wave, which TASK_2026_201 deleted outright (context.md C1/C2). Nothing
 * writes it any more; existing values are still read for the `wasNotified`
 * approval-audit field and must not be re-purposed.
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  /**
   * Join the Builders waitlist.
   *
   * @returns `{ status: 'joined' }` on first join, `{ status: 'already_joined' }`
   *          when the (lowercased) email is already present.
   */
  async join(params: {
    email: string;
    source?: string;
  }): Promise<WaitlistJoinResult> {
    const email = this.normalizeEmail(params.email);
    const source = params.source?.trim() || null;

    const existing = await this.prisma.waitlist.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      this.logger.log(`Waitlist signup ignored — already joined (${email})`);
      return { status: 'already_joined' };
    }

    try {
      await this.prisma.waitlist.create({
        data: { email, source },
      });
    } catch (error: unknown) {
      // Handle the concurrent-signup race: two requests for the same email can
      // both pass the findUnique check, and the second create hits the unique
      // constraint (Prisma error code P2002). Treat that as an idempotent join.
      if (this.isUniqueConstraintError(error)) {
        this.logger.log(`Waitlist signup raced — already joined (${email})`);
        return { status: 'already_joined' };
      }
      throw error;
    }

    this.logger.log(
      `Waitlist signup recorded (${email}, source: ${source ?? 'unknown'})`,
    );

    // Confirmation email is best-effort: a delivery failure must not turn a
    // successful signup into an error for the caller.
    try {
      await this.emailService.sendWaitlistConfirmation({ email });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Waitlist confirmation email failed for ${email}: ${message}`,
      );
    }

    return { status: 'joined' };
  }

  /**
   * Stamp `convertedAt` on the waitlist row matching `email` (lowercased),
   * marking the founding lead as converted to a paid Builders subscriber.
   *
   * Called by the Paddle→provisioning fan-out (Circle agent) from the webhook
   * handler. Idempotent and forgiving:
   *   - No matching row → no-op (many buyers never joined the waitlist).
   *   - Row already converted → no-op (never moves an existing timestamp).
   *
   * Uses `updateMany` so a missing row resolves to `{ count: 0 }` instead of
   * throwing — the caller must never fail the webhook on this.
   */
  async markConverted(email: string): Promise<void> {
    const normalized = this.normalizeEmail(email);
    const { count } = await this.prisma.waitlist.updateMany({
      where: { email: normalized, convertedAt: null },
      data: { convertedAt: new Date() },
    });

    if (count > 0) {
      this.logger.log(`Waitlist lead marked converted (${normalized})`);
    } else {
      this.logger.log(
        `Waitlist markConverted no-op — no un-converted row for ${normalized}`,
      );
    }
  }

  /**
   * Stamp `approvedAt` on the waitlist row matching `email` (lowercased),
   * marking the lead as granted FREE founding access.
   *
   * TASK_2026_201 R4.3 / R4.6. `approvedAt` and `convertedAt` are disjoint
   * facts and must stay that way:
   *   - `approvedAt`  — approve-to-cohort, and complimentary-licence issuance.
   *   - `convertedAt` — the Paddle provisioning fan-out ONLY (they paid).
   * A gift is not a conversion; stamping `convertedAt` for a free grant
   * silently inflates the paid-conversion funnel.
   *
   * Idempotent and forgiving, mirroring {@link markConverted} exactly:
   *   - No matching row → no-op (many recipients never joined the waitlist).
   *   - Row already approved → no-op, and the existing timestamp is NEVER
   *     moved — that is what the `approvedAt: null` guard in the `where` buys.
   *
   * Uses `updateMany` so a missing row resolves to `{ count: 0 }` instead of
   * throwing — the caller must never fail a persisted grant on this.
   *
   * ⚠️ This is the non-transactional, email-keyed stamp used by the
   * complimentary-licence endpoint. The approve-to-cohort action does NOT use
   * it: that path claims the row by id inside its own transaction, because the
   * claim is also its idempotency guard (R5).
   */
  async markApproved(email: string): Promise<void> {
    const normalized = this.normalizeEmail(email);
    const { count } = await this.prisma.waitlist.updateMany({
      where: { email: normalized, approvedAt: null },
      data: { approvedAt: new Date() },
    });

    if (count > 0) {
      this.logger.log(`Waitlist lead marked approved (${normalized})`);
    } else {
      this.logger.log(
        `Waitlist markApproved no-op — no un-approved row for ${normalized}`,
      );
    }
  }

  /**
   * Conditionally claim a waitlist row for approve-to-cohort, ON THE CALLER'S
   * TRANSACTION (TASK_2026_201 R5, R5.5; converted guard TASK_2026_462 C4).
   *
   * The claim is a single conditional UPDATE:
   *
   * ```sql
   * UPDATE "waitlist" SET "approved_at" = $now
   *  WHERE "id" = $id AND "approved_at" IS NULL AND "converted_at" IS NULL
   * ```
   *
   * `count = 0` means the row was already approved or already converted — by
   * an earlier request or by a concurrent one — and is the ONLY idempotency
   * signal this path has. Prisma runs PostgreSQL transactions at Read
   * Committed, so a concurrent claimer blocks on the row lock and, on release,
   * re-evaluates both null guards against the committed row and reports
   * `count = 0`. Exactly one winner, and neither side raises (R5.2).
   *
   * ⚠️ THE `converted_at` GUARD IS THE 462 RULE, NOT REDUNDANCY. `approvedAt`
   * and `convertedAt` are disjoint facts (see `markApproved`), so an
   * admin-clicked Approve on a row that PAID in the gap must refuse the gift:
   * stamping `approvedAt` over a live `convertedAt` would corrupt the funnel
   * and hand a free year to someone who just bought one. The loser maps to
   * the pre-existing `already_paid` outcome — the public five-outcome
   * contract does not grow.
   *
   * ⚠️ WHY THIS TAKES `tx` RATHER THAN RUNNING ON THE BASE CLIENT. The claim
   * must be the FIRST WRITE inside the caller's per-row transaction so that a
   * later failure — cohort assignment, audit, anything — rolls the claim back
   * with everything else and leaves the row re-approvable (R5.5). A claim taken
   * outside the transaction would permanently poison a row whose grant then
   * failed. Same `tx`-injection shape as `AuditLogService.write({ tx })`.
   *
   * ⚠️ THE `findUnique` IS ADVISORY ONLY. It exists to tell `not_found` from
   * the claim-losing outcomes, nothing more; a racer that claims between the
   * read and the update is still caught by `count === 0`, so the read
   * introduces no race. For the same reason `row.approvedAt` on the
   * `already_approved` branch is the value as of the read and may be `null`
   * when the racer's stamp landed after it — callers must treat the `outcome`
   * as the truth, never `row.approvedAt`. The one value the read IS trusted
   * for is the paid/approved split: the production select always carries
   * `convertedAt`, so `row.convertedAt !== null` (a STRICT check — see
   * below) means the row had paid as of the read, and the outcome follows it.
   *
   * All `Waitlist` writes stay owned by this service; the caller never touches
   * `tx.waitlist` directly.
   *
   * @param tx - the caller's interactive-transaction client.
   * @param id - waitlist row id (cuid).
   */
  async claimForApproval(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<WaitlistClaimResult> {
    const row = await tx.waitlist.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        notifiedAt: true,
        approvedAt: true,
        convertedAt: true,
      },
    });

    if (!row) {
      return { outcome: 'not_found' };
    }

    const { count } = await tx.waitlist.updateMany({
      where: { id, approvedAt: null, convertedAt: null },
      data: { approvedAt: new Date() },
    });

    if (count === 0) {
      const current = await tx.waitlist.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          notifiedAt: true,
          approvedAt: true,
          convertedAt: true,
        },
      });

      if (!current) {
        return { outcome: 'not_found' };
      }

      return current.convertedAt !== null
        ? { outcome: 'already_paid', row: current }
        : { outcome: 'already_approved', row: current };
    }

    return { outcome: 'claimed', row };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
