import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { type Type } from '@nestjs/common';

import { AdminLicensesController } from '@ptah-api/admin';
import { AdminRecordsController } from '@ptah-api/admin';
import { AdminStatsController } from '@ptah-api/admin';
import { AdminUsersController } from '@ptah-api/admin';
import { AdminWaitlistController } from '@ptah-api/admin';
import { AuthController } from '@ptah-api/licensing';
import { ContactController } from '@ptah-api/marketing';
import { EventsController } from '@ptah-api/licensing';
import { AdminSessionsController } from '@ptah-api/community';
import { MembersController } from '@ptah-api/community';
import { AdminLiveSessionsController } from '@ptah-api/community';
import { AdminSessionRequestsController } from '@ptah-api/community';
import { MemberLiveController } from '@ptah-api/community';
import { MemberSessionRequestsController } from '@ptah-api/community';
import { MemberPacksController } from '@ptah-api/community';
import { MemberNotificationsController } from '@ptah-api/notifications';
import { MemberEntitlementController } from '@ptah-api/member-hub';
import { MemberHubController } from '@ptah-api/member-hub';
import { AdminCommunityCategoriesController } from '@ptah-api/forum';
import { AdminCommunityPostsController } from '@ptah-api/forum';
import { AdminCommunityTopicsController } from '@ptah-api/forum';
import { MemberCommunityController } from '@ptah-api/forum';
import { MemberSearchController } from '@ptah-api/forum';
import { AdminCourseModulesController } from '@ptah-api/learning';
import { AdminCoursesController } from '@ptah-api/learning';
import { AdminLessonsController } from '@ptah-api/learning';
import { MemberCoursesController } from '@ptah-api/learning';
import { MemberLessonCommentsController } from '@ptah-api/learning';
import { HealthController } from '../health/health.controller';
import { IntegrationLicensesController } from '@ptah-api/licensing';
import { LicenseController } from '@ptah-api/licensing';
import { AdminMarketingController } from '@ptah-api/marketing';
import { PublicMarketingController } from '@ptah-api/marketing';
import { ResendWebhookController } from '@ptah-api/marketing';
import { MemberGroupsController } from '@ptah-api/community';
import { AdminPacksController } from '@ptah-api/community';
import { PaddleController } from '@ptah-api/billing';
import { SessionController } from '@ptah-api/marketing';
import { SubscriptionController } from '@ptah-api/billing';
import { WaitlistController } from '@ptah-api/marketing';

/**
 * THE SHARED CONTROLLER REGISTRY (TASK_2026_170, plan §6.1).
 *
 * The single, authoritative list of every controller class in this server,
 * consumed by BOTH structural guards:
 *   - `src/common/controller-validation.spec.ts` — every `@Body()`/`@Query()`
 *     whole-object payload param binds a `ValidationPipe` with `expectedType`.
 *   - `src/common/route-map.spec.ts` — the registered route table and the
 *     RI-1/RI-2/RI-3 routing invariants. (Added by R2.)
 *
 * ⚠️ WHY THIS IS A MODULE AND NOT A CONST IN ONE SPEC.
 * Both specs need the identical list — 21 entries when this file was written,
 * 24 after TASK_2026_177 P1d, 29 since P2 added `libs/api/forum`, 34 since P3
 * added `libs/api/learning`, 38 since P4 added the live and private session
 * surfaces to `libs/api/community`, 40 since P5 added the member pack read and
 * the notification inbox. Duplicating
 * it would create exactly the drift both specs exist to prevent: a controller
 * added to one list and not the other is enforced by one guard and invisible to
 * the other, with nothing failing. One list, two importers.
 *
 * (The number is prose, not an assertion — the CENSUS below is what makes the
 * list impossible to leave incomplete, and it compares against the filesystem
 * rather than against a count.)
 *
 * ⚠️ WHY AN EXPLICIT IMPORT LIST AND NOT MODULE-GRAPH REFLECTION.
 * Reflecting over `AppModule` would drag Prisma's `onModuleInit` into specs
 * that must stay infra-free — no Postgres, no Nest bootstrap, no docker (the
 * same reasoning TASK_2026_169 used for G3; see its report §6(d)). The
 * hand-maintained list is instead kept honest by the CENSUS assertion in
 * `controller-validation.spec.ts`, which calls `findControllerFiles()`
 * below and fails if any `*.controller.ts` on disk is missing from it.
 *
 * ⚠️ CONTROLLERS NO LONGER LIVE IN ONE TREE.
 * The license server is being decomposed into `libs/api/*` scoped libs
 * (`@ptah-api/*`) by `tools/migration`. A controller may therefore sit in the
 * app's `src/` OR inside any api lib, and it MOVES from the first to the second
 * as its domain is extracted. The census consequently scans MULTIPLE ROOTS
 * (see {@link CONTROLLER_ROOTS}) and `file` paths are WORKSPACE-relative rather
 * than src-relative, so an entry keeps meaning the same thing on both sides of
 * a move. The roots are discovered from the filesystem at import time, so a new
 * api lib is covered the moment it exists — this file needs no edit for that.
 *
 * ⚠️ DO NOT ADD THIS MODULE TO `testing/index.ts`. The barrel is a general
 * test-harness surface; pulling every controller class (and its entire DI
 * import graph) into every consumer of `createMockPrisma()` is a needless
 * cost. Import it by direct path — which is what every existing consumer of
 * `src/testing/` already does (`'../testing/mock-prisma.factory'` etc.).
 *
 * This file is test-only. `tsconfig.app.json` excludes `src/testing/**`, and
 * no non-spec file imports it, so esbuild never bundles it into `main.js`.
 */

