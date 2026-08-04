import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { dtoPipe } from '@ptah-api/core';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard } from '@ptah-api/membership';
import type {
  MemberCategory,
  MemberPost,
  MemberTopicDetail,
  MemberTopicSummary,
  Paged,
  ReactionCounts,
  ReactionType,
} from '@ptah-contracts/community';

import { CategoriesService } from '../categories/categories.service';
import { requireMemberContext } from '../common/member-context';
import { AcceptedAnswerService } from '../posts/accepted-answer.service';
import { PostsService } from '../posts/posts.service';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { UpdatePostDto } from '../posts/dto/update-post.dto';
import { AcceptAnswerDto } from '../posts/dto/accept-answer.dto';
import { REACTION_TYPE_ENUM } from '../reactions/reaction-types';
import { ReactionsService } from '../reactions/reactions.service';
import { ReadStateService } from '../read-state/read-state.service';
import { MarkReadDto } from '../read-state/dto/mark-read.dto';

import { CreateTopicDto } from './dto/create-topic.dto';
import { ListTopicsQueryDto } from './dto/list-topics.query.dto';
import { ThreadQueryDto, resolveThreadPage } from './dto/thread.query.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';
import { TopicsReadService } from './topics-read.service';
import { TopicsService } from './topics.service';

/**
 * Throttle budgets, NFR-S9 / §3.1, as named constants rather than repeated
 * literals — so "content creation" is one number and not eight.
 *
 * ⚠️ `CONTENT_CREATION` IS APPLIED TO CREATES ONLY, WHICH IS §3.1 READ
 * LITERALLY ("content creation 10/min, reactions 30/min, progress writes
 * 60/min, reads inherit the global 100/min"). Edits and deletes are NOT named
 * there and therefore inherit the global 100/min. That is a deliberate literal
 * reading and it is the cheap one to overrule: a member who can edit 100 times
 * a minute is annoying, a member who cannot save a correction is a bug report.
 * If abuse appears, add `@Throttle(CONTENT_CREATION)` to the two `@Patch`
 * handlers — one line each, no other change.
 *
 * `POST topics/:id/read` and `POST categories/:id/read-all` are PROGRESS
 * WRITES, not content: a member reading a long thread emits one per scroll
 * settle, and 10/min would rate-limit ordinary reading.
 */
const CONTENT_CREATION = { default: { limit: 10, ttl: 60_000 } } as const;
const REACTIONS = { default: { limit: 30, ttl: 60_000 } } as const;
const PROGRESS_WRITES = { default: { limit: 60, ttl: 60_000 } } as const;

