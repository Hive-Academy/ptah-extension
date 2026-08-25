import type { NotificationTargetType } from '@ptah-contracts/community';

/**
 * The stored `route` — R10.3, plan §1.6, **RISK-AJ**.
 *
 * ── 🔴 WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────
 * `Notification.route` is written once, by a producer, and read back months
 * later by a client that calls `router.navigateByUrl(notification.route)`. Both
 * halves of that sentence are dangerous:
 *
 *   1. **It is frozen.** Plan §1.6 stores the route rather than deriving it at
 *      read time on purpose — re-deriving from a `targetType`/`targetId` pair
 *      breaks the moment the target is soft-deleted or re-slugged. The upside is
 *      that historical notifications keep working; the downside is that a bad
 *      value written today is still in the table in 2027 and no deploy fixes it.
 *   2. **It is navigated to verbatim.** A producer that built the string by hand
 *      from a slug, with no constraint, could persist an ABSOLUTE URL, and the
 *      client's `navigateByUrl` would then be an open redirect — one that
 *      survives every future routing change, because the value is in the row.
 *
 * So the route is constructed in ONE function, and that function cannot return
 * a string that does not begin `/members/`:
 *
 *   - the prefix is a LITERAL in every branch, never interpolated;
 *   - every caller-supplied segment goes through `encodeURIComponent`, so a
 *     slug containing `/`, `?`, `#`, `..` or `https:` becomes an inert path
 *     segment rather than a new path, a new query or a new origin;
 *   - the return type is the template-literal type {@link MemberRoute}, so a
 *     branch that returned `'/admin/x'` would not compile.
 *
 * ⚠️ DEFENCE AT BOTH ENDS. The client (Task 15.4) additionally refuses any
 * stored `route` that does not start with `/members/`. That is not redundancy
 * for its own sake: this function guards rows written from now on, and the
 * client guard covers rows written by anything that ever bypasses it.
 *
 * ⚠️ IT RE-EXPORTS NOTHING FROM THE CONTRACTS LIB. `NotificationKind` and
 * `NotificationTargetType` are imported as TYPES from
 * `@ptah-contracts/community` and stay owned there — a second export site for a
 * vocabulary is a second place for it to drift.
 */

/**
 * Every route this function can produce, as a type.
 *
 * The template literal is the `satisfies`-style guard RISK-AJ asks for: it is
 * checked by the compiler at every `return` below, so "the route starts with
 * `/members/`" is a property of the FUNCTION rather than of a test that happens
 * to cover the branches someone remembered.
 */
export type MemberRoute = `/members/${string}`;

/**
 * The literal member routes a notification can point at, single-sourced.
 *
 * ⚠️ THESE MIRROR `libs/web/members/src/lib/members.routes.ts` AND THE MIRROR IS
 * MANUAL, because the two live on opposite sides of the frontend/backend
 * boundary and neither may import the other. The consequence is stated rather
 * than hidden: renaming a member route is a two-file change, and the second file
 * is this one. Historical rows keep the OLD string by design (see the file
 * docblock) — a route rename therefore needs a data migration or a client-side
 * redirect, and pretending otherwise is what "stored at write time" costs.
 */
const MEMBER_ROUTES = {
  /** `community/topics/:slug` — the thread page. */
  thread: (topicSlug: string): MemberRoute =>
    `/members/community/topics/${encodeURIComponent(topicSlug)}`,
  /** The private-session surface: submit a request, and see your own. */
  sessionRequests: '/members/live/request',
  /** The merged live/upcoming/replays feed. */
  live: '/members/live',
} as const satisfies Record<
  string,
  MemberRoute | ((...args: never[]) => MemberRoute)
>;

/**
 * What a producer knows about the thing it is notifying about.
 *
 * ⚠️ IT CARRIES SLUGS, NOT IDS, FOR ANYTHING THAT APPEARS IN A PATH. The member
 * route table is slug-addressed (`community/topics/:slug`), so a producer that
 * had only a `topicId` would have to look the slug up — and it does, at write
 * time, which is exactly when the slug is known to be current. `targetId` on the
 * row stays the ID, so the notification still identifies its target after a
 * re-slug even though the route no longer resolves.
 */