/**
 * The server's own `src/` directory.
 *
 * ⚠️ RE-DERIVED DELIBERATELY, NOT COPIED. This module lives at `src/testing/`,
 * so `join(__dirname, '..')` is `src/`. Its previous home was `src/common/`,
 * where `..` was ALSO `src/` — the two depths happen to agree, which is
 * precisely why this needs saying out loud: the next move may not be at the
 * same depth, and a silently-wrong root would make the census scan the wrong
 * tree and the file-exports-class assertion read the wrong files.
 *
 * The guard below turns "someone moved this file" into an immediate, named
 * failure instead of a confusing census diff.
 */
export const APP_SRC = join(__dirname, '..');

if (!existsSync(join(APP_SRC, 'main.ts'))) {
  throw new Error(
    `controller-registry: APP_SRC resolved to "${APP_SRC}", which does not ` +
      `contain main.ts. This module derives the server's src/ directory as ONE ` +
      `level above its own directory. If this file moved, re-derive APP_SRC ` +
      `here — do not adjust the callers.`,
  );
}

/**
 * The Nx workspace root, found by walking UP from this file until a directory
 * containing `nx.json` appears.
 *
 * ⚠️ WHY A SEARCH AND NOT A FIXED NUMBER OF `..` SEGMENTS. `file` paths are
 * workspace-relative because controllers live in two places now (this app and
 * `libs/api/*`), so the ledger needs an anchor ABOVE both. Counting `..` from
 * `apps/<app>/src/testing/` would bake this file's depth into the anchor and
 * break silently the next time it moves — the exact failure mode the APP_SRC
 * guard above exists to prevent. Searching for a marker cannot drift.
 */
function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'nx.json'))) return dir;

    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `controller-registry: walked up from "${start}" to the filesystem ` +
          `root without finding nx.json, so the workspace root could not be ` +
          `derived. Every ALL_CONTROLLERS \`file\` is resolved against it. If ` +
          `this server no longer lives inside the Nx workspace, re-derive the ` +
          `anchor here — do not adjust the callers.`,
      );
    }
    dir = parent;
  }
}

export const WORKSPACE_ROOT = findWorkspaceRoot(__dirname);

/**
 * Every `src/` tree that may contain a controller: this app, plus each
 * `libs/api/*` domain extracted out of it.
 *
 * Discovered from the filesystem rather than hand-listed, so extracting a new
 * api domain needs no edit here — the census covers it as soon as the lib
 * exists. Returns app-first, then libs in directory order.
 */
