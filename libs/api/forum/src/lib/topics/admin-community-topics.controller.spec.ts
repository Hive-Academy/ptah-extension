// ⚠️ FIRST IMPORT — `ListAdminTopicsQueryDto` and `ModerateTopicDto` carry
// `class-validator` decorators, and this lib has no jest `setupFiles`.
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import type { AuditLogService } from '@ptah-api/audit';
import {
  AdminGuard,
  AdminThrottlerGuard,
  JwtAuthGuard,
} from '@ptah-api/identity';

import {
  asPrismaService,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';
import {
  ROUTE_PARAMTYPES,
  handlersOf,
  routeArgs,
  routeOf,
} from '../../testing/controller-reflection';
import { CategoriesService } from '../categories/categories.service';

import { AdminCommunityTopicsController } from './admin-community-topics.controller';
import type { AdminTopicsReadService } from './admin-topics-read.service';
import { TopicsService } from './topics.service';

/**
 * `AdminCommunityTopicsController` — §3.3's topic moderation surface.
 *
 * The block that earns this file its place is
 * ["PRE-6"](#) below: a moderation mutation and its audit row must share ONE
 * transaction. It is asserted against the REAL `TopicsService` and the REAL
 * audit hook, with a spy on `$transaction` — not against a double that would
 * have made the assertion a restatement of the mock.
 */

const ADMIN_REQUEST = {
  user: { id: 'admin-user-1', email: 'admin@example.com' },
  ip: '203.0.113.7',
  get: (header: string) => (header === 'user-agent' ? 'jest' : undefined),
  method: 'PATCH',
  path: '/api/v1/admin/community/topics/t-1',
} as unknown as Request;

/** A request whose `JwtAuthGuard` never ran — the wiring tripwire's input. */
const UNAUTHENTICATED_REQUEST = {
  user: undefined,
  ip: '203.0.113.7',
  get: () => undefined,
  method: 'DELETE',
  path: '/api/v1/admin/community/topics/t-1',
} as unknown as Request;

interface Harness {
  controller: AdminCommunityTopicsController;
  prisma: MockForumPrisma;
  topics: TopicsService;
  audit: { write: jest.Mock };
  adminTopics: { list: jest.Mock };
}

/**
 * The REAL `TopicsService` over the shared Prisma double.
 *
 * ⚠️ REAL, NOT A JEST DOUBLE, AND THAT IS THE WHOLE POINT FOR PRE-6. With a
 * doubled service, "the audit hook was called with a `tx`" only asserts that the
 * spec called it that way. Driving the real `$transaction` is what proves the
 * hook is invoked from INSIDE it.
 */
function createHarness(): Harness {
  const prisma = createMockPrisma();
  const audit = { write: jest.fn().mockResolvedValue('audit-row-1') };
  const adminTopics = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };

  const topics = new TopicsService(
    asPrismaService(prisma),
    {} as unknown as CategoriesService,
  );

  const controller = new AdminCommunityTopicsController(
    topics,
    adminTopics as unknown as AdminTopicsReadService,
    audit as unknown as AuditLogService,
  );

  return { controller, prisma, topics, audit, adminTopics };
}

