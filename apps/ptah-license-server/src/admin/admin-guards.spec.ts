import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import {
  MODULE_METADATA,
  PATH_METADATA,
  METHOD_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants';
import { AdminGuard } from './admin.guard';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { PacksModule } from '../packs/packs.module';
import { AdminPacksController } from '../packs/admin-packs.controller';
import { AdminSessionsController } from '../google-sessions/admin-sessions.controller';
import { AdminCommunityController } from '../discourse/admin-community.controller';
import { MemberGroupsController } from '../member-groups/member-groups.controller';

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
 *   G5 — the admin community controller exposes ONLY @Get handlers
 *   G6 — PacksModule registers no member-facing controller
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

const SRC = join(__dirname, '..');

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
      ['AdminCommunityController', AdminCommunityController],
      ['MemberGroupsController', MemberGroupsController],
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
      ['AdminCommunityController', AdminCommunityController],
    ])('%s is mounted under v1/admin/', (_name, ctrl) => {
      const path = Reflect.getMetadata(PATH_METADATA, ctrl) as string;
      expect(path.startsWith('v1/admin/')).toBe(true);
    });
  });

  describe('G4 — the Builders membership gate is not admin-aware', () => {
    // THE SECURITY INVARIANT. Admin access must be a SEPARATE authorized path,
    // never a loosening of the member gate. If this file ever learns about
    // ADMIN_EMAILS, AdminGuard, or an isAdmin flag, the two concerns have been
    // fused and a platform admin would silently gain member entitlements.
    const membershipSource = readFileSync(
      join(SRC, 'discourse', 'builders-membership.service.ts'),
      'utf8',
    );

    it.each(['ADMIN_EMAILS', 'AdminGuard', 'isAdmin'])(
      'builders-membership.service.ts contains no reference to %s',
      (needle) => {
        expect(membershipSource).not.toContain(needle);
      },
    );

    it('no source file fuses the member gate with an admin check', () => {
      // The literal shape the plan forbids: `isBuildersMember || isAdmin`.
      for (const file of [
        join(SRC, 'discourse', 'builders-membership.service.ts'),
        join(SRC, 'discourse', 'community.controller.ts'),
        join(SRC, 'google-sessions', 'members.controller.ts'),
      ]) {
        const source = readFileSync(file, 'utf8');
        expect(source).not.toMatch(/isBuildersMember\s*\|\|\s*isAdmin/);
        expect(source).not.toContain('AdminGuard');
      }
    });
  });

  describe('G5 — the admin community controller is READ-ONLY', () => {
    // The executable form of Checkpoint-1 Decision 1: all Discourse moderation
    // stays in Discourse's own admin panel. A contributor adding a moderation
    // write here fails the build rather than quietly reopening the surface.
    it('exposes only @Get handlers', () => {
      const proto = AdminCommunityController.prototype;
      const handlers = Object.getOwnPropertyNames(proto).filter(
        (name) => name !== 'constructor',
      );

      expect(handlers.length).toBeGreaterThan(0);

      for (const name of handlers) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        const method = Reflect.getMetadata(
          METHOD_METADATA,
          descriptor?.value as object,
        );
        expect({ name, method }).toEqual({
          name,
          method: RequestMethod.GET,
        });
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
      const forbiddenImports = [
        /from\s+'[^']*builders-membership\.service'/,
        /from\s+'[^']*member-groups\.service'/,
      ];

      for (const file of ['packs.service.ts', 'packs.module.ts']) {
        const text = readFileSync(join(SRC, 'packs', file), 'utf8');
        for (const pattern of forbiddenImports) {
          expect({ file, matched: pattern.test(text) }).toEqual({
            file,
            matched: false,
          });
        }
        // Nor injected by token.
        expect(text).not.toMatch(/@Inject\(\s*BuildersMembershipService\s*\)/);
        expect(text).not.toMatch(/@Inject\(\s*MemberGroupsService\s*\)/);
      }
    });
  });
});
