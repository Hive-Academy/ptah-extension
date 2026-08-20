/**
 * Response contract for `POST /api/v1/admin/waitlist/approve`
 * (TASK_2026_201 R1, R2.5, R5, R6.2, R7.4 · implementation-plan.md §4).
 *
 * ⚠️ NO LICENCE KEY APPEARS ANYWHERE IN THIS PAYLOAD. `licenseId` is the row's
 * primary key and is safe; `License.licenseKey` is the member's credential and
 * travels in exactly one place — the welcome email. The same prohibition covers
 * the `waitlist.approve` audit metadata and every log line this path emits.
 *
 * ⚠️ WHY THESE TYPES LIVE HERE AND NOT IN `libs/api-contracts/community`.
 * That lib is the COMMUNITY domain (forum, courses, sessions, packs,
 * notifications) and carries an executable boundary guard
 * (`contract-boundary.spec.ts`) asserting its `member/` and `admin/` halves
 * never reference each other and that it imports nothing else. A waitlist
 * approval is not a community contract, and widening the lib to hold one
 * dilutes a boundary that has a test on it. The established convention for THIS
 * surface is the opposite and is followed here: the server declares the
 * response type next to the handler (exactly as `AdminStatsResponse` is
 * declared in `admin.service.ts` and consumed by `AdminStatsController`), and
 * the admin client re-declares it as a Zod schema validated at its own
 * boundary.
 */

/**
 * Every outcome one waitlist row can reach. Exhaustive and closed — the tally
 * in {@link WaitlistApprovalResponse} is keyed by exactly these values, so a
 * new outcome cannot be added without the client's Zod enum failing loudly.
 */
export const WAITLIST_APPROVAL_OUTCOMES = [
  'approved',
  'already_approved',
  'already_paid',
  'not_found',
  'failed',
] as const;

export type WaitlistApprovalOutcome =
  (typeof WAITLIST_APPROVAL_OUTCOMES)[number];

/**
 * Stable, client-safe failure codes (R2.5, R8.6).
 *
 * A CODE, never a message. Prisma error text names columns and constraints,
 * Resend error text names infrastructure, and both would reach an admin browser
 * — and from there a screenshot — if they were forwarded. The diagnosable cause
 * goes to `logger.error` server-side; the client gets this.
 */
export type WaitlistApprovalErrorCode = 'GRANT_FAILED';

/**
 * The result of ONE waitlist id in the request array. Rows are independent:
 * one row's failure never changes another row's outcome, and never changes the
 * HTTP status (R1.6, R2.4).
 */
export interface WaitlistApprovalRowResult {
  /** The waitlist id as requested, echoed verbatim so the client can join. */
  id: string;
  /**
   * Null ONLY for `not_found` — that id matched no row, so no address was ever
   * learned. Every other outcome carries the row's stored address.
   */
  email: string | null;
  outcome: WaitlistApprovalOutcome;
  /**
   * Present iff `outcome === 'approved'`. The `License` row's id — NEVER its
   * `licenseKey` (R7.4).
   */
  licenseId?: string;
  /**
   * R6.2 — whether this row had been sent the withdrawn paid invite
   * (`notifiedAt` non-null) at approval time. Absent for `not_found`, where
   * there was no row to read it from. Reported, never acted on: `notifiedAt` is
   * not a precondition, not a blocker and is never modified by approval (R6.1).
   */
  wasNotified?: boolean;
  /**
   * R2.3 — the grant COMMITTED and the welcome mail did not go out. The outcome
   * stays `approved` because the member is real; re-sending the mail is a
   * recovery, rolling back a committed grant is not. Code only: the provider's
   * message is logged server-side.
   */
  warning?: { code: 'APPROVAL_EMAIL_FAILED' };
  /**
   * R2.5 / R8.6 — the row rolled back. Code only, and deliberately UNLIKE
   * `ComplimentaryLicenseResult.warning` (`license.service.ts:41`), which
   * carries a raw provider string. That type belongs to a different endpoint,
   * predates this rule and is out of scope here; it is not changed and it is
   * not a precedent to copy.
   */
  error?: { code: WaitlistApprovalErrorCode };
}

/**
 * The whole response. Always HTTP `200` when the request validated and the
 * cohort resolved — per-row failures are reported in `results`, not as a status
 * (R1.6, R2.4).
 */
export interface WaitlistApprovalResponse {
  /** `ids.length` as received. Equals `results.length` by construction. */
  requested: number;
  /**
   * One count per outcome, always all five keys present (zeros included) so the
   * admin UI can render a fixed summary without null-checking each stage.
   */
  tally: Record<WaitlistApprovalOutcome, number>;
  /** One entry per requested id, in request order. */
  results: WaitlistApprovalRowResult[];
}
