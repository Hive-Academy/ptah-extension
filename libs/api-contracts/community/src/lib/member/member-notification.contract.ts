import { z } from 'zod';

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_TARGET_TYPES,
} from '../shared/notification-kind';
import type {
  NotificationKind,
  NotificationTargetType,
} from '../shared/notification-kind';
import { MAX_PAGE_SIZE } from '../shared/paged';

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
 * WHAT SHIPS. Both types below are BACKED BY A REAL TABLE as of Phase 5
 * (`member_notifications`, migration
 * `20260902090000_packs_visibility_and_notifications`).
 * {@link HubNotificationSummary} is the hub's `notifications` section payload
 * AND the body of `GET /v1/members/notifications/unread-count`;
 * {@link MemberNotification} is one row of `GET /v1/members/notifications`.
 * The two were declared together in Phase 1, before either had a producer,
 * because the badge (R9.3 / R10.4) and the list (R10.3) are one contract and
 * splitting them across two batches is how the two halves drift.
 *
 * ⚠️ THE HUB SECTION'S `status` IS DERIVED FROM THE DATA, NOT PINNED. Phase 1
 * emitted a hard-coded `{ status: 'empty', data: { unreadCount: 0 } }` because
 * there was no table to read. Phase 5 replaces the constant with a count — it
 * does NOT replace it with a hard-coded `'ok'`. `HUB_SECTION_STATUSES` is
 * `'ok' | 'empty' | 'unavailable'`, and a member with nothing unread is
 * honestly `'empty'`. Pinning the status to `'ok'` would be a new lie standing
 * where the old one stood.
 *
 * ⚠️ FOUR OF THE FIVE {@link NotificationKind}S HAVE A PRODUCER. `announcement`
 * is declared, accepted by the service, and written by nothing: R10.1's
 * admin-publish action has no admin surface in this task (RK-1), and a producer
 * for an action nobody can take is dead code. The kind stays in the enum.
 *
 * ⚠️ THE THREE WRITE ENDPOINTS HAVE NO RESPONSE CONTRACT HERE, DELIBERATELY.
 * `POST :id/read` returns `{ readAt }`, and `POST read` and `POST read-all`
 * both return `{ marked }`, but the client treats all three as
 * FIRE-AND-REFETCH: it decrements optimistically and then re-reads the count
 * from `GET .../unread-count`, which is the only writer of the badge. Nothing
 * parses any of those bodies, so declaring schemas for them would add exported
 * symbols with no boundary to guard. If a client ever reads one of those
 * bodies, the contract is added THEN, in the change that reads it.
 *
 * ⚠️ {@link MarkNotificationsReadRequest} IS A REQUEST SHAPE AND HAS NO ZOD
 * SCHEMA, FOR THE SAME REASON READ BACKWARDS. A client does not parse its own
 * outgoing body; the boundary that has to reject a malformed one is the
 * SERVER's, and there it is `MarkNotificationsReadDto` bound with `dtoPipe`
 * (`libs/api/notifications`). The type is declared here so the field name and
 * {@link MAX_BULK_MARK_READ_IDS} are single-sourced across the two sides — the
 * two things that CAN drift — and nothing more.
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

/**
 * The largest selection `POST /v1/members/notifications/read` will accept.
 *
 * 🔴 AN UNBOUNDED ID ARRAY IS A DoS VECTOR, AND THE BOUND IS NOT AN ARBITRARY
 * ROUND NUMBER. It is {@link MAX_PAGE_SIZE} — DERIVED, not copied — because the
 * only honest way a member produces a selection is by ticking rows that are on
 * screen, and the inbox cannot render more than one page at a time. A request
 * naming more ids than the largest page the same API will serve is not a
 * selection; it is a client that has stopped describing what the member did.
 *
 * Deriving it also means the two numbers cannot drift into disagreement: raise
 * the page ceiling and the largest possible selection follows it by
 * construction, with no second edit to forget.
 *
 * ⚠️ A member who wants their WHOLE inbox marked read has `POST read-all`,
 * which takes no ids at all and is not bounded by this. This cap constrains
 * "these N", never "all".
 */
export const MAX_BULK_MARK_READ_IDS = MAX_PAGE_SIZE;

/**
 * The body of `POST /v1/members/notifications/read` — mark exactly the named
 * notifications read (R10.4).
 *
 * ⚠️ WHY THIS ENDPOINT EXISTS AT ALL. Before it there were two writes: one row
 * (`POST :id/read`) and THE WHOLE INBOX (`POST read-all`). A selection toolbar
 * — a control whose entire semantic is "act on the N things I selected" — could
 * be served by neither: `read-all` marks rows the member never selected,
 * including rows on pages they have never seen, and nothing can un-read a row,
 * so that over-reach is permanent. N separate `:id/read` calls were correct and
 * cost N round trips.
 *
 * ⚠️ `ids` IS NEVER EMPTY, AND THE SERVER REJECTS AN EMPTY ARRAY WITH A `400`
 * RATHER THAN TREATING IT AS A NO-OP. The toolbar renders nothing at zero
 * selected, so an empty array is a client bug — but that is the smaller half of
 * the reason. The larger half is that "these, where these is empty" is the one
 * phrasing that could ever be re-read as "all", and conflating those two is
 * precisely the irreversible mistake this endpoint was added to make
 * impossible. Refusing it closes that door permanently instead of documenting
 * it shut.
 *
 * ⚠️ AN ID THAT DOES NOT EXIST, IS ALREADY READ, OR BELONGS TO ANOTHER MEMBER
 * IS NOT AN ERROR. It contributes zero to `marked` and the call still answers
 * `200`. A per-id failure report would tell a caller which of the ids they
 * guessed are real — an existence oracle over guessable cuids, and the same
 * reason `POST :id/read` answers `{ readAt: null }` for both a missing id and
 * someone else's.
 */
export interface MarkNotificationsReadRequest {
  /**
   * The notification ids to mark read. 1..{@link MAX_BULK_MARK_READ_IDS}
   * entries. Duplicates are harmless — the server matches with a set `in`, so a
   * repeated id is counted once.
   */
  ids: string[];
}
