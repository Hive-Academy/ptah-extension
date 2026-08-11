import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import { AuditLogService } from '@ptah-api/audit';
import { EmailService } from '@ptah-api/email';
import { LicenseService } from '@ptah-api/licensing';
import type { AdminActor } from '@ptah-api/licensing';
import { WaitlistService } from '@ptah-api/marketing';
import type { WaitlistApprovalRow } from '@ptah-api/marketing';
import { MemberGroupsService } from '@ptah-api/community';
import type {
  WaitlistApprovalOutcome,
  WaitlistApprovalResponse,
  WaitlistApprovalRowResult,
} from './waitlist-approval.types';
import { WAITLIST_APPROVAL_OUTCOMES } from './waitlist-approval.types';

/** The cohort every approval places the member in. Never resolved by `isDefault`. */
const FOUNDING_GROUP_KEY = 'founding';

/** The grant is always a year. NOT client-supplied (context.md C3). */
const APPROVAL_DURATION_PRESET = '1y' as const;

/** Recorded verbatim on the `license.complimentary.issue` audit row. */
const APPROVAL_REASON = 'Founding cohort approval (waitlist)';

/** `withLicenseKeyRetry`'s attempt budget, mirrored here for the log line. */
const MAX_GRANT_ATTEMPTS = 3;

/**
 * Subscription states that mean "this person is already paying us"
 * (`schema.prisma:201`). `paused`, `canceled` and `past_due` are deliberately
 * absent: none of them is a live entitlement, and somebody whose card failed is
 * exactly who a founding grant is for.
 */
const PAYING_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;

/**
 * Sentinel used to roll a row's transaction back with a REASON.
 *
 * ⚠️ THROWING IS THE MECHANISM, NOT AN ERROR CONDITION. Prisma rolls an
 * interactive transaction back if and only if the callback rejects, so a skip
 * decided INSIDE the callback (the claim came back `count = 0`, the address is
 * already paying) has to leave by throwing or the writes that preceded it —
 * critically, the claim itself — would commit. Returning a discriminated union
 * from the callback would commit the claim on a row we then report as skipped,
 * which is R5.5 inverted.
 *
 * It is private to this file, is never an `HttpException`, and is caught
 * immediately outside the `$transaction` it was thrown through. It cannot reach
 * the client.
 */
class SkipRow extends Error {
  constructor(
    readonly outcome: Extract<
      WaitlistApprovalOutcome,
      'already_approved' | 'already_paid' | 'not_found'
    >,
    readonly row?: WaitlistApprovalRow,
  ) {
    super(`waitlist row skipped: ${outcome}`);
    this.name = 'SkipRow';
  }
}

/** What one committed row transaction hands back to the post-commit stage. */
interface CommittedGrant {
  row: WaitlistApprovalRow;
  licenseId: string;
  licenseKey: string;
  expiresAt: Date | null;
}

/**
 * WaitlistApprovalService — approve waitlist rows to the founding cohort
 * (TASK_2026_201 R1, R2, R5, R6, R7).
 *
 * One request, N grants. Each grant is: claim the waitlist row → find-or-create
 * the user → issue a free 1-year `builders` licence → assign the `founding`
 * cohort → write the `waitlist.approve` audit row, all inside ONE transaction
 * per row; then, AFTER COMMIT, one welcome email.
 *
 * ── WHY THE ENDPOINT IS ONE REQUEST DOING N GRANTS ─────────────────────────
 * The obvious client-side alternative — N calls to
 * `POST /v1/admin/licenses/complimentary` — is forbidden (R2 mechanism (c),
 * R8.5) for two independent reasons. That route is throttled at 20/min, so a
 * 25-row cohort trips at row 21 and strands a partial cohort nobody owns or
 * reports; and it issues a licence with NO cohort assignment, which is the
 * exact half-state R2 exists to eliminate.
 *
 * ── THE TRANSACTION BOUNDARY, STATED ONCE ──────────────────────────────────
 * INSIDE  (per row, atomic): claim · user · paid guard · licence · cohort · audit
 * OUTSIDE (post-commit):     the welcome email
 * OUTSIDE (once per request, before the loop): the `founding` group lookup
 *
 * Email is outside because it is different in KIND, not merely slower: Resend
 * cannot un-accept a message, and holding a transaction open across
 * `sendWithRetry`'s three attempts pins a connection for the retry window. A
 * committed grant with a failed mail is a real member who has not been told —
 * recoverable. A sent mail with a rolled-back grant is a promise the system
 * cannot honour. The ordering makes the second impossible.
 *
 * ── WHY THE RETRY WRAPS THE TRANSACTION RATHER THAN LIVING INSIDE IT ───────
 * On PostgreSQL any statement error inside an open transaction puts the session
 * into the aborted state (`25P02`), so a P2002 caught INSIDE the callback could
 * not be retried there — the next statement would fail with something unrelated
 * to a key collision while the code still LOOKED like it retried.
 * {@link LicenseService.withLicenseKeyRetry} therefore wraps the whole
 * `$transaction` call. It also buys R5.6 for free: a re-entered attempt starts
 * from a fully rolled-back predecessor, so two licences are unreachable.
 */
