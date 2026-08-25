import 'reflect-metadata';

import { InternalServerErrorException } from '@nestjs/common';
import {
  GUARDS_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard } from '@ptah-api/membership';
import type { MemberContext } from '@ptah-api/membership';
import type { MemberPack } from '@ptah-contracts/community';

import { MemberPacksController } from './member-packs.controller';
import { MemberPacksModule } from './member-packs.module';
import { MemberPacksService } from './member-packs.service';
import { PacksModule } from './packs.module';

/**
 * `MemberPacksController` + `MemberPacksModule` — §3.6, R5.1, PRE-1, PRE-2,
 * RISK-AG / G6, ground truth 11.
 *
 * The behaviour here is one line long; the properties that matter are
 * STRUCTURAL, and every one of them fails somewhere far away when it is wrong:
 *
 *   - the guard chain is at CLASS level, in the right order (leak risk L1);
 *   - the prefix is a depth-3 literal disjoint from the nine existing member
 *     prefixes (RI-1);
 *   - this controller is in `MemberPacksModule` and NOT in `PacksModule`
 *     (RISK-AG — `admin-guards.spec.ts` G6 is the far-away failure);
 *   - there is no `@Query` and no `@Body`, so `NAMED_PRIMITIVE_PARAM_COUNT`
 *     (exact equality at 6) cannot move.
 */

const CTX: MemberContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const PACK: MemberPack = {
  id: 'pack_1',
  slug: 'saas-starter',
  title: 'SaaS Starter',
  description: 'A production-shaped SaaS codebase.',
  repoUrl: 'https://github.com/Hive-Academy/saas-starter',
  tags: ['nestjs'],
  cohortName: 'Founding Members',
  accessNote: 'You will receive a GitHub invite within 24h.',
};

function guardedRequest(): Request {
  return {
    memberContext: CTX,
    method: 'GET',
    path: '/x',
  } as unknown as Request;
}

function unguardedRequest(): Request {
  return { method: 'GET', path: '/x' } as unknown as Request;
}

function build() {
  const packs = { list: jest.fn().mockResolvedValue([PACK]) };
  const controller = new MemberPacksController(
    packs as unknown as MemberPacksService,
  );
  return { controller, packs };
}

function controllersOf(
  module: unknown,
): Array<new (...args: never[]) => unknown> {
  return (
    (Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      module as object,
    ) as Array<new (...args: never[]) => unknown>) ?? []
  );
}

