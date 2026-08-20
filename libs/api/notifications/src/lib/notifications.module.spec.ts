import 'reflect-metadata';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import * as barrel from '../index';

import { MemberNotificationsController } from './member-notifications.controller';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';

/**
 * `NotificationsModule` and this lib's public surface — plan §2.7, R10,
 * ASSUMPTION-19, RISK-F.
 *
 * Four properties, each of which fails somewhere far away when it is wrong:
 *
 *   §2.7          — it is `@Global()`. Not global, four producers in three libs
 *                   each acquire a graph edge into this one.
 *   R10 / NFR-S8  — it exports `NotificationsService` and NOTHING else. A
 *                   second export makes the global `deleteMany`, or a raw
 *                   Prisma handle, reachable from a request handler.
 *   ASSUMPTION-19 — there is no `common/` directory here. The symmetric move
 *                   would be a fourth copy of helpers that have nothing to do.
 *   RISK-F        — the tag set is `scope:api` + `type:util`, which is what
 *                   makes the dependency DIRECTION structural.
 */

function metadata<T>(key: string): T[] {
  return (Reflect.getMetadata(key, NotificationsModule) as T[]) ?? [];
}

describe('NotificationsModule', () => {
  describe('§2.7 — it is @Global(), and PacksModule is not', () => {
    it('is registered globally', () => {
      expect(
        Reflect.getMetadata('__module:global__', NotificationsModule),
      ).toBeTruthy();
    });

    it('records WHY in the docblock, and contrasts it with PacksModule', () => {
      // The two decisions look contradictory and are the same decision applied
      // to opposite shapes. Without the note the next reader "fixes" one of
      // them to match the other.
      const source = readFileSync(
        join(__dirname, 'notifications.module.ts'),
        'utf8',
      );

      expect(source).toContain('@Global()');
      expect(source).toContain('PacksModule');
      expect(source).toContain('ASSUMPTION-19');
    });
  });

  describe('the exported surface', () => {
    it('exports exactly NotificationsService', () => {
      expect(metadata<unknown>(MODULE_METADATA.EXPORTS)).toEqual([
        NotificationsService,
      ]);
    });

    it('does NOT export the retention service', () => {
      // `prune()` is a global `deleteMany` with no `userId` in its `where`.
      const exportNames = metadata<{ name?: string }>(
        MODULE_METADATA.EXPORTS,
      ).map((e) => e?.name ?? String(e));

      expect(exportNames).not.toContain('NotificationRetentionService');
      expect('NotificationRetentionService' in barrel).toBe(false);
    });

    it('does NOT export the Prisma client or any where-builder', () => {
      // The same reasoning `forum.module.spec.ts` uses for its `common/`
      // non-export: a consumer that can reach a `where` builder can read past
      // every ownership clause.
      for (const forbidden of [
        'PrismaService',
        'PrismaModule',
        'NotificationRetentionService',
        'RETENTION_DAYS',
        'PRUNE_JOB_NAME',
        'PRUNE_SCHEDULE',
      ]) {
        expect({ forbidden, exported: forbidden in barrel }).toEqual({
          forbidden,
          exported: false,
        });
      }
    });

    it('exports the pure mapper, and that is deliberate', () => {
      // `toMemberNotification` grants no authority: it takes a row the caller
      // already holds and drops the two identifying columns. It is exported
      // because it rides `notifications.service.ts` and hiding it would mean
      // splitting a 20-line function into its own file for no property. The
      // rule this barrel enforces is about REACH — a Prisma handle, a
      // `where`-builder, or the global `deleteMany` — not about symbol count.
      expect('toMemberNotification' in barrel).toBe(true);
      expect('UNNAMED_ACTOR' in barrel).toBe(true);
    });

    it('the barrel exports exactly one Service, and it is the write/read facade', () => {
      const services = Object.keys(barrel).filter((name) =>
        name.endsWith('Service'),
      );

      expect(services).toEqual(['NotificationsService']);
    });

    it('exports the controller class PRE-2 needs', () => {
      // `controller-registry.ts` imports every controller BY PACKAGE NAME, so a
      // controller the barrel hides cannot be registered and the census fails.
      const controllers = Object.keys(barrel).filter((name) =>
        name.endsWith('Controller'),
      );

      expect(controllers).toEqual(['MemberNotificationsController']);
    });

    it('re-exports nothing from the contracts lib', () => {
      // One vocabulary, one export site. A second is a second place to drift.
      for (const forbidden of [
        'NOTIFICATION_KINDS',
        'NOTIFICATION_TARGET_TYPES',
        'isNotificationKind',
        'memberNotificationSchema',
        'pagedSchema',
      ]) {
        expect({ forbidden, exported: forbidden in barrel }).toEqual({
          forbidden,
          exported: false,
        });
      }
    });
  });

  describe('the registered surface', () => {
    it('declares both services — the retention one is provided, not exported', () => {
      const providers = metadata<{ name?: string }>(MODULE_METADATA.PROVIDERS)
        .map((p) => p?.name ?? String(p))
        .sort();

      expect(providers).toEqual([
        'NotificationRetentionService',
        'NotificationsService',
      ]);
    });

    it('declares ONE controller, at one depth-3 literal prefix', () => {
      const controllers = metadata<new (...args: never[]) => unknown>(
        MODULE_METADATA.CONTROLLERS,
      );

      expect(controllers).toEqual([MemberNotificationsController]);
      expect(
        Reflect.getMetadata(PATH_METADATA, MemberNotificationsController),
      ).toBe('v1/members/notifications');
    });

    it('imports IdentityModule and MembershipModule, and nothing else', () => {
      // Both guards named in `@UseGuards` must be resolvable in THIS injector.
      // Anything more would be an edge this lib does not need — it deliberately
      // depends on no feature lib, so the producers depend on it and never the
      // reverse.
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      expect(names.sort()).toEqual(['IdentityModule', 'MembershipModule']);
    });

    it('does NOT re-provide MemberGuard or JwtAuthGuard', () => {
      // A second `MemberGuard` declaration builds a second instance resolving
      // entitlement out of a different injector.
      const providers = metadata<{ name?: string }>(
        MODULE_METADATA.PROVIDERS,
      ).map((p) => p?.name ?? String(p));

      expect(providers).not.toContain('MemberGuard');
      expect(providers).not.toContain('JwtAuthGuard');
    });

    it('does NOT register ScheduleModule.forRoot() — the app owns that', () => {
      // `forRoot()` inside a `@Global()` module three libs import would
      // register the scheduler root more than once.
      const source = readFileSync(
        join(__dirname, 'notifications.module.ts'),
        'utf8',
      );

      expect(source).not.toMatch(/ScheduleModule\.forRoot\(\)\s*,/);
      expect(source).toContain('RISK-AE');
    });

    it('imports no AuditModule — a notification is not an admin mutation', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      expect(names).not.toContain('AuditModule');
    });
  });

  describe('🔴 ASSUMPTION-19 — this lib copies NO common/ helpers', () => {
    const LIB_SRC = join(__dirname, '..');

    it('has no common/ directory', () => {
      // `forum`, `learning` and `community` each carry one (ASSUMPTION-11), so
      // the symmetric move would be a fourth set. A notification has no
      // visibility rule, no soft delete and no admin mutation, so there is
      // nothing for them to do. This test is what stops the symmetry from
      // doing the thinking.
      const entries = readdirSync(join(LIB_SRC, 'lib'), {
        withFileTypes: true,
      })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      expect(entries).not.toContain('common');
      expect(entries.sort()).toEqual(['dto']);
    });

    it('declares none of the three helpers by name, anywhere in the lib', () => {
      const sources = collectSources(join(LIB_SRC, 'lib'));

      for (const forbidden of [
        'NOT_DELETED',
        'deletedFilter',
        'buildLiveSessionVisibilityWhere',
        'buildCategoryVisibilityWhere',
        'writeAdminAudit',
      ]) {
        const offenders = sources
          .filter(([, text]) => text.includes(`export const ${forbidden}`))
          .map(([file]) => file);
        expect({ forbidden, offenders }).toEqual({ forbidden, offenders: [] });
      }
    });

    it('imports MemberContext as a TYPE, not a value', () => {
      const source = readFileSync(
        join(__dirname, 'notifications.service.ts'),
        'utf8',
      );

      expect(source).toMatch(
        /import type \{ MemberContext \} from '@ptah-api\/membership'/,
      );
    });
  });

  describe('RISK-F — the tag set is what makes the direction structural', () => {
    it('is scope:api + type:util, matching api-membership', () => {
      // 🔴 `type:util` MAY DEPEND ONLY ON `type:util` LIBS
      // (`@nx/enforce-module-boundaries`). Every dependency this lib has —
      // `@ptah-api/core`, `@ptah-api/identity`, `@ptah-api/membership`,
      // `@ptah-contracts/community` — is `type:util`, so the tag is legal.
      //
      // It is also the RIGHT tag rather than merely a legal one: `type:util`
      // forbids this lib from EVER depending on `forum`, `learning` or
      // `community` (all `type:feature`). The producers depend on notifications
      // and never the reverse, and that direction is now enforced by lint
      // instead of by intention.
      const project = JSON.parse(
        readFileSync(join(LIB_ROOT, 'project.json'), 'utf8'),
      ) as { tags: string[]; name: string };

      expect(project.name).toBe('api-notifications');
      expect(project.tags.sort()).toEqual(['scope:api', 'type:util']);
    });

    it('depends on no feature lib', () => {
      const sources = collectSources(join(__dirname, '..'));

      for (const forbidden of [
        '@ptah-api/forum',
        '@ptah-api/learning',
        '@ptah-api/community',
        '@ptah-api/member-hub',
      ]) {
        const offenders = sources
          .filter(([, text]) => text.includes(`from '${forbidden}'`))
          .map(([file]) => file);
        expect({ forbidden, offenders }).toEqual({ forbidden, offenders: [] });
      }
    });
  });
});

const LIB_ROOT = join(__dirname, '..', '..');

function collectSources(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push([full, readFileSync(full, 'utf8')]);
    }
  }
  return out;
}
