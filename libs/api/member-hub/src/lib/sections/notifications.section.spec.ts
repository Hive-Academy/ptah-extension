import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MemberContext } from '@ptah-api/membership';
import type { NotificationsService } from '@ptah-api/notifications';

import { EMPTY_NOTIFICATIONS } from './hub-section';
import { NotificationsSection } from './notifications.section';

/**
 * `NotificationsSection` — R6.1, R6.6, **R6.4**, R10.4, **F-D**, RISK-AI.
 *
 * ── 🔴 WHY THE `'empty'` CELL MATTERS MORE HERE THAN ANYWHERE ELSE ────────
 * Zero unread is the STEADY STATE of a healthy member. Every other section's
 * `'empty'` is an edge case; this one's is the common case, so a resolver pinned
 * to `'ok'` (the coarse batch text's literal instruction, corrected by F-D)
 * would mislabel the majority of real responses rather than a corner of them.
 *
 * ── ⚠️ IT READS `unreadCount`, THE SAME METHOD THE POLL ENDPOINT SERVES ───
 * One construction site for `HubNotificationSummary`, so the hub badge and the
 * 60-second badge cannot disagree about their own field name or about which rows
 * count. RISK-AI's `count`-not-`findMany` property lives in that service and is
 * asserted there; what is asserted here is that this section does not build a
 * second one.
 */

function memberContext(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    userId: 'user_1',
    email: 'member@example.com',
    entitled: true,
    cohortKeys: [],
    isAdmin: false,
    ...overrides,
  };
}

function notifications(unreadCount: number): {
  service: NotificationsService;
  unread: jest.Mock;
} {
  const unread = jest.fn().mockResolvedValue({ unreadCount });
  return {
    service: { unreadCount: unread } as unknown as NotificationsService,
    unread,
  };
}

describe('NotificationsSection', () => {
  describe('🔴 F-D — the status is DERIVED from the count', () => {
    it('unread > 0 ⇒ ok, carrying the count', async () => {
      const { service } = notifications(3);

      await expect(
        new NotificationsSection(service).resolve(memberContext()),
      ).resolves.toEqual({ status: 'ok', data: { unreadCount: 3 } });
    });

    it('🔴 zero unread ⇒ empty — a read inbox is not an outage', async () => {
      const { service } = notifications(0);

      await expect(
        new NotificationsSection(service).resolve(memberContext()),
      ).resolves.toEqual({ status: 'empty', data: { unreadCount: 0 } });
    });

    it('🔴 the status is not a constant — the SAME resolver answers both ways', async () => {
      const { service, unread } = notifications(0);
      const section = new NotificationsSection(service);

      expect((await section.resolve(memberContext())).status).toBe('empty');
      unread.mockResolvedValue({ unreadCount: 1 });
      expect((await section.resolve(memberContext())).status).toBe('ok');
    });

    it('one unread is enough — the boundary is > 0, not >= some threshold', async () => {
      const { service } = notifications(1);

      expect(
        (await new NotificationsSection(service).resolve(memberContext()))
          .status,
      ).toBe('ok');
    });
  });

  describe('R6.6 — the envelope does not change', () => {
    it('🔴 `data` stays an OBJECT, never a bare number', async () => {
      // A later per-kind breakdown has to be addable without touching the
      // contract. `data: 3` would be smaller and would make that impossible.
      const { service } = notifications(7);
      const section = await new NotificationsSection(service).resolve(
        memberContext(),
      );

      expect(typeof section.data).toBe('object');
      expect(section.data).toEqual({ unreadCount: 7 });
    });

    it('the empty payload equals the shared EMPTY_NOTIFICATIONS shape', async () => {
      // The composer's degradation path uses that constant; this resolver's own
      // empty path must not disagree with it about what "nothing" looks like.
      const { service } = notifications(0);
      const section = await new NotificationsSection(service).resolve(
        memberContext(),
      );

      expect(section.data).toEqual(EMPTY_NOTIFICATIONS);
      // …and it is NOT the frozen shared object itself, so a caller that mutated
      // a response cannot corrupt every later one in the process.
      expect(section.data).not.toBe(EMPTY_NOTIFICATIONS);
    });

    it('two resolutions do not share one payload object', async () => {
      const { service } = notifications(0);
      const section = new NotificationsSection(service);

      const first = await section.resolve(memberContext());
      const second = await section.resolve(memberContext());

      expect(first.data).not.toBe(second.data);
    });
  });

  describe('R6.4 — the resolver does not catch', () => {
    it('🔴 a failing collaborator PROPAGATES; it is not reported as empty', async () => {
      const service = {
        unreadCount: jest
          .fn()
          .mockRejectedValue(new Error('connection refused')),
      } as unknown as NotificationsService;

      await expect(
        new NotificationsSection(service).resolve(memberContext()),
      ).rejects.toThrow('connection refused');
    });

    it('names no unavailable condition, because it has none', () => {
      const source = readFileSync(
        join(__dirname, 'notifications.section.ts'),
        'utf8',
      );

      expect(source).not.toMatch(/status:\s*'unavailable'/);
      expect(source).not.toMatch(/\btry\s*\{/);
    });
  });

  describe('one source for the badge', () => {
    it('scopes the read to THIS member, by handing the context straight over', async () => {
      const { service, unread } = notifications(2);
      const ctx = memberContext({ userId: 'user_42' });

      await new NotificationsSection(service).resolve(ctx);

      expect(unread).toHaveBeenCalledTimes(1);
      expect(unread.mock.calls[0]?.[0]).toBe(ctx);
    });

    it('🔴 does not rebuild the { unreadCount } envelope or touch Prisma', () => {
      const source = readFileSync(
        join(__dirname, 'notifications.section.ts'),
        'utf8',
      );

      expect(source).toContain('NotificationsService');
      expect(source).not.toContain('PrismaService');
      // No hand-built literal: the service's envelope is passed through, so the
      // field cannot be renamed here into something the client does not read.
      expect(source).not.toMatch(/data:\s*\{\s*unreadCount/);
    });
  });
});
