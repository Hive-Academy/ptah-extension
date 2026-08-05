// ⚠️ FIRST IMPORT — the course DTOs carry `class-validator` decorators and this
// lib has no jest `setupFiles`. Without it the suite dies on
// `TypeError: Reflect.getMetadata is not a function` before a single assertion.
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
  paramCount,
  routeArgs,
  routeOf,
  unifies,
} from '../../testing/controller-reflection';
import {
  asPrismaService,
  createMockPrisma,
  type MockLearningPrisma,
} from '../../testing/mock-learning-prisma';

import { AdminCourseModulesController } from './admin-course-modules.controller';
import { AdminCoursesController } from './admin-courses.controller';
import { AdminLessonsController } from './admin-lessons.controller';
import { CoursesService } from './courses.service';
import { ReorderService } from './reorder.service';

/**
 * `AdminCoursesController` — §3.4's course surface, R8.1, R8.5, R8.8.
 *
 * Four things are asserted here that cannot be asserted anywhere else, and each
 * one fails somewhere far away when it is wrong:
 *
 *   RISK-N / RI-1 — the three admin prefixes are pairwise disjoint, and
 *                   `v1/admin/course-modules` has NOT been "simplified" into a
 *                   child of `v1/admin/courses`.
 *   RI-3         — `PATCH reorder` is DECLARED BEFORE `PATCH :id`, and the two
 *                   genuinely unify — without the second half the first is
 *                   decoration.
 *   PRE-1        — every payload param binds a `ValidationPipe` carrying
 *                   `expectedType`, and none is a named primitive (RISK-I).
 *   PRE-6        — the audit row is written with the mutation's OWN `tx`.
 */

const ADMIN_REQUEST = {
  user: { id: 'admin-user-1', email: 'admin@example.com' },
  ip: '203.0.113.7',
  get: (header: string) => (header === 'user-agent' ? 'jest' : undefined),
  method: 'POST',
  path: '/api/v1/admin/courses',
} as unknown as Request;

/**
 * A request with NO authenticated user — the `requireAdminUserId` tripwire.
 *
 * ⚠️ IT IS A SEPARATE FUNCTION, NOT `adminRequest(undefined)`. A default
 * parameter FIRES on an explicitly-passed `undefined`, so a
 * `function adminRequest(user = USER)` helper would hand the happy-path user to
 * every "guard removed" case and each of them would assert the opposite of its
 * name. That bug has already happened twice in this task (Batch 6C's Task 6.12,
 * Batch 9A's Finding 6).
 */
function unguardedRequest(): Request {
  return {
    ip: '203.0.113.7',
    get: () => undefined,
    method: 'DELETE',
    path: '/api/v1/admin/courses/c-1',
  } as unknown as Request;
}

interface Harness {
  controller: AdminCoursesController;
  prisma: MockLearningPrisma;
  audit: { write: jest.Mock };
}

/**
 * The REAL `CoursesService` and the REAL `ReorderService` over the shared Prisma
 * double.
 *
 * ⚠️ NOT JEST-DOUBLED SERVICES. With a doubled service, "the hook received a
 * `tx`" would only assert that THIS SPEC called it that way. Driving the real
 * service is what makes `audit.write` receiving the same client the mutation's
 * own `update` went to a statement about the production code path.
 */
