import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { type Type } from '@nestjs/common';

import { AdminLicensesController } from '../admin/admin-licenses.controller';
import { AdminRecordsController } from '../admin/admin-records.controller';
import { AdminStatsController } from '../admin/admin-stats.controller';
import { AdminUsersController } from '../admin/admin-users.controller';
import { AdminWaitlistController } from '../admin/admin-waitlist.controller';
import { AuthController } from '../app/auth/auth.controller';
import { ContactController } from '../contact/contact.controller';
import { AdminCommunityController } from '../discourse/admin-community.controller';
import { CommunityController } from '../discourse/community.controller';
import { DiscourseController } from '../discourse/discourse.controller';
import { EventsController } from '../events/events.controller';
import { AdminSessionsController } from '../google-sessions/admin-sessions.controller';
import { MembersController } from '../google-sessions/members.controller';
import { HealthController } from '../health/health.controller';
import { AdminController as LicenseAdminController } from '../license/controllers/admin.controller';
import { LicenseController } from '../license/controllers/license.controller';
import { AdminMarketingController } from '../marketing/controllers/admin-marketing.controller';
import { PublicMarketingController } from '../marketing/controllers/public-marketing.controller';
import { ResendWebhookController } from '../marketing/controllers/resend-webhook.controller';
import { MemberGroupsController } from '../member-groups/member-groups.controller';
import { AdminPacksController } from '../packs/admin-packs.controller';
import { PaddleController } from '../paddle/paddle.controller';
import { SessionController } from '../session/session.controller';
import { SubscriptionController } from '../subscription/subscription.controller';
import { WaitlistController } from '../waitlist/waitlist.controller';

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
 * `controller-validation.spec.ts`, which calls `findControllerFiles(SRC)`
 * below and fails if any `*.controller.ts` on disk is missing from it.
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
 * The server's `src/` directory.
 *
 * ⚠️ RE-DERIVED DELIBERATELY, NOT COPIED. This module lives at `src/testing/`,
 * so `join(__dirname, '..')` is `src/`. Its previous home was `src/common/`,
 * where `..` was ALSO `src/` — the two depths happen to agree, which is
 * precisely why this needs saying out loud: the next move may not be at the
 * same depth, and a silently-wrong `SRC` would make the census scan the wrong
 * tree and `readFileSync(join(SRC, file))` read the wrong files.
 *
 * The guard below turns "someone moved this file" into an immediate, named
 * failure instead of a confusing census diff.
 */
export const SRC = join(__dirname, '..');

if (!existsSync(join(SRC, 'main.ts'))) {
  throw new Error(
    `controller-registry: SRC resolved to "${SRC}", which does not contain ` +
      `main.ts. This module derives the server's src/ directory as ONE level ` +
      `above its own directory. If this file moved, re-derive SRC here — do ` +
      `not adjust the callers.`,
  );
}

/** One entry in {@link ALL_CONTROLLERS}. */
export interface ControllerRegistryEntry {
  /** UNIQUE, path-qualified human label — the key every ledger is keyed on. */
  readonly label: string;
  /** Source path relative to `src/`, always `/`-separated. */
  readonly file: string;
  readonly controller: Type<unknown>;
}

/**
 * Every controller in the server, with a UNIQUE human label and its
 * source-relative file path.
 *
 * ⚠️ The label is NOT `controller.name`, and it must stay that way.
 * Until TASK_2026_170 R2, two distinct classes in this server were both called
 * `AdminController` (`admin/admin.controller.ts` and
 * `license/controllers/admin.controller.ts`). Keying a debt ledger on the class
 * name would have let one hide behind the other: whichever got bound first
 * would remove "AdminController" from the ledger and silently exempt the other.
 * R2 split the first into five resource-named controllers; R3 renames the
 * second to `IntegrationLicensesController`, after which the alias import below
 * collapses to a plain one. Labels stay path-qualified regardless — they are
 * the ledger keys, a class name is not guaranteed unique, and a path is.
 */
