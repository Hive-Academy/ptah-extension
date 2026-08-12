import { z } from 'zod';

import { SESSION_REQUEST_STATUSES } from '../shared/session-request-status';
import type { SessionRequestStatus } from '../shared/session-request-status';

/**
 * MEMBER-facing private-session request contract — R4, plan §3.5.
 *
 * ⚠️ THE SECOND RK-8 PAIR. {@link MemberSessionRequest} and `AdminSessionRequest`
 * (`../admin/admin-session-request.contract.ts`) are adjacent, independent
 * declarations with NO `extends` between them, for the same reason
 * `MemberPack` / `AdminPack` are: the admin shape carries billing internals and
 * the requester's identity, and an `extends` would widen the member response
 * into both with a one-line edit.
 *
 * `contract-boundary.spec.ts` asserts this structurally, in both directions.
 */

/**
 * A member's own private-session request — `GET /v1/members/session-requests`.
 *
 * ⚠️ OWN ONLY (R4.3). This endpoint never returns another member's request,
 * and this type could not carry one usefully anyway: it has no requester field.
 *
 * ⚠️ FIELD ABSENCE IS THE CONTRACT (NFR-S4). Deliberately absent, all present
 * on the admin shape:
 *   - `userId` / requester identity — the member already knows who they are.
 *   - `paymentStatus`, `paddleTransactionId`, `isFreeSession` — billing
 *     internals. A transaction id on a member-facing response is a
 *     payment-system identifier in a browser's network tab.
 *   - `calendarEventId` — an internal Google handle. The member needs
 *     {@link meetLink}, which is the thing they actually click; the event id
 *     grants nothing but names an internal record.
 */
export interface MemberSessionRequest {
  id: string;
  /** The topic the member selected when requesting. */
  sessionTopicId: string;
  additionalNotes: string | null;
  status: SessionRequestStatus;
  /** ISO 8601. `null` until an admin accepts and schedules. */
  scheduledAt: string | null;
  /** `null` until accepted; set from the admin's accept payload. */
  durationMinutes: number | null;
  /**
   * Resolved from the created event's `hangoutLink` / `conferenceData`
   * (R4.1, PRE-5) — never from a Meet API. `null` until accepted.
   *
   * An accept that creates an event but cannot resolve this link fails with
   * `502 { reason: 'meet_link_unresolved' }` and DELETES the orphan event, so a
   * `scheduled` request with a `null` meetLink is unrepresentable.
   */
  meetLink: string | null;
  /** Admin-supplied reason on decline. Member-visible by design (R4.8). */
  declineReason: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberSessionRequestSchema = z.object({
  id: z.string(),
  sessionTopicId: z.string(),
  additionalNotes: z.string().nullable(),
  status: z.enum(SESSION_REQUEST_STATUSES),
  scheduledAt: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  meetLink: z.string().nullable(),
  declineReason: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<MemberSessionRequest>;
