import { z } from 'zod';

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_TARGET_TYPES,
} from '../shared/notification-kind';
import type {
  NotificationKind,
  NotificationTargetType,
} from '../shared/notification-kind';

/**
 * MEMBER-facing notification contracts — R10.
 *
 * ⚠️ No `admin/*` type may `extend` anything here, and nothing here may extend
 * an `admin/*` type. `contract-boundary.spec.ts` enforces both directions.
 *
 * Notifications have no admin counterpart by design: R10 describes a
 * member-owned inbox, and an admin "see everyone's notifications" surface is
 * not in scope. If one is ever added it goes in `admin/`, re-declared.
 *
 * PHASE 1 SCOPE. {@link HubNotificationSummary} is the hub's `notifications`
 * section payload — the only part Phase 1 emits (always
 * `{ status: 'empty', data: { unreadCount: 0 } }` until Batch 14 lands R10).
 * {@link MemberNotification} is declared alongside it because the badge
 * (R9.3 / R10.4) and the list (R10.3) are one contract and splitting them
 * across two batches is how the two halves drift.
 */

/**
 * The hub's `notifications` section, and the body of
 * `GET /v1/members/notifications/unread-count` — the ≥60 s poll target (AD-14,
 * R10.5).
 *
 * ⚠️ A COUNT, NOT A LIST. The poll runs every 60 s for every open tab; sending
 * notification bodies on that cadence would make the cheapest endpoint in the
 * product the most expensive one. The list is `GET /v1/members/notifications`,
 * fetched on navigation.
 *
 * ⚠️ Its own object rather than a bare `number` so Phase 5 can add a field
 * (e.g. a per-kind breakdown) without changing the hub envelope (R6.6).
 */
export interface HubNotificationSummary {
  unreadCount: number;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const hubNotificationSummarySchema = z.object({
  unreadCount: z.number().int(),
}) satisfies z.ZodType<HubNotificationSummary>;

/**
 * One notification in the member's inbox — `GET /v1/members/notifications`,
 * newest first (R10.3).
 */
export interface MemberNotification {
  id: string;
  kind: NotificationKind;
  /**
   * The member who caused it, for "X replied to your topic". `null` for
   * system-generated notifications (an announcement has no actor).
   *
   * ⚠️ NAME ONLY — never an email address. The actor is another member, and
   * their email is exactly the class of field NFR-S4 keeps off member-facing
   * responses.
   */
  actorName: string | null;
  targetType: NotificationTargetType;
  targetId: string;
  title: string;
  /** A short plain-text excerpt. Never HTML — this string is not sanitized. */
  bodyPreview: string | null;
  /**
   * The `/members` deep link opening this notification navigates to (R10.3).
   *
   * ⚠️ STORED AT WRITE TIME, not derived at read time (plan §1.6). A routing
   * change must not orphan historical notifications, and re-deriving a route
   * from a `targetType`/`targetId` pair fails the moment the target is
   * soft-deleted or re-slugged.
   */
  route: string;
  /** ISO 8601, or `null` while unread. Opening a notification marks it read. */
  readAt: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberNotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  actorName: z.string().nullable(),
  targetType: z.enum(NOTIFICATION_TARGET_TYPES),
  targetId: z.string(),
  title: z.string(),
  bodyPreview: z.string().nullable(),
  route: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<MemberNotification>;
