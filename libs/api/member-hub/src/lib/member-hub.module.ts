import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@ptah-api/core';
import { ForumModule } from '@ptah-api/forum';
import { IdentityModule } from '@ptah-api/identity';
import { LearningModule } from '@ptah-api/learning';
import { LiveSessionsModule, MemberPacksModule } from '@ptah-api/community';
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
 *
 * ⚠️ `LearningModule` (TASK_2026_177 P3) IS IMPORTED ON EXACTLY THE SAME TERMS.
 * `LearningSection` injects ONE of its two exported services —
 * `CourseReadService` — because every number the card renders
 * (`completedLessons`, `totalLessons`, `percent`, the resume pointer and the
 * module lock verdict) is already computed inside that service's own query
 * budget; a second injection of `ProgressService` would be a duplicate
 * derivation of one number, which is how a card and a page start disagreeing
 * (D-6.15a). It is a NORMAL import, not `@Optional()`: learning is
 * unconditionally part of the product, so a missing module is a wiring mistake
 * that should fail at boot rather than degrade the card to `'unavailable'`
 * forever.
 *
 * ⚠️ AND IT DOES NOT WIDEN THE HUB'S REACH EITHER. `LearningModule` exports two
 * READ services and nothing else — no `CoursesService`, no `ReorderService`, no
 * `LessonVideoService`, none of `common/`, and nothing that can reach
 * `@ptah-api/youtube`. The hub cannot author a course, evaluate a lock against a
 * hand-built tree, or issue a third-party request (NFR-P6);
 * `learning.module.spec.ts` asserts that surface by exact array equality.
 *
 * ⚠️ `LiveSessionsModule` (TASK_2026_177 P4) IS IMPORTED FOR ONE EXPORTED READ
 * SERVICE — `LiveFeedService`, which `SessionsSection` folds into the hub's
 * "what is next" card as `kind: 'live'` (R6.6).
 *
 * 🔴 THE IMPORT IS REQUIRED, NOT DECORATIVE, EVEN THOUGH THE INJECTION IS
 * `@Optional()`. `LiveSessionsModule` is NOT `@Global()` — unlike
 * `GoogleSessionsModule`, which is how `SessionsService` and
 * `SessionRequestsService` reach the same section without an import. Without
 * this line the `@Optional()` would resolve to `undefined` FOR EVER and the
 * live source would be silently and permanently omitted from the card, with one
 * `logger.warn` at first request and a perfectly plausible response. The
 * `@Optional()` is there so a wiring mistake degrades one card instead of
 * failing `/hub`; this import is what makes the card correct.
 *
 * ⚠️ AND IT DOES NOT WIDEN THE HUB'S REACH. `LiveSessionsModule` exports ONE
 * READ service and nothing else — no `LiveSessionsService`, none of
 * `live-sessions/common/`, and nothing that can reach `@ptah-api/youtube`. The
 * hub cannot author or delete a live session, hand-build a visibility `where`,
 * or issue a third-party request (NFR-P6); `live-sessions.module.spec.ts`
 * asserts that surface.
 *
 * ⚠️ NO NEW LIB EDGE. `api-member-hub` already depends on `@ptah-api/community`
 * for `SessionsService`; this is a second module out of the same package.
 *
 * ── 🔴 `MemberPacksModule` (TASK_2026_177 Phase 5, Task 14.16) ────────────
 * Imported for ONE exported read service, `MemberPacksService`, which
 * `PacksSection` injects. It is a NORMAL import and a NORMAL injection —
 * `MemberPacksModule` is NOT `@Global()` (deliberately: see its own docblock),
 * so without this line the section could not construct at all.
 *
 * 🔴 THE SECTION DOES NOT READ PRISMA, AND THAT IS AN NFR-S5 DECISION RATHER
 * THAN A STYLE ONE. `toMemberPack` — the explicit-field mapper that makes
 * `notes` structurally unable to reach a member — lives inside that service. A
 * resolver with its own `pack.findMany` would need its own `where` AND its own
 * mapper, so `memberVisible: true` would have two homes and the admin-only
 * `notes` column two places to leak from. `CommunitySection` and
 * `LearningSection` are the same shape for weaker reasons.
 *
 * ⚠️ AND IT DOES NOT WIDEN THE HUB'S REACH. `MemberPacksModule` exports ONE
 * READ service and nothing else. `PacksService` — every pack MUTATION and every
 * audit write — lives in `PacksModule`, which this module does not import and
 * which has no import edge to `MemberPacksModule` in either direction (RISK-AG).
 *
 * ── 🔴 `NotificationsModule` IS *NOT* IN THIS LIST, AND `NotificationsSection`
 *    STILL INJECTS `NotificationsService` ────────────────────────────────
 * That module IS `@Global()`, so the injection resolves at app scope — the same
 * reason `SessionsService` and `SessionRequestsService` reach `SessionsSection`
 * with no `GoogleSessionsModule` import. The asymmetry between the two Phase-5
 * sections is therefore real and is a property of the two modules, not an
 * oversight in one of them: packs is a leaf module with one importer,
 * notifications is a cross-cutting definition with four consumers in three libs.
 *
 * ⚠️ NEITHER PHASE-5 INJECTION IS `@Optional()`. Both modules are
 * unconditionally registered; an `@Optional()` would turn a forgotten
 * registration into a card that says "nothing here" for ever, which is
 * indistinguishable from the truth and therefore never gets reported.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    IdentityModule,
    ForumModule,
    LearningModule,
    LiveSessionsModule,
    MemberPacksModule,
  ],
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
