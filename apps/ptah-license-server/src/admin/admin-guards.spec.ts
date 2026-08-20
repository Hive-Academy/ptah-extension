import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants';
import { AdminGuard } from '@ptah-api/identity';
import { JwtAuthGuard } from '@ptah-api/identity';
import { AdminCommunityCategoriesController } from '@ptah-api/forum';
import { AdminCommunityPostsController } from '@ptah-api/forum';
import { AdminCommunityTopicsController } from '@ptah-api/forum';
import { AdminCourseModulesController } from '@ptah-api/learning';
import { AdminCoursesController } from '@ptah-api/learning';
import { AdminLessonsController } from '@ptah-api/learning';
import { PacksModule } from '@ptah-api/community';
import { AdminPacksController } from '@ptah-api/community';
import { AdminSessionsController } from '@ptah-api/community';
import { MemberGroupsController } from '@ptah-api/community';
import { WORKSPACE_ROOT } from '../testing/controller-registry';

/**
 * STRUCTURAL GUARD TESTS (TASK_2026_169, plan §8.2).
 *
 * Cheap reflective assertions that survive refactors and fail the build if the
 * architecture's load-bearing invariants are broken. These are deliberately
 * dependency-free — no Postgres, no Nest bootstrap, no docker — so they run in
 * CI on every commit.
 *
 *   G1 — every admin controller carries JwtAuthGuard + AdminGuard at CLASS level
 *   G4 — the Builders membership gate never consults admin identity
 *   G6 — PacksModule registers no member-facing controller
 *
 * G5 ("the admin community controller exposes ONLY @Get handlers") USED to live
 * here. It was DELETED by TASK_2026_177 P1b, not moved. G5 was the executable
 * form of "all moderation stays in the external forum's own admin panel" — a
 * rule whose subject no longer exists. `AdminCommunityController` was deleted
 * with the rest of that forum integration, and the native community surface
 * that replaces it owns moderation WRITES by design (plan §2.5, R8). Re-adding a
 * read-only assertion against the new admin moderation controllers would freeze
 * the opposite of the intended architecture.
 *
 * ⚠️ TASK_2026_177 P2 LANDED THOSE CONTROLLERS AND STILL DID NOT RESTORE G5.
 * G1 below now enumerates all three (`AdminCommunityCategoriesController`,
 * `AdminCommunityTopicsController`, `AdminCommunityPostsController`), and the
 * two assertions added beside it are the INVERSE of G5's claim: the prefixes
 * are disjoint (RISK-J), and the surface genuinely declares writes. What makes
 * those writes safe is not that they do not exist — it is that each one records
 * an `AdminAuditLog` row INSIDE its own transaction (PRE-6), asserted in
 * `libs/api/forum`'s three controller specs.
 *
 * G3 ("registers PacksModule before AdminModule in AppModule") USED to live
 * here. It was DELETED by TASK_2026_170 R2, not moved. G3 froze an arbitrary
 * ordering of `app.module.ts`'s `imports` array as if the ordering itself were
 * the invariant; it was only ever a PROXY for the real property — that no two
 * controllers contest a route. R2 removed the cause by moving
 * `AdminController`'s `v1/admin/:model` wildcards under `v1/admin/records`, and
 * `src/common/route-map.spec.ts` now asserts the real property directly as RI-2
 * ("no cross-controller contest"), which holds no matter how the array is
 * ordered. Keeping G3 after that would have made a free choice look mandatory.
 *
 * G7 ("every @Body()/@Query() param binds dtoPipe") USED to live here. It was
 * moved to `src/common/controller-validation.spec.ts` by TASK_2026_170: it now
 * covers every controller in the server, including public ones, which do not
 * belong under an admin-guards heading — and it needed a named-primitive
 * carve-out (`@Query('code')`) that the version here did not have.
 */

