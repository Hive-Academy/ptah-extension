// ⚠️ FIRST IMPORT — the category DTOs carry `class-validator` decorators and
// this lib has no jest `setupFiles`.
import 'reflect-metadata';

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
import { AdminCommunityTopicsController } from '../topics/admin-community-topics.controller';
import { AdminCommunityPostsController } from '../posts/admin-community-posts.controller';

import { AdminCommunityCategoriesController } from './admin-community-categories.controller';
import { CategoriesService } from './categories.service';

/**
 * `AdminCommunityCategoriesController` — §3.3's category surface, R8.8.
 *
 * Two things here cannot be asserted anywhere else and both fail the build
 * elsewhere when they are wrong:
 *
 *   RI-3 — `PATCH reorder` is DECLARED BEFORE `PATCH :id`. Reversed, Nest
 *          matches `:id === 'reorder'` and the endpoint silently becomes
 *          "update the category called reorder".
 *   RI-1 — the three admin prefixes are pairwise disjoint, with nothing at the
 *          bare `v1/admin/community` (RISK-J).
 */

const ADMIN_REQUEST = {
  user: { id: 'admin-user-1', email: 'admin@example.com' },
  ip: '203.0.113.7',
  get: (header: string) => (header === 'user-agent' ? 'jest' : undefined),
  method: 'POST',
  path: '/api/v1/admin/community/categories',
} as unknown as Request;

interface Harness {
  controller: AdminCommunityCategoriesController;
  prisma: MockForumPrisma;
  audit: { write: jest.Mock };
}

/** The REAL `CategoriesService` — see the PRE-6 note in the topics spec. */
function createHarness(): Harness {
  const prisma = createMockPrisma();
  const audit = { write: jest.fn().mockResolvedValue('audit-row-1') };

  const controller = new AdminCommunityCategoriesController(
    new CategoriesService(asPrismaService(prisma)),
    audit as unknown as AuditLogService,
  );

  return { controller, prisma, audit };
}