export interface NotificationRouteTarget {
  /** Required for `'Topic'` and `'Post'`. The thread the member lands in. */
  readonly topicSlug?: string;
  /**
   * Required for `'Post'`. Becomes the in-thread anchor, so a reply deep in a
   * long thread does not put the member at the top of it.
   *
   * ⚠️ THERE IS NO `/members/community/posts/:id` ROUTE AND ONE MUST NOT BE
   * INVENTED HERE. A post is not a page; it is a position in a thread.
   * `members.routes.spec.ts` enumerates the member route table in full and
   * fails the build on a route that is not in it (R9.4, RK-11), so a route
   * fabricated in this file would produce a stored deep link that 404s for
   * every member who clicks it — silently, and forever, because the string is
   * frozen in the row.
   */
  readonly postId?: string;
}

/**
 * Build the `/members` deep link a notification navigates to — the SINGLE place
 * a stored `route` is constructed (RISK-AJ).
 *
 * 🔴 IT THROWS RATHER THAN GUESSING. An unknown `targetType`, or a `'Topic'` /
 * `'Post'` with no `topicSlug`, is a producer bug, and the two ways of being
 * lenient are both worse than a throw:
 *
 *   - returning `'/members/'` or `'/members/hub'` writes a row that looks
 *     healthy and lands the member on the wrong screen with no way to find out
 *     what they were told about;
 *   - interpolating `undefined` writes `/members/community/topics/undefined`,
 *     which is a permanent 404 stored in a table nobody re-reads.
 *
 * The throw happens INSIDE the producer's transaction (ASSUMPTION-21), so a
 * malformed notification rolls back the reply it was about rather than being
 * committed beside it. That is the loud failure, in development, on the first
 * request — which is the only time it is cheap.
 */
export function buildNotificationRoute(
  targetType: NotificationTargetType,
  target: NotificationRouteTarget = {},
): MemberRoute {
  switch (targetType) {
    case 'Topic':
      return MEMBER_ROUTES.thread(requireTopicSlug(targetType, target));

    case 'Post': {
      const thread = MEMBER_ROUTES.thread(requireTopicSlug(targetType, target));
      if (!target.postId) {
        throw new Error(
          `buildNotificationRoute: targetType 'Post' requires a postId. A ` +
            `reply notification without one lands the member at the top of a ` +
            `thread that may be hundreds of posts long.`,
        );
      }
      // A FRAGMENT, not a path segment: `#post-<id>` scrolls the thread page to
      // the reply and needs no route of its own.
      return `${thread}#post-${encodeURIComponent(target.postId)}`;
    }

    case 'SessionRequest':
      return MEMBER_ROUTES.sessionRequests;

    case 'LiveSession':
      return MEMBER_ROUTES.live;

    default: {
      // Exhaustiveness, enforced by the compiler: adding a sixth
      // NOTIFICATION_TARGET_TYPE makes this assignment fail to typecheck, so the
      // new type cannot ship with no route.
      const unreachable: never = targetType;
      throw new Error(
        `buildNotificationRoute: unknown targetType ${JSON.stringify(
          unreachable,
        )}. Every NOTIFICATION_TARGET_TYPE must map to exactly one /members/ ` +
          `route; a notification with no destination is a badge the member ` +
          `cannot clear by reading it.`,
      );
    }
  }
}

function requireTopicSlug(
  targetType: NotificationTargetType,
  target: NotificationRouteTarget,
): string {
  if (!target.topicSlug) {
    throw new Error(
      `buildNotificationRoute: targetType '${targetType}' requires a ` +
        `topicSlug. Interpolating an absent one would store ` +
        `'/members/community/topics/undefined' — a permanent 404 frozen in a ` +
        `row nobody re-reads.`,
    );
  }
  return target.topicSlug;
}
