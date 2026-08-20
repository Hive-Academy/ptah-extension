/**
 * Private-session request lifecycle — R4, matching the persisted
 * `SessionRequest.status` column.
 *
 * ⚠️ WHY THIS IS IN `shared/` AND NOT NEXT TO `MemberSessionRequest`.
 * Both the member contract and the admin contract need it, and `member/` and
 * `admin/` are FORBIDDEN from importing each other — with no exceptions, in
 * either direction (`contract-boundary.spec.ts`). A shared vocabulary that
 * lived on one side would force the first exception into that rule, and a rule
 * whose value is that it has no exceptions cannot afford one. Vocabularies live
 * here; payload shapes live on their own side and are re-declared.
 *
 * A string union carries no fields, so sharing it cannot widen either response
 * — which is exactly the property that makes it a vocabulary and not a payload.
 */

/** The runtime list, in lifecycle order. */
export const SESSION_REQUEST_STATUSES = [
  /** Submitted, awaiting an admin decision. R4.4 queues these oldest-first. */
  'pending',
  /** Accepted: a Calendar event exists and `meetLink` is resolved. */
  'scheduled',
  /** The session happened. */
  'completed',
  /** Declined by an admin, or canceled by the member while still `pending`. */
  'canceled',
] as const;

export type SessionRequestStatus = (typeof SESSION_REQUEST_STATUSES)[number];

/** Runtime narrowing for the persisted `status` column read back in. */
export function isSessionRequestStatus(
  value: unknown,
): value is SessionRequestStatus {
  return (SESSION_REQUEST_STATUSES as readonly unknown[]).includes(value);
}
