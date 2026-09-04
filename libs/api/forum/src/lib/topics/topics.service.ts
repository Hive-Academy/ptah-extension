import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';

import {
  type AuditHook,
  CategoriesService,
} from '../categories/categories.service';
import { assertWithinEditWindow } from '../common/edit-window';
import { buildSlug, slugify } from '../common/slug';
import {
  NOT_DELETED,
  assertRestored,
  restorableWhere,
} from '../common/soft-delete';
import { buildTopicCategoryVisibilityWhere } from '../common/visibility';

import type { CreateAdminTopicDto } from './dto/create-admin-topic.dto';
import type { CreateTopicDto } from './dto/create-topic.dto';
import type { ModerateTopicDto } from './dto/moderate-topic.dto';
import type { UpdateTopicDto } from './dto/update-topic.dto';

/**
 * The `403` body for a reply to a locked topic (§3.3: `403 {reason:'topic_locked'}`).
 *
 * ⚠️ IT IS A MACHINE-READABLE `reason`, NOT A MESSAGE THE CLIENT PARSES. The UI
 * hides the composer and renders its own copy off this value; matching on the
 * English sentence would break the moment the sentence is reworded or
 * translated.
 */
export const TOPIC_LOCKED_REASON = 'topic_locked';

/**
 * The ONE construction site for the locked-topic refusal.
 *
 * Exported and shared with `PostsService` on purpose: the lock is set here
 * (moderation) and enforced there (replies), and two independently written
 * `ForbiddenException`s would drift into two different response bodies for one
 * documented error. `topics.service.spec.ts` asserts the shape.
 *
 * ⚠️ A LOCKED TOPIC IS STILL FULLY READABLE (R1.3.4). This refuses WRITES only.
 * It is never called from a read path, and a lock must never become a visibility
 * decision — that is what `deletedAt` and category visibility are for.
 */
export function assertTopicNotLocked(locked: boolean): void {
  if (locked) {
    throw new ForbiddenException({
      statusCode: 403,
      message: 'This topic is locked and is not accepting new replies',
      reason: TOPIC_LOCKED_REASON,
    });
  }
}

/**
 * How many times a create retries after a slug collision.
 *
 * ⚠️ THE RETRY IS NOT OPTIONAL AND IT IS NOT PARANOIA. `resolveSlugCollision`
 * computes a free slug from a taken-set the caller read a moment earlier, and
 * its own docblock says plainly that this is NOT a concurrency control — two
 * simultaneous creates compute the same free slug and the `@unique` index
 * decides. There is a second, NON-racy reason too: the taken-set is read
 * through `NOT_DELETED` (AD-5 applies to every read in this file), so a
 * SOFT-DELETED topic's slug is invisible to the collision resolver while still
 * occupying the unique index. Retrying is what makes both cases a saved topic
 * instead of a `500`.
 *
 * Five attempts, because each one re-reads the taken-set and adds the slug that
 * just failed, so the candidate strictly advances.
 */
const MAX_SLUG_ATTEMPTS = 5;

/** What `create` hands back to the controller, which then composes the detail. */
export interface CreatedTopic {
  readonly id: string;
  readonly slug: string;
  readonly firstPostId: string;
}

interface PersistTopicWithOpeningPostInput {
  readonly categoryId: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly authorId: string;
  readonly now: Date;
  readonly pinned?: boolean;
  readonly locked?: boolean;
  readonly audit?: AuditHook;
}

/**
 * TopicsService — the topic WRITE paths. R1.2.1–R1.2.7, R8.2, AD-9, AD-11.
 *
 * ⚠️ THERE IS NO `Topic.body` COLUMN (AD-9). The opening body is a `Post` with
 * `postNumber = 1`, so `create` writes TWO rows in ONE transaction and an
 * "edit the body" is an edit of post #1. Every rule that applies to a reply —
 * `editedAt`, the edit window, soft delete, markdown rendering — therefore
 * applies to the opening post for free, with one implementation each.
 *
 * ⚠️ THE MEMBER EDIT PATH HAS NO `isAdmin` BRANCH, AND THAT IS THE DESIGN
 * (ASSUMPTION-5). {@link updateByAuthor} refuses a non-author unconditionally
 * and refuses an out-of-window edit unconditionally. An admin edits through
 * {@link moderate}, behind `AdminGuard`, which does not consult the window and
 * writes an audit row. So there is no escape hatch on the member path to get
 * wrong, and no admin edit that can happen unaudited.
 *
 * ⚠️ READ MODELS LIVE IN `TopicsReadService`, NOT HERE. This service returns row
 * identifiers; the controller composes `MemberTopicDetail` from the read model.
 * Keeping the write path free of response assembly is what stops the feed's
 * query budget (NFR-P4) from being spent inside a create.
 *
 * ⚠️ `postCount` IS NOT MAINTAINED HERE. It counts REPLIES (AD-11), and post #1
 * is not a reply — so a create must leave it at its `@default(0)`. `PostsService`
 * owns every change to it, in the same transaction as the post write.
 */