export const ALL_CONTROLLERS: readonly ControllerRegistryEntry[] = [
  {
    label: 'admin/AdminLicensesController',
    file: 'admin/admin-licenses.controller.ts',
    controller: AdminLicensesController,
  },
  {
    label: 'admin/AdminRecordsController',
    file: 'admin/admin-records.controller.ts',
    controller: AdminRecordsController,
  },
  {
    label: 'admin/AdminStatsController',
    file: 'admin/admin-stats.controller.ts',
    controller: AdminStatsController,
  },
  {
    label: 'admin/AdminUsersController',
    file: 'admin/admin-users.controller.ts',
    controller: AdminUsersController,
  },
  {
    label: 'admin/AdminWaitlistController',
    file: 'admin/admin-waitlist.controller.ts',
    controller: AdminWaitlistController,
  },
  {
    label: 'app/auth/AuthController',
    file: 'app/auth/auth.controller.ts',
    controller: AuthController,
  },
  {
    label: 'contact/ContactController',
    file: 'contact/contact.controller.ts',
    controller: ContactController,
  },
  {
    label: 'discourse/AdminCommunityController',
    file: 'discourse/admin-community.controller.ts',
    controller: AdminCommunityController,
  },
  {
    label: 'discourse/CommunityController',
    file: 'discourse/community.controller.ts',
    controller: CommunityController,
  },
  {
    label: 'discourse/DiscourseController',
    file: 'discourse/discourse.controller.ts',
    controller: DiscourseController,
  },
  {
    label: 'events/EventsController',
    file: 'events/events.controller.ts',
    controller: EventsController,
  },
  {
    label: 'google-sessions/AdminSessionsController',
    file: 'google-sessions/admin-sessions.controller.ts',
    controller: AdminSessionsController,
  },
  {
    label: 'google-sessions/MembersController',
    file: 'google-sessions/members.controller.ts',
    controller: MembersController,
  },
  {
    label: 'health/HealthController',
    file: 'health/health.controller.ts',
    controller: HealthController,
  },
  {
    label: 'license/AdminController',
    file: 'license/controllers/admin.controller.ts',
    controller: LicenseAdminController,
  },
  {
    label: 'license/LicenseController',
    file: 'license/controllers/license.controller.ts',
    controller: LicenseController,
  },
  {
    label: 'marketing/AdminMarketingController',
    file: 'marketing/controllers/admin-marketing.controller.ts',
    controller: AdminMarketingController,
  },
  {
    label: 'marketing/PublicMarketingController',
    file: 'marketing/controllers/public-marketing.controller.ts',
    controller: PublicMarketingController,
  },
  {
    label: 'marketing/ResendWebhookController',
    file: 'marketing/controllers/resend-webhook.controller.ts',
    controller: ResendWebhookController,
  },
  {
    label: 'member-groups/MemberGroupsController',
    file: 'member-groups/member-groups.controller.ts',
    controller: MemberGroupsController,
  },
  {
    label: 'packs/AdminPacksController',
    file: 'packs/admin-packs.controller.ts',
    controller: AdminPacksController,
  },
  {
    label: 'paddle/PaddleController',
    file: 'paddle/paddle.controller.ts',
    controller: PaddleController,
  },
  {
    label: 'session/SessionController',
    file: 'session/session.controller.ts',
    controller: SessionController,
  },
  {
    label: 'subscription/SubscriptionController',
    file: 'subscription/subscription.controller.ts',
    controller: SubscriptionController,
  },
  {
    label: 'waitlist/WaitlistController',
    file: 'waitlist/waitlist.controller.ts',
    controller: WaitlistController,
  },
];

/**
 * Recursively collect `*.controller.ts` paths under `src/`, `/`-normalized and
 * relative to {@link SRC}. The input for the census assertion — it is what
 * makes the hand-maintained list above impossible to leave incomplete.
 */
export function findControllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'generated-prisma-client' ||
        entry.name === 'node_modules'
      ) {
        continue;
      }
      found.push(...findControllerFiles(full));
    } else if (
      entry.name.endsWith('.controller.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      found.push(relative(SRC, full).split(sep).join('/'));
    }
  }
  return found;
}
