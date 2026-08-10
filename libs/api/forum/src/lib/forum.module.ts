import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '@ptah-api/audit';
import { PrismaModule } from '@ptah-api/core';
import {
  AdminGuard,
  AdminThrottlerGuard,
  IdentityModule,
} from '@ptah-api/identity';
import { MembershipModule } from '@ptah-api/membership';

import { AdminCommunityCategoriesController } from './categories/admin-community-categories.controller';
import { CategoriesService } from './categories/categories.service';
import { AdminCommunityPostsController } from './posts/admin-community-posts.controller';
import { AcceptedAnswerService } from './posts/accepted-answer.service';
import { PostsService } from './posts/posts.service';
import { ReactionsService } from './reactions/reactions.service';
import { ReadStateService } from './read-state/read-state.service';
import { MemberSearchController } from './search/member-search.controller';
import { SearchService } from './search/search.service';
import { AdminCommunityTopicsController } from './topics/admin-community-topics.controller';
import { AdminTopicsReadService } from './topics/admin-topics-read.service';
import { MemberCommunityController } from './topics/member-community.controller';
import { TopicsReadService } from './topics/topics-read.service';
import { TopicsService } from './topics/topics.service';

/**
 * `ForumModule` — the native community forum (plan §2.5, R1, R1.7, R8).
 *
 * Five controllers: two member (`v1/members/community`, `v1/members/search`) and
 * three admin (`v1/admin/community/{categories,topics,posts}`). Nine services.
 *
 * ── ⚠️ `NotificationsModule` IS STILL ABSENT, FOR A DIFFERENT REASON (RISK-L)
 *
 * 🔴 THE OLD REASON IS DEAD AND THE ABSENCE IS NOT. `libs/api/notifications`
 * now EXISTS, and this module now PRODUCES notifications: `PostsService`
 * (`topic.reply`, `post.child_reply`) and `AcceptedAnswerService`
 * (`post.accepted`) both inject `NotificationsService`. Plan §2.5's "add
 * `NotificationsModule` to the imports" is nevertheless NOT what Phase 5 did.
 *
 * `NotificationsModule` is `@Global()` and exports `NotificationsService`, so
 * the injections resolve at app scope with no import — and its own docblock
 * argues the case in terms: four consumers across three libs, and an explicit
 * import in each would put an edge from every producer lib into it for a service
 * whose entire public surface is "write one row, unless the actor is the
 * recipient". The idiom is already in this repo, one module away:
 * `live-sessions.module.spec.ts` asserts that `LiveSessionsModule` does NOT
 * import `GoogleSessionsModule` although `LiveFeedService` reads it, for exactly
 * this reason.
 *
 * ⚠️ THE PRICE, STATED RATHER THAN HIDDEN. `Test.createTestingModule({ imports:
 * [ForumModule] })` no longer resolves in TOTAL isolation — `PostsService` and
 * `AcceptedAnswerService` need `NotificationsService` from the global scope. The
 * injection is deliberately NOT `@Optional()`: an `@Optional()` here would mean
 * that forgetting `NotificationsModule` in `app.module.ts` silently stops every
 * forum notification for ever, with a plausible-looking reply on every request —
 * which is RISK-AE's failure mode in a different costume. Non-optional, the app
 * fails to boot and `app.module.spec.ts` says which provider is missing.
 *
 * ── ⚠️ `AdminGuard` AND `AdminThrottlerGuard` ARE DECLARED LOCALLY ──────────
 * Not by importing `AdminModule`. That is the acyclicity idiom
 * `MemberGroupsModule` already uses and states: a guard with constructor
 * dependencies is instantiated in the CONSUMING module's injector, so
 * `@UseGuards(AdminGuard)` on a controller here requires `AdminGuard` to be
 * resolvable from THIS module. Importing `AdminModule` to get it would make a
 * feature module depend on the admin dashboard module for a stateless guard
 * that needs only `ConfigService` and the global throttler providers — and
 * `AdminModule` is a plausible future consumer of the forum, which is how a
 * cycle appears.
 *
 * `MemberGuard` needs no equivalent: `MembershipModule` is `@Global()` and
 * exports it. The asymmetry is real, not an oversight.
 *
 * ── ⚠️ `IdentityModule` IS NOT OPTIONAL ────────────────────────────────────
 * `JwtAuthGuard` is `@UseGuards`-referenced by all five controllers and has its
 * own constructor dependency (`AuthService`). Omitting this import fails at
 * BOOT with `Nest can't resolve dependencies of the JwtAuthGuard (?)` — not at
 * request time, and not in any unit test, because the controller specs
 * construct the classes directly and never exercise Nest's injector.
 * `app.module.spec.ts` is the test that would catch it.
 *
 * ── EXPORTS: TWO SERVICES, AND NOT ONE MORE (§2.5) ─────────────────────────
 * `TopicsReadService` and `ReadStateService` — the two the member hub composes
 * its `community` section from (Task 6.15). Everything else stays internal:
 * `TopicsService`, `PostsService`, `CategoriesService`, `SearchService`,
 * `AcceptedAnswerService`, `ReactionsService` and `AdminTopicsReadService` carry
 * the WRITE paths and the tombstone read, and they are reachable only through
 * this module's own controllers — i.e. only behind
 * `JwtAuthGuard` + `MemberGuard`, or `JwtAuthGuard` + `AdminGuard`. Exporting
 * one would let a future consumer perform a forum mutation, or read a deleted
 * body, having passed through none of that chain.
 *
 * ── NOT `@Global()`, DELIBERATELY ──────────────────────────────────────────
 * `MemberHubModule` imports it explicitly. The global scope is reserved for the
 * cross-cutting definitions (`MembershipModule`, `MemberGroupsModule`,
 * `PrismaModule`, `AuditModule`) that genuinely span libs; a feature module that
 * makes itself global removes the one place a reader can see who depends on it.
 *
 * `ConfigModule`, `PrismaModule` and `AuditModule` are imported although all
 * three are already global in `app.module.ts`, matching `MembershipModule`,
 * `MemberGroupsModule` and `MemberHubModule`. ⚠️ They no longer buy FULL
 * isolation under `Test.createTestingModule({ imports: [ForumModule] })` — see
 * the `NotificationsModule` block above for what changed and why the import was
 * not added to buy it back.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    IdentityModule,
    MembershipModule,
    AuditModule,
  ],
  controllers: [
    MemberCommunityController,
    MemberSearchController,
    AdminCommunityCategoriesController,
    AdminCommunityTopicsController,
    AdminCommunityPostsController,
  ],
  providers: [
    CategoriesService,
    TopicsService,
    TopicsReadService,
    AdminTopicsReadService,
    PostsService,
    AcceptedAnswerService,
    ReactionsService,
    ReadStateService,
    SearchService,
    AdminGuard,
    AdminThrottlerGuard,
  ],
  exports: [TopicsReadService, ReadStateService],
})
export class ForumModule {}