@Injectable()
export class WaitlistApprovalService {
  private readonly logger = new Logger(WaitlistApprovalService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LicenseService) private readonly license: LicenseService,
    @Inject(WaitlistService) private readonly waitlist: WaitlistService,
    // ⚠️ REQUIRED — NO `@Optional()`, AND THE CONTRAST IS DELIBERATE.
    // `AdminService` injects this same service with `@Optional()` because it
    // uses it for a DEGRADABLE stats read: an empty group list is a slightly
    // poorer dashboard. Here an unbound cohort service would mean licences
    // issued with nobody placed in the cohort — precisely the half-state R2
    // forbids — so a wiring mistake must fail at BOOT, loudly, rather than
    // silently downgrade every grant at runtime. `MemberGroupsModule` is
    // `@Global()`, so no import edge is needed to satisfy it.
    @Inject(MemberGroupsService)
    private readonly memberGroups: MemberGroupsService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Approve every id in `ids`, sequentially and independently.
   *
   * @throws InternalServerErrorException `COHORT_NOT_CONFIGURED` when the
   *   `founding` group does not exist — raised BEFORE the loop, so no licence
   *   is issued for ANY row (R1.5). This is the one failure that is not a
   *   per-row outcome, because it is not a property of any row.
   */
  async approve(
    ids: readonly string[],
    actor: AdminActor,
  ): Promise<WaitlistApprovalResponse> {
    // ── ONCE PER REQUEST, BEFORE THE LOOP (R1.5) ───────────────────────────
    // Hard-fails with a sanitized 500 if the cohort is not provisioned. Doing
    // this per row would issue licences for rows 1..k-1 and then fail — the
    // partial cohort R1.5 exists to prevent. There is NO `isDefault` fallback,
    // here or in `requireGroupByKey`: the day a second group is flagged default
    // a fallback would silently retarget every founding approval into it, with
    // no error and no log.
    const foundingGroup =
      await this.memberGroups.requireGroupByKey(FOUNDING_GROUP_KEY);

    const results: WaitlistApprovalRowResult[] = [];

    // Sequential, never `Promise.all`: 50 concurrent INTERACTIVE transactions
    // would exhaust the connection pool, and per-row ISOLATION is the point
    // here, not per-row parallelism. 50 × ~200 ms ≈ 10 s, inside the 30 s NFR.
    for (const id of ids) {
      results.push(await this.approveOne(id, foundingGroup.id, actor));
    }

    const tally = this.tally(results);

    // R7.5 — the wave summary. No licence key, no licence id: this line is the
    // shape of the wave, and the per-row lines above carry the specifics.
    this.logger.log(
      `Waitlist approve wave: actor=${actor.email} requested=${ids.length} ` +
        WAITLIST_APPROVAL_OUTCOMES.map((o) => `${o}=${tally[o]}`).join(' '),
    );

    return { requested: ids.length, tally, results };
  }

