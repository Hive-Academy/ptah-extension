import 'reflect-metadata';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminGuard, AdminThrottlerGuard } from '@ptah-api/identity';

import * as barrel from '../../index';

import { AdminLiveSessionsController } from './admin-live-sessions.controller';
import { LiveFeedService } from './live-feed.service';
import { LiveSessionsModule } from './live-sessions.module';
import { MemberLiveController } from './member-live.controller';

/**
 * `LiveSessionsModule` and the Phase-4 public surface of `@ptah-api/community`.
 *
 * Five properties, each of which fails somewhere far away when it is wrong:
 *
 *   RISK-L — `NotificationsModule` is absent. Present, the lib does not compile
 *            and `app.module.spec.ts` (the real-injector boot test) goes red.
 *   §2.9   — exactly ONE service is exported from this module. A second makes a
 *            live-session mutation or a hand-built visibility `where` callable
 *            from outside the guard chain.
 *   §2.9   — `AdminGuard` / `AdminThrottlerGuard` are declared LOCALLY, and
 *            `MemberGuard` is NOT. The asymmetry is the acyclicity idiom
 *            `MemberGroupsModule` established plus the `@Global()`
 *            `MembershipModule` rule, and getting the second half wrong gives
 *            two entitlement resolvers in two injectors.
 *   NFR-P6 — `@ptah-api/youtube` is imported by EXACTLY ONE file in this
 *            directory. A read-path import would put a third-party call on every
 *            member page view.
 *   AD-12  — both prefixes are depth-3 literals, and the admin one is
 *            `v1/admin/live-sessions` rather than `v1/admin/sessions/live`.
 */

function metadata<T>(key: string): T[] {
  return (Reflect.getMetadata(key, LiveSessionsModule) as T[]) ?? [];
}

/** Every source file in `live-sessions/`, recursively, excluding specs. */
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

