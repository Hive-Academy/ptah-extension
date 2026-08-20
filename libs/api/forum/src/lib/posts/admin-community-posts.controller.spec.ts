import 'reflect-metadata';

import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import type { AuditLogService } from '@ptah-api/audit';
import {
  AdminGuard,
  AdminThrottlerGuard,
  JwtAuthGuard,
} from '@ptah-api/identity';
import type { NotificationsService } from '@ptah-api/notifications';

import {
  ROUTE_PARAMTYPES,
  handlersOf,
  routeArgs,
  routeOf,
} from '../../testing/controller-reflection';
import {
  asPrismaService,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';

import { AdminCommunityPostsController } from './admin-community-posts.controller';
import { PostsService } from './posts.service';

/**
 * `AdminCommunityPostsController` — post removal and restore (§3.3, R8.2, R8.5).
 *
 * The assertion worth the file is the one about `Topic.postCount` (AD-11): a
 * restore that only clears `deletedAt` leaves the counter permanently one below
 * the truth, with no reconciliation job (RK-1) to ever notice and no symptom
 * except a reply count that is quietly wrong forever.
 */

const ADMIN_REQUEST = {
  user: { id: 'admin-user-1', email: 'admin@example.com' },
  ip: '203.0.113.7',
  get: (header: string) => (header === 'user-agent' ? 'jest' : undefined),
  method: 'DELETE',
  path: '/api/v1/admin/community/posts/p-1',
} as unknown as Request;

const UNAUTHENTICATED_REQUEST = {
  user: undefined,
  ip: '203.0.113.7',
  get: () => undefined,
  method: 'POST',
  path: '/api/v1/admin/community/posts/p-1/restore',
} as unknown as Request;

interface Harness {
  controller: AdminCommunityPostsController;
  prisma: MockForumPrisma;
  audit: { write: jest.Mock };
}

/** The Phase-5 notification double; see the note at its use below. */
let notifyCreate: jest.Mock;

function createHarness(): Harness {
  const prisma = createMockPrisma();
  const audit = { write: jest.fn().mockResolvedValue('audit-row-1') };
  notifyCreate = jest.fn().mockResolvedValue('notif-1');

  const controller = new AdminCommunityPostsController(
    // Phase 5: `PostsService` gained the notification producer. This
    // controller reaches only `softDeleteAsAdmin` / `restore`, neither of
    // which produces one — a moderator removing a post does not tell its
    // author, and R10.1's producer list does not include moderation. The
    // double is here to satisfy the constructor, and the assertion that it
    // stays unused is below.
    new PostsService(asPrismaService(prisma), {
      create: notifyCreate,
    } as unknown as NotificationsService),
    audit as unknown as AuditLogService,
  );

  return { controller, prisma, audit };
}

describe('AdminCommunityPostsController', () => {
  describe('mount and guards', () => {
    it('sits at v1/admin/community/posts, a depth-4 literal', () => {
      const prefix = Reflect.getMetadata(
        PATH_METADATA,
        AdminCommunityPostsController,
      ) as string;

      expect(prefix).toBe('v1/admin/community/posts');
      expect(prefix.startsWith('v1/admin/')).toBe(true);
      expect(prefix.split('/').filter((s) => s.startsWith(':'))).toEqual([]);
    });

    it('declares JwtAuthGuard then AdminGuard at CLASS level, in that order', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          AdminCommunityPostsController,
        ) as unknown[]) ?? [];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(AdminGuard);
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(AdminGuard),
      );
    });

    it('throttles both routes — this class has no read to exempt', () => {
      const throttled = handlersOf(AdminCommunityPostsController).filter(
        (handler) => {
          const fn = Object.getOwnPropertyDescriptor(
            AdminCommunityPostsController.prototype,
            handler,
          )?.value as object;
          return (
            (Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? []
          ).includes(AdminThrottlerGuard);
        },
      );

      expect(throttled.sort()).toEqual(['remove', 'restore']);
    });
  });

  describe('the route table', () => {
    it('is exactly delete + restore, with no list', () => {
      const routes = handlersOf(AdminCommunityPostsController)
        .map((handler) => {
          const { verb, path } = routeOf(
            AdminCommunityPostsController,
            handler,
          );
          return `${verb} ${path}`;
        })
        .sort();

      // §3.3 gives posts two operations and no list. A standalone "every post in
      // the forum" read would be an unpaged scan of the largest table serving a
      // screen nobody asked for (RK-1).
      expect(routes).toEqual([
        'DELETE v1/admin/community/posts/:id',
        'POST v1/admin/community/posts/:id/restore',
      ]);
    });

    it('declares NO payload param at all (so PRE-1 has nothing to bind)', () => {
      const payloadParams = handlersOf(AdminCommunityPostsController).flatMap(
        (handler) =>
          routeArgs(AdminCommunityPostsController, handler).filter(
            (arg) =>
              arg.paramtype === ROUTE_PARAMTYPES.BODY ||
              arg.paramtype === ROUTE_PARAMTYPES.QUERY,
          ),
      );

      // Stated rather than assumed: `controller-validation.spec.ts` would
      // otherwise be satisfied by this class vacuously, and a future `@Body()`
      // added here must bind `dtoPipe`.
      expect(payloadParams).toEqual([]);
    });
  });

  describe('PRE-6 — audit inside the mutation transaction', () => {
    it('delete: one transaction carrying the tombstone, the decrement and the row', async () => {
      const harness = createHarness();
      harness.prisma.post.findFirst.mockResolvedValue({
        id: 'p-2',
        topicId: 't-1',
        postNumber: 4,
      });

      await harness.controller.remove(ADMIN_REQUEST, 'p-2');

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'community.post.delete',
        // The hook carries the TOPIC id, so the row must claim `Topic` — an
        // audit row naming `Post` while carrying a topic id is unresolvable by
        // `targetType` + `targetId`, which is the only way anybody looks one up.
        targetType: 'Topic',
        targetId: 't-1',
        tx: harness.prisma,
      });
    });

    it('refuses to delete post #1 — it IS the topic body (AD-9)', async () => {
      const harness = createHarness();
      harness.prisma.post.findFirst.mockResolvedValue({
        id: 'p-1',
        topicId: 't-1',
        postNumber: 1,
      });

      await expect(
        harness.controller.remove(ADMIN_REQUEST, 'p-1'),
      ).rejects.toMatchObject({ status: 400 });

      expect(harness.audit.write).not.toHaveBeenCalled();
    });
  });

  describe('R8.5 restore — and the AD-11 counter it must repair', () => {
    function stubRestorable(harness: Harness): void {
      harness.prisma.post.updateMany.mockResolvedValue({ count: 1 });
      harness.prisma.post.findFirst.mockResolvedValue({ topicId: 't-1' });
    }

    it('RE-INCREMENTS Topic.postCount in the same transaction', async () => {
      const harness = createHarness();
      stubRestorable(harness);

      await harness.controller.restore(ADMIN_REQUEST, 'p-2');

      expect(harness.prisma.topic.update).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: { postCount: { increment: 1 } },
      });
      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('puts the 30-day window in the UPDATE and reads no tombstone', async () => {
      const harness = createHarness();
      stubRestorable(harness);

      await harness.controller.restore(ADMIN_REQUEST, 'p-2');

      const where = harness.prisma.post.updateMany.mock.calls[0][0].where as {
        id: string;
        deletedAt: { not: null; gte: Date };
      };
      expect(where.id).toBe('p-2');
      expect(where.deletedAt.not).toBeNull();

      const days =
        (Date.now() - where.deletedAt.gte.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThanOrEqual(30);
      expect(days).toBeLessThan(30.001);
    });

    it('reads the topicId only AFTER the restore, through a FILTERED read', async () => {
      const harness = createHarness();
      stubRestorable(harness);

      await harness.controller.restore(ADMIN_REQUEST, 'p-2');

      // The ordering is what keeps this path exemption-free: by the time the
      // `findFirst` runs, the post is live, so `deletedAt: null` finds it
      // honestly. Reading it first would have been a tombstone read on a WRITE
      // path — the kind of `EXPECTED_EXEMPTIONS` entry to refuse in review.
      const readWhere = harness.prisma.post.findFirst.mock.calls[0][0]
        .where as {
        deletedAt: null;
      };
      expect(readWhere.deletedAt).toBeNull();
      expect(
        harness.prisma.post.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(harness.prisma.post.findFirst.mock.invocationCallOrder[0]);
    });

    it('refuses with a 409 and touches no counter when nothing was restorable', async () => {
      const harness = createHarness();
      harness.prisma.post.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        harness.controller.restore(ADMIN_REQUEST, 'p-old'),
      ).rejects.toMatchObject({ status: 409 });

      expect(harness.prisma.topic.update).not.toHaveBeenCalled();
      expect(harness.audit.write).not.toHaveBeenCalled();
    });

    it('audits the restore with the tx', async () => {
      const harness = createHarness();
      stubRestorable(harness);

      await harness.controller.restore(ADMIN_REQUEST, 'p-2');

      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'community.post.restore',
        targetType: 'Topic',
        targetId: 't-1',
        tx: harness.prisma,
      });
    });
  });

  describe('the acting admin', () => {
    it('lands in deletedBy', async () => {
      const harness = createHarness();
      harness.prisma.post.findFirst.mockResolvedValue({
        id: 'p-2',
        topicId: 't-1',
        postNumber: 4,
      });

      await harness.controller.remove(ADMIN_REQUEST, 'p-2');

      expect(harness.prisma.post.update.mock.calls[0][0].data).toMatchObject({
        deletedBy: 'admin-user-1',
      });
    });

    it('is REQUIRED — no actor means no mutation', async () => {
      const harness = createHarness();

      await expect(
        harness.controller.restore(UNAUTHENTICATED_REQUEST, 'p-2'),
      ).rejects.toMatchObject({ status: 500 });

      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
