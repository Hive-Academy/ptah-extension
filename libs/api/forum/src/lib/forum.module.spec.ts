import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminGuard, AdminThrottlerGuard } from '@ptah-api/identity';

import * as barrel from '../index';

import { ForumModule } from './forum.module';
import { ReadStateService } from './read-state/read-state.service';
import { TopicsReadService } from './topics/topics-read.service';

/**
 * `ForumModule` and the lib's public surface.
 *
 * Three properties, each of which fails somewhere far away when it is wrong:
 *
 *   RISK-L — `NotificationsModule` is absent. Present, the lib does not compile
 *            and `app.module.spec.ts` (the real-injector boot test) goes red.
 *   §2.5   — exactly two SERVICES are exported. A third makes a forum mutation
 *            or a tombstone read callable from outside the guard chain, and
 *            nothing else in the repo would notice.
 *   §2.5   — `AdminGuard` / `AdminThrottlerGuard` are declared LOCALLY. Imported
 *            via `AdminModule` instead, the module graph acquires a cycle the
 *            day `AdminModule` reads the forum.
 */

function metadata<T>(key: string): T[] {
  return (Reflect.getMetadata(key, ForumModule) as T[]) ?? [];
}

describe('ForumModule', () => {
  describe('RISK-L — NotificationsModule is deliberately absent', () => {
    it('imports no notifications module', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      // `libs/api/notifications` does not exist until Batch 14. Plan §2.5 lists
      // it here; copying that list verbatim is an unresolvable import.
      expect(names).not.toContain('NotificationsModule');
    });

    it('records the omission as a DECISION in the module docblock', () => {
      // Without the note, the next reader sees a missing import rather than a
      // deferred one, and "fixes" it against a lib that does not exist.
      const source = readFileSync(join(__dirname, 'forum.module.ts'), 'utf8');

      expect(source).toContain('NotificationsModule');
      expect(source).toContain('RISK-L');
      expect(source).toMatch(/Batch 14/);
    });

    it('imports the five modules §2.5 names that DO exist', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      expect(names.sort()).toEqual([
        'AuditModule',
        'ConfigModule',
        'IdentityModule',
        'MembershipModule',
        'PrismaModule',
      ]);
    });
  });

  describe('§2.5 — the exported surface', () => {
    it('exports exactly TopicsReadService and ReadStateService', () => {
      const exports = metadata<unknown>(MODULE_METADATA.EXPORTS);

      expect(exports).toEqual([TopicsReadService, ReadStateService]);
    });

    it('the barrel exports no OTHER service', () => {
      // The property that matters is about services, not symbol count: a
      // controller class cannot be constructed outside Nest because its
      // dependencies are exactly the services withheld here.
      const services = Object.keys(barrel).filter((name) =>
        name.endsWith('Service'),
      );

      expect(services.sort()).toEqual([
        'ReadStateService',
        'TopicsReadService',
      ]);
    });

    it('the barrel exports no write service by any name', () => {
      for (const forbidden of [
        'TopicsService',
        'PostsService',
        'CategoriesService',
        'SearchService',
        'AcceptedAnswerService',
        'ReactionsService',
        'AdminTopicsReadService',
      ]) {
        expect({ forbidden, exported: forbidden in barrel }).toEqual({
          forbidden,
          exported: false,
        });
      }
    });

    it('the barrel exports none of common/ — NOT_DELETED above all', () => {
      // `NOT_DELETED` leaving the lib would let a consumer hand-build a `where`
      // and read the forum directly, past every visibility clause.
      for (const forbidden of [
        'NOT_DELETED',
        'deletedFilter',
        'buildCategoryVisibilityWhere',
        'restorableWhere',
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
        'AdminCommunityCategoriesController',
        'AdminCommunityPostsController',
        'AdminCommunityTopicsController',
        'MemberCommunityController',
        'MemberSearchController',
      ]);
    });
  });

  describe('§2.5 — guards are declared LOCALLY, not via AdminModule', () => {
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
      const source = readFileSync(join(__dirname, 'forum.module.ts'), 'utf8');
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

  describe('the registered surface', () => {
    it('declares the nine services', () => {
      const providers = metadata<{ name?: string }>(MODULE_METADATA.PROVIDERS)
        .map((p) => p?.name ?? String(p))
        .filter((name) => name.endsWith('Service'));

      expect(providers.sort()).toEqual([
        'AcceptedAnswerService',
        'AdminTopicsReadService',
        'CategoriesService',
        'PostsService',
        'ReactionsService',
        'ReadStateService',
        'SearchService',
        'TopicsReadService',
        'TopicsService',
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
        'v1/admin/community/categories',
        'v1/admin/community/posts',
        'v1/admin/community/topics',
        'v1/members/community',
        'v1/members/search',
      ]);

      // RI-1, restated locally: no prefix is a path-prefix of another.
      const violations: string[] = [];
      for (const a of prefixes) {
        for (const b of prefixes) {
          if (a !== b && b.startsWith(`${a}/`)) violations.push(`${a} < ${b}`);
        }
      }
      expect(violations).toEqual([]);
    });

    it('is NOT @Global (MemberHubModule imports it explicitly)', () => {
      // A feature module that makes itself global removes the one place a
      // reader can see who depends on it.
      expect(Reflect.getMetadata('__module:global__', ForumModule)).toBeFalsy();
    });
  });
});