describe('LiveSessionsModule', () => {
  describe('RISK-L — NotificationsModule is deliberately absent', () => {
    it('imports no notifications module', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      // `libs/api/notifications` does not exist until Batch 14. R10.1's
      // producers include `session_request.status`, written one directory away,
      // so the temptation is real and the import would be unresolvable.
      expect(names).not.toContain('NotificationsModule');
    });

    it('records the omission as a DECISION in the module docblock', () => {
      // Without the note, the next reader sees a MISSING import rather than a
      // deferred one, and "fixes" it against a lib that does not exist.
      const source = readFileSync(
        join(__dirname, 'live-sessions.module.ts'),
        'utf8',
      );

      expect(source).toContain('NotificationsModule');
      expect(source).toContain('RISK-L');
      expect(source).toMatch(/Batch 14/);
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

    it('🔴 does NOT import GoogleSessionsModule, although LiveFeedService reads it', () => {
      // That module is @Global() and exports `SessionsService`, and the
      // injection is @Optional() — so an unregistered Google integration
      // degrades `calendarAvailable` to `false` (R3.6) rather than failing this
      // module's construction. An explicit import would turn graceful
      // degradation into a boot failure.
      const names = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );

      expect(names).not.toContain('GoogleSessionsModule');
    });
  });

  describe('§2.9 — the exported surface', () => {
    it('exports exactly LiveFeedService', () => {
      expect(metadata<unknown>(MODULE_METADATA.EXPORTS)).toEqual([
        LiveFeedService,
      ]);
    });

    it('the barrel exports no Phase-4 WRITE service', () => {
      // 🔴 `LiveSessionsService` carries every mutation AND the YouTube
      // authoring path, and is reachable only through this module's own
      // AdminGuard-gated controller. Exporting it would let a future consumer
      // create or delete a live session having passed through none of that.
      expect({
        LiveSessionsService: 'LiveSessionsService' in barrel,
      }).toEqual({ LiveSessionsService: false });
      expect('LiveFeedService' in barrel).toBe(true);
    });

    it('the barrel exports NOTHING from live-sessions/common/', () => {
      // `NOT_DELETED` or `buildLiveSessionVisibilityWhere` leaving the lib would
      // let a consumer hand-build a `where` and read past every visibility
      // clause — the same reason forum's and learning's `common/` are hidden.
      for (const forbidden of [
        'NOT_DELETED',
        'buildLiveSessionVisibilityWhere',
        'restorableWhere',
        'assertRestored',
        'requireMemberContext',
        'requireAdminUserId',
        'auditHook',
        'adminActor',
        'IsOptionalNotNull',
        'NullMeansAbsent',
        'RESTORE_WINDOW_DAYS',
      ]) {
        expect({ forbidden, exported: forbidden in barrel }).toEqual({
          forbidden,
          exported: false,
        });
      }
    });

    it('PRE-2 — both controller classes ARE exported, so the registry can import them', () => {
      // A controller the barrel hides cannot be registered in
      // `controller-registry.ts`, and the census assertion fails the build. A
      // controller class is inert without an instance and cannot be constructed
      // outside Nest, because its constructor dependencies are exactly the
      // services withheld above — so the capability rule survives.
      expect('MemberLiveController' in barrel).toBe(true);
      expect('AdminLiveSessionsController' in barrel).toBe(true);
    });
  });

  describe('§2.9 — the guard declarations, and the asymmetry', () => {
    it('declares AdminGuard and AdminThrottlerGuard LOCALLY', () => {
      const providers = metadata<unknown>(MODULE_METADATA.PROVIDERS);

      expect(providers).toContain(AdminGuard);
      expect(providers).toContain(AdminThrottlerGuard);
      // …and NOT by importing AdminModule, which would make a feature module
      // depend on the admin dashboard for a stateless guard, and would become a
      // cycle the day AdminModule reads the live schedule.
      const imports = metadata<{ name?: string }>(MODULE_METADATA.IMPORTS).map(
        (m) => m?.name ?? String(m),
      );
      expect(imports).not.toContain('AdminModule');
    });

    it('🔴 does NOT re-declare MemberGuard', () => {
      // `MembershipModule` is @Global() and exports it. A second declaration
      // creates a second instance resolving entitlement out of a different
      // injector — a member's `cohortKeys` computed by one copy and their
      // `entitled` by another.
      const names = metadata<{ name?: string }>(MODULE_METADATA.PROVIDERS).map(
        (p) => p?.name ?? String(p),
      );

      expect(names).not.toContain('MemberGuard');
    });

    it('declares exactly the two services and the two guards', () => {
      const names = metadata<{ name?: string }>(MODULE_METADATA.PROVIDERS)
        .map((p) => p?.name ?? String(p))
        .sort();

      expect(names).toEqual([
        'AdminGuard',
        'AdminThrottlerGuard',
        'LiveFeedService',
        'LiveSessionsService',
      ]);
    });
  });

  describe('🔴 NFR-P6 — exactly one file may import @ptah-api/youtube', () => {
    it('names the importer, rather than counting it', () => {
      // The same shape `markdown-chokepoint.spec.ts` uses for its three
      // importers: a count would pass for a set that swapped one file for
      // another.
      const importers = sourceFiles(__dirname)
        .filter((file) =>
          /^\s*import[\s\S]*?from\s+'@ptah-api\/youtube';/m.test(
            readFileSync(file, 'utf8'),
          ),
        )
        .map((file) => file.slice(__dirname.length + 1).replace(/\\/g, '/'))
        .sort();

      expect(importers).toEqual([
        'live-sessions.module.ts',
        'live-sessions.service.ts',
      ]);
    });

    it('the scan is not vacuous — it really did walk the whole directory', () => {
      // A walk that matched nothing would make the assertion above pass on an
      // empty set for ever.
      const files = sourceFiles(__dirname).map((f) =>
        f.slice(__dirname.length + 1).replace(/\\/g, '/'),
      );

      expect(files.length).toBeGreaterThanOrEqual(12);
      expect(files).toContain('live-feed.service.ts');
      expect(files).toContain('common/visibility.ts');
      expect(files).toContain('dto/create-live-session.dto.ts');
    });
  });

  describe('AD-12 / RI-1 — the two prefixes', () => {
    it('mounts the member surface at the depth-3 literal v1/members/live', () => {
      expect(Reflect.getMetadata(PATH_METADATA, MemberLiveController)).toBe(
        'v1/members/live',
      );
    });

    it('🔴 mounts the admin surface at v1/admin/live-sessions, NOT v1/admin/sessions/live', () => {
      // The nested form would be a proper segment-wise path prefix of the
      // existing `v1/admin/sessions` and RI-1 rejects it — the same shape
      // (RISK-J) that forced the forum's moderation surface into three
      // controllers and made `v1/admin/course-modules` a hyphenated sibling.
      const prefix = Reflect.getMetadata(
        PATH_METADATA,
        AdminLiveSessionsController,
      ) as string;

      expect(prefix).toBe('v1/admin/live-sessions');
      expect(prefix.split('/')).toHaveLength(3);
      expect(prefix.startsWith('v1/admin/sessions/')).toBe(false);
    });

    it('registers exactly the two controllers', () => {
      expect(metadata<unknown>(MODULE_METADATA.CONTROLLERS)).toEqual([
        MemberLiveController,
        AdminLiveSessionsController,
      ]);
    });
  });
});
