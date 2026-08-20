import type { SessionRequestStatus } from '../shared/session-request-status';

/**
 * ADMIN-facing private-session request contract — R4.4, R4.7, plan §3.5.
 *
 * ⚠️ The second half of the RK-8 pair with
 * `../member/member-session-request.contract.ts`. Adjacent, independent, no
 * `extends` in either direction — `contract-boundary.spec.ts` enforces it.
 *
 * ⚠️ NOTE WHAT THIS FILE DOES **NOT** IMPORT. The shared lifecycle vocabulary
 * comes from `../shared/session-request-status`, not from the member contract
 * that also uses it. `member/` and `admin/` never import each other, in either
 * direction, with no exceptions — a string union is a vocabulary and lives in
 * `shared/`; an object type is a payload and is re-declared on each side.
 */

/**
 * A private-session request as an admin sees it —
 * `GET /v1/admin/session-requests`, and the body returned by
 * `accept` / `reschedule` / `decline`.
 *
 * ⚠️ EVERYTHING HERE THAT IS NOT ON `MemberSessionRequest` IS DELIBERATE:
 *   - {@link requester} — R4.4's queue is unusable without knowing who asked.
 *     The member's own view needs no such field; adding one there would put
 *     another member's identity on a member-facing response (NFR-S4).
 *   - {@link paymentStatus} / {@link paddleTransactionId} / {@link isFreeSession}
 *     — billing internals. A payment-system identifier belongs in an admin
 *     console, not a member's network tab.
 *   - {@link calendarEventId} — the internal Google handle. `reschedule` patches
 *     the event BY THIS ID rather than by a fuzzy `(title, startsAt)` match, and
 *     its `@unique` constraint makes "two requests reconciled to one event" —
 *     the defect R4.6 names — unrepresentable.
 */
export interface AdminSessionRequest {
  id: string;
  /** The requesting `User.id`. */
  userId: string;
  /**
   * Denormalised requester identity for the queue (R4.4).
   *
   * ⚠️ ADMIN-ONLY. This is the field whose member-side equivalent would leak
   * another member's email address — the precise harm
   * `AdminSession.attendees`' docblock describes, and the reason these two
   * types are not related by inheritance.
   */
  requester: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  sessionTopicId: string;
  additionalNotes: string | null;
  /** ADMIN-ONLY billing internal. */
  isFreeSession: boolean;
  status: SessionRequestStatus;
  /** ADMIN-ONLY billing internal: `none` | `pending` | `completed`. */
  paymentStatus: string;
  /** ADMIN-ONLY billing internal. `null` for free sessions. */
  paddleTransactionId: string | null;
  /**
   * ADMIN-ONLY. The Google Calendar event created at accept time.
   * `null` while `pending`; Postgres treats NULLs as distinct, so pending
   * requests are unconstrained by the `@unique` index.
   */
  calendarEventId: string | null;
  /**
   * Resolved from the created event's `hangoutLink` / `conferenceData`
   * (R4.1, PRE-5). NEVER from a Meet API — none is called and none is built.
   */
  meetLink: string | null;
  /** ISO 8601. `null` while `pending`. */
  scheduledAt: string | null;
  /** Admin-supplied at accept time; needed to rebuild `endsAt` on reschedule. */
  durationMinutes: number | null;
  /** Optional admin reason. Member-visible (R4.8). */
  declineReason: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}