export function discoverControllerRoots(): string[] {
  const roots = [APP_SRC];

  const apiLibs = join(WORKSPACE_ROOT, 'libs', 'api');
  if (existsSync(apiLibs)) {
    for (const entry of readdirSync(apiLibs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const libSrc = join(apiLibs, entry.name, 'src');
      if (existsSync(libSrc)) roots.push(libSrc);
    }
  }

  return roots;
}

/** @see discoverControllerRoots */
export const CONTROLLER_ROOTS: readonly string[] = discoverControllerRoots();

for (const root of CONTROLLER_ROOTS) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(
      `controller-registry: controller root "${root}" is not a directory. ` +
        `Roots are discovered as this app's src/ plus every libs/api/*/src ` +
        `under "${WORKSPACE_ROOT}". A root that vanishes between discovery ` +
        `and use would make the census silently under-report.`,
    );
  }
}

/** One entry in {@link ALL_CONTROLLERS}. */
export interface ControllerRegistryEntry {
  /** UNIQUE, path-qualified human label — the key every ledger is keyed on. */
  readonly label: string;
  /**
   * Source path relative to {@link WORKSPACE_ROOT}, always `/`-separated.
   *
   * Workspace-relative, NOT src-relative: a controller lives in this app until
   * its domain is extracted, then in `libs/api/<domain>/src/lib/`. Anchoring
   * above both keeps one ledger meaningful across that move. `tools/migration`
   * rewrites these literals automatically when it moves a controller.
   */
  readonly file: string;
  readonly controller: Type<unknown>;
}

/**
 * Every controller in the server, with a UNIQUE human label and its
 * source-relative file path.
 *
 * ⚠️ The label is NOT `controller.name`, and it must stay that way.
 * Until TASK_2026_170, two distinct classes in this server were both called
 * `AdminController` (`admin/admin.controller.ts` and
 * `license/controllers/admin.controller.ts`), which forced an aliased import
 * here. Keying a debt ledger on the class name would have let one hide behind
 * the other: whichever got bound first would remove "AdminController" from the
 * ledger and silently exempt the other. R2 split the first into five
 * resource-named controllers and R3 renamed the second to
 * `IntegrationLicensesController`, so no duplicated controller class name is
 * left in the server and every import above is a plain one.
 *
 * Labels stay path-qualified anyway, and that is not a leftover: they are the
 * ledger keys, a path is guaranteed unique and a class name is not. Nothing
 * stops the next contributor from reintroducing a collision, and when they do
 * the ledgers must keep working without an edit.
 */