/** A single admin category row as `listForAdmin` would read it back. */
function categoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    slug: 'general',
    name: 'General',
    description: null,
    visibility: 'member',
    cohortKeys: [],
    sortOrder: 100,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminCommunityCategoriesController', () => {
  describe('RISK-J / RI-1 — three disjoint literal depth-4 prefixes', () => {
    const prefixes = [
      AdminCommunityCategoriesController,
      AdminCommunityTopicsController,
      AdminCommunityPostsController,
    ].map(
      (controller) => Reflect.getMetadata(PATH_METADATA, controller) as string,
    );

    it('are exactly categories / topics / posts under v1/admin/community', () => {
      expect(prefixes).toEqual([
        'v1/admin/community/categories',
        'v1/admin/community/topics',
        'v1/admin/community/posts',
      ]);
    });

    it('none is a path-prefix of another, in either direction', () => {
      // The property RI-1 asserts server-wide. Both ledgers that could excuse a
      // violation (`PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT`) are EMPTY at HEAD,
      // so a failure means a prefix is wrong — not that a ledger needs a line.
      const violations: string[] = [];
      for (const a of prefixes) {
        for (const b of prefixes) {
          if (a === b) continue;
          if (b.startsWith(`${a}/`)) violations.push(`${a} < ${b}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it('none sits at the bare v1/admin/community (the §2.5 shape)', () => {
      expect(prefixes).not.toContain('v1/admin/community');
      for (const prefix of prefixes) {
        expect(prefix.split('/')).toHaveLength(4);
      }
    });
  });

  describe('RI-3 — reorder is declared BEFORE :id', () => {
    it('orders the two PATCH handlers correctly', () => {
      // `handlersOf` preserves DECLARATION order (V8 keeps definition order for
      // string-keyed own properties, which is also what Nest's MetadataScanner
      // relies on — and is why this is a real property, not a style rule).
      const handlers = handlersOf(AdminCommunityCategoriesController);
      const patches = handlers.filter(
        (h) => routeOf(AdminCommunityCategoriesController, h).verb === 'PATCH',
      );

      expect(patches).toEqual(['reorder', 'update']);
      expect(handlers.indexOf('reorder')).toBeLessThan(
        handlers.indexOf('update'),
      );
    });

    it('the two PATCH paths genuinely unify — so the ordering is load-bearing', () => {
      // Anti-vacuity for the assertion above: if the paths could not contest,
      // the ordering would not matter and the test would be decoration.
      const reorder = routeOf(
        AdminCommunityCategoriesController,
        'reorder',
      ).path;
      const update = routeOf(AdminCommunityCategoriesController, 'update').path;

      const a = reorder.split('/');
      const b = update.split('/');
      expect(a).toHaveLength(b.length);
      expect(
        a.every(
          (seg, i) =>
            seg === b[i] || seg.startsWith(':') || b[i].startsWith(':'),
        ),
      ).toBe(true);
      // …and the more specific one (zero params) is the one declared first.
      expect(a.filter((s) => s.startsWith(':'))).toHaveLength(0);
      expect(b.filter((s) => s.startsWith(':'))).toHaveLength(1);
    });
  });

  describe('G1 — the class-level guard chain', () => {
    it('declares JwtAuthGuard then AdminGuard at CLASS level, in that order', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          AdminCommunityCategoriesController,
        ) as unknown[]) ?? [];

      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(AdminGuard),
      );
    });

    it('throttles every write and leaves the read on the global budget', () => {
      const throttled = handlersOf(AdminCommunityCategoriesController).filter(
        (handler) => {
          const fn = Object.getOwnPropertyDescriptor(
            AdminCommunityCategoriesController.prototype,
            handler,
          )?.value as object;
          return (
            (Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? []
          ).includes(AdminThrottlerGuard);
        },
      );

      expect(throttled.sort()).toEqual([
        'create',
        'remove',
        'reorder',
        'update',
      ]);
    });
  });

  describe('the route table', () => {
    it('is exactly the §3.3 admin category surface', () => {
      const routes = handlersOf(AdminCommunityCategoriesController)
        .map((handler) => {
          const { verb, path } = routeOf(
            AdminCommunityCategoriesController,
            handler,
          );
          return `${verb} ${path}`;
        })
        .sort();

      expect(routes).toEqual([
        'DELETE v1/admin/community/categories/:id',
        'GET v1/admin/community/categories',
        'PATCH v1/admin/community/categories/:id',
        'PATCH v1/admin/community/categories/reorder',
        'POST v1/admin/community/categories',
      ]);
    });
  });

  describe('PRE-1 — payload params', () => {
    const payloadParams = handlersOf(
      AdminCommunityCategoriesController,
    ).flatMap((handler) =>
      routeArgs(AdminCommunityCategoriesController, handler)
        .filter(
          (arg) =>
            arg.paramtype === ROUTE_PARAMTYPES.BODY ||
            arg.paramtype === ROUTE_PARAMTYPES.QUERY,
        )
        .map((arg) => ({ handler, ...arg })),
    );

    it('has exactly three bodies: create, reorder, update', () => {
      expect(payloadParams.map((p) => p.handler).sort()).toEqual([
        'create',
        'reorder',
        'update',
      ]);
    });

    it('binds all three, and none is a named primitive (RISK-I)', () => {
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

  describe('PRE-6 — the audit row rides the mutation transaction', () => {
    it('create: one transaction, and write() receives that tx', async () => {
      const harness = createHarness();
      harness.prisma.category.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      harness.prisma.category.create.mockResolvedValue(categoryRow());
      harness.prisma.category.findMany.mockResolvedValue([categoryRow()]);
      harness.prisma.topic.findMany.mockResolvedValue([]);

      await harness.controller.create(ADMIN_REQUEST, {
        slug: 'general',
        name: 'General',
        visibility: 'member',
      });

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'community.category.create',
        targetType: 'Category',
        targetId: 'c-1',
        actorEmail: 'admin@example.com',
        ipAddress: '203.0.113.7',
        tx: harness.prisma,
      });
    });

    it('reorder: writes ONE row with NO targetId — it has no single target', async () => {
      const harness = createHarness();
      harness.prisma.category.findMany.mockResolvedValue([
        { id: 'c-1' },
        { id: 'c-2' },
      ]);
      harness.prisma.category.update.mockResolvedValue(categoryRow());

      await harness.controller.reorder(ADMIN_REQUEST, {
        ids: ['c-2', 'c-1'],
      });

      const params = harness.audit.write.mock.calls[0][0] as {
        action: string;
        targetId?: unknown;
        tx: unknown;
      };
      expect(params.action).toBe('community.category.reorder');
      // `undefined`, not `null`: `AuditLogService.write` strips undefined keys so
      // Postgres applies the column default rather than storing a literal null.
      expect(params.targetId).toBeUndefined();
      expect(params.tx).toBe(harness.prisma);
    });

    it('delete: audits inside the transaction', async () => {
      const harness = createHarness();
      harness.prisma.category.findUnique.mockResolvedValue({
        id: 'c-1',
        slug: 'general',
      });
      harness.prisma.category.delete.mockResolvedValue(categoryRow());

      await harness.controller.remove(ADMIN_REQUEST, 'c-1');

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'community.category.delete',
        targetType: 'Category',
        targetId: 'c-1',
        tx: harness.prisma,
      });
    });

    it('audits NOTHING when the mutation refused', async () => {
      const harness = createHarness();
      harness.prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        harness.controller.remove(ADMIN_REQUEST, 'missing'),
      ).rejects.toMatchObject({ status: 404 });

      expect(harness.audit.write).not.toHaveBeenCalled();
    });

    it('records the CHANGED KEYS on an update, not the values', async () => {
      const harness = createHarness();
      harness.prisma.category.findUnique.mockResolvedValue({ id: 'c-1' });
      harness.prisma.category.update.mockResolvedValue(categoryRow());
      harness.prisma.category.findMany.mockResolvedValue([categoryRow()]);
      harness.prisma.topic.findMany.mockResolvedValue([]);

      const description = 'x'.repeat(2000);
      await harness.controller.update(ADMIN_REQUEST, 'c-1', { description });

      const params = harness.audit.write.mock.calls[0][0] as {
        metadata: { changed: string[] };
      };
      expect(params.metadata.changed).toEqual(['description']);
      // A 2000-character body does not belong in an audit row; "what did they
      // touch" is the question a moderation log is asked.
      expect(JSON.stringify(params)).not.toContain(description);
    });
  });

  describe('writes answer with the ADMIN view, re-read rather than assembled', () => {
    it('a created category comes back with cohortNames and topicCount', async () => {
      const harness = createHarness();
      harness.prisma.memberGroup.findMany.mockResolvedValue([
        { key: 'founding', name: 'Founding cohort' },
      ]);
      harness.prisma.category.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      harness.prisma.category.create.mockResolvedValue(
        categoryRow({ visibility: 'cohort', cohortKeys: ['founding'] }),
      );
      harness.prisma.category.findMany.mockResolvedValue([
        categoryRow({ visibility: 'cohort', cohortKeys: ['founding'] }),
      ]);
      harness.prisma.topic.findMany.mockResolvedValue([
        { categoryId: 'c-1' },
        { categoryId: 'c-1' },
      ]);

      const created = await harness.controller.create(ADMIN_REQUEST, {
        slug: 'general',
        name: 'General',
        visibility: 'cohort',
        cohortKeys: ['founding'],
      });

      // Assembling the response from the written row would have produced neither
      // of these, and the category would render differently here than on the
      // next GET.
      expect(created.cohortNames).toEqual(['Founding cohort']);
      expect(created.topicCount).toBe(2);
    });
  });
});