function createHarness(): Harness {
  const prisma = createMockPrisma();
  const audit = { write: jest.fn().mockResolvedValue('audit-row-1') };

  const controller = new AdminCoursesController(
    new CoursesService(asPrismaService(prisma)),
    new ReorderService(asPrismaService(prisma)),
    audit as unknown as AuditLogService,
  );

  return { controller, prisma, audit };
}

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    slug: 'foundations',
    title: 'Foundations',
    description: 'The basics.',
    coverImageUrl: null,
    visibility: 'member',
    cohortKeys: [],
    published: false,
    sequential: false,
    sortOrder: 100,
    createdBy: 'admin-user-1',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminCoursesController', () => {
  describe('🔴 RISK-N / RI-1 — three disjoint literal depth-3 admin prefixes', () => {
    const prefixes = [
      AdminCoursesController,
      AdminCourseModulesController,
      AdminLessonsController,
    ].map(
      (controller) => Reflect.getMetadata(PATH_METADATA, controller) as string,
    );

    it('are exactly courses / course-modules / lessons under v1/admin', () => {
      expect(prefixes).toEqual([
        'v1/admin/courses',
        'v1/admin/course-modules',
        'v1/admin/lessons',
      ]);
    });

    it('none is a SEGMENT-WISE path-prefix of another, in either direction', () => {
      // The property RI-1 asserts server-wide, restated locally so a failure
      // names the admin surface rule rather than only the routing invariant.
      // Both ledgers that could excuse a violation (`PREFIX_EXCEPTIONS`,
      // `KNOWN_PREFIX_DEBT`) are held at their current contents deliberately, so
      // a failure here means a prefix is WRONG — not that a ledger needs a line.
      const segments = prefixes.map((p) => p.split('/'));

      const violations: string[] = [];
      for (const a of segments) {
        for (const b of segments) {
          if (a === b) continue;
          if (a.length >= b.length) continue;
          if (a.every((segment, i) => segment === b[i])) {
            violations.push(`${a.join('/')} < ${b.join('/')}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });

    it('🔴 course-modules is a SIBLING of courses, not a child of it (RISK-J)', () => {
      // The one that would silently reintroduce the shape that broke the plan's
      // admin layout in Batch 6. `v1/admin/courses/modules` IS a proper
      // segment-wise prefix relationship with `v1/admin/courses` and RI-1
      // rejects it; `v1/admin/course-modules` is not, because segment 3 differs
      // — even though one is a *string* prefix of the other, which is exactly
      // why a naive check would get this backwards.
      const modules = Reflect.getMetadata(
        PATH_METADATA,
        AdminCourseModulesController,
      ) as string;

      expect(modules).toBe('v1/admin/course-modules');
      expect(modules.split('/')).toHaveLength(3);
      expect(modules.startsWith('v1/admin/courses/')).toBe(false);
    });
  });

  describe('🔴 RI-3 — reorder is declared BEFORE :id', () => {
    it('orders the two PATCH handlers correctly', () => {
      // `handlersOf` preserves DECLARATION order (V8 keeps definition order for
      // string-keyed own properties, which is also what Nest's MetadataScanner
      // relies on — and is why this is a real property, not a style rule).
      const handlers = handlersOf(AdminCoursesController);
      const patches = handlers.filter(
        (h) => routeOf(AdminCoursesController, h).verb === 'PATCH',
      );

      expect(patches).toEqual(['reorder', 'update']);
      expect(handlers.indexOf('reorder')).toBeLessThan(
        handlers.indexOf('update'),
      );
    });

    it('the two PATCH paths GENUINELY UNIFY — so the ordering is load-bearing', () => {
      // Anti-vacuity for the assertion above: if the paths could not contest,
      // the ordering would not matter and the test would be decoration.
      const reorder = routeOf(AdminCoursesController, 'reorder').path;
      const update = routeOf(AdminCoursesController, 'update').path;

      expect(unifies(reorder, update)).toBe(true);
      // …and the more specific one (zero params) is declared first.
      expect(paramCount(reorder)).toBe(0);
      expect(paramCount(update)).toBe(1);
    });

    it('GET "" and GET :id do NOT unify — different segment counts', () => {
      // The negative control. Without it, `unifies()` returning true for
      // everything would make the assertion above pass for the wrong reason.
      const list = routeOf(AdminCoursesController, 'list').path;
      const get = routeOf(AdminCoursesController, 'get').path;

      expect(unifies(list, get)).toBe(false);
    });
  });

  describe('G1 — the class-level guard chain', () => {
    it('declares JwtAuthGuard then AdminGuard at CLASS level, in that order', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          AdminCoursesController,
        ) as unknown[]) ?? [];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(AdminGuard);
      // JwtAuthGuard must populate request.user before AdminGuard reads
      // request.user.email.
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(AdminGuard),
      );
    });

    it('throttles every write and leaves the two reads on the global budget', () => {
      const throttled = handlersOf(AdminCoursesController).filter((handler) => {
        const fn = Object.getOwnPropertyDescriptor(
          AdminCoursesController.prototype,
          handler,
        )?.value as object;
        return (
          (Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? []
        ).includes(AdminThrottlerGuard);
      });

      expect(throttled.sort()).toEqual([
        'create',
        'remove',
        'reorder',
        'restore',
        'setPublished',
        'update',
      ]);
    });
  });

  describe('the route table', () => {
    it('is exactly the §3.4 admin course surface', () => {
      const routes = handlersOf(AdminCoursesController)
        .map((handler) => {
          const { verb, path } = routeOf(AdminCoursesController, handler);
          return `${verb} ${path}`;
        })
        .sort();

      expect(routes).toEqual([
        'DELETE v1/admin/courses/:id',
        'GET v1/admin/courses',
        'GET v1/admin/courses/:id',
        'PATCH v1/admin/courses/:id',
        'PATCH v1/admin/courses/reorder',
        'POST v1/admin/courses',
        'POST v1/admin/courses/:id/restore',
        'PUT v1/admin/courses/:id/published',
      ]);
    });
  });

  describe('PRE-1 — payload params', () => {
    const payloadParams = handlersOf(AdminCoursesController).flatMap(
      (handler) =>
        routeArgs(AdminCoursesController, handler)
          .filter(
            (arg) =>
              arg.paramtype === ROUTE_PARAMTYPES.BODY ||
              arg.paramtype === ROUTE_PARAMTYPES.QUERY,
          )
          .map((arg) => ({ handler, ...arg })),
    );

    it('has exactly four bodies: create, reorder, update, setPublished', () => {
      expect(payloadParams.map((p) => p.handler).sort()).toEqual([
        'create',
        'reorder',
        'setPublished',
        'update',
      ]);
    });

    it('binds all four, and none is a named primitive (RISK-I)', () => {
      // A bare `@Body() dto: X` is SILENTLY UNVALIDATED — esbuild emits no
      // `emitDecoratorMetadata`, so the global pipe short-circuits. Asserted on
      // the whole object so a failure NAMES the handler.
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

    it('declares no @Query() at all, so it cannot move the named-primitive census', () => {
      const queries = payloadParams.filter(
        (p) => p.paramtype === ROUTE_PARAMTYPES.QUERY,
      );
      expect(queries).toEqual([]);
    });
  });

  describe('🔴 PRE-6 — the audit row rides the mutation transaction', () => {
    it('create: ONE transaction, and write() receives THAT tx', async () => {
      const harness = createHarness();
      harness.prisma.course.findMany.mockResolvedValue([]);
      harness.prisma.course.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      harness.prisma.course.create.mockResolvedValue(courseRow());
      harness.prisma.memberGroup.findMany.mockResolvedValue([]);

      await harness.controller.create(ADMIN_REQUEST, {
        title: 'Foundations',
        description: 'The basics.',
        visibility: 'member',
      });

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'learning.course.create',
        targetType: 'Course',
        targetId: 'c-1',
        actorEmail: 'admin@example.com',
        ipAddress: '203.0.113.7',
        // Not merely "a defined tx" — the SAME client `course.create` went to.
        tx: harness.prisma,
      });
    });

    it('create: the course is written as a DRAFT whatever the caller sends', async () => {
      const harness = createHarness();
      harness.prisma.course.findMany.mockResolvedValue([]);
      harness.prisma.course.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      harness.prisma.course.create.mockResolvedValue(courseRow());
      harness.prisma.memberGroup.findMany.mockResolvedValue([]);

      await harness.controller.create(ADMIN_REQUEST, {
        title: 'Foundations',
        description: 'The basics.',
        visibility: 'member',
        // Smuggled in as a loose property: `CreateCourseDto` has no such field
        // and `forbidNonWhitelisted` would 400 it at the real boundary. This
        // asserts the SERVICE does not honour it either.
        ...({ published: true } as Record<string, unknown>),
      });

      expect(harness.prisma.course.create.mock.calls[0][0].data.published).toBe(
        false,
      );
    });

    it('reorder: ONE row with NO targetId — a reorder has no single target', async () => {
      const harness = createHarness();
      harness.prisma.course.findMany.mockResolvedValue([
        { id: 'c-1' },
        { id: 'c-2' },
      ]);
      harness.prisma.course.update.mockResolvedValue(courseRow());

      await harness.controller.reorder(ADMIN_REQUEST, {
        ids: ['c-2', 'c-1'],
      });

      const params = harness.audit.write.mock.calls[0][0] as {
        action: string;
        targetId?: unknown;
        tx: unknown;
      };
      expect(params.action).toBe('learning.course.reorder');
      // `undefined`, not `null`: `AuditLogService.write` strips undefined keys
      // so Postgres applies the column default rather than storing a literal
      // null.
      expect(params.targetId).toBeUndefined();
      expect(params.tx).toBe(harness.prisma);
    });

    it('delete: audits INSIDE the transaction — the only record of the actor', async () => {
      // 🔴 `Course` has no `deletedBy` column (Batch 9B's F-1), so this row is
      // the whole answer to "who removed this course".
      const harness = createHarness();
      harness.prisma.course.findFirst.mockResolvedValue({ id: 'c-1' });
      harness.prisma.course.update.mockResolvedValue(courseRow());

      await harness.controller.remove(ADMIN_REQUEST, 'c-1');

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'learning.course.delete',
        targetType: 'Course',
        targetId: 'c-1',
        actorEmail: 'admin@example.com',
        tx: harness.prisma,
      });
    });

    it('publish: one row per direction, with the direction in metadata', async () => {
      const harness = createHarness();
      harness.prisma.course.findFirst.mockResolvedValue({ id: 'c-1' });
      harness.prisma.course.update.mockResolvedValue(
        courseRow({ published: true }),
      );
      harness.prisma.courseModule.findMany.mockResolvedValue([]);
      harness.prisma.memberGroup.findMany.mockResolvedValue([]);

      await harness.controller.setPublished(ADMIN_REQUEST, 'c-1', {
        published: true,
      });

      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'learning.course.publish',
        targetType: 'Course',
        targetId: 'c-1',
        metadata: { published: true },
        tx: harness.prisma,
      });
    });

    it('a mutation that THROWS audits nothing and opens no transaction', async () => {
      const harness = createHarness();
      // An unknown cohort key is refused BEFORE the transaction opens.
      harness.prisma.memberGroup.findMany.mockResolvedValue([]);

      await expect(
        harness.controller.create(ADMIN_REQUEST, {
          title: 'Foundations',
          description: 'The basics.',
          visibility: 'cohort',
          cohortKeys: ['no-such-cohort'],
        }),
      ).rejects.toThrow();

      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
      expect(harness.audit.write).not.toHaveBeenCalled();
    });

    it('refuses rather than substituting a placeholder actor on a delete', async () => {
      // `requireAdminUserId` is a wiring tripwire, not a null check: the audit
      // row is the only record of who deleted a course, and manufacturing an
      // actor for it would be inventing the one fact it exists to carry.
      const harness = createHarness();

      await expect(
        harness.controller.remove(unguardedRequest(), 'c-1'),
      ).rejects.toThrow();

      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
      expect(harness.audit.write).not.toHaveBeenCalled();
    });
  });

  describe('R7.3 — entitlement is never re-derived in this lib', () => {
    it('imports neither MembershipService nor CohortResolver', () => {
      // ⚠️ ASSERTED AGAINST IMPORT STATEMENTS AND `@Inject(...)`, NOT RAW TEXT.
      // The controller docblocks name these services in prose to explain why
      // they are absent, and a `toContain` reads that documentation as the
      // violation — the idiom `admin-guards.spec.ts` G6 already uses and
      // documents for the identical reason.
      const { readFileSync } = require('node:fs') as typeof import('node:fs');
      const { join } = require('node:path') as typeof import('node:path');

      for (const file of [
        'admin-courses.controller.ts',
        'admin-course-modules.controller.ts',
        'admin-lessons.controller.ts',
        'member-courses.controller.ts',
      ]) {
        const source = readFileSync(join(__dirname, file), 'utf8');

        expect(source).not.toMatch(/from\s+'[^']*membership\.service'/);
        expect(source).not.toMatch(/from\s+'[^']*cohort-resolver'/);
        expect(source).not.toMatch(/@Inject\(\s*MembershipService\s*\)/);
        expect(source).not.toMatch(/@Inject\(\s*CohortResolver\s*\)/);
      }
    });
  });
});
