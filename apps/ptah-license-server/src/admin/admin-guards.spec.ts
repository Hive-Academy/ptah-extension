import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import {
  MODULE_METADATA,
  PATH_METADATA,
  METHOD_METADATA,
  GUARDS_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { AppModule } from '../app/app.module';
import { AdminModule } from './admin.module';
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
 *   G3 — PacksModule is registered BEFORE AdminModule (routing landmine)
 *   G4 — the Builders membership gate never consults admin identity
 *   G5 — the admin community controller exposes ONLY @Get handlers
 *   G6 — PacksModule registers no member-facing controller
 *   G7 — every @Body()/@Query() param binds dtoPipe (input validation is live)
 */

const SRC = join(__dirname, '..');

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
}

/**
 * Nest's `RouteParamtypes` values for the two decorators that carry a request
 * payload. Route args metadata is keyed `"<paramtype>:<index>"`.
 */
const PARAMTYPE = { BODY: 3, QUERY: 4 } as const;

interface ParamBinding {
  handler: string;
  kind: 'Body' | 'Query';
  /** True when a ValidationPipe with `expectedType` is bound to the param. */
  validated: boolean;
}

/**
 * Enumerate every `@Body()` / `@Query()` parameter on a controller and report
 * whether each one binds a `dtoPipe(...)` — i.e. a `ValidationPipe` carrying an
 * explicit `expectedType`.
 */
function paramBindings(
  controller: new (...args: never[]) => unknown,
): ParamBinding[] {
  const proto = controller.prototype as object;
  const handlers = Object.getOwnPropertyNames(proto).filter(
    (name) => name !== 'constructor',
  );

  const bindings: ParamBinding[] = [];
  for (const handler of handlers) {
    const meta =
      (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) as Record<
        string,
        { pipes?: unknown[] }
      >) ?? {};

    for (const [key, value] of Object.entries(meta)) {
      const paramtype = Number(key.split(':')[0]);
      if (paramtype !== PARAMTYPE.BODY && paramtype !== PARAMTYPE.QUERY) {
        continue;
      }
      const validated = (value.pipes ?? []).some(
        (pipe) =>
          pipe instanceof ValidationPipe &&
          (pipe as ValidationPipe & { expectedType?: unknown }).expectedType !==
            undefined,
      );
      bindings.push({
        handler: `${controller.name}.${handler}`,
        kind: paramtype === PARAMTYPE.BODY ? 'Body' : 'Query',
        validated,
      });
    }
  }
  return bindings;
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

  describe('G3 — module registration order (routing landmine, plan §7.2)', () => {
    // AdminController is @Controller('v1/admin') with @Get(':model') and
    // @Get(':model/:id') wildcards. A sibling @Controller('v1/admin/packs')
    // only wins the route match when its module is registered FIRST.
    // Registered after, GET /api/v1/admin/packs falls through to the generic
    // admin CRUD and 400s with "Unknown admin model: packs" — a confusing,
    // non-obvious failure. This asserts the ordering directly, with no Nest
    // bootstrap and no database.
    it('registers PacksModule before AdminModule in AppModule', () => {
      const imports = Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        AppModule,
      ) as unknown[];

      const packsIndex = imports.indexOf(PacksModule);
      const adminIndex = imports.indexOf(AdminModule);

      expect(packsIndex).toBeGreaterThanOrEqual(0);
      expect(adminIndex).toBeGreaterThanOrEqual(0);
      expect(packsIndex).toBeLessThan(adminIndex);
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

  describe('G7 — every @Body()/@Query() param binds dtoPipe (validation is live)', () => {
    // ⚠️ WHY THIS TEST EXISTS.
    // esbuild does not implement `emitDecoratorMetadata`, so Nest cannot infer
    // a handler parameter's DTO class and the globally-registered
    // ValidationPipe short-circuits on `if (!metatype) return value;`. The
    // practical effect is that a bare `@Body() dto: X` is SILENTLY UNVALIDATED:
    // every @Matches/@MaxLength/@IsUUID cap and `forbidNonWhitelisted` becomes
    // inert. This was live and demonstrated —
    // `POST /admin/groups {"key":"INVALID KEY WITH SPACES!!"}` returned 201.
    //
    // `dtoPipe(X)` fixes it per-parameter via ValidationPipe's `expectedType`.
    // Without this test that fix rots exactly the way the bug did: the next
    // contributor copies a bare `@Body()` from anywhere else in the codebase
    // (where it is still the norm) and ships an endpoint whose validation
    // silently does nothing, on the admin surface, where a bad `repoUrl` or an
    // unbounded array has the highest blast radius.
    const CONTROLLERS: Array<
      [string, new (...args: never[]) => unknown, number]
    > = [
      // [name, controller, minimum number of Body/Query params expected]
      ['AdminPacksController', AdminPacksController, 3],
      ['AdminSessionsController', AdminSessionsController, 3],
      ['AdminCommunityController', AdminCommunityController, 1],
      ['MemberGroupsController', MemberGroupsController, 4],
    ];

    it.each(CONTROLLERS)(
      '%s binds a ValidationPipe with expectedType on every payload param',
      (_name, controller) => {
        for (const binding of paramBindings(controller)) {
          // Assert on the whole object so a failure names the exact handler.
          expect(binding).toEqual({
            handler: binding.handler,
            kind: binding.kind,
            validated: true,
          });
        }
      },
    );

    // Anti-vacuity: if the metadata key format ever changes under us, the loop
    // above would iterate zero params and pass without checking anything.
    it.each(CONTROLLERS)(
      '%s actually exposes payload params for G7 to check',
      (_name, controller, minimum) => {
        expect(paramBindings(controller).length).toBeGreaterThanOrEqual(
          minimum,
        );
      },
    );
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
