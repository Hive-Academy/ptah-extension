import type { MemberNotification, Paged } from '@ptah-contracts/community';

/**
 * Notification fixtures — the shape the LIVE server actually returned.
 *
 * ⚠️ CAPTURED, NOT INVENTED. Every default below was copied from a real
 * `GET /api/v1/members/notifications` body produced on `:3011` at commit
 * `54650edee` by driving the real producer: member B posted a real reply to a
 * real topic member A authored, over HTTP, and this is what member A read back.
 * A hand-written fixture is how a client ends up correct about a response no
 * endpoint produces.
 *
 * ⚠️ `actorName` IS `'Grace'` AND THAT IS A MEASURED FACT, NOT A GUESS. The
 * seeded user had `first_name = 'Grace'` and `last_name = NULL`, and the server
 * composed a bare first name rather than falling back to an email — the case
 * B14's ASSUMPTION-22 flagged. It is NEVER an email address (NFR-S4).
 *
 * ⚠️ `bodyPreview` CARRIES LITERAL MARKDOWN AND IT IS NOT SANITIZED. The live
 * body contained `**Grace here** — …` with the asterisks intact. It is rendered
 * as an ESCAPED TEXT NODE and never through a renderer (NFR-S2, B14 ground
 * truth 4), so the fixture keeps the asterisks: a fixture of plain prose would
 * make an `[innerHTML]` regression invisible.
 */
export function memberNotification(
  overrides: Partial<MemberNotification> = {},
): MemberNotification {
  return {
    id: 'cmsnaworh0001u0bi8w9c0yv8',
    kind: 'topic.reply',
    actorName: 'Grace',
    targetType: 'Topic',
    targetId: 'b15a_topic',
    title: 'New reply to your topic',
    bodyPreview: '**Grace here** — a real reply driving the real producer.',
    route: '/members/community/topics/b15a-topic',
    readAt: null,
    createdAt: '2026-08-10T14:02:38.814Z',
    ...overrides,
  };
}

/**
 * A page of notifications in the live envelope.
 *
 * ⚠️ THE DEFAULTS ARE THE SERVER'S ECHOED ONES — `page: 1`, `pageSize: 25`.
 * Measured, not assumed: a request with no parameters came back
 * `{"page":1,"pageSize":25,"total":1,"hasMore":false}`. The client never
 * hard-codes 25 anywhere; it reads whatever the server says it used.
 */
export function notificationPage(
  items: MemberNotification[] = [memberNotification()],
  overrides: Partial<Paged<MemberNotification>> = {},
): Paged<MemberNotification> {
  return {
    items,
    page: 1,
    pageSize: 25,
    total: items.length,
    hasMore: false,
    ...overrides,
  };
}

/** The live empty inbox, exactly as the server answered before any producer ran. */
export function emptyNotificationPage(): Paged<MemberNotification> {
  return { items: [], page: 1, pageSize: 25, total: 0, hasMore: false };
}
