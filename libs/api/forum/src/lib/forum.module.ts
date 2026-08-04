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
 * ── ⚠️ `NotificationsModule` IS DELIBERATELY ABSENT (RISK-L) ────────────────
 * Plan §2.5 lists it in this module's imports. `libs/api/notifications` DOES NOT
 * EXIST — Batch 14 creates it. Copying the list verbatim gives an unresolvable
 * import, a failed compile, and a red `app.module.spec.ts` (the boot test that
 * catches exactly this class of wiring mistake). It is omitted here so the next
 * reader sees a DECISION rather than an oversight: **Batch 14 adds the import
 * together with the notification producers it exists for** — a reply creating a
 * `Notification` row, an accepted answer notifying the author. Nothing in this
 * module currently produces one, so there is nothing to wire it to yet.
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
 * three are already global in `app.module.ts`, so the module stays resolvable in
 * isolation under `Test.createTestingModule({ imports: [ForumModule] })` —
 * matching `MembershipModule`, `MemberGroupsModule` and `MemberHubModule`.
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