@Injectable()
export class TopicsService {
  private readonly logger = new Logger(TopicsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CategoriesService) private readonly categories: CategoriesService,
  ) {}

  /**
   * Create a topic and its opening post — R1.2.1, R1.2.2, AD-9.
   *
   * ⚠️ ONE TRANSACTION, TWO ROWS. A create that writes the `Topic` and then the
   * `Post` outside a transaction leaves a BODYLESS TOPIC whenever the second
   * write fails — a row that appears in the feed, has a slug, resolves to a
   * thread, and renders nothing. Nothing downstream can repair it, because
   * "topic with no post #1" is not a state any read model expects.
   *
   * ⚠️ THE TWO ROWS ARE WRITTEN AS TWO SEPARATE CALLS, NOT AS A NESTED
   * `posts: { create: … }`. Both are correct at runtime; the flat form is used
   * because a nested relation write named `posts` is indistinguishable, to the
   * AD-5 structural analyser, from a nested relation READ that returns
   * tombstones — and teaching that analyser to tell them apart would weaken the
   * rule that catches the read.
   *
   * Creating in a category the member cannot see is `404` (R1.2.1 + R1.1.3):
   * the visibility clause is part of the lookup query, so the category is not
   * found rather than found-and-refused.
   */
  async create(
    ctx: MemberContext,
    input: CreateTopicDto,
    now: Date = new Date(),
  ): Promise<CreatedTopic> {
    // ⚠️ ONE POSTURE FOR "INVISIBLE CATEGORY", SHARED WITH THE FEED AND
    // MARK-ALL-READ. `requireVisible` puts the visibility clause INSIDE the
    // lookup query, so an invisible category is not found and `404` is the
    // honest answer (R1.2.1 + R1.1.3). Re-deriving it here would be a second
    // place for the 403/404 posture to be got wrong.
    const category = await this.categories.requireVisible(
      ctx,
      input.categoryId,
    );

    const created = await this.persistTopicWithOpeningPost({
      categoryId: category.id,
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      authorId: ctx.userId,
      now,
    });

    this.logger.log(
      `Topic created: id=${created.id} slug=${created.slug} category=${category.id}`,
    );
    return created;
  }

  /**
   * The MEMBER edit path — R1.2.3, R1.2.4, ASSUMPTION-5.
   *
   * Author only, inside the edit window, and neither check has an admin bypass
   * (see the class docblock). The order of the three refusals matters:
   *
   *   1. NOT FOUND OR INVISIBLE → `404`, decided by the query itself.
   *   2. NOT THE AUTHOR        → `403`. Legitimate: the member can SEE this
   *      topic, so confirming it exists discloses nothing they did not already
   *      have. This is what `403` is reserved for (R1.1.3).
   *   3. WINDOW CLOSED         → `403`, from the one guard in `common/`.
   *
   * ⚠️ A TITLE EDIT NEVER CHANGES THE SLUG (R1.2.2), and a body edit writes to
   * POST #1 (AD-9) — including that post's own `editedAt`, so the "edited"
   * marker renders where the change happened.
   */
  async updateByAuthor(
    ctx: MemberContext,
    topicId: string,
    input: UpdateTopicDto,
    now: Date = new Date(),
  ): Promise<{ id: string; slug: string }> {
    if (input.title === undefined && input.bodyMarkdown === undefined) {
      throw new BadRequestException(
        'Supply at least one of: title, bodyMarkdown',
      );
    }

    const topic = await this.prisma.topic.findFirst({
      where: {
        id: topicId,
        ...NOT_DELETED,
        ...buildTopicCategoryVisibilityWhere(ctx),
      },
      select: { id: true, slug: true, authorId: true, createdAt: true },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }
    if (topic.authorId !== ctx.userId) {
      throw new ForbiddenException('Only the author can edit this topic');
    }
    assertWithinEditWindow(topic.createdAt, now);

    await this.prisma.$transaction(async (tx) => {
      if (input.title !== undefined) {
        await tx.topic.update({
          where: { id: topic.id },
          // NOTE: no `slug` key. R1.2.2 — the slug was generated once, at
          // creation, and every shared link depends on it not moving.
          data: { title: input.title, editedAt: now },
        });
      }

      if (input.bodyMarkdown !== undefined) {
        // `updateMany` rather than `update`: post #1 is identified by the
        // COMPOSITE (topicId, postNumber), and `updateMany` is the verb that
        // accepts a non-unique `where` — which is also what lets the soft-delete
        // filter be part of it, so an edit cannot resurrect the body of a
        // tombstoned opening post.
        await tx.post.updateMany({
          where: { topicId: topic.id, postNumber: 1, ...NOT_DELETED },
          data: { bodyMarkdown: input.bodyMarkdown, editedAt: now },
        });
      }
    });

    this.logger.log(`Topic edited by author: id=${topic.id}`);
    return { id: topic.id, slug: topic.slug };
  }

  /**
   * Soft delete by the author — R1.2.7, AD-5.
   *
   * ⚠️ NO EDIT WINDOW ON DELETION, AND THE SPEC SAYS SO STRUCTURALLY. §3.3's
   * error table annotates `PATCH topics/:id` as `403 (not author / window
   * closed)` and `DELETE topics/:id` as plain `403` — the annotation is present
   * on one row and absent on the other. Read the other way, a window on
   * deletion would trap a member with content they want removed 25 hours after
   * posting it, and their only remaining route would be to ask an admin.
   *
   * The topic disappears from every member listing, feed and search result
   * immediately, and it does so for FREE: every member read in this lib spreads
   * `NOT_DELETED`, so there is no cache to invalidate and no second index to
   * update. Its posts are NOT touched — they are unreachable through the topic,
   * and leaving them intact is what makes R8.5's admin restore a single-row
   * write.
   */
  async softDelete(
    ctx: MemberContext,
    topicId: string,
    now: Date = new Date(),
  ): Promise<{ deleted: boolean }> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: topicId,
        ...NOT_DELETED,
        ...buildTopicCategoryVisibilityWhere(ctx),
      },
      select: { id: true, authorId: true },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }
    if (topic.authorId !== ctx.userId) {
      throw new ForbiddenException('Only the author can delete this topic');
    }

    await this.prisma.topic.update({
      where: { id: topic.id },
      data: { deletedAt: now, deletedBy: ctx.userId },
    });

    this.logger.log(`Topic soft-deleted by author: id=${topic.id}`);
    return { deleted: true };
  }

  /**
   * Pin / lock / move / edit, ADMIN ONLY — R1.2.5, R1.2.6, R8.2.
   *
   * Reachable only from the `AdminGuard`-gated moderation controller (Task
   * 6.13). It takes no `MemberContext` at all, which is the strongest available
   * statement that it applies no visibility filter and grants no member-side
   * authority: there is no context here to consult.
   *
   * ⚠️ THE EDIT WINDOW IS NOT CHECKED, BY CONSTRUCTION — this is the structural
   * admin exemption ASSUMPTION-5 describes. The audit row supplied by {@link
   * AuditHook} is what makes that acceptable.
   */
  async moderate(
    topicId: string,
    input: ModerateTopicDto,
    now: Date = new Date(),
    audit?: ModerationAuditHook,
  ): Promise<{ id: string; changed: string[] }> {
    const changed = MODERATABLE_KEYS.filter((key) => input[key] !== undefined);
    if (changed.length === 0) {
      throw new BadRequestException(
        `Supply at least one of: ${MODERATABLE_KEYS.join(', ')}`,
      );
    }

    const topic = await this.prisma.topic.findFirst({
      where: { id: topicId, ...NOT_DELETED },
      select: { id: true },
    });
    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    if (input.categoryId !== undefined) {
      const target = await this.prisma.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true },
      });
      if (!target) {
        // A typed `400` rather than letting the FK raise a raw `P2003`, whose
        // message names the constraint and the columns (NFR-S7).
        throw new BadRequestException('Target category not found');
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const data: Prisma.TopicUpdateInput = {};
        if (input.pinned !== undefined) data.pinned = input.pinned;
        if (input.locked !== undefined) data.locked = input.locked;
        if (input.title !== undefined) {
          data.title = input.title;
          data.editedAt = now;
        }
        if (input.categoryId !== undefined) {
          // Scalar FK via `connect` rather than a nested `category: { create }`;
          // the relation is required, so `connect` is the only legal shape.
          data.category = { connect: { id: input.categoryId } };
        }

        await tx.topic.update({ where: { id: topic.id }, data });

        if (input.bodyMarkdown !== undefined) {
          await tx.post.updateMany({
            where: { topicId: topic.id, postNumber: 1, ...NOT_DELETED },
            data: { bodyMarkdown: input.bodyMarkdown, editedAt: now },
          });
        }

        await audit?.(tx, topic.id, changed);
      });
    } catch (error: unknown) {
      throw this.mapPrismaError(error);
    }

    this.logger.log(
      `Topic moderated: id=${topic.id} changed=[${changed.join(',')}]`,
    );
    return { id: topic.id, changed };
  }

  /**
   * Admin soft delete — R1.2.7, R8.2.
   *
   * Separate from {@link softDelete} because it has no author check and no
   * `MemberContext`, and because it records the acting ADMIN in `deletedBy` —
   * which is what makes R8.5's restore window auditable.
   */
  async softDeleteAsAdmin(
    topicId: string,
    actorId: string,
    now: Date = new Date(),
    audit?: ModerationAuditHook,
  ): Promise<{ deleted: boolean }> {
    const topic = await this.prisma.topic.findFirst({
      where: { id: topicId, ...NOT_DELETED },
      select: { id: true },
    });
    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.topic.update({
        where: { id: topic.id },
        data: { deletedAt: now, deletedBy: actorId },
      });
      await audit?.(tx, topic.id, ['deleted']);
    });

    this.logger.log(
      `Topic soft-deleted by admin: id=${topic.id} actor=${actorId}`,
    );
    return { deleted: true };
  }

  /**
   * Admin restore of a soft-deleted topic — R8.5, R8.2.
   *
   * ⚠️ THE 30-DAY WINDOW IS PART OF THE `UPDATE`'S `WHERE`, NOT A CHECK BEFORE
   * IT. `restorableWhere(now)` is built from `RESTORE_WINDOW_MS` in `common/`
   * — one constant, two consumers (this and `PostsService.restore`), no literal
   * `30` anywhere near a controller. Postgres evaluates the window against the
   * committed row in the same statement that writes, so there is no instant
   * between deciding and doing, and `count` IS the outcome.
   *
   * ⚠️ IT ALSO MEANS THIS PATH TAKES NO AD-5 EXEMPTION. The obvious
   * implementation — read the tombstone, compare, then update — is an
   * unfiltered read of a soft-deletable model on a WRITE path, which is exactly
   * the kind of `EXPECTED_EXEMPTIONS` entry that should be refused in review.
   * `updateMany` is not a read, so nothing is exempted here.
   *
   * ⚠️ `deletedBy` IS CLEARED TOO. Leaving the deleting admin's id on a live row
   * makes every later "who deleted this?" query answer for a topic that is not
   * deleted; the audit row is where that history belongs, and it is written
   * inside this same transaction (PRE-6).
   */
  async restore(
    topicId: string,
    actorId: string,
    now: Date = new Date(),
    audit?: ModerationAuditHook,
  ): Promise<{ restored: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.topic.updateMany({
        where: { id: topicId, ...restorableWhere(now) },
        data: { deletedAt: null, deletedBy: null },
      });

      assertRestored(result.count);
      await audit?.(tx, topicId, ['restored']);
    });

    this.logger.log(`Topic restored by admin: id=${topicId} actor=${actorId}`);
    return { restored: true };
  }

  /**
   * Create an admin-authored topic without applying member category visibility.
   * Topic, opening post and audit row commit or roll back together.
   */
  async createAsAdmin(
    actorUserId: string,
    input: CreateAdminTopicDto,
    now: Date = new Date(),
    audit?: AuditHook,
  ): Promise<{ id: string; slug: string }> {
    const category = await this.prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const created = await this.persistTopicWithOpeningPost({
      categoryId: category.id,
      title: input.title,
      bodyMarkdown: input.body,
      authorId: actorUserId,
      pinned: input.pinned ?? false,
      locked: input.locked ?? false,
      now,
      audit,
    });

    this.logger.log(
      `Admin topic created: id=${created.id} slug=${created.slug} category=${category.id} actor=${actorUserId}`,
    );
    return { id: created.id, slug: created.slug };
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Persist a topic and post #1 through the one shared create path.
   * Category authorization and lookup remain the caller's responsibility.
   */
  private async persistTopicWithOpeningPost(
    input: PersistTopicWithOpeningPostInput,
  ): Promise<CreatedTopic> {
    const stem = slugify(input.title);
    const failed = new Set<string>();

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const existing = await this.prisma.topic.findMany({
        where: { ...NOT_DELETED, slug: { startsWith: stem } },
        select: { slug: true },
      });
      const taken = new Set<string>([
        ...existing.map((row) => row.slug),
        ...failed,
      ]);
      const slug = buildSlug(input.title, taken);

      try {
        return await this.prisma.$transaction(async (tx) => {
          const topic = await tx.topic.create({
            data: {
              categoryId: input.categoryId,
              slug,
              title: input.title,
              authorId: input.authorId,
              ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
              ...(input.locked === undefined ? {} : { locked: input.locked }),
              // `lastPostedAt` has no default in the schema: it is the feed's
              // sort key and must exist from the instant the topic is created.
              lastPostedAt: input.now,
            },
            select: { id: true, slug: true },
          });

          // POST #1 IS THE BODY (AD-9). It is created in the same transaction
          // as the topic so a bodyless topic can never become visible.
          const first = await tx.post.create({
            data: {
              topicId: topic.id,
              parentId: null,
              postNumber: 1,
              bodyMarkdown: input.bodyMarkdown,
              authorId: input.authorId,
            },
            select: { id: true },
          });

          await input.audit?.(tx, topic.id);
          return { id: topic.id, slug: topic.slug, firstPostId: first.id };
        });
      } catch (error: unknown) {
        if (this.isSlugCollision(error) && attempt < MAX_SLUG_ATTEMPTS) {
          failed.add(slug);
          continue;
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        ) {
          throw new NotFoundException('Category not found');
        }
        throw this.mapPrismaError(error);
      }
    }

    // Unreachable in practice: each attempt adds the failed slug to `failed`,
    // so the candidate strictly advances. The message is sanitized (NFR-S7).
    throw new BadRequestException(
      'Could not allocate a unique link for this title — please adjust the title and try again',
    );
  }

  /** A `P2002` naming `slug` — the one collision `create` retries rather than surfaces. */
  private isSlugCollision(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code !== 'P2002') return false;

    const target = error.meta?.['target'];
    if (Array.isArray(target)) return target.includes('slug');
    if (typeof target === 'string') return target.includes('slug');
    // Prisma did not report a target. Treat it as a slug collision anyway: this
    // create writes exactly two rows, and post #1's `(topicId, postNumber)`
    // cannot collide in a topic that did not exist a statement ago. Retrying is
    // the safe direction — the worst case is a wasted attempt.
    return true;
  }

  /** Typed, sanitized translation of a Prisma failure (NFR-S7). */
  private mapPrismaError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new BadRequestException(
          'Could not allocate a unique link for this title — please adjust the title and try again',
        );
      }
      if (error.code === 'P2003' || error.code === 'P2025') {
        return new NotFoundException('Topic not found');
      }
    }
    return error instanceof Error
      ? error
      : new Error('Unknown topic persistence error');
  }
}

/** The keys {@link ModerateTopicDto} may carry, for the "what changed" audit trail. */
const MODERATABLE_KEYS = [
  'pinned',
  'locked',
  'categoryId',
  'title',
  'bodyMarkdown',
] as const satisfies readonly (keyof ModerateTopicDto)[];

/**
 * A caller-supplied audit write, enlisted in the moderation transaction (PRE-6).
 *
 * See `CategoriesService`'s `AuditHook` for the full reasoning: the
 * `community.topic.*` values this row needs are not in `AdminAuditAction` yet
 * (Task 6.13 owns adding them), and a hook is what keeps atomicity available
 * without this batch inventing the action names.
 */
export type ModerationAuditHook = (
  tx: Prisma.TransactionClient,
  topicId: string,
  changed: readonly string[],
) => Promise<void>;