describe('AdminCommunityTopicsController', () => {
  describe('RISK-J — three disjoint literal depth-4 prefixes', () => {
    const prefix = Reflect.getMetadata(
      PATH_METADATA,
      AdminCommunityTopicsController,
    ) as string;

    it('is mounted at v1/admin/community/topics', () => {
      expect(prefix).toBe('v1/admin/community/topics');
    });

    it('is NOT at the bare v1/admin/community — the §2.5 shape RI-1 rejects', () => {
      // The plan put this controller at `v1/admin/community`, which is a strict
      // PATH-PREFIX of the categories controller's prefix. `PREFIX_EXCEPTIONS`
      // and `KNOWN_PREFIX_DEBT` are both empty arrays at HEAD, so there is no
      // ledger to excuse it through and the build simply fails.
      expect(prefix).not.toBe('v1/admin/community');
      expect(prefix.split('/')).toHaveLength(4);
      expect(prefix.split('/').filter((s) => s.startsWith(':'))).toEqual([]);
    });

    it('is mounted under v1/admin/ (admin-guards G1, second table)', () => {
      expect(prefix.startsWith('v1/admin/')).toBe(true);
    });
  });

  describe('G1 — the class-level guard chain', () => {
    it('declares JwtAuthGuard then AdminGuard at CLASS level, in that order', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          AdminCommunityTopicsController,
        ) as unknown[]) ?? [];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(AdminGuard);
      // `JwtAuthGuard` must populate `request.user` before `AdminGuard` reads
      // `request.user.email`.
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(AdminGuard),
      );
    });

    it('adds AdminThrottlerGuard to every WRITE route and to no read', () => {
      const throttled = handlersOf(AdminCommunityTopicsController).filter(
        (handler) => {
          const fn = Object.getOwnPropertyDescriptor(
            AdminCommunityTopicsController.prototype,
            handler,
          )?.value as object;
          return (
            (Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? []
          ).includes(AdminThrottlerGuard);
        },
      );

      expect(throttled.sort()).toEqual(['moderate', 'remove', 'restore']);
    });
  });

  describe('the route table', () => {
    it('is exactly the §3.3 admin topic surface', () => {
      const routes = handlersOf(AdminCommunityTopicsController)
        .map((handler) => {
          const { verb, path } = routeOf(
            AdminCommunityTopicsController,
            handler,
          );
          return `${verb} ${path}`;
        })
        .sort();

      expect(routes).toEqual([
        'DELETE v1/admin/community/topics/:id',
        'GET v1/admin/community/topics',
        'PATCH v1/admin/community/topics/:id',
        'POST v1/admin/community/topics/:id/restore',
      ]);
    });
  });

  describe('PRE-1 — payload params', () => {
    const payloadParams = handlersOf(AdminCommunityTopicsController).flatMap(
      (handler) =>
        routeArgs(AdminCommunityTopicsController, handler)
          .filter(
            (arg) =>
              arg.paramtype === ROUTE_PARAMTYPES.BODY ||
              arg.paramtype === ROUTE_PARAMTYPES.QUERY,
          )
          .map((arg) => ({ handler, ...arg })),
    );

    it('has exactly two: the list query and the moderate body', () => {
      expect(payloadParams.map((p) => p.handler).sort()).toEqual([
        'list',
        'moderate',
      ]);
    });

    it('binds both, and neither is a named primitive (RISK-I)', () => {
      for (const param of payloadParams) {
        expect({
          handler: param.handler,
          named: param.data !== undefined,
          bound: param.pipes.some(
            (pipe) =>
              pipe instanceof ValidationPipe &&
              (pipe as ValidationPipe & { expectedType?: unknown })
                .expectedType !== undefined,
          ),
        }).toEqual({ handler: param.handler, named: false, bound: true });
      }
    });
  });

  describe('PRE-6 — the audit row is written INSIDE the mutation transaction', () => {
    // ⚠️ THE ASSERTION THE BATCH BRIEF NAMES. An audit row that commits
    // separately from its mutation can be missing for the one moderation
    // anybody ever asks about — or can accuse an admin of something that rolled
    // back. Both directions are prevented by `WriteAuditLogParams.tx`, and this
    // is what proves the controller actually supplies it.
    async function moderate(harness: Harness): Promise<void> {
      harness.prisma.topic.findFirst.mockResolvedValue({ id: 't-1' });
      harness.prisma.topic.update.mockResolvedValue({ id: 't-1' });

      await harness.controller.moderate(ADMIN_REQUEST, 't-1', { pinned: true });
    }

    it('opens exactly ONE transaction', async () => {
      const harness = createHarness();

      await moderate(harness);

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('hands AuditLogService.write the SAME client the mutation used', async () => {
      const harness = createHarness();

      await moderate(harness);

      expect(harness.audit.write).toHaveBeenCalledTimes(1);
      const params = harness.audit.write.mock.calls[0][0] as { tx?: unknown };

      // Not merely "tx is defined": it must be the transaction client, which the
      // double supplies as the mock itself — the same object `topic.update` was
      // called on a moment earlier.
      expect(params.tx).toBe(harness.prisma);
    });

    it('writes the row BEFORE the transaction callback returns', async () => {
      const harness = createHarness();
      const order: string[] = [];
      harness.prisma.$transaction.mockImplementation(
        async (fn: (tx: MockForumPrisma) => Promise<unknown>) => {
          const result = await fn(harness.prisma);
          order.push('transaction-committed');
          return result;
        },
      );
      harness.audit.write.mockImplementation(async () => {
        order.push('audit-written');
        return 'audit-row-1';
      });

      await moderate(harness);

      // If the hook were called after the transaction resolved, the order would
      // be reversed — and every other assertion in this block would still pass.
      expect(order).toEqual(['audit-written', 'transaction-committed']);
    });

    it('records the pin INTENT, not a generic update', async () => {
      const harness = createHarness();

      await moderate(harness);

      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'community.topic.pin',
        targetType: 'Topic',
        targetId: 't-1',
        actorEmail: 'admin@example.com',
      });
    });

    it('writes ONE ROW PER INTENT for a multi-field patch', async () => {
      const harness = createHarness();
      harness.prisma.topic.findFirst.mockResolvedValue({ id: 't-1' });
      harness.prisma.category.findUnique.mockResolvedValue({ id: 'c-2' });
      harness.prisma.topic.update.mockResolvedValue({ id: 't-1' });

      await harness.controller.moderate(ADMIN_REQUEST, 't-1', {
        pinned: true,
        locked: true,
        categoryId: 'c-2',
        title: 'Renamed',
      });

      const actions = harness.audit.write.mock.calls.map(
        (call) => (call[0] as { action: string }).action,
      );

      // "Who pinned this / who locked this / who moved it" are three separate
      // questions; one `community.topic.update` row would make each of them
      // answerable only by diffing a metadata array.
      expect(actions).toEqual([
        'community.topic.pin',
        'community.topic.lock',
        'community.topic.move',
        'community.topic.update',
      ]);
      // Still ONE transaction — four rows, all atomic with the mutation.
      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('does not audit a moderation that threw before it wrote', async () => {
      const harness = createHarness();
      harness.prisma.topic.findFirst.mockResolvedValue(null); // topic not found

      await expect(
        harness.controller.moderate(ADMIN_REQUEST, 'missing', { pinned: true }),
      ).rejects.toMatchObject({ status: 404 });

      expect(harness.audit.write).not.toHaveBeenCalled();
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('R8.5 — restore', () => {
    it('puts the 30-day window in the UPDATE, and reads no tombstone', async () => {
      const harness = createHarness();
      harness.prisma.topic.updateMany.mockResolvedValue({ count: 1 });

      await harness.controller.restore(ADMIN_REQUEST, 't-1');

      const where = harness.prisma.topic.updateMany.mock.calls[0][0].where as {
        id: string;
        deletedAt: { not: null; gte: Date };
      };

      expect(where.id).toBe('t-1');
      // `not: null` is what refuses a LIVE row; `gte` is the window. Both are
      // evaluated by Postgres in the same statement that writes, so there is no
      // instant between deciding and doing.
      expect(where.deletedAt.not).toBeNull();
      expect(where.deletedAt.gte).toBeInstanceOf(Date);

      // The whole reason this shape was chosen: no unfiltered read means no
      // AD-5 exemption on a write path.
      expect(harness.prisma.topic.findFirst).not.toHaveBeenCalled();
      expect(harness.prisma.topic.findMany).not.toHaveBeenCalled();
    });

    it('uses the shared constant, so the window is ~30 days from now', async () => {
      const harness = createHarness();
      harness.prisma.topic.updateMany.mockResolvedValue({ count: 1 });
      const before = Date.now();

      await harness.controller.restore(ADMIN_REQUEST, 't-1');

      const { gte } = harness.prisma.topic.updateMany.mock.calls[0][0].where
        .deletedAt as { gte: Date };
      const days = (before - gte.getTime()) / (24 * 60 * 60 * 1000);

      // R8.5 says "at least 30 days". A cutoff computed from a smaller constant
      // would silently breach the requirement with no other symptom.
      expect(days).toBeGreaterThanOrEqual(30);
      expect(days).toBeLessThan(30.001);
    });

    it('refuses with a 409 when nothing was restorable, and audits nothing', async () => {
      const harness = createHarness();
      harness.prisma.topic.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        harness.controller.restore(ADMIN_REQUEST, 't-old'),
      ).rejects.toMatchObject({ status: 409 });

      expect(harness.audit.write).not.toHaveBeenCalled();
    });

    it('audits the restore inside the same transaction', async () => {
      const harness = createHarness();
      harness.prisma.topic.updateMany.mockResolvedValue({ count: 1 });

      await harness.controller.restore(ADMIN_REQUEST, 't-1');

      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'community.topic.restore',
        targetType: 'Topic',
        tx: harness.prisma,
      });
    });
  });

  describe('the acting admin', () => {
    it('is recorded in deletedBy on a soft delete', async () => {
      const harness = createHarness();
      harness.prisma.topic.findFirst.mockResolvedValue({ id: 't-1' });
      harness.prisma.topic.update.mockResolvedValue({ id: 't-1' });

      await harness.controller.remove(ADMIN_REQUEST, 't-1');

      expect(harness.prisma.topic.update.mock.calls[0][0].data).toMatchObject({
        deletedBy: 'admin-user-1',
      });
    });

    it('REFUSES rather than deleting with no actor when JwtAuthGuard is missing', async () => {
      const harness = createHarness();

      await expect(
        harness.controller.remove(UNAUTHENTICATED_REQUEST, 't-1'),
      ).rejects.toMatchObject({ status: 500 });

      // `deletedBy` is what makes R8.5's window auditable. A placeholder there
      // is a deletion with no owner and nothing else records the column.
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('the list', () => {
    it('delegates the whole query DTO to the admin read service', async () => {
      const harness = createHarness();
      const query = { includeDeleted: true, page: 2 };

      await harness.controller.list(query);

      expect(harness.adminTopics.list).toHaveBeenCalledWith(query);
    });

    it('reads tombstones through the ONE exempt service, never inline', () => {
      // If this controller ever grew its own `prisma.topic.findMany`, it would
      // be a second place in the lib capable of returning a deleted row — and
      // `soft-delete-filter.spec.ts` only scans `*.service.ts`, so the census
      // would not see it at all.
      const source = readFileSync(
        join(__dirname, 'admin-community-topics.controller.ts'),
        'utf8',
      );

      expect(source).not.toContain('prisma');
      // Line-anchored: the marker is only a marker when it is the comment on the
      // line above a read. A prose mention inside a docblock starts with ` * `
      // and is not one — which is also why this controller's docblock is worded
      // to avoid the token entirely.
      expect(/^\s*\/\/ ?AD-5-EXEMPT:/m.test(source)).toBe(false);
    });
  });
});
