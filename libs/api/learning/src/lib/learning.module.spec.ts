import 'reflect-metadata';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminGuard, AdminThrottlerGuard } from '@ptah-api/identity';

import * as barrel from '../index';

import { CourseReadService } from './courses/course-read.service';
import { LearningModule } from './learning.module';
import { ProgressService } from './progress/progress.service';

/**
 * `LearningModule` and the lib's public surface.
 *
 * Four properties, each of which fails somewhere far away when it is wrong:
 *
 *   RISK-L — `NotificationsModule` is absent AND this lib produces no
 *            notification at all. Phase 5 built the lib and wired four producers
 *            in two OTHER modules; a lesson-comment producer is not one of them.
 *   §2.6   — exactly two SERVICES are exported. A third makes a curriculum
 *            mutation, a tombstone read or a hand-built visibility `where`
 *            callable from outside the guard chain, and nothing else in the repo
 *            would notice.
 *   §2.6   — `AdminGuard` / `AdminThrottlerGuard` are declared LOCALLY. Imported
 *            via `AdminModule` instead, the module graph acquires a cycle the
 *            day `AdminModule` reads the curriculum.
 *   NFR-P6 — `YoutubeModule` is imported HERE and nowhere else in the server, so
 *            there is one provider instance and one `loggedDisabled` flag.
 *
 * 🔴 IT IS ALSO THE ANSWER TO BATCH 6C's C-2. PRE-2 forces the five CONTROLLER
 * classes into the barrel (the registry imports them by package name and the
 * census scans the disk), which looks like it contradicts §2.6's narrow surface.
 * It does not: what §2.6 protects is that the SERVICES stay internal, and that
 * is asserted here by exact array equality rather than by a line count on the
 * barrel. The line count was a proxy for the capability rule and it broke first.
 */

/**
 * Every source file in `src/lib/`, recursively, excluding specs.
 *
 * ⚠️ SPECS ARE EXCLUDED DELIBERATELY. This file itself names
 * `@ptah-api/notifications` in the assertion below, and a scan that included
 * specs would flag its own accuser. The property being asserted is about
 * SHIPPED code — the same shape `live-sessions.module.spec.ts` uses.
 */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function metadata<T>(key: string): T[] {
  return (Reflect.getMetadata(key, LearningModule) as T[]) ?? [];
}