export const ALL_CONTROLLERS: readonly ControllerRegistryEntry[] = [
  {
    label: 'admin/AdminLicensesController',
    file: 'libs/api/admin/src/lib/admin-licenses.controller.ts',
    controller: AdminLicensesController,
  },
  {
    label: 'admin/AdminRecordsController',
    file: 'libs/api/admin/src/lib/admin-records.controller.ts',
    controller: AdminRecordsController,
  },
  {
    label: 'admin/AdminStatsController',
    file: 'libs/api/admin/src/lib/admin-stats.controller.ts',
    controller: AdminStatsController,
  },
  {
    label: 'admin/AdminUsersController',
    file: 'libs/api/admin/src/lib/admin-users.controller.ts',
    controller: AdminUsersController,
  },
  // ⚠️ THIS ENTRY WAS DELETED AND HAS NOW RETURNED, AND THE CLASS BEHIND IT IS
  // NOT THE ONE THAT LEFT. TASK_2026_201 first removed
  // `admin/AdminWaitlistController` outright: its only route was
  // `POST v1/admin/waitlist/invite`, the paid founding-invite wave, deleted
  // rather than repointed (context.md C2) — and a controller with zero routes
  // is not a legal resting state here, because `route-map.spec.ts`'s barren-
  // controller assertion requires every registered controller to contribute at
  // least one route. So the class, its module registration and this entry went
  // together. The same task's approve batch then created a NEW class at the
  // same path and the same name, owning `POST v1/admin/waitlist/approve` — a
  // free grant, sharing nothing with the invite wave but the URL prefix.
  {
    label: 'admin/AdminWaitlistController',
    file: 'libs/api/admin/src/lib/admin-waitlist.controller.ts',
    controller: AdminWaitlistController,
  },
  {
    label: 'app/auth/AuthController',
    file: 'libs/api/licensing/src/lib/auth-endpoints/auth.controller.ts',
    controller: AuthController,
  },
  {
    label: 'contact/ContactController',
    file: 'libs/api/marketing/src/lib/contact/contact.controller.ts',
    controller: ContactController,
  },
  {
    label: 'events/EventsController',
    file: 'libs/api/licensing/src/lib/events/events.controller.ts',
    controller: EventsController,
  },
  // TASK_2026_177 P2 — the native community forum (`libs/api/forum`). FIVE
  // controllers, and the count is the point of RISK-J: plan §2.5 proposed FOUR,
  // with the admin topic moderation sitting at the bare `v1/admin/community`.
  // That prefix is a strict path-prefix of `v1/admin/community/categories`,
  // which RI-1 rejects — and both ledgers it could be excused through
  // (`PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT`) are empty arrays, deliberately.
  // Splitting the moderation surface into three disjoint literal depth-4
  // prefixes is what makes the shape legal rather than debt.
  {
    label: 'forum/AdminCommunityCategoriesController',
    file: 'libs/api/forum/src/lib/categories/admin-community-categories.controller.ts',
    controller: AdminCommunityCategoriesController,
  },
  {
    label: 'forum/AdminCommunityPostsController',
    file: 'libs/api/forum/src/lib/posts/admin-community-posts.controller.ts',
    controller: AdminCommunityPostsController,
  },
  {
    label: 'forum/AdminCommunityTopicsController',
    file: 'libs/api/forum/src/lib/topics/admin-community-topics.controller.ts',
    controller: AdminCommunityTopicsController,
  },
  // Two member controllers, one lib, deliberately NOT one class — the same
  // reasoning as the member-hub pair below. `v1/members/community` and
  // `v1/members/search` are disjoint literal siblings at depth 3, and search
  // spans more than the forum (`?kinds=…,lessons` lands in Phase 3), so hanging
  // it off the community prefix would make Phase 3 either move a shipped URL or
  // leave it lying about its scope.
  {
    label: 'forum/MemberCommunityController',
    file: 'libs/api/forum/src/lib/topics/member-community.controller.ts',
    controller: MemberCommunityController,
  },
  {
    label: 'forum/MemberSearchController',
    file: 'libs/api/forum/src/lib/search/member-search.controller.ts',
    controller: MemberSearchController,
  },
  // TASK_2026_177 P3 — the course curriculum (`libs/api/learning`). FIVE
  // controllers at five disjoint LITERAL prefixes.
  //
  // 🔴 `v1/admin/course-modules` IS NOT A TYPO FOR `v1/admin/courses/modules`
  // AND MUST NEVER BE "SIMPLIFIED" INTO ONE (RISK-N). The nested form would be a
  // proper SEGMENT-WISE path prefix of `v1/admin/courses`, which RI-1 rejects —
  // the same shape (RISK-J) that forced the forum's moderation surface into
  // three controllers one phase earlier. `v1/admin/courses` IS a *string* prefix
  // of `v1/admin/course-modules`, and that is fine: RI-1 compares parsed
  // segments and segment 3 differs, which is precisely why the hyphenated
  // sibling is legal where the nested one is not.
  //
  // Two member controllers, one lib, deliberately NOT one class: plan §3.4 says
  // lesson comments are "separate, to avoid contesting `courses/:slug`". Hung
  // off the courses prefix, a comment route would sit beside `:slug` at the same
  // depth and the two would contest a concrete path.
  {
    label: 'learning/AdminCourseModulesController',
    file: 'libs/api/learning/src/lib/courses/admin-course-modules.controller.ts',
    controller: AdminCourseModulesController,
  },
  {
    label: 'learning/AdminCoursesController',
    file: 'libs/api/learning/src/lib/courses/admin-courses.controller.ts',
    controller: AdminCoursesController,
  },
  {
    label: 'learning/AdminLessonsController',
    file: 'libs/api/learning/src/lib/courses/admin-lessons.controller.ts',
    controller: AdminLessonsController,
  },
  {
    label: 'learning/MemberCoursesController',
    file: 'libs/api/learning/src/lib/courses/member-courses.controller.ts',
    controller: MemberCoursesController,
  },
  {
    label: 'learning/MemberLessonCommentsController',
    file: 'libs/api/learning/src/lib/comments/member-lesson-comments.controller.ts',
    controller: MemberLessonCommentsController,
  },
  {
    label: 'google-sessions/AdminSessionsController',
    file: 'libs/api/community/src/lib/google-sessions/admin-sessions.controller.ts',
    controller: AdminSessionsController,
  },
  {
    label: 'google-sessions/MembersController',
    file: 'libs/api/community/src/lib/google-sessions/members.controller.ts',
    controller: MembersController,
  },
  // TASK_2026_177 P4 — live sessions and private-session requests. FOUR
  // controllers at four disjoint LITERAL depth-3 prefixes, in ONE lib
  // (`libs/api/community`) but TWO Nest modules: `LiveSessionsModule` owns the
  // two `live` surfaces, and `GoogleSessionsModule` absorbs the two
  // `session-request` ones because R4 extends `SessionRequest` and the Calendar
  // write path it already owns (AD-6).
  //
  // 🔴 `v1/admin/live-sessions` AND `v1/admin/session-requests` ARE SIBLINGS OF
  // THE EXISTING `v1/admin/sessions`, NOT CHILDREN OF IT. The nested forms
  // `v1/admin/sessions/{live,requests}` would be proper SEGMENT-WISE path
  // prefixes of it, which RI-1 rejects — the same shape (RISK-J) that forced the
  // forum's moderation surface into three controllers in Batch 6 and made
  // `v1/admin/course-modules` a hyphenated sibling in Batch 9. The same holds on
  // the member side for `v1/members/{live,session-requests}` against
  // `v1/members/sessions`.
  //
  // Two member controllers, deliberately NOT one class: `v1/members/live` is a
  // READ of a schedule anyone entitled may see, `v1/members/session-requests` is
  // a member's OWN correspondence with the founder. Merging them would hang R4.3's
  // own-only rule off the same prefix as a public feed, and the two would then
  // contest nothing — but the class would have two reasons to change and one
  // guard chain covering both.
  {
    label: 'google-sessions/AdminSessionRequestsController',
    file: 'libs/api/community/src/lib/google-sessions/admin-session-requests.controller.ts',
    controller: AdminSessionRequestsController,
  },
  {
    label: 'google-sessions/MemberSessionRequestsController',
    file: 'libs/api/community/src/lib/google-sessions/member-session-requests.controller.ts',
    controller: MemberSessionRequestsController,
  },
  {
    label: 'live-sessions/AdminLiveSessionsController',
    file: 'libs/api/community/src/lib/live-sessions/admin-live-sessions.controller.ts',
    controller: AdminLiveSessionsController,
  },
  {
    label: 'live-sessions/MemberLiveController',
    file: 'libs/api/community/src/lib/live-sessions/member-live.controller.ts',
    controller: MemberLiveController,
  },
  {
    label: 'health/HealthController',
    file: 'apps/ptah-license-server/src/health/health.controller.ts',
    controller: HealthController,
  },
  {
    label: 'license/IntegrationLicensesController',
    file: 'libs/api/licensing/src/lib/license/controllers/integration-licenses.controller.ts',
    controller: IntegrationLicensesController,
  },
  {
    label: 'license/LicenseController',
    file: 'libs/api/licensing/src/lib/license/controllers/license.controller.ts',
    controller: LicenseController,
  },
  {
    label: 'marketing/AdminMarketingController',
    file: 'libs/api/marketing/src/lib/marketing/controllers/admin-marketing.controller.ts',
    controller: AdminMarketingController,
  },
  {
    label: 'marketing/PublicMarketingController',
    file: 'libs/api/marketing/src/lib/marketing/controllers/public-marketing.controller.ts',
    controller: PublicMarketingController,
  },
  {
    label: 'marketing/ResendWebhookController',
    file: 'libs/api/marketing/src/lib/marketing/controllers/resend-webhook.controller.ts',
    controller: ResendWebhookController,
  },
  {
    label: 'member-groups/MemberGroupsController',
    file: 'libs/api/community/src/lib/member-groups/member-groups.controller.ts',
    controller: MemberGroupsController,
  },
  // TASK_2026_177 P1d. Two controllers, one lib, deliberately NOT one class:
  // `v1/members/entitlement` runs `JwtAuthGuard` alone (a non-member gets
  // `200 { entitled: false }`, R7.7) while `v1/members/hub` adds `MemberGuard`
  // (a non-member gets 403). Guards are declared per class, so merging them
  // would force the probe behind the gate it exists to report on.
  {
    label: 'member-hub/MemberEntitlementController',
    file: 'libs/api/member-hub/src/lib/member-entitlement.controller.ts',
    controller: MemberEntitlementController,
  },
  {
    label: 'member-hub/MemberHubController',
    file: 'libs/api/member-hub/src/lib/member-hub.controller.ts',
    controller: MemberHubController,
  },
  {
    label: 'packs/AdminPacksController',
    file: 'libs/api/community/src/lib/packs/admin-packs.controller.ts',
    controller: AdminPacksController,
  },
  // TASK_2026_177 P5 — the member-facing half of the pack registry.
  //
  // 🔴 SAME DIRECTORY AS `AdminPacksController`, DIFFERENT NEST MODULE
  // (RISK-AG). `admin-guards.spec.ts` G6 asserts that every controller in
  // `PacksModule` is mounted under `v1/admin/`; this one is at
  // `v1/members/packs` and is registered by `MemberPacksModule`, which imports
  // nothing from `PacksModule` and provides its own `MemberPacksService`.
  // Co-location is not co-registration, and G6 stayed green and unmodified
  // through Phase 5 — which is exactly what `admin-packs.controller.ts:48-50`
  // predicted when it said this sibling would arrive.
  {
    label: 'packs/MemberPacksController',
    file: 'libs/api/community/src/lib/packs/member-packs.controller.ts',
    controller: MemberPacksController,
  },
  // TASK_2026_177 P5 — the member-owned notification inbox (`libs/api/
  // notifications`). ONE controller at ONE depth-3 literal prefix, serving four
  // routes.
  //
  // ⚠️ `unread-count`, `:id/read` and `read-all` ARE METHOD PATHS INSIDE IT,
  // NOT SIBLING CONTROLLERS. Split into three classes they would be three
  // prefixes for RI-1 to arbitrate and three guard chains to keep in step, for
  // one member-owned resource.
  //
  // ⚠️ THERE IS NO ADMIN COUNTERPART, BY DESIGN. R10 describes a member-owned
  // inbox; an admin "see everyone's notifications" surface is not in scope
  // (RK-1). If one is ever added it goes in `admin/`, re-declared.
  {
    label: 'notifications/MemberNotificationsController',
    file: 'libs/api/notifications/src/lib/member-notifications.controller.ts',
    controller: MemberNotificationsController,
  },
  {
    label: 'paddle/PaddleController',
    file: 'libs/api/billing/src/lib/paddle/paddle.controller.ts',
    controller: PaddleController,
  },
  {
    label: 'session/SessionController',
    file: 'libs/api/marketing/src/lib/session/session.controller.ts',
    controller: SessionController,
  },
  {
    label: 'subscription/SubscriptionController',
    file: 'libs/api/billing/src/lib/subscription/subscription.controller.ts',
    controller: SubscriptionController,
  },
  {
    label: 'waitlist/WaitlistController',
    file: 'libs/api/marketing/src/lib/waitlist/waitlist.controller.ts',
    controller: WaitlistController,
  },
];

function collectControllerFiles(dir: string, found: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'generated-prisma-client' ||
        entry.name === 'node_modules'
      ) {
        continue;
      }
      collectControllerFiles(full, found);
    } else if (
      entry.name.endsWith('.controller.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      found.push(relative(WORKSPACE_ROOT, full).split(sep).join('/'));
    }
  }
}

/**
 * Recursively collect `*.controller.ts` paths under every controller root,
 * `/`-normalized and relative to {@link WORKSPACE_ROOT}. The input for the
 * census assertion — it is what makes the hand-maintained list above impossible
 * to leave incomplete, on BOTH sides of a domain extraction.
 */
export function findControllerFiles(
  roots: readonly string[] = CONTROLLER_ROOTS,
): string[] {
  const found: string[] = [];
  for (const root of roots) collectControllerFiles(root, found);
  return found;
}
