import {
  NOTIFICATION_TARGET_TYPES,
  type NotificationTargetType,
} from '@ptah-contracts/community';

import {
  buildNotificationRoute,
  type NotificationRouteTarget,
} from './notification-kinds';

/**
 * `buildNotificationRoute` — RISK-AJ.
 *
 * The property under test is not "the four routes are right"; it is **no input
 * can make this function return something that is not a `/members/` path**.
 * A stored `route` is navigated to verbatim by the client and is frozen in the
 * row forever, so an open redirect written here is an open redirect that no
 * deploy removes.
 */

/** The minimum each target type needs to produce a route at all. */
const SUFFICIENT: Record<NotificationTargetType, NotificationRouteTarget> = {
  Topic: { topicSlug: 'how-do-i-ship-faster' },
  Post: { topicSlug: 'how-do-i-ship-faster', postId: 'post_42' },
  SessionRequest: {},
  LiveSession: {},
};

describe('buildNotificationRoute', () => {
  describe('every NOTIFICATION_TARGET_TYPE maps to a /members/ route', () => {
    // Driven off the CONTRACT's runtime list, not a local copy: a sixth target
    // type added to the contract fails here rather than silently going
    // untested.
    it.each([...NOTIFICATION_TARGET_TYPES])(
      '%s produces a /members/-prefixed path',
      (targetType) => {
        const route = buildNotificationRoute(
          targetType,
          SUFFICIENT[targetType],
        );

        expect(route.startsWith('/members/')).toBe(true);
      },
    );

    it('covers all four types — the table above is not allowed to go stale', () => {
      expect(Object.keys(SUFFICIENT).sort()).toEqual(
        [...NOTIFICATION_TARGET_TYPES].sort(),
      );
    });

    it('produces the four routes the member route table actually declares', () => {
      expect(buildNotificationRoute('Topic', SUFFICIENT.Topic)).toBe(
        '/members/community/topics/how-do-i-ship-faster',
      );
      expect(buildNotificationRoute('Post', SUFFICIENT.Post)).toBe(
        '/members/community/topics/how-do-i-ship-faster#post-post_42',
      );
      expect(buildNotificationRoute('SessionRequest')).toBe(
        '/members/live/request',
      );
      expect(buildNotificationRoute('LiveSession')).toBe('/members/live');
    });

    it('anchors a Post inside the THREAD rather than inventing a post route', () => {
      // `/members/community/posts/:id` is not in `members.routes.spec.ts`'s
      // enumerated table, so a route shaped that way would be a stored 404.
      const route = buildNotificationRoute('Post', SUFFICIENT.Post);

      expect(route).not.toContain('/posts/');
      expect(route).toContain('#post-');
    });
  });

  describe('🔴 no input escapes the /members/ prefix', () => {
    const HOSTILE = [
      'https://evil.example.com',
      '//evil.example.com',
      '../../admin/records',
      'x?next=https://evil.example.com',
      'x#/admin',
      '/admin/records',
    ];

    it.each(HOSTILE)('a topicSlug of %p cannot leave /members/', (slug) => {
      const route = buildNotificationRoute('Topic', { topicSlug: slug });

      expect(route.startsWith('/members/community/topics/')).toBe(true);
      // The hostile value survives as ONE inert path segment. If any of these
      // characters came through raw, the string would parse as a new path, a
      // new query, a new fragment or a new origin.
      expect(route).not.toContain('//evil');
      expect(route).not.toContain('../');
      expect(route.indexOf('?')).toBe(-1);
      expect(route.indexOf('#')).toBe(-1);
    });

    it.each(HOSTILE)('a postId of %p cannot leave the thread route', (id) => {
      const route = buildNotificationRoute('Post', {
        topicSlug: 'ok',
        postId: id,
      });

      expect(route.startsWith('/members/community/topics/ok#post-')).toBe(true);
      // Exactly one `#`: the anchor we added. A raw `#` in the id would create
      // a second one and truncate the first.
      expect(route.split('#')).toHaveLength(2);
    });

    it('an absolute URL is never returned for any target type', () => {
      for (const targetType of NOTIFICATION_TARGET_TYPES) {
        const route = buildNotificationRoute(
          targetType,
          SUFFICIENT[targetType],
        );

        expect(route).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
        expect(route.startsWith('//')).toBe(false);
      }
    });
  });

  describe('it throws rather than storing a broken deep link', () => {
    it('throws for an unknown targetType', () => {
      expect(() =>
        buildNotificationRoute(
          'Course' as unknown as NotificationTargetType,
          {},
        ),
      ).toThrow(/unknown targetType/);
    });

    it.each(['Topic', 'Post'] as const)(
      'throws when %s is given no topicSlug',
      (targetType) => {
        // Returning `/members/hub` instead would write a healthy-looking row
        // that lands the member on the wrong screen.
        expect(() => buildNotificationRoute(targetType, {})).toThrow(
          /requires a topicSlug/,
        );
      },
    );

    it('throws when Post is given no postId', () => {
      expect(() => buildNotificationRoute('Post', { topicSlug: 'ok' })).toThrow(
        /requires a postId/,
      );
    });

    it('throws on an empty-string slug, not just an absent one', () => {
      // `''` interpolates to `/members/community/topics/` — a valid-looking
      // prefix that resolves to nothing.
      expect(() => buildNotificationRoute('Topic', { topicSlug: '' })).toThrow(
        /requires a topicSlug/,
      );
    });
  });
});
