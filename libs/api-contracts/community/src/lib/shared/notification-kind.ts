/**
 * In-app notification kinds — R10.1, plan §1.6.
 *
 * Five kinds, no more. Each names the event that CREATES the notification, and
 * each maps to exactly one `targetType` so `route` can be built deterministically
 * at write time (plan §1.6 stores `route` rather than deriving it, so a routing
 * change never orphans historical rows).
 *
 * ⚠️ In-app only. R10.5 and §5 forbid email, websocket and SSE transports for
 * notifications; the badge is refreshed on navigation plus a ≥60 s poll of
 * `GET /v1/members/notifications/unread-count` (AD-14).
 *
 * ⚠️ R10.2: a member never gets a notification for their own action. That is a
 * producer-side rule, but it is recorded here because the kinds are what a
 * reader sees and "why did I get notified about my own reply" is the bug it
 * prevents.
 */

/** The runtime list. */
export const NOTIFICATION_KINDS = [
  /** Someone replied to a topic you authored. Target: `Topic`. */
  'topic.reply',
  /** Someone replied to a reply you authored. Target: `Post`. */
  'post.child_reply',
  /** Your reply was marked as the accepted answer. Target: `Post`. */
  'post.accepted',
  /** Your private-session request changed status. Target: `SessionRequest`. */
  'session_request.status',
  /** An admin published an announcement. Target: `LiveSession`. */
  'announcement',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * The entity a notification points at. Stored alongside `targetId` so a
 * notification survives its source being renamed or re-slugged.
 */
export const NOTIFICATION_TARGET_TYPES = [
  'Topic',
  'Post',
  'SessionRequest',
  'LiveSession',
] as const;

export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number];

/** Runtime narrowing for a persisted `kind` column read back into TypeScript. */
export function isNotificationKind(value: unknown): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly unknown[]).includes(value);
}
