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
 *   RISK-L — `NotificationsModule` is absent from the IMPORTS while
 *            `NotificationsService` IS injected by two of the services. Phase 5
 *            changed the reason for the absence and not the absence: see the
 *            describe block below.
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
  /**
   * 🔴 RISK-L, REWRITTEN IN THE CHANGE THAT MADE ITS OLD REASON FALSE
   * (TASK_2026_177 Task 14.14).
   *
   * These assertions used to mean "`libs/api/notifications` does not exist yet".
   * It exists, and this module now PRODUCES notifications — so that sentence is
   * dead. The assertion that `NotificationsModule` is not imported is NOT dead:
   * the module is `@Global()` and exports `NotificationsService`, so the import
   * would be redundant, and its own docblock argues that an explicit import in
   * each of the four producer sites would put a graph edge into it from three
   * libs for no resolution benefit.
   *
   * ⚠️ DELETING THESE WOULD HAVE BEEN THE EASY MOVE AND THE WRONG ONE. An
   * absence that used to be "not built yet" and is now "reached globally" looks
   * identical in the metadata and is a completely different fact. Without the
   * pair below, the next reader cannot tell a deliberate global consumption from
   * a forgotten import — and the two fail in opposite directions.
   */
  describe('RISK-L — NotificationsModule is reached GLOBALLY, not imported', () => {
    it('imports no notifications module', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      // Plan §2.5 lists it in this module's imports. It is `@Global()`, so the
      // import buys nothing that is not already true.
      expect(names).not.toContain('NotificationsModule');
    });

    it('🔴 …while this lib DOES consume NotificationsService — the absence is not an omission', () => {
      // THE OTHER HALF, and the one that makes the assertion above meaningful.
      // Without it, deleting both producers would leave this file green while
      // R10.1 shipped with no forum notifications at all.
      const posts = readFileSync(
        join(__dirname, 'posts', 'posts.service.ts'),
        'utf8',
      );
      const accepted = readFileSync(
        join(__dirname, 'posts', 'accepted-answer.service.ts'),
        'utf8',
      );

      for (const [name, source] of [
        ['posts.service.ts', posts],
        ['accepted-answer.service.ts', accepted],
      ] as const) {
        // Asserted against the IMPORT STATEMENT and the `@Inject(...)`, never a
        // bare substring — both docblocks name the service in prose, so a
        // substring match would pass against a file that only talks about it.
        expect({
          name,
          imports: /from\s+'@ptah-api\/notifications'/.test(source),
          injects: /@Inject\(NotificationsService\)/.test(source),
        }).toEqual({ name, imports: true, injects: true });
      }
    });

    it('records the reason as a DECISION in the module docblock', () => {
      // The prose must say WHY the import is absent now that "it does not exist"
      // is false. `@Global` is the load-bearing word.
      const source = readFileSync(join(__dirname, 'forum.module.ts'), 'utf8');

      expect(source).toContain('NotificationsModule');
      expect(source).toContain('RISK-L');
      expect(source).toMatch(/@Global\(\)/);

      // 🔴 THE STALE CLAIMS MUST BE GONE. Both were true before Phase 5 and are
      // false after it; leaving either in place would be exactly the "retire one
      // false tense by writing another" trap Task 14.6 exists to avoid.
      expect(source).not.toMatch(/DOES NOT\s*\n?\s*\*?\s*EXIST/);
      expect(source).not.toMatch(/Batch 14 creates it/);
    });

    it('imports the five modules §2.5 names that DO exist', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      // ⚠️ STILL FIVE, AND THAT IS THE POINT. Adding the producers did not add
      // an import, so this count survives Phase 5 unchanged rather than being
      // re-derived — which is a stronger outcome than editing it to six.
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