/**
 * `MemberCommunityController` — the whole §3.3 member forum surface, mounted at
 * `/api/v1/members/community/*`.
 *
 * ── THE PREFIX IS A DEPTH-3 LITERAL, AND NO ROUTE HERE MAY EVER PARAMETERISE
 *    SEGMENT 3 ────────────────────────────────────────────────────────────────
 * `v1/members/{entitlement,hub,sessions,community,search}` are five DISJOINT
 * literal siblings. RI-1 in `route-map.spec.ts` fails the build the moment one
 * controller's prefix becomes a path-prefix of another's — which is exactly what
 * AD-12 was done to remove, and why `MembersController` moved from
 * `@Controller('v1/members')` + `@Get('sessions')` to
 * `@Controller('v1/members/sessions')`. A `@Get(':something')` declared on this
 * class at the top level would resolve to `v1/members/community/:something`,
 * which is fine; a controller at `v1/members` with a param would not be.
 *
 * ── GUARD ORDER IS LOAD-BEARING ───────────────────────────────────────────────
 * `@UseGuards(JwtAuthGuard, MemberGuard)` at CLASS level, in that order.
 * `JwtAuthGuard` populates `req.user` (401 without a valid session);
 * `MemberGuard` then resolves entitlement + cohort keys ONCE and attaches
 * `req.memberContext` (403 `{ reason: 'membership_required' }`). Declared at
 * class level so a handler added later is guarded by default — a method-only
 * `@UseGuards` leaves every FUTURE handler open.
 *
 * ── R7.3: `memberContext` IS READ, NEVER RE-DERIVED ──────────────────────────
 * Nothing in this controller and nothing in the services below it injects
 * `MembershipService` or `CohortResolver`. Entitlement and cohort keys are
 * resolved exactly once per request, by the guard. A second derivation would be
 * a second definition of who a member is (RISK-A), and the two would disagree
 * the first time either changed.
 *
 * ── PRE-1: EVERY `@Body()` / `@Query()` BINDS `dtoPipe(TheDto)` ──────────────
 * This app is bundled by esbuild, which does not implement
 * `emitDecoratorMetadata`, so Nest cannot infer a parameter's DTO class and the
 * global `ValidationPipe` short-circuits on `if (!metatype) return value;`. A
 * bare `@Body() dto: X` is SILENTLY UNVALIDATED — every `@MaxLength`, `@Min`
 * and `forbidNonWhitelisted` on it becomes inert. `controller-validation.spec.ts`
 * fails the build on an unbound payload param. See
 * `libs/api/core/src/lib/common/dto-validation.pipe.ts`.
 *
 * ⚠️ AND EVERY QUERY PAYLOAD IS A WHOLE-OBJECT DTO, NOT `@Query('page') page`.
 * `NAMED_PRIMITIVE_PARAM_COUNT = 6` is an EXACT-EQUALITY assertion (RISK-I), so
 * one named primitive added here fails the build. `@Param('id')` is not a
 * payload param and does not count.
 *
 * ── INVISIBLE IS `404`, NEVER `403` (R1.1.3) ────────────────────────────────
 * Every visibility clause is part of the SQL `WHERE`, in the services, so an
 * invisible category/topic/post is simply NOT FOUND and no code path here ever
 * learns it exists. `403` is reserved for VISIBLE-BUT-FORBIDDEN: a locked topic
 * (`{ reason: 'topic_locked' }`), a non-author edit, an edit outside the
 * ASSUMPTION-5 window. Do not add a `403` for an invisible resource — that
 * answer confirms existence.
 *
 * ── THIS CONTROLLER COMPOSES; IT DOES NOT DECIDE ────────────────────────────
 * The write services return row IDENTIFIERS (`CreatedTopic`, `CreatedPost`) and
 * the read model turns them into wire shapes. So a create's response is
 * assembled by exactly the same code that serves a plain read, and the two can
 * never disagree about what a topic looks like. No business rule — visibility,
 * authorship, the edit window, the lock, the depth repair — is decided here.
 */
@Controller('v1/members/community')
@UseGuards(JwtAuthGuard, MemberGuard)
export class MemberCommunityController {
  private readonly logger = new Logger(MemberCommunityController.name);

