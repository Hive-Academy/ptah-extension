import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { dtoPipe } from '@ptah-api/core';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard } from '@ptah-api/membership';
import type { MemberLessonComment } from '@ptah-contracts/community';

import { requireMemberContext } from '../common/member-context';

import { CreateCommentDto } from './dto/create-comment.dto';
import { SetAnsweredDto } from './dto/set-answered.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { LessonCommentsService } from './lesson-comments.service';

/**
 * §3.1's content-creation tier, read literally (B6C's D-6.12g).
 *
 * A comment is content; an edit and a delete are not named by §3.1 and inherit
 * the global 100/min. That is the cheap-to-overrule direction: a member who can
 * edit 100 times a minute is annoying, a member who cannot save a correction is
 * a bug report.
 */
const CONTENT_CREATION = { default: { limit: 10, ttl: 60_000 } } as const;

/**
 * `MemberLessonCommentsController` — the §3.4 lesson-comment surface, mounted at
 * `/api/v1/members/lesson-comments/*`.
 *
 * ── WHY IT IS A SEPARATE CONTROLLER FROM `v1/members/courses` ───────────────
 * plan §3.4 says it in one clause: "separate, to avoid contesting
 * `courses/:slug`". Hung off the courses prefix, `POST courses/comments` would
 * sit at the same depth as `GET courses/:slug` and the two would contest a
 * concrete path — the exact cross-controller ambiguity RI-2 forbids and the
 * intra-controller one RI-3 orders around. As siblings,
 * `v1/members/lesson-comments` and `v1/members/courses` are disjoint literal
 * depth-3 prefixes and neither is a path-prefix of the other.
 *
 * ── THERE IS NO `GET` HERE, AND THAT IS DELIBERATE ─────────────────────────
 * A lesson's thread arrives with the lesson
 * (`MemberLessonDetail.comments`, one read), so a standalone
 * `GET lesson-comments?lessonId=…` would be a second way to fetch the same rows
 * — a second visibility decision to keep in step, and a query parameter this
 * batch would then have to bind a DTO for. R2.4.4 also means the OUTLINE
 * deliberately has no comments key at all; a separate read endpoint would be the
 * obvious way to get around that.
 *
 * ── GUARDS, R7.3 AND PRE-1 ─────────────────────────────────────────────────
 * `@UseGuards(JwtAuthGuard, MemberGuard)` at CLASS level, in that order, so a
 * handler added later is guarded by default. Nothing here or below injects
 * `MembershipService` or `CohortResolver` — `req.memberContext` is resolved once
 * by the guard and passed through. Every `@Body()` binds `dtoPipe(TheDto)`;
 * there is no `@Query()` on this controller, so nothing here can move
 * `NAMED_PRIMITIVE_PARAM_COUNT` (exact-equality at 6, RISK-I).
 *
 * ── 🔴 VISIBILITY AND LOCKING INHERIT, ON THE WRITE PATH AS WELL AS THE READ
 *    (R2.5.1) ────────────────────────────────────────────────────────────────
 * Every method below delegates the decision to `LessonCommentsService`, which
 * evaluates the SAME `ModuleLockService` verdict the lesson read evaluates. So
 * "you cannot comment on a lesson you cannot open" is one implementation rather
 * than a rule two code paths agree about today. An invisible or draft course's
 * lesson is `404`; a locked module is `403 { reason, unlocksAt }`.
 *
 * ── `403` vs `404` ON SOMEONE ELSE'S COMMENT, AND WHY BOTH ARE RIGHT ───────
 * Editing or deleting ANOTHER member's comment is `403`: the member can already
 * SEE it — it was in the thread they just read — so its existence is not a
 * secret and `404` would be a lie about something on their screen. But a comment
 * on a lesson the member can NO LONGER see is `404` **even for its own author**,
 * otherwise a member whose cohort assignment was revoked could keep probing the
 * course by editing their old comments.
 *
 * ── A-8: THERE ARE NO REACTIONS ON A LESSON COMMENT ────────────────────────
 * No `PUT :id/reactions/:type`, no `ReactionCounts`, nothing imported from the
 * forum's reaction vocabulary. `MemberLessonComment` carries `answered` and
 * nothing else of that kind, and a spec asserts the absence structurally over
 * every file in this lib.
 */