/**
 * Read a source file this suite asserts on, by WORKSPACE-relative path.
 *
 * ⚠️ WORKSPACE-relative, and a SINGLE literal per file, on purpose. These
 * assertions read source TEXT, so they are a second path ledger alongside
 * `ALL_CONTROLLERS[].file` — and the files they name now live in `libs/api/*`
 * rather than this app. Anchoring on `WORKSPACE_ROOT` (shared with the
 * controller registry) spans both, and keeping each path as one whole literal
 * is what lets `tools/migration` rewrite it automatically the next time one of
 * these files moves. A `join(SRC, 'dir', 'file.ts')` split into segments is
 * invisible to that rewriting and silently rots into ENOENT.
 */
function readSource(workspaceRelativePath: string): string {
  return readFileSync(
    join(WORKSPACE_ROOT, ...workspaceRelativePath.split('/')),
    'utf8',
  );
}

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
}

function controllersOf(
  module: object,
): Array<new (...args: never[]) => unknown> {
  return (
    (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) as Array<
      new (...args: never[]) => unknown
    >) ?? []
  );
}

describe('Admin surface — structural guards', () => {
  describe('G1 — class-level guards on every admin controller (leak risk L1)', () => {
    // A method-only @UseGuards leaves any FUTURE handler on the class
    // unguarded. Declaring at class level makes the safe thing the default.
    it.each([
      ['AdminPacksController', AdminPacksController],
      ['AdminSessionsController', AdminSessionsController],
      ['MemberGroupsController', MemberGroupsController],
      // TASK_2026_177 P2 — the three community moderation controllers. G1 is a
      // HAND-MAINTAINED enumeration: an admin controller absent from it is not
      // partially covered, it is simply untested by the guard test, and nothing
      // else in the server asserts the class-level chain.
      [
        'AdminCommunityCategoriesController',
        AdminCommunityCategoriesController,
      ],
      ['AdminCommunityTopicsController', AdminCommunityTopicsController],
      ['AdminCommunityPostsController', AdminCommunityPostsController],
      // TASK_2026_177 P3 — the three curriculum authoring controllers. Same
      // reasoning: G1 is a HAND-MAINTAINED enumeration, so an admin controller
      // absent from it is untested rather than partially covered.
      ['AdminCoursesController', AdminCoursesController],
      ['AdminCourseModulesController', AdminCourseModulesController],
      ['AdminLessonsController', AdminLessonsController],
    ])(
      '%s declares JwtAuthGuard + AdminGuard at class level',
      (_name, ctrl) => {
        const guards = guardsOf(ctrl);

        expect(guards).toContain(JwtAuthGuard);
        expect(guards).toContain(AdminGuard);
        // Order matters: JwtAuthGuard must populate request.user before
        // AdminGuard reads request.user.email.
        expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
          guards.indexOf(AdminGuard),
        );
      },
    );

    it.each([
      ['AdminPacksController', AdminPacksController],
      ['AdminSessionsController', AdminSessionsController],
      [
        'AdminCommunityCategoriesController',
        AdminCommunityCategoriesController,
      ],
      ['AdminCommunityTopicsController', AdminCommunityTopicsController],
      ['AdminCommunityPostsController', AdminCommunityPostsController],
      ['AdminCoursesController', AdminCoursesController],
      ['AdminCourseModulesController', AdminCourseModulesController],
      ['AdminLessonsController', AdminLessonsController],
    ])('%s is mounted under v1/admin/', (_name, ctrl) => {
      const path = Reflect.getMetadata(PATH_METADATA, ctrl) as string;
      expect(path.startsWith('v1/admin/')).toBe(true);
    });

    // ⚠️ RISK-J, asserted here as well as in `route-map.spec.ts`. The three
    // community controllers sit at three DISJOINT literal depth-4 prefixes. The
    // plan's §2.5 split put topic moderation at the bare `v1/admin/community`,
    // a strict path-prefix of the categories controller — which RI-1 rejects,
    // with `PREFIX_EXCEPTIONS` and `KNOWN_PREFIX_DEBT` both empty by design.
    // Restated on this side so the failure names the ADMIN SURFACE rule rather
    // than only the routing invariant.
    it('the three community moderation prefixes are disjoint, with nothing at the bare v1/admin/community', () => {
      const prefixes = [
        AdminCommunityCategoriesController,
        AdminCommunityTopicsController,
        AdminCommunityPostsController,
      ].map((ctrl) => Reflect.getMetadata(PATH_METADATA, ctrl) as string);

      expect(prefixes.sort()).toEqual([
        'v1/admin/community/categories',
        'v1/admin/community/posts',
        'v1/admin/community/topics',
      ]);
      expect(prefixes).not.toContain('v1/admin/community');
    });

    // 🔴 THE SAME TWO ASSERTIONS FOR TASK_2026_177 P3's THREE CURRICULUM
    // CONTROLLERS, and the first of them is the one that would catch the shape
    // most likely to be "tidied up" later.
    it('the three curriculum prefixes are disjoint SIBLINGS at depth 3 (RISK-N)', () => {
      const prefixes = [
        AdminCoursesController,
        AdminCourseModulesController,
        AdminLessonsController,
      ].map((ctrl) => Reflect.getMetadata(PATH_METADATA, ctrl) as string);

      expect(prefixes.sort()).toEqual([
        'v1/admin/course-modules',
        'v1/admin/courses',
        'v1/admin/lessons',
      ]);

      // 🔴 `v1/admin/courses/modules` WOULD be a proper segment-wise path prefix
      // of `v1/admin/courses`, which RI-1 rejects (RISK-J's shape). The
      // hyphenated sibling is NOT, because segment 3 differs — even though one
      // prefix is a *string* prefix of the other, which is exactly what makes a
      // naive `startsWith` check get this backwards. Restated on this side so a
      // failure names the ADMIN SURFACE rule rather than only the routing
      // invariant.
      expect(prefixes).not.toContain('v1/admin/courses/modules');
      for (const prefix of prefixes) {
        expect(prefix.split('/')).toHaveLength(3);
      }

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

    it('the curriculum authoring surface declares WRITES, by design', () => {
      // The analogue of the assertion below: authoring is a write surface, and
      // what makes those writes safe is that each records an `AdminAuditLog` row
      // INSIDE its own transaction (PRE-6) — asserted in `libs/api/learning`'s
      // three admin controller specs. That matters more here than in the forum:
      // `Course`, `CourseModule` and `Lesson` carry no `deletedBy` column, so
      // the audit row is the ONLY record of who deleted one.
      const writeVerbs = [
        AdminCoursesController,
        AdminCourseModulesController,
        AdminLessonsController,
      ].flatMap((ctrl) => {
        const proto = ctrl.prototype as object;
        return Object.getOwnPropertyNames(proto)
          .filter((name) => name !== 'constructor')
          .map((name) => {
            const fn = Object.getOwnPropertyDescriptor(proto, name)
              ?.value as object;
            return Reflect.getMetadata(METHOD_METADATA, fn) as
              | number
              | undefined;
          })
          .filter((method): method is number => method !== undefined);
      });

      // RequestMethod.GET === 0, so this MUST compare against the enum rather
      // than test truthiness.
      expect(writeVerbs.some((verb) => verb !== RequestMethod.GET)).toBe(true);
    });

    // ⚠️ G5 IS NOT COMING BACK, AND THIS IS NOT IT. G5 asserted that the admin
    // community controller exposed only `@Get` handlers — a rule whose subject
    // (an EXTERNAL forum owning its own moderation history) was deleted by P1b.
    // The native surface owns moderation WRITES by design. What replaces the
    // concern is the opposite assertion: the writes exist AND are audited, which
    // `libs/api/forum`'s three controller specs check by asserting the audit row
    // shares the mutation's transaction (PRE-6).
    it('the community moderation surface declares WRITES, by design (the inverse of the deleted G5)', () => {
      const writeVerbs = [
        AdminCommunityCategoriesController,
        AdminCommunityTopicsController,
        AdminCommunityPostsController,
      ].flatMap((ctrl) => {
        const proto = ctrl.prototype as object;
        return Object.getOwnPropertyNames(proto)
          .filter((name) => name !== 'constructor')
          .map((name) => {
            const fn = Object.getOwnPropertyDescriptor(proto, name)
              ?.value as object;
            return Reflect.getMetadata(METHOD_METADATA, fn) as
              | number
              | undefined;
          })
          .filter((method): method is number => method !== undefined);
      });

      // RequestMethod.GET === 0, so this MUST compare against the enum rather
      // than test truthiness.
      expect(writeVerbs.some((verb) => verb !== RequestMethod.GET)).toBe(true);
    });
  });

  describe('G4 — the Builders membership gate is not admin-aware', () => {
    // THE SECURITY INVARIANT. Admin access must be a SEPARATE authorized path,
    // never a loosening of the member gate. If this file ever learns about
    // ADMIN_EMAILS, AdminGuard, or an isAdmin flag, the two concerns have been
    // fused and a platform admin would silently gain member entitlements.
    //
    // ⚠️ REPOINTED BY TASK_2026_177 P1b. This suite used to read
    // `BuildersMembershipService`, which held one of the three
    // `isBuildersMember` implementations RISK-A enumerated. That file was
    // deleted with the whole forum-integration tree; its logic was relocated FIRST
    // (MG-2.2 / RK-4) to `MembershipService`, which is now the SINGLE
    // implementation (R7.2). The invariant is unchanged and its subject is the
    // same code — only the file it lives in moved, so this is a repoint and not
    // a weakening.
    const membershipSource = readSource(
      'libs/api/membership/src/lib/membership.service.ts',
    );

    it.each(['ADMIN_EMAILS', 'AdminGuard', 'isAdmin'])(
      'membership.service.ts contains no reference to %s',
      (needle) => {
        expect(membershipSource).not.toContain(needle);
      },
    );

    it('no source file fuses the member gate with an admin check', () => {
      // The literal shape the plan forbids: `isBuildersMember || isAdmin`.
      for (const file of [
        'libs/api/membership/src/lib/membership.service.ts',
        'libs/api/community/src/lib/google-sessions/members.controller.ts',
      ]) {
        const source = readSource(file);
        expect(source).not.toMatch(/isBuildersMember\s*\|\|\s*isAdmin/);
        expect(source).not.toContain('AdminGuard');
      }
    });
  });

  describe('G6 — PacksModule registers no member-facing controller', () => {
    // The executable form of Decision 3, and the cheapest possible guard on
    // the whole architecture: packs may never acquire a member endpoint by
    // accident. Ptah stores a bookkeeping row; GitHub controls repo access.
    it('every controller in PacksModule is mounted under v1/admin/', () => {
      const controllers = controllersOf(PacksModule);

      expect(controllers.length).toBeGreaterThan(0);
      for (const controller of controllers) {
        const path = Reflect.getMetadata(PATH_METADATA, controller) as string;
        expect(path.startsWith('v1/admin/')).toBe(true);
      }
    });

    it('imports neither BuildersMembershipService nor MemberGroupsService', () => {
      // Packs perform NO membership resolution and NO cohort resolution.
      // `cohortKey` is a bookkeeping label enforced only by a Postgres FK.
      //
      // Asserted against IMPORT STATEMENTS rather than raw substrings: the
      // docblocks in these files deliberately name both services in prose to
      // explain why they are absent, and a naive `toContain` would flag that
      // documentation as a violation.
      //
      // ⚠️ REPOINTED BY TASK_2026_177 P1b, for the same reason as G4 above.
      // `builders-membership.service` was deleted with that tree, so
      // a pattern naming it would have become permanently vacuous — an assertion
      // that cannot fail is worse than none, because it reads as coverage.
      // `MembershipService` is the relocated single implementation, so it is now
      // the thing packs must not reach for.
      const forbiddenImports = [
        /from\s+'[^']*membership\.service'/,
        /from\s+'[^']*@ptah-api\/membership'/,
        /from\s+'[^']*member-groups\.service'/,
      ];

      for (const file of [
        'libs/api/community/src/lib/packs/packs.service.ts',
        'libs/api/community/src/lib/packs/packs.module.ts',
      ]) {
        const text = readSource(file);
        for (const pattern of forbiddenImports) {
          expect({ file, matched: pattern.test(text) }).toEqual({
            file,
            matched: false,
          });
        }
        // Nor injected by token.
        expect(text).not.toMatch(/@Inject\(\s*MembershipService\s*\)/);
        expect(text).not.toMatch(/@Inject\(\s*MemberGroupsService\s*\)/);
      }
    });
  });
});
