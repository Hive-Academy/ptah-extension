import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/services/email.service';

export type WaitlistJoinStatus = 'joined' | 'already_joined';

export interface WaitlistJoinResult {
  status: WaitlistJoinStatus;
}

/**
 * Result of an invite wave.
 *
 * `invited` / `skipped` are the client-facing contract; `invitedIds` is an
 * internal extension the admin controller uses for the AdminAuditLog wave
 * summary (never returned to the HTTP client).
 */
export interface WaitlistInviteResult {
  invited: number;
  skipped: number;
  invitedIds: string[];
}

/**
 * Default number of oldest un-notified rows an invite wave sends when neither
 * explicit `ids` nor a `batchSize` is supplied.
 */
const DEFAULT_INVITE_BATCH_SIZE = 50;

/**
 * WaitlistService - Builders premium-tier lead capture.
 *
 * Dedupes by lowercased email. On first join, persists the row and fires a
 * confirmation email (best-effort — email failure never fails the signup).
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
   * Send the founding early-adopter invite to a wave of waitlist rows and stamp
   * `notifiedAt` on each successful send.
   *
   * Target resolution (per API contract):
   *   - `ids` wins when provided — invites exactly those rows.
   *   - otherwise the `batchSize` (default {@link DEFAULT_INVITE_BATCH_SIZE})
   *     oldest rows where `notifiedAt IS NULL`.
   *
   * Per-row semantics:
   *   - Already-notified row → counted in `skipped`, no email, no re-stamp.
   *   - Email send fails → NOT stamped and NOT counted as invited, so the row
   *     is naturally retried on the next wave (best-effort, logged).
   *   - Email send succeeds → `notifiedAt` stamped, counted in `invited`.
   */
  async inviteBatch(params: {
    ids?: string[];
    batchSize?: number;
  }): Promise<WaitlistInviteResult> {
    const rows = await this.resolveInviteTargets(params);

    let invited = 0;
    let skipped = 0;
    const invitedIds: string[] = [];

    for (const row of rows) {
      if (row.notifiedAt) {
        skipped += 1;
        continue;
      }

      try {
        await this.emailService.sendFoundingInvite({ email: row.email });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        // Do NOT stamp notifiedAt on send failure — leaving it null lets the
        // row be picked up again by the next batch invite (retry-safe).
        this.logger.error(
          `Founding invite email failed for ${row.email}: ${message} — not stamping notifiedAt`,
        );
        continue;
      }

      await this.prisma.waitlist.update({
        where: { id: row.id },
        data: { notifiedAt: new Date() },
      });
      invited += 1;
      invitedIds.push(row.id);
    }

    this.logger.log(
      `Waitlist invite wave complete: invited=${invited} skipped=${skipped}`,
    );

    return { invited, skipped, invitedIds };
  }

  /**
   * Resolve the rows an invite wave should target. `ids` (when non-empty) take
   * precedence over `batchSize`. Selects only the fields the wave needs.
   */
  private async resolveInviteTargets(params: {
    ids?: string[];
    batchSize?: number;
  }): Promise<Array<{ id: string; email: string; notifiedAt: Date | null }>> {
    if (params.ids && params.ids.length > 0) {
      return this.prisma.waitlist.findMany({
        where: { id: { in: params.ids } },
        select: { id: true, email: true, notifiedAt: true },
      });
    }

    const take =
      params.batchSize && params.batchSize > 0
        ? params.batchSize
        : DEFAULT_INVITE_BATCH_SIZE;

    return this.prisma.waitlist.findMany({
      where: { notifiedAt: null },
      orderBy: { createdAt: 'asc' },
      take,
      select: { id: true, email: true, notifiedAt: true },
    });
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
