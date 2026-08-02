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
import { AdminCommunityController } from '@ptah-api/community';
import { CommunityController } from '@ptah-api/community';
import { DiscourseController } from '@ptah-api/community';
import { EventsController } from '@ptah-api/licensing';
import { AdminSessionsController } from '@ptah-api/community';
import { MembersController } from '@ptah-api/community';
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
 * Both specs need the identical 21-entry list. Duplicating it would create
 * exactly the drift both specs exist to prevent: a controller added to one
 * list and not the other is enforced by one guard and invisible to the other,
 * with nothing failing. One list, two importers.
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
 * test-harness surface; pulling 21 controller classes (and their entire DI
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
    label: 'discourse/AdminCommunityController',
    file: 'libs/api/community/src/lib/discourse/admin-community.controller.ts',
    controller: AdminCommunityController,
  },
  {
    label: 'discourse/CommunityController',
    file: 'libs/api/community/src/lib/discourse/community.controller.ts',
    controller: CommunityController,
  },
  {
    label: 'discourse/DiscourseController',
    file: 'libs/api/community/src/lib/discourse/discourse.controller.ts',
    controller: DiscourseController,
  },
  {
    label: 'events/EventsController',
    file: 'libs/api/licensing/src/lib/events/events.controller.ts',
    controller: EventsController,
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
  {
    label: 'packs/AdminPacksController',
    file: 'libs/api/community/src/lib/packs/admin-packs.controller.ts',
    controller: AdminPacksController,
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