@Controller('v1/members/lesson-comments')
@UseGuards(JwtAuthGuard, MemberGuard)
export class MemberLessonCommentsController {
  private readonly logger = new Logger(MemberLessonCommentsController.name);

  constructor(
    @Inject(LessonCommentsService)
    private readonly comments: LessonCommentsService,
  ) {}

  /**
   * `POST` → `201 MemberLessonComment` (R2.5.2, RK-12).
   *
   * ⚠️ A DEPTH-3 REPLY IS REPAIRED TO DEPTH 2, NOT REJECTED. The comment is
   * saved with its parent re-pointed to the parent's parent, and the composed
   * response reports the parent it actually got — so a client that offered a
   * "reply" control under a depth-2 comment renders a correct thread rather than
   * losing the member's writing to a `400` about an implementation detail they
   * cannot see. The `depthRepaired` flag the service returns is deliberately NOT
   * on the wire contract: nothing depends on it, and a client that ignored it
   * would still be correct.
   */
  @Post()
  @Throttle(CONTENT_CREATION)
  async create(
    @Req() req: Request,
    @Body(dtoPipe(CreateCommentDto)) dto: CreateCommentDto,
  ): Promise<MemberLessonComment> {
    const result = await this.comments.create(this.context(req), dto);

    if (result.depthRepaired) {
      this.logger.log(
        `Lesson comment depth repaired to 2: lessonId=${dto.lessonId}`,
      );
    }
    return result.comment;
  }

  /** `PATCH :id` → author-or-admin edit (R2.5.4). */
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdateCommentDto)) dto: UpdateCommentDto,
  ): Promise<MemberLessonComment> {
    return this.comments.update(this.context(req), id, dto.bodyMarkdown);
  }

  /**
   * `DELETE :id` → author-or-admin soft delete (R2.5.4, AD-5).
   *
   * ⚠️ THE ROW SURVIVES, WITH ITS CHILDREN STILL ATTACHED. A tombstone that
   * still holds a live reply is returned to the thread with a stated placeholder
   * body and a `null` author, so the reply below it does not become an orphan
   * answering nothing; a childless tombstone is omitted entirely. The removed
   * text appears nowhere in the serialised thread.
   *
   * ⚠️ `LessonComment` IS THE ONE COURSE MODEL THAT HAS A `deletedBy` COLUMN
   * (plan §1.4), and the service writes it. The other three soft-deletable
   * models do not — Batch 9B's F-1 — which is why their audit rows carry the
   * actor instead.
   */
  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ deleted: boolean }> {
    return this.comments.remove(this.context(req), id);
  }

  /**
   * `PUT :id/answered` → mark or unmark a comment as answered (R2.5.3).
   *
   * ⚠️ IT IS ON THE MEMBER CONTROLLER AND THE AUTHORISATION IS IN THE SERVICE,
   * BECAUSE R2.5.3 NAMES TWO ACTORS. An admin **or the lesson author** may set
   * it. "The lesson author" is not an admin identity — `Lesson` has no
   * `authorId` in plan §1.4, so `LessonCommentsService.setAnswered` resolves it
   * through `Course.createdBy` (`ctx.isAdmin || course.createdBy ===
   * ctx.userId`). Behind `AdminGuard` this route would silently implement half
   * the requirement.
   *
   * ⚠️ ON THE SEEDED CURRICULUM THAT MAKES IT ADMIN-ONLY, and it is asserted
   * rather than left to be discovered: Batch 11 writes no `Course.createdBy`, so
   * the second branch matches nobody until a course is created through the API.
   *
   * ⚠️ IT DOES NOT UNIFY WITH `PATCH :id` (different verbs) OR WITH `DELETE :id`
   * (different segment counts), so RI-3 has nothing to arbitrate on this
   * controller.
   */
  @Put(':id/answered')
  @HttpCode(200)
  async setAnswered(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(SetAnsweredDto)) dto: SetAnsweredDto,
  ): Promise<MemberLessonComment> {
    return this.comments.setAnswered(this.context(req), id, dto.answered);
  }

  /* ---------------------------------------------------------------------- */

  /** @see requireMemberContext — the removed-guard tripwire, not a null check. */
  private context(req: Request) {
    return requireMemberContext(
      req,
      MemberLessonCommentsController.name,
      this.logger,
    );
  }
}