  constructor(
    @Inject(CategoriesService) private readonly categories: CategoriesService,
    @Inject(TopicsService) private readonly topics: TopicsService,
    @Inject(TopicsReadService) private readonly topicsRead: TopicsReadService,
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(ReactionsService) private readonly reactions: ReactionsService,
    @Inject(ReadStateService) private readonly readState: ReadStateService,
    @Inject(AcceptedAnswerService)
    private readonly acceptedAnswer: AcceptedAnswerService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Categories                                                              */
  /* ---------------------------------------------------------------------- */

  /** `GET categories` → the categories this member may see, with counts (R1.1). */
  @Get('categories')
  async listCategories(@Req() req: Request): Promise<MemberCategory[]> {
    return this.categories.listForMember(this.context(req));
  }

  /* ---------------------------------------------------------------------- */
  /* Topics — read                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * `GET topics` → the feed. `?categoryId&sort=recent|unread&page&pageSize`.
   *
   * `pageSize > 50` is a `400` from `ListTopicsQueryDto`'s `@Max(MAX_PAGE_SIZE)`
   * — which only fires because the `dtoPipe` below supplies the expected type.
   */
  @Get('topics')
  async listTopics(
    @Req() req: Request,
    @Query(dtoPipe(ListTopicsQueryDto)) query: ListTopicsQueryDto,
  ): Promise<Paged<MemberTopicSummary>> {
    return this.topicsRead.listFeed(this.context(req), query);
  }

  /**
   * `GET topics/:slug` → the thread. Declared AFTER `GET topics` — both are
   * `GET`, but `[topics]` and `[topics, :param]` have different segment counts
   * and cannot unify, so this is readability rather than a routing requirement.
   *
   * ⚠️ `:slug`, NOT `:id`. R1.2.2 makes the slug the topic's stable public
   * identifier and a title edit never changes it; the thread URL a member
   * bookmarks or shares is the slug.
   */
  @Get('topics/:slug')
  async getTopic(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query(dtoPipe(ThreadQueryDto)) query: ThreadQueryDto,
  ): Promise<MemberTopicDetail> {
    return this.topicsRead.getThread(
      this.context(req),
      slug,
      resolveThreadPage(query),
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Topics — write                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST topics` → `201 MemberTopicDetail`.
   *
   * The service writes the topic and post #1 in one transaction (AD-9) and
   * returns identifiers; the detail is then composed by the SAME read model
   * that serves `GET topics/:slug`, so a freshly created thread is byte-identical
   * to a re-fetched one.
   */
  @Post('topics')
  @Throttle(CONTENT_CREATION)
  async createTopic(
    @Req() req: Request,
    @Body(dtoPipe(CreateTopicDto)) dto: CreateTopicDto,
  ): Promise<MemberTopicDetail> {
    const ctx = this.context(req);
    const created = await this.topics.create(ctx, dto);
    return this.topicsRead.getThread(ctx, created.slug);
  }

  /**
   * `PATCH topics/:id` → `MemberTopicDetail`.
   *
   * `403` for a non-author and for an edit outside the ASSUMPTION-5 window;
   * `404` for a topic this member cannot see. Both decided in `TopicsService`.
   * An ADMIN editing here gets the same `403` as anyone else — the admin path is
   * `PATCH v1/admin/community/topics/:id`, which is audited. That structural
   * separation is ASSUMPTION-5's admin exemption and it is why there is no
   * `isAdmin` branch anywhere on this route.
   */
  @Patch('topics/:id')
  async updateTopic(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdateTopicDto)) dto: UpdateTopicDto,
  ): Promise<MemberTopicDetail> {
    const ctx = this.context(req);
    const updated = await this.topics.updateByAuthor(ctx, id, dto);
    return this.topicsRead.getThread(ctx, updated.slug);
  }

  /** `DELETE topics/:id` → author-only soft delete (R1.2.7). */
  @Delete('topics/:id')
  @HttpCode(200)
  async deleteTopic(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ deleted: boolean }> {
    return this.topics.softDelete(this.context(req), id);
  }

  /* ---------------------------------------------------------------------- */
  /* Posts                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST topics/:id/posts` → `201 MemberPost`.
   *
   * A `parentId` two levels deep is REPAIRED to depth 2, not rejected (R1.3.3,
   * RK-12) — the reply is saved with a re-pointed parent, and the composed
   * `MemberPost` below reports the parent it actually got. A locked topic is
   * `403 { reason: 'topic_locked' }`.
   */
  @Post('topics/:id/posts')
  @Throttle(CONTENT_CREATION)
  async createPost(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(CreatePostDto)) dto: CreatePostDto,
  ): Promise<MemberPost> {
    const ctx = this.context(req);
    const created = await this.posts.createReply(ctx, id, dto);
    return this.topicsRead.getPost(ctx, created.id);
  }

  /** `PATCH posts/:id` → author-only, inside the edit window. */
  @Patch('posts/:id')
  async updatePost(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdatePostDto)) dto: UpdatePostDto,
  ): Promise<MemberPost> {
    const ctx = this.context(req);
    const updated = await this.posts.updateByAuthor(ctx, id, dto);
    return this.topicsRead.getPost(ctx, updated.id);
  }