describe('MemberPacksController', () => {
  describe('the handler', () => {
    it('returns the member-visible packs for the guard-resolved context', async () => {
      const { controller, packs } = build();

      await expect(controller.list(guardedRequest())).resolves.toEqual([PACK]);
      expect(packs.list).toHaveBeenCalledWith(CTX);
    });

    it('refuses to serve when MemberGuard has not run (the tripwire)', async () => {
      // Not a null check: the branch is unreachable while the guard chain is
      // intact, and it exists so that DELETING the guards is a loud 500 rather
      // than an ungated read.
      const { controller, packs } = build();

      await expect(controller.list(unguardedRequest())).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(packs.list).not.toHaveBeenCalled();
    });

    it('takes exactly ONE handler parameter — no @Query, no @Body', () => {
      // `NAMED_PRIMITIVE_PARAM_COUNT` is an EXACT-EQUALITY assertion at 6 in
      // `controller-validation.spec.ts`. A `@Query('page') page: string` added
      // here would make the server-wide total 7 and fail the build; this pins
      // the shape locally so the failure is diagnosed here instead.
      expect(MemberPacksController.prototype.list).toHaveLength(1);
    });
  });

  describe('leak risk L1 — the guard chain is at CLASS level, in order', () => {
    it('declares JwtAuthGuard then MemberGuard on the class', () => {
      const guards = (Reflect.getMetadata(
        GUARDS_METADATA,
        MemberPacksController,
      ) ?? []) as unknown[];

      expect(guards).toEqual([JwtAuthGuard, MemberGuard]);
    });

    it('declares NO method-level guards — a later handler is guarded by default', () => {
      const methodGuards = Reflect.getMetadata(
        GUARDS_METADATA,
        MemberPacksController.prototype.list,
      );

      expect(methodGuards).toBeUndefined();
    });
  });

  describe('RI-1 — the prefix is a disjoint depth-3 literal', () => {
    it('is mounted at v1/members/packs', () => {
      expect(Reflect.getMetadata(PATH_METADATA, MemberPacksController)).toBe(
        'v1/members/packs',
      );
    });

    it('is segment-wise disjoint from every existing member prefix', () => {
      const mine = 'v1/members/packs';
      const existing = [
        'v1/members/entitlement',
        'v1/members/hub',
        'v1/members/sessions',
        'v1/members/session-requests',
        'v1/members/live',
        'v1/members/community',
        'v1/members/courses',
        'v1/members/lesson-comments',
        'v1/members/search',
      ];

      for (const other of existing) {
        expect({
          other,
          nested: mine.startsWith(`${other}/`) || other.startsWith(`${mine}/`),
        }).toEqual({ other, nested: false });
      }
    });
  });

  describe('RISK-AG — co-location is NOT co-registration', () => {
    it('MemberPacksModule declares exactly one controller, and it is this one', () => {
      expect(controllersOf(MemberPacksModule)).toEqual([MemberPacksController]);
    });

    it('PacksModule does NOT declare it — the far-away failure is admin-guards G6', () => {
      // G6: "every controller in PacksModule is mounted under v1/admin/". This
      // controller is at `v1/members/packs`, so its presence there would fail G6
      // in a different project's test suite. Asserted here too, so the diagnosis
      // arrives in the lib that caused it.
      expect(controllersOf(PacksModule)).not.toContain(MemberPacksController);
    });

    it('every controller still in PacksModule is mounted under v1/admin/', () => {
      // G6 restated locally, so this file fails if a member controller is ever
      // moved INTO PacksModule rather than added beside it.
      const controllers = controllersOf(PacksModule);

      expect(controllers.length).toBeGreaterThan(0);
      for (const controller of controllers) {
        const path = Reflect.getMetadata(PATH_METADATA, controller) as string;
        expect({
          controller: controller.name,
          admin: path.startsWith('v1/admin/'),
        }).toEqual({
          controller: controller.name,
          admin: true,
        });
      }
    });

    it('the two modules share no import edge in either direction', () => {
      const names = (module: unknown) =>
        (
          (Reflect.getMetadata(
            MODULE_METADATA.IMPORTS,
            module as object,
          ) as Array<{
            name?: string;
          }>) ?? []
        ).map((m) => m?.name ?? String(m));

      expect(names(MemberPacksModule)).not.toContain('PacksModule');
      expect(names(PacksModule)).not.toContain('MemberPacksModule');
    });

    it('provides its OWN service and not PacksService', () => {
      const providers = (
        (Reflect.getMetadata(
          MODULE_METADATA.PROVIDERS,
          MemberPacksModule,
        ) as Array<{ name?: string }>) ?? []
      ).map((p) => p?.name ?? String(p));

      expect(providers).toEqual(['MemberPacksService']);
    });

    it('is NOT @Global — the member read path stays unreachable from elsewhere', () => {
      expect(
        Reflect.getMetadata('__module:global__', MemberPacksModule),
      ).toBeFalsy();
    });

    it('does not re-provide MemberGuard (MembershipModule is @Global and exports it)', () => {
      const providers = (
        (Reflect.getMetadata(
          MODULE_METADATA.PROVIDERS,
          MemberPacksModule,
        ) as Array<{ name?: string }>) ?? []
      ).map((p) => p?.name ?? String(p));

      // A second declaration would build a SECOND guard instance resolving
      // entitlement out of a different injector.
      expect(providers).not.toContain('MemberGuard');
    });
  });
});