describe('LearningModule', () => {
  /**
   * 🔴 RISK-L, REWRITTEN IN THE CHANGE THAT MADE ITS OLD REASON FALSE
   * (TASK_2026_177 Task 14.14).
   *
   * "The lib does not exist" was true and is not. What replaces it is stronger,
   * not weaker: this lib writes NO notification, and the assertion below now
   * says that about the SOURCE rather than about a module import — because with
   * `NotificationsModule` `@Global()`, a producer added here would resolve
   * perfectly well WITHOUT touching the imports array, and the old assertion
   * would have stayed green through it.
   */
  describe('RISK-L — no NotificationsModule import, and no producer either', () => {
    it('imports no notifications module', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      expect(names).not.toContain('NotificationsModule');
    });

    it('🔴 no source file in this lib reaches @ptah-api/notifications', () => {
      // THE ASSERTION THAT ACTUALLY BITES NOW. `NotificationsModule` is
      // `@Global()`, so a lesson-comment producer would inject
      // `NotificationsService` and never appear in this module's metadata. Only
      // a source scan can see it.
      const offenders = sourceFiles(__dirname).filter((file) =>
        /from\s+'@ptah-api\/notifications'/.test(readFileSync(file, 'utf8')),
      );

      expect(offenders).toEqual([]);
    });

    it('records the reason as a DECISION in the module docblock', () => {
      const source = readFileSync(
        join(__dirname, 'learning.module.ts'),
        'utf8',
      );

      expect(source).toContain('NotificationsModule');
      expect(source).toContain('RISK-L');
      // The `@Global()` half must be stated, or the next reader concludes the
      // import is what stops a producer appearing here. It is not.
      expect(source).toMatch(/@Global\(\)/);

      // 🔴 THE STALE CLAIM MUST BE GONE — Task 14.6's rule, applied to this
      // docblock: retiring one false tense by writing another is the trap.
      expect(source).not.toMatch(/DOES NOT EXIST/);
    });

    it('imports exactly the six modules that DO exist', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS)
        .map((m) => m?.name ?? String(m))
        .sort();

      expect(names).toEqual([
        'AuditModule',
        'ConfigModule',
        'IdentityModule',
        'MembershipModule',
        'PrismaModule',
        'YoutubeModule',
      ]);
    });
  });

  describe('§2.6 — the exported surface', () => {
    it('exports exactly CourseReadService and ProgressService', () => {
      const exports = metadata<unknown>(MODULE_METADATA.EXPORTS);

      expect(exports).toEqual([CourseReadService, ProgressService]);
    });

    it('the barrel exports no OTHER service', () => {
      // 🔴 THE ASSERTION THAT REPLACES THE "THREE EXPORT LINES" RULE. The
      // property that matters is about SERVICES, not symbol count: a controller
      // class cannot be constructed outside Nest because its dependencies are
      // exactly the services withheld here.
      const services = Object.keys(barrel).filter((name) =>
        name.endsWith('Service'),
      );

      expect(services.sort()).toEqual(['CourseReadService', 'ProgressService']);
    });

    it('the barrel exports no write or authoring service by any name', () => {
      for (const forbidden of [
        'CoursesService',
        'ReorderService',
        'LessonVideoService',
        'LessonCommentsService',
        'ModuleLockService',
      ]) {
        expect({ forbidden, exported: forbidden in barrel }).toEqual({
          forbidden,
          exported: false,
        });
      }
    });

    it('the barrel exports none of common/ — NOT_DELETED above all', () => {
      // `NOT_DELETED` leaving the lib would let a consumer hand-build a `where`
      // and read the curriculum directly, past every visibility clause and every
      // soft-delete filter. The visibility builder is worse still: it is the
      // whole of R2.1.2's draft/cohort gate.
      for (const forbidden of [
        'NOT_DELETED',
        'restorableWhere',
        'buildCourseVisibilityWhere',
        'buildModuleCourseVisibilityWhere',
        'buildLessonCourseVisibilityWhere',
        'DETERMINISTIC_ORDER_BY',
        'appendSortOrder',
        'buildSlug',
        'auditHook',
        'requireAdminUserId',
        'requireMemberContext',
        'IsOptionalNotNull',
      ]) {
        expect({ forbidden, exported: forbidden in barrel }).toEqual({
          forbidden,
          exported: false,
        });
      }
    });

    it('the barrel exports nothing from src/testing/', () => {
      for (const forbidden of [
        'createMockPrisma',
        'asPrismaService',
        'LEARNING_MODEL_KEYS',
        'handlersOf',
        'routeOf',
        'routeArgs',
      ]) {
        expect({ forbidden, exported: forbidden in barrel }).toEqual({
          forbidden,
          exported: false,
        });
      }
    });

    it('exports the five controller classes PRE-2 needs', () => {
      const controllers = Object.keys(barrel).filter((name) =>
        name.endsWith('Controller'),
      );

      expect(controllers.sort()).toEqual([
        'AdminCourseModulesController',
        'AdminCoursesController',
        'AdminLessonsController',
        'MemberCoursesController',
        'MemberLessonCommentsController',
      ]);
    });
  });

  describe('§2.6 — guards are declared LOCALLY, not via AdminModule', () => {
    it('provides AdminGuard and AdminThrottlerGuard itself', () => {
      const providers = metadata<unknown>(MODULE_METADATA.PROVIDERS);

      // `@UseGuards(AdminGuard)` makes Nest resolve the guard from the
      // CONSUMING module's injector, so it has to be provided here.
      expect(providers).toContain(AdminGuard);
      expect(providers).toContain(AdminThrottlerGuard);
    });

    it('imports no AdminModule (the acyclicity idiom MemberGroupsModule uses)', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      expect(names).not.toContain('AdminModule');
      const source = readFileSync(
        join(__dirname, 'learning.module.ts'),
        'utf8',
      );
      expect(source).not.toMatch(/from\s+'@ptah-api\/admin'/);
    });

    it('does NOT provide MemberGuard — MembershipModule is @Global and exports it', () => {
      const providers = metadata<{ name?: string }>(
        MODULE_METADATA.PROVIDERS,
      ).map((p) => p?.name ?? String(p));

      // The asymmetry with AdminGuard is real and worth pinning: re-declaring
      // MemberGuard here would create a SECOND instance resolving entitlement
      // out of a different injector.
      expect(providers).not.toContain('MemberGuard');
    });
  });

  describe('🔴 NFR-P6 — YoutubeModule is imported here, and only here', () => {
    it('imports YoutubeModule as a NORMAL import, not @Optional()', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      // The feature-off posture lives INSIDE the provider, so an unset
      // `YOUTUBE_API_KEY` is a supported runtime state; a MISSING module is a
      // wiring mistake and should fail at boot.
      expect(names).toContain('YoutubeModule');
    });

    it('records why it is not registered in app.module.ts', () => {
      // A second registration would create a second provider instance and
      // therefore a second `loggedDisabled` flag — which is how "logged exactly
      // once" becomes "logged once per module that touched it".
      const source = readFileSync(
        join(__dirname, 'learning.module.ts'),
        'utf8',
      );

      expect(source).toMatch(/loggedDisabled/);
      expect(source).toMatch(/app\.module\.ts/);
    });
  });

  describe('the registered surface', () => {
    it('declares the eight services', () => {
      const providers = metadata<{ name?: string }>(MODULE_METADATA.PROVIDERS)
        .map((p) => p?.name ?? String(p))
        .filter((name) => name.endsWith('Service'));

      expect(providers.sort()).toEqual([
        'CourseReadService',
        // TASK_2026_202 C4 — cohort scheduling. A PROVIDER ONLY: it is not in
        // `exports` and not in the barrel, because it carries a WRITE path and
        // the barrel-export assertion above is what keeps that rule true.
        'CourseScheduleService',
        'CoursesService',
        'LessonCommentsService',
        'LessonVideoService',
        'ModuleLockService',
        'ProgressService',
        'ReorderService',
      ]);
    });

    it('declares five controllers at five disjoint prefixes', () => {
      const controllers = metadata<new (...args: never[]) => unknown>(
        MODULE_METADATA.CONTROLLERS,
      );
      const prefixes = controllers.map(
        (c) => Reflect.getMetadata(PATH_METADATA, c) as string,
      );

      expect(prefixes.sort()).toEqual([
        'v1/admin/course-modules',
        'v1/admin/courses',
        'v1/admin/lessons',
        'v1/members/courses',
        'v1/members/lesson-comments',
      ]);

      // RI-1, restated locally as a SEGMENT-WISE check: `v1/admin/courses` is a
      // string prefix of `v1/admin/course-modules` and must NOT be treated as a
      // path prefix (RISK-N). A `startsWith` here would fail on a legal layout.
      const violations: string[] = [];
      for (const a of prefixes) {
        for (const b of prefixes) {
          if (a === b) continue;
          const left = a.split('/');
          const right = b.split('/');
          if (left.length >= right.length) continue;
          if (left.every((segment, i) => segment === right[i])) {
            violations.push(`${a} < ${b}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it('is NOT @Global (MemberHubModule imports it explicitly)', () => {
      // A feature module that makes itself global removes the one place a
      // reader can see who depends on it.
      expect(
        Reflect.getMetadata('__module:global__', LearningModule),
      ).toBeFalsy();
    });
  });
});
