import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@ptah-api/core';
import { ForumModule } from '@ptah-api/forum';
import { IdentityModule } from '@ptah-api/identity';
import { CohortBadgesService } from './cohort-badges.service';
import { MemberEntitlementController } from './member-entitlement.controller';
import { MemberHubController } from './member-hub.controller';
import { MemberHubService } from './member-hub.service';
import { CommunitySection } from './sections/community.section';
import { LearningSection } from './sections/learning.section';
import { NotificationsSection } from './sections/notifications.section';
import { PacksSection } from './sections/packs.section';
import { SessionsSection } from './sections/sessions.section';

/**
 * MemberHubModule — the member home screen and the entitlement probe.
 *
 * ⚠️ REGISTER IT AFTER `MembershipModule` in `app.module.ts` (R7.3).
 * `MembershipModule` is `@Global()`, and a global module's providers exist only
 * once it has been instantiated. `MemberHubController` declares
 * `@UseGuards(JwtAuthGuard, MemberGuard)` and both controllers inject
 * `MembershipService` / `CohortResolver` out of that global scope.
 *
 * ⚠️ ALSO AFTER `GoogleSessionsModule`, for the same reason and with a softer
 * consequence: `SessionsSection` takes `SessionsService` with `@Optional()`, so
 * the wrong order costs the `sessions` card (it reports `'unavailable'`) rather
 * than the whole endpoint. The `@Optional()` is what makes that a degradation
 * instead of a boot failure — but the order is still the correct wiring, not a
 * thing to rely on the fallback for.
 *
 * NOT `@Global()`, deliberately. Nothing else in the server injects the hub or
 * its section resolvers; it is a leaf feature module, and the global scope is
 * reserved for the cross-cutting definitions (`MembershipModule`,
 * `MemberGroupsModule`, `PrismaModule`) that genuinely span libs.
 *
 * ⚠️ `IdentityModule` IS NOT OPTIONAL AND IS NOT GLOBAL. `JwtAuthGuard` is
 * `@UseGuards`-referenced by both controllers, and a guard with constructor
 * dependencies is instantiated in the CONSUMING module's injector — so
 * `JwtAuthGuard`'s own `AuthService` must be resolvable from here. Omitting
 * this import fails at BOOT with `Nest can't resolve dependencies of the
 * JwtAuthGuard (?)`, not at request time and not in any unit test: the
 * controller specs construct the class directly and never exercise Nest's
 * injector. `GoogleSessionsModule` imports it for the same reason and says so.
 *
 * `MemberGuard` needs no equivalent because `MembershipModule` is `@Global()`
 * and exports it — the asymmetry is real, not an oversight.
 *
 * `ConfigModule` and `PrismaModule` are imported although both are already
 * global in `app.module.ts`, so the module stays resolvable in isolation under
 * `Test.createTestingModule({ imports: [MemberHubModule] })` — matching
 * `MembershipModule` and `MemberGroupsModule`.
 *
 * The five section resolvers are listed individually rather than collected
 * behind a multi-provider token: the composer injects them by NAME so that
 * adding a Phase-N section is a compile error until the composer is updated,
 * whereas an injected array would silently compose four sections and ship an
 * envelope with a missing key.
 *
 * ⚠️ `ForumModule` (TASK_2026_177 P2) IS IMPORTED FOR ITS TWO EXPORTED
 * SERVICES, and `CommunitySection` uses one of them (`TopicsReadService`) — see
 * that file for why `ReadStateService` would be a second derivation of a number
 * the feed already returns. It is a NORMAL import, not `@Optional()`: unlike
 * `SessionsService`, which is genuinely feature-flagged behind
 * `GOOGLE_OAUTH_*`, the forum is unconditionally part of the product, and a
 * missing `ForumModule` is a wiring mistake that should fail at boot rather
 * than silently degrade the community card to `'unavailable'` forever.
 *
 * ⚠️ THIS IMPORT DOES NOT WIDEN THE HUB'S REACH. `ForumModule` exports two READ
 * services and nothing else — no `TopicsService`, no `PostsService`, no
 * `CategoriesService`, none of `common/`. The hub cannot mutate the forum or
 * read past a visibility clause; `forum.module.spec.ts` asserts that surface.
 */
@Module({
  imports: [ConfigModule, PrismaModule, IdentityModule, ForumModule],
  controllers: [MemberHubController, MemberEntitlementController],
  providers: [
    MemberHubService,
    CohortBadgesService,
    LearningSection,
    CommunitySection,
    SessionsSection,
    PacksSection,
    NotificationsSection,
  ],
  exports: [MemberHubService],
})
export class MemberHubModule {}