  /**
   * `DELETE posts/:id` → author-only tombstone (R1.3.5).
   *
   * The row survives with its `postNumber`; the body and author are withheld at
   * the READ model, which is what makes R8.5's admin restore a single-row write.
   */
  @Delete('posts/:id')
  @HttpCode(200)
  async deletePost(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ deleted: boolean }> {
    return this.posts.softDelete(this.context(req), id);
  }

  /* ---------------------------------------------------------------------- */
  /* Reactions                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * `PUT posts/:id/reactions/:type` → toggle MY reaction of this type.
   *
   * ⚠️ `PUT`, NOT `POST`, AND THAT IS THE CONTRACT (§3.3). The request expresses
   * "my reaction of this type on this post should flip"; a retried request
   * converges on the state the client asked for rather than double-toggling
   * back. `POST` would make a dropped response and a re-tap indistinguishable.
   *
   * ⚠️ `:type` IS VALIDATED BY `ParseEnumPipe` AT THE CONTROLLER, so an unknown
   * type is a `400` before any service runs — never a silently-stored fifth
   * reaction type. `PostReaction.type` is a Postgres `String`, not an enum
   * (§1.3), so this pipe is the only thing standing between a typo and a row no
   * reader can render. The enum object is DERIVED from `REACTION_TYPES`.
   *
   * `@Param` is not a payload param, so this pipe does not touch
   * `NAMED_PRIMITIVE_PARAM_COUNT`.
   */
  @Put('posts/:id/reactions/:type')
  @HttpCode(200)
  @Throttle(REACTIONS)
  async toggleReaction(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('type', new ParseEnumPipe(REACTION_TYPE_ENUM)) type: ReactionType,
  ): Promise<{ counts: ReactionCounts; mine: ReactionType[] }> {
    return this.reactions.toggle(this.context(req), id, type);
  }

  /* ---------------------------------------------------------------------- */
  /* Accepted answer                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * `PUT topics/:id/accepted-answer` — settable by the topic AUTHOR or an admin
   * (R1.5.3).
   *
   * `403` and not `404` for anyone else: they can already see the topic, so its
   * existence is not a secret and hiding it would be theatre.
   */
  @Put('topics/:id/accepted-answer')
  @HttpCode(200)
  async acceptAnswer(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(AcceptAnswerDto)) dto: AcceptAnswerDto,
  ): Promise<{ acceptedPostId: string }> {
    return this.acceptedAnswer.accept(this.context(req), id, dto);
  }

  /** `DELETE topics/:id/accepted-answer` — idempotent by design. */
  @Delete('topics/:id/accepted-answer')
  @HttpCode(200)
  async clearAcceptedAnswer(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ acceptedPostId: null }> {
    return this.acceptedAnswer.clear(this.context(req), id);
  }

  /* ---------------------------------------------------------------------- */
  /* Read state                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST topics/:id/read` — advance MY marker (R1.6.1). Monotonic: a lower
   * number never moves it backwards.
   */
  @Post('topics/:id/read')
  @HttpCode(200)
  @Throttle(PROGRESS_WRITES)
  async markRead(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(MarkReadDto)) dto: MarkReadDto,
  ): Promise<{ unreadCount: number }> {
    return this.readState.markRead(
      this.context(req),
      id,
      dto.lastReadPostNumber,
    );
  }

  /** `POST categories/:id/read-all` — mark every visible topic in it read. */
  @Post('categories/:id/read-all')
  @HttpCode(200)
  @Throttle(PROGRESS_WRITES)
  async markCategoryRead(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ topicsMarked: number }> {
    return this.readState.markCategoryRead(this.context(req), id);
  }

  /* ---------------------------------------------------------------------- */

  /** @see requireMemberContext — the removed-guard tripwire, not a null check. */
  private context(req: Request) {
    return requireMemberContext(
      req,
      MemberCommunityController.name,
      this.logger,
    );
  }
}