  /**
   * One row: the transaction, the retry around it, and the post-commit mail.
   * Never throws — every failure becomes this row's outcome, so row 3 of 10
   * cannot take rows 4–10 down with it (R2.4).
   */
  private async approveOne(
    id: string,
    foundingGroupId: string,
    actor: AdminActor,
  ): Promise<WaitlistApprovalRowResult> {
    // Computed BEFORE the transaction opens: it is the one step that can throw
    // a 400, and a 400 must precede every write. For the fixed `'1y'` preset it
    // cannot actually throw — resolving it through the shared definition rather
    // than re-deriving `365 * DAY_MS` here is the point (one definition of a
    // year for both complimentary paths).
    const expiresAt = this.license.computeComplimentaryExpiresAt(
      APPROVAL_DURATION_PRESET,
      undefined,
      new Date(),
    );

    let committed: CommittedGrant;
    try {
      committed = await this.license.withLicenseKeyRetry(() =>
        this.prisma.$transaction((tx) =>
          this.grantInTx(tx, id, foundingGroupId, actor, expiresAt),
        ),
      );
    } catch (error: unknown) {
      if (error instanceof SkipRow) {
        // The transaction rolled back, so NOTHING persisted — including the
        // claim (R5.5). No audit row, no mail (R7.3).
        this.logRow(actor, id, error.row?.email ?? null, error.outcome, null);
        return {
          id,
          email: error.row?.email ?? null,
          outcome: error.outcome,
          ...(error.row ? { wasNotified: error.row.notifiedAt !== null } : {}),
        };
      }

      // Everything else: a real failure. The row rolled back in full.
      // The cause is logged here and ONLY here — the client gets a code.
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Waitlist approve FAILED after up to ${MAX_GRANT_ATTEMPTS} attempts: ` +
          `actor=${actor.email} waitlistId=${id} cause=${message}`,
      );
      this.logRow(actor, id, null, 'failed', null);
      return {
        id,
        email: null,
        outcome: 'failed',
        error: { code: 'GRANT_FAILED' },
      };
    }

    // ── POST-COMMIT, OUTSIDE THE TRANSACTION (R2.3, R3.3) ──────────────────
    // Exactly one outbound message per approval. Suppression of the separate
    // `sendLicenseKey` mail is STRUCTURAL, not conditional: the licence core
    // has no mail side effect at all, and this is the only send on this path.
    // There is no `sendEmail` flag here and none may be added — a flag would be
    // a second, silently-flippable way to send an approved member two
    // contradictory messages.
    const result: WaitlistApprovalRowResult = {
      id,
      email: committed.row.email,
      outcome: 'approved',
      licenseId: committed.licenseId,
      wasNotified: committed.row.notifiedAt !== null,
    };

    try {
      await this.email.sendFoundingCohortWelcome({
        email: committed.row.email,
        licenseKey: committed.licenseKey,
        expiresAt: committed.expiresAt,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // ⚠️ The interpolated values here are the address, the waitlist id and the
      // provider's message — never `committed.licenseKey` (R7.4).
      this.logger.error(
        `Founding cohort welcome FAILED to send (the grant is committed and ` +
          `stands): actor=${actor.email} waitlistId=${id} ` +
          `email=${committed.row.email} cause=${message}`,
      );
      result.warning = { code: 'APPROVAL_EMAIL_FAILED' };
    }

    this.logRow(
      actor,
      id,
      committed.row.email,
      'approved',
      committed.licenseId,
    );
    return result;
  }

  /**
   * The atomic half. Runs entirely on `tx`; touches `this.prisma` nowhere.
   *
   * Order is load-bearing:
   *   1. claim  — the FIRST WRITE, and the idempotency key (R5)
   *   2. user   — find-or-create, on `tx`, so a rollback removes a user we made
   *   3. guard  — already paying? skip without granting (R5.4)
   *   4. licence
   *   5. cohort
   *   6. audit  — inside the boundary, NO try/catch (R2.2, PRE-6)
   */
  private async grantInTx(
    tx: Prisma.TransactionClient,
    id: string,
    foundingGroupId: string,
    actor: AdminActor,
    expiresAt: Date | null,
  ): Promise<CommittedGrant> {
    // ── 1. THE CONDITIONAL CLAIM ───────────────────────────────────────────
    // `UPDATE waitlist SET approved_at = now() WHERE id = ? AND approved_at IS NULL`
    // THE WAITLIST ROW IS THE IDEMPOTENCY KEY, NOT THE LICENCE TABLE. A "does
    // this user already hold a licence?" check would NOT close this: the
    // complimentary conflict guard filters `source: { not: 'complimentary' }`,
    // so a second comp licence stacks silently with no 409 and no warning.
    const claim = await this.waitlist.claimForApproval(tx, id);
    if (claim.outcome === 'not_found') {
      throw new SkipRow('not_found');
    }
    if (claim.outcome === 'already_approved') {
      throw new SkipRow('already_approved', claim.row);
    }
    const row = claim.row;

    // ── 2. RECIPIENT ───────────────────────────────────────────────────────
    const { user, created: userWasCreated } =
      await this.license.findOrCreateUserByEmail(row.email, tx);

    // ── 3. ALREADY-PAYING GUARD (R5.4) ─────────────────────────────────────
    if (await this.holdsPaidEntitlement(tx, user.id)) {
      throw new SkipRow('already_paid', row);
    }

    // ── 4. THE LICENCE, THROUGH THE SHARED CORE ────────────────────────────
    // `stackOnTopOfPaid` is NOT passed, here or anywhere on this path (R5.4).
    // Step 3 has already established there is nothing to stack on top of; the
    // core's own `EXISTING_ACTIVE_LICENSE` guard is the second line of defence
    // and is left armed on purpose.
    const license = await this.license.issueComplimentaryLicenseTx(tx, {
      user,
      plan: 'builders',
      durationPreset: APPROVAL_DURATION_PRESET,
      expiresAt,
      createdBy: actor.email,
      actor,
      reason: APPROVAL_REASON,
    });

    // ── 5. COHORT ──────────────────────────────────────────────────────────
    const { created: cohortCreated } = await this.memberGroups.assignInTx(tx, {
      userId: user.id,
      groupId: foundingGroupId,
      source: 'admin',
    });

    // ── 6. AUDIT, INSIDE THE BOUNDARY (R2.2, R7.1, PRE-6) ──────────────────
    // No `try/catch`. If this write fails the whole grant rolls back, which is
    // the correct trade HERE and the opposite of the deleted invite writer's:
    // that one swallowed audit failures because the invite mail had already
    // gone out and an unrecorded sent mail beats an un-sent one. Here nothing
    // has gone out — the welcome mail is post-commit — so an unrecorded grant
    // has no upside at all.
    await this.auditLog.write({
      tx,
      actorEmail: actor.email,
      action: 'waitlist.approve',
      targetType: 'Waitlist',
      targetId: row.id,
      metadata: {
        email: row.email,
        userId: user.id,
        userWasCreated,
        licenseId: license.id,
        durationPreset: APPROVAL_DURATION_PRESET,
        expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
        groupKey: FOUNDING_GROUP_KEY,
        // R6.2 — reported, never acted on. `notifiedAt` is not a precondition,
        // not a blocker, and is not written by anything in this transaction.
        wasNotified: row.notifiedAt !== null,
        cohortAlreadyAssigned: !cohortCreated,
      },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });

    return {
      row,
      licenseId: license.id,
      licenseKey: license.licenseKey,
      expiresAt: license.expiresAt,
    };
  }

  /**
   * True when this user is ALREADY a paying member and must not be handed a
   * free grant (R5.4).
   *
   * Two clauses, read through `tx` so both see the same snapshot as the rest of
   * the transaction:
   *
   *  1. an active NON-complimentary `builders` licence — R5.4 verbatim;
   *  2. a subscription in {@link PAYING_SUBSCRIPTION_STATUSES} — a DELIBERATE
   *     SUPERSET, and it is not scope creep. `MembershipService.isBuildersMember`
   *     checks the SUBSCRIPTION FIRST, so a Paddle subscriber whose licence row
   *     is missing or mis-sourced is already a paying member by the platform's
   *     own definition. Without this clause that person gets a free year and a
   *     "you're in, it's free" mail on top of a subscription they are paying
   *     for. The clause never contradicts R5.4 — it only widens `already_paid`
   *     — and costs one indexed read per row.
   */
  private async holdsPaidEntitlement(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const paidLicense = await tx.license.findFirst({
      where: {
        userId,
        status: 'active',
        plan: 'builders',
        source: { not: 'complimentary' },
      },
      select: { id: true },
    });
    if (paidLicense) {
      return true;
    }

    const subscription = await tx.subscription.findFirst({
      where: { userId, status: { in: [...PAYING_SUBSCRIPTION_STATUSES] } },
      select: { id: true },
    });
    return subscription !== null;
  }

  /**
   * The per-row structured line (R7.5). `licenseId` — never `licenseKey`
   * (R7.4). `email` is null only where the row was never resolved.
   */
  private logRow(
    actor: AdminActor,
    waitlistId: string,
    email: string | null,
    outcome: WaitlistApprovalOutcome,
    licenseId: string | null,
  ): void {
    this.logger.log(
      `Waitlist approve row: actor=${actor.email} waitlistId=${waitlistId} ` +
        `email=${email ?? 'unknown'} outcome=${outcome} licenseId=${licenseId ?? 'none'}`,
    );
  }

  /** All five keys always present, zeros included. */
  private tally(
    results: readonly WaitlistApprovalRowResult[],
  ): Record<WaitlistApprovalOutcome, number> {
    const tally = Object.fromEntries(
      WAITLIST_APPROVAL_OUTCOMES.map((outcome) => [outcome, 0]),
    ) as Record<WaitlistApprovalOutcome, number>;
    for (const result of results) {
      tally[result.outcome] += 1;
    }
    return tally;
  }
}
