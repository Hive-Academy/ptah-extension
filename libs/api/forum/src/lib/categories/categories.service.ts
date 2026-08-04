import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type {
  AdminCategory,
  MemberCategory,
  Visibility,
} from '@ptah-contracts/community';

import { NOT_DELETED } from '../common/soft-delete';
import { buildCategoryVisibilityWhere } from '../common/visibility';

import type { CreateCategoryDto } from './dto/create-category.dto';
import type { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';

/**
 * CategoriesService — R1.1, R8.8, AD-10.
 *
 * ⚠️ THE MEMBER READ NEVER DISCLOSES AN INVISIBLE CATEGORY, INCLUDING ITS
 * COUNTS (R1.1.2, stronger than "filter the list").
 *
 * `topicCount` and `unreadCount` are computed from topics whose `categoryId` is
 * already restricted to the categories that survived
 * `buildCategoryVisibilityWhere` — never computed across all categories and
 * then masked. A masked count is a disclosure: "there are 47 threads you cannot
 * see" is the same oracle as a `403`, delivered as a number.
 *
 * ⚠️ NO SERVICE HERE RE-DERIVES VISIBILITY OR ENTITLEMENT (R7.3). `MemberContext`
 * arrives resolved from `MemberGuard`; this service injects neither
 * `MembershipService` nor a cohort resolver, and the only visibility logic it
 * contains is the CALL to `common/visibility.ts`.
 *
 * ADMIN WRITES. `create` / `update` / `remove` / `reorder` are reachable only
 * from the `AdminGuard`-gated admin controller (Task 6.13). They take an
 * optional {@link AuditHook} so the caller's audit row commits inside the SAME
 * transaction as the mutation (PRE-6, the `packs.service.ts` pattern) — see the
 * type's docblock for why the hook is a seam rather than an injected
 * `AuditLogService`.
 */
@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Every category this member may see, in admin-defined order (R1.1.4).
   *
   * ⚠️ ORDERED BY `sortOrder`, NEVER ALPHABETICALLY AND NEVER BY CREATION DATE.
   * `name` is only the TIE-BREAK, so two categories sharing a `sortOrder` still
   * come back in a stable order rather than whatever Postgres last wrote.
   *
   * THREE QUERIES, NO N+1:
   *   1. the visible categories;
   *   2. their live topics, projected to `{ id, categoryId, postCount }`;
   *   3. this member's read markers for exactly those topics.
   *
   * Query 2 is a projection over ids and two integers, not topic content, and
   * it is what makes both counts derivable without a per-category round trip.
   * At §1.3 volume it is a handful of rows. If the forum ever outgrows that,
   * the replacement is a `groupBy` for `topicCount` plus a read-state join for
   * `unreadCount` — NOT a per-category count, which is the N+1 this shape
   * exists to avoid.
   *
   * A `_count: { select: { topics: true } }` would be shorter and WRONG: it
   * counts soft-deleted topics, silently inflating every number on the category
   * nav (AD-5 — and `soft-delete-filter.spec.ts` rejects it).
   */
  async listForMember(ctx: MemberContext): Promise<MemberCategory[]> {
    const categories = await this.prisma.category.findMany({
      where: buildCategoryVisibilityWhere(ctx),
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        visibility: true,
        sortOrder: true,
      },
    });

    if (categories.length === 0) return [];

    const categoryIds = categories.map((category) => category.id);

    const topics = await this.prisma.topic.findMany({
      where: { ...NOT_DELETED, categoryId: { in: categoryIds } },
      select: { id: true, categoryId: true, postCount: true },
    });

    const readStates =
      topics.length === 0
        ? []
        : await this.prisma.topicReadState.findMany({
            where: {
              userId: ctx.userId,
              topicId: { in: topics.map((topic) => topic.id) },
            },
            select: { topicId: true, lastReadPostNumber: true },
          });

    // A MISSING ROW IS THE "NEVER READ" SIGNAL (R1.6.3). No row is written on a
    // read, so the `@default(0)` below is what makes a never-opened topic report
    // its whole reply count.
    const lastRead = new Map(
      readStates.map((state) => [state.topicId, state.lastReadPostNumber]),
    );

    const topicCounts = new Map<string, number>();
    const unreadCounts = new Map<string, number>();

    for (const topic of topics) {
      topicCounts.set(
        topic.categoryId,
        (topicCounts.get(topic.categoryId) ?? 0) + 1,
      );

      // ⚠️ A COUNT OF TOPICS WITH UNREAD ACTIVITY, NOT A SUM OF UNREAD POSTS —
      // see `MemberCategory.unreadCount`. Bounded above by `topicCount`.
      if (topic.postCount > (lastRead.get(topic.id) ?? 0)) {
        unreadCounts.set(
          topic.categoryId,
          (unreadCounts.get(topic.categoryId) ?? 0) + 1,
        );
      }
    }

    return categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      // The column is a Postgres `String`, not an enum. It was written through
      // the `@IsIn(VISIBILITIES)` DTO, so the cast asserts a property the write
      // path enforces rather than one this read hopes for.
      visibility: category.visibility as Visibility,
      sortOrder: category.sortOrder,
      topicCount: topicCounts.get(category.id) ?? 0,
      unreadCount: unreadCounts.get(category.id) ?? 0,
    }));
  }

  /**
   * Resolve one category id to a VISIBLE category, or `404`.
   *
   * ⚠️ THE VISIBILITY CLAUSE IS PART OF THE QUERY, so an invisible category is
   * simply not found and the honest answer is `404` (R1.1.3). There is no
   * branch here that could produce a `403`, because nothing in this method ever
   * learns that the row exists.
   *
   * Shared by the topic feed (`?categoryId=`), topic creation and
   * mark-all-read, so those three cannot drift into three different postures.
   */
  async requireVisible(
    ctx: MemberContext,
    categoryId: string,
  ): Promise<{ id: string; name: string }> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, ...buildCategoryVisibilityWhere(ctx) },
      select: { id: true, name: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  /* ---------------------------------------------------------------------- */
  /* Admin reads                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Every category, for the moderation surface — `AdminCategory[]` (§3.3, R8.8).
   *
   * ⚠️ NO VISIBILITY FILTER, AND THAT IS THE POINT OF A SEPARATE METHOD. An
   * admin managing categories must see the `cohort` ones they are not in and
   * the `staff` ones nobody else can reach; that is a different question from
   * "what may this member read", which {@link listForMember} answers and which
   * ASSUMPTION-4 deliberately keeps narrow. Reusing one method with an `isAdmin`
   * branch would put a write-surface concern inside the member visibility path.
   *
   * ⚠️ `cohortNames` IS RESOLVED, NOT ECHOED. `Category.cohortKeys` is a
   * `String[]` with NO foreign key (AD-10), so a key naming a group that has
   * since been renamed or deleted stays in the array and matches nobody. The
   * admin table is the only surface that can show that, and it can only show it
   * if the names come from `MemberGroup` rather than from the keys themselves —
   * a missing name is a key that has gone stale, and printing the raw key back
   * would hide exactly the failure this resolution exists to expose.
   *
   * ⚠️ `topicCount` COUNTS LIVE TOPICS ONLY. It is therefore NOT the number that
   * decides whether a delete succeeds: `Topic.category` is `onDelete: Restrict`,
   * and Postgres counts TOMBSTONES too, so a category reading `0` here can still
   * refuse deletion with the `409` from {@link remove}. That is the correct
   * split — the constraint is the gate, this number is for the reader — and
   * counting tombstones instead would require an unfiltered read of a
   * soft-deletable model (an AD-5 exemption) to make a number nobody acts on
   * more precise.
   *
   * Three queries, no N+1: categories · their live topics projected to
   * `{ categoryId }` · the member groups named by the union of all `cohortKeys`.
   */
  async listForAdmin(): Promise<AdminCategory[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    if (categories.length === 0) return [];

    const topics = await this.prisma.topic.findMany({
      where: {
        ...NOT_DELETED,
        categoryId: { in: categories.map((c) => c.id) },
      },
      select: { categoryId: true },
    });

    const topicCounts = new Map<string, number>();
    for (const topic of topics) {
      topicCounts.set(
        topic.categoryId,
        (topicCounts.get(topic.categoryId) ?? 0) + 1,
      );
    }

    const keys = [...new Set(categories.flatMap((c) => c.cohortKeys))];
    const groups =
      keys.length === 0
        ? []
        : await this.prisma.memberGroup.findMany({
            where: { key: { in: keys } },
            select: { key: true, name: true },
          });
    const groupNames = new Map(groups.map((group) => [group.key, group.name]));

    return categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      visibility: category.visibility as Visibility,
      cohortKeys: [...category.cohortKeys],
      // A key with no group left keeps its position in the list and reports the
      // absence, rather than being dropped — a silently shorter array would make
      // a stale key look like a key that was never there.
      cohortNames: category.cohortKeys.map(
        (key) => groupNames.get(key) ?? `${key} (unknown group)`,
      ),
      sortOrder: category.sortOrder,
      topicCount: topicCounts.get(category.id) ?? 0,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* Admin writes                                                            */
  /* ---------------------------------------------------------------------- */

  /** Create a category. Duplicate slug → `409`; unknown `cohortKey` → `400`. */
  async create(
    input: CreateCategoryDto,
    audit?: AuditHook,
  ): Promise<CategoryRow> {
    const cohortKeys = input.cohortKeys ?? [];
    await this.assertCohortKeysExist(cohortKeys);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const sortOrder = input.sortOrder ?? (await this.nextSortOrder(tx));

        const row = await tx.category.create({
          data: {
            slug: input.slug,
            name: input.name,
            description: input.description ?? null,
            visibility: input.visibility,
            cohortKeys,
            sortOrder,
          },
        });

        await audit?.(tx, row.id);
        return row;
      });

      this.logger.log(
        `Category created: id=${created.id} slug=${created.slug} visibility=${created.visibility}`,
      );
      return created;
    } catch (error: unknown) {
      throw this.mapPrismaError(error, input.slug);
    }
  }

  /** Patch a category. Only supplied keys are written. */
  async update(
    id: string,
    input: UpdateCategoryDto,
    audit?: AuditHook,
  ): Promise<CategoryRow> {
    if (input.cohortKeys !== undefined) {
      await this.assertCohortKeysExist(input.cohortKeys);
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.category.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!existing) {
          throw new NotFoundException('Category not found');
        }

        const data: Prisma.CategoryUpdateInput = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.description !== undefined)
          data.description = input.description;
        if (input.visibility !== undefined) data.visibility = input.visibility;
        if (input.cohortKeys !== undefined) data.cohortKeys = input.cohortKeys;
        if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

        const row = await tx.category.update({ where: { id }, data });
        await audit?.(tx, row.id);
        return row;
      });

      this.logger.log(`Category updated: id=${id}`);
      return updated;
    } catch (error: unknown) {
      throw this.mapPrismaError(error, undefined, id);
    }
  }

  /**
   * Delete a category.
   *
   * ⚠️ A CATEGORY WITH TOPICS CANNOT BE DELETED, AND THE DATABASE IS WHAT
   * REFUSES. `Topic.category` is `onDelete: Restrict` (§1.3), so Postgres
   * raises a foreign-key violation and Prisma reports `P2003`. This method's
   * job is to turn that into a TYPED, SANITIZED `409` (NFR-S7) — never to let a
   * raw Prisma message reach a client, and never to soften the constraint to
   * `Cascade`, which would silently destroy a discussion an admin only meant to
   * tidy away.
   *
   * A pre-flight `count()` is deliberately NOT used as the gate: it would be a
   * TOCTOU window in which a member creates a topic between the check and the
   * delete. The constraint is the gate; the count below only makes the message
   * useful.
   */
  async remove(id: string, audit?: AuditHook): Promise<{ deleted: boolean }> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.category.findUnique({
          where: { id },
          select: { id: true, slug: true },
        });
        if (!existing) {
          throw new NotFoundException('Category not found');
        }

        await tx.category.delete({ where: { id } });
        await audit?.(tx, id);
      });

      this.logger.log(`Category deleted: id=${id}`);
      return { deleted: true };
    } catch (error: unknown) {
      throw this.mapPrismaError(error, undefined, id);
    }
  }

  /**
   * Renumber the whole category list in ONE transaction, on a sparse scale
   * (R8.8).
   *
   * ⚠️ SPARSE (100, 200, 300 …) SO A LATER SINGLE INSERT DOES NOT FORCE A FULL
   * RENUMBER. With a dense 0,1,2 scale, dropping one category between two
   * others means rewriting every row after it; with a step of 100 it means
   * writing one row at 150.
   *
   * ⚠️ THE LIST MUST BE COMPLETE AND DUPLICATE-FREE — see
   * `ReorderCategoriesDto.ids`. Both failures are `400` with a fixed message,
   * checked INSIDE the transaction so the completeness check and the writes see
   * the same snapshot: a category created by another admin between the check
   * and the writes would otherwise be renumbered out of existence.
   */
  async reorder(
    input: ReorderCategoriesDto,
    audit?: AuditHook,
  ): Promise<{ reordered: number }> {
    const unique = new Set(input.ids);
    if (unique.size !== input.ids.length) {
      throw new BadRequestException(
        'ids must not contain duplicates — one category cannot hold two positions',
      );
    }

    const reordered = await this.prisma.$transaction(async (tx) => {
      const all = await tx.category.findMany({ select: { id: true } });
      const known = new Set(all.map((category) => category.id));

      const unknown = input.ids.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `ids contains ${unknown.length} unknown category id(s)`,
        );
      }
      if (input.ids.length !== known.size) {
        throw new BadRequestException(
          `ids must list every category exactly once (expected ${known.size}, received ${input.ids.length})`,
        );
      }

      for (const [index, id] of input.ids.entries()) {
        await tx.category.update({
          where: { id },
          data: { sortOrder: (index + 1) * SORT_ORDER_STEP },
        });
      }

      await audit?.(tx, null);
      return input.ids.length;
    });

    this.logger.log(`Categories reordered: count=${reordered}`);
    return { reordered };
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Every `cohortKey` must name a real `MemberGroup.key` — R1.1.1, AD-10.
   *
   * ⚠️ AN UNKNOWN KEY IS A `400`, NOT A SILENTLY UNREACHABLE CATEGORY. AD-10
   * stores cohort keys as a `String[]` column rather than a join table, so there
   * is NO foreign key to catch a typo: a category with `cohortKeys: ['foundng']`
   * saves cleanly, matches `hasSome` for nobody, and is invisible to every
   * member including the admin who created it — with no error anywhere. The
   * array column is the right call (it keeps the visibility check to one
   * operator on one row); this check is the price of it.
   */
  private async assertCohortKeysExist(
    cohortKeys: readonly string[],
  ): Promise<void> {
    if (cohortKeys.length === 0) return;

    const groups = await this.prisma.memberGroup.findMany({
      where: { key: { in: [...cohortKeys] } },
      select: { key: true },
    });

    const found = new Set(groups.map((group) => group.key));
    const unknown = cohortKeys.filter((key) => !found.has(key));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown cohort key(s): ${unknown.join(', ')} — create the member group first`,
      );
    }
  }

  /** Append position for a create that did not choose one. */
  private async nextSortOrder(tx: Prisma.TransactionClient): Promise<number> {
    const highest = await tx.category.aggregate({ _max: { sortOrder: true } });
    return (highest._max.sortOrder ?? 0) + SORT_ORDER_STEP;
  }

  /**
   * Translate a Prisma failure into a typed Nest exception (NFR-S7).
   *
   * ⚠️ RAW PRISMA MESSAGES ARE NEVER FORWARDED. A `P2003` message names the
   * constraint, the table and the column — a schema disclosure on an endpoint
   * that already told the caller it refused. Each branch below produces a fixed
   * sentence built only from values the caller supplied.
   *
   * A `NotFoundException` (or any other `HttpException`) thrown from inside the
   * transaction passes through untouched: it is already typed and sanitized,
   * and re-wrapping it would turn a deliberate `404` into a `500`.
   */
  private mapPrismaError(error: unknown, slug?: string, id?: string): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new ConflictException(
          slug
            ? `A category with slug '${slug}' already exists`
            : 'A category with that slug already exists',
        );
      }
      if (error.code === 'P2003') {
        // `Topic.category` is `onDelete: Restrict` — the only FK pointing here.
        return new ConflictException(
          'This category still contains topics and cannot be deleted. Move or delete its topics first.',
        );
      }
      if (error.code === 'P2025') {
        return new NotFoundException('Category not found');
      }
    }
    return error instanceof Error
      ? error
      : new Error('Unknown category persistence error');
  }
}

/**
 * The gap between adjacent `sortOrder` values after a reorder (R8.8).
 *
 * 100 leaves room for 99 manual insertions between any two categories before a
 * renumber is needed, which at the number of categories a community has is
 * effectively never.
 */
export const SORT_ORDER_STEP = 100;

/** The `Category` row shape these writes return. */
export type CategoryRow = Prisma.CategoryModel;

/**
 * A caller-supplied audit write, enlisted in the mutation's OWN transaction.
 *
 * ⚠️ WHY A HOOK RATHER THAN AN INJECTED `AuditLogService`. PRE-6 requires every
 * admin mutation's audit row to commit or roll back with the mutation. The
 * `community.*` values that row needs (`community.category.create`, …) do not
 * exist in `AdminAuditAction` yet — `audit-log.types.ts` still carries the
 * "there is no `community.*` action YET" comment, and Task 6.13 owns adding
 * them together with the admin controllers that write them. Referencing a value
 * that is not in the union would not compile.
 *
 * A hook keeps atomicity AVAILABLE without this batch guessing the action
 * names: Task 6.13 passes `(tx, id) => this.audit.write({ …, tx })` and the
 * property PRE-6 asks for holds. The alternative — Task 6.13 opening its own
 * transaction around this one — is exactly the non-atomic shape PRE-6 exists to
 * forbid.
 *
 * `targetId` is `null` for `reorder`, which has no single target row.
 */
export type AuditHook = (
  tx: Prisma.TransactionClient,
  targetId: string | null,
) => Promise<void>;
