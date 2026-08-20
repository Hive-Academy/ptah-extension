import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';

import { NOT_DELETED } from '../common/soft-delete';
import { renumberSparse } from '../common/sort-order';

import { mapPrismaError, type AuditHook } from './courses.service';

/**
 * ReorderService — R8.8: ONE request, ONE transaction, a sparse renumber.
 *
 * 🔴 R8.8 IS THE WHOLE POINT OF THIS FILE. Reordering a curriculum by issuing
 * one `PATCH` per row is the shape that produces a half-ordered course when the
 * fourth request fails, and it is the shape that makes an admin's drag of one
 * lesson cost twelve round trips. `PATCH reorder` takes `{ ids }` — the
 * COMPLETE sibling list in the desired order — and writes `renumberSparse(ids)`
 * inside a single `$transaction`.
 *
 * THREE PROPERTIES, EACH OF WHICH IS A DECISION:
 *
 *  1. 🔴 **`@@unique([courseId, sortOrder])` IS DELIBERATELY NOT DECLARED**
 *     (plan §1.4's own comment). A uniqueness constraint would force these
 *     `UPDATE`s to be SEQUENCED to dodge transient collisions — swapping two
 *     adjacent rows would need a third, temporary value — and that sequencing
 *     is fragile in exactly the way a bulk operation must not be. Because there
 *     is no constraint, the writes are independent and their ORDER DOES NOT
 *     MATTER; `reorder.service.spec.ts` asserts that directly.
 *
 *  2. 🔴 **THE SUBMITTED `ids` MUST BE EXACTLY THE CURRENT SIBLING SET** — no
 *     additions, no omissions, no duplicates, no foreign parents. A PARTIAL
 *     list is a `400`, not a partial renumber: renumbering a subset onto the
 *     sparse scale interleaves the renumbered rows with untouched ones at
 *     values nobody chose, so the resulting order is neither the old one nor
 *     the new one — and it can create ties, which `DETERMINISTIC_ORDER_BY` then
 *     breaks by `createdAt`, i.e. by an order the admin never expressed.
 *
 *  3. 🔴 **ONE AUDIT ROW PER REORDER, NOT ONE PER ROW.** The intent is "the
 *     admin reordered these siblings"; twelve rows would make the log useless
 *     for the one case it exists for. Batch 7's bulk-lock decision is the
 *     INVERSE of this and both are right: twelve independent moderation actions
 *     are twelve rows, one reorder is one action.
 *
 * ⚠️ COMPLETENESS IS CHECKED **INSIDE** THE TRANSACTION, against the same
 * snapshot the writes see. Checked outside, a lesson created by another admin
 * between the check and the writes would be left at a stale number — renumbered
 * out of the order without ever appearing in the request. Forum's
 * `CategoriesService.reorder` made the same call (D-6.6a).
 *
 * ⚠️ THE THREE ENTRY POINTS SHARE ONE IMPLEMENTATION. Courses, modules within a
 * course, and lessons within a module are the same operation over three
 * delegates; three copies would drift in the way that is invisible — one
 * forgetting the duplicate check, one forgetting to scope to the parent.
 */
@Injectable()
export class ReorderService {
  private readonly logger = new Logger(ReorderService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Renumber every course — `PATCH /v1/admin/courses/reorder`. */
  async reorderCourses(
    ids: readonly string[],
    audit?: AuditHook,
  ): Promise<ReorderResult> {
    return this.reorder({
      label: 'course',
      ids,
      readSiblings: (tx) =>
        tx.course.findMany({ where: { ...NOT_DELETED }, select: { id: true } }),
      write: (tx, id, sortOrder) =>
        tx.course.update({ where: { id }, data: { sortOrder } }),
      audit,
    });
  }

  /**
   * Renumber the modules of ONE course —
   * `PATCH /v1/admin/course-modules/reorder`.
   *
   * ⚠️ SCOPED TO A PARENT, WHICH IS WHY `courseId` IS A PARAMETER AND NOT
   * INFERRED FROM THE FIRST ID. Inferring it would make a request mixing two
   * courses' modules look valid for whichever course the first id belonged to,
   * and would silently renumber a course the admin was not editing.
   */
  async reorderModules(
    courseId: string,
    ids: readonly string[],
    audit?: AuditHook,
  ): Promise<ReorderResult> {
    return this.reorder({
      label: 'module',
      ids,
      readSiblings: async (tx) => {
        const course = await tx.course.findFirst({
          where: { id: courseId, ...NOT_DELETED },
          select: { id: true },
        });
        if (!course) throw new NotFoundException('Course not found');

        return tx.courseModule.findMany({
          where: { ...NOT_DELETED, courseId },
          select: { id: true },
        });
      },
      write: (tx, id, sortOrder) =>
        tx.courseModule.update({ where: { id }, data: { sortOrder } }),
      audit,
    });
  }

  /** Renumber the lessons of ONE module — `PATCH /v1/admin/lessons/reorder`. */
  async reorderLessons(
    moduleId: string,
    ids: readonly string[],
    audit?: AuditHook,
  ): Promise<ReorderResult> {
    return this.reorder({
      label: 'lesson',
      ids,
      readSiblings: async (tx) => {
        const module = await tx.courseModule.findFirst({
          where: { id: moduleId, ...NOT_DELETED, course: { ...NOT_DELETED } },
          select: { id: true },
        });
        if (!module) throw new NotFoundException('Module not found');

        return tx.lesson.findMany({
          where: { ...NOT_DELETED, moduleId },
          select: { id: true },
        });
      },
      write: (tx, id, sortOrder) =>
        tx.lesson.update({ where: { id }, data: { sortOrder } }),
      audit,
    });
  }

  /* ---------------------------------------------------------------------- */

  private async reorder(op: ReorderOperation): Promise<ReorderResult> {
    // The duplicate check is the one that can be made OUTSIDE the transaction:
    // it is a property of the request alone and does not depend on any
    // database state, so checking it first avoids opening a transaction for a
    // request that could never succeed.
    const unique = new Set(op.ids);
    if (unique.size !== op.ids.length) {
      throw new BadRequestException(
        `ids must not contain duplicates — one ${op.label} cannot hold two positions`,
      );
    }

    const reordered = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        const siblings = await op.readSiblings(tx);
        const known = new Set(siblings.map((row) => row.id));

        const unknown = op.ids.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          // ⚠️ THE COUNT, NOT THE IDS. Echoing an id the caller supplied is
          // harmless; echoing which of them exist elsewhere would turn this
          // into an existence probe over the whole table.
          throw new BadRequestException(
            `ids contains ${unknown.length} id(s) that are not live ${op.label}s of this parent`,
          );
        }
        if (op.ids.length !== known.size) {
          throw new BadRequestException(
            `ids must list every ${op.label} exactly once ` +
              `(expected ${known.size}, received ${op.ids.length})`,
          );
        }

        // ⚠️ THE NUMBERS COME FROM `renumberSparse`, NOT FROM AN INLINE
        // `(index + 1) * 100`. One declaration of the scale means the reorder
        // and the append path (`appendSortOrder`) cannot drift onto two
        // different grids.
        for (const { id, sortOrder } of renumberSparse(op.ids)) {
          await op.write(tx, id, sortOrder);
        }

        // ONE row, with a null target — the action has no single subject.
        await op.audit?.(tx, null);
        return op.ids.length;
      }),
    );

    this.logger.log(`Reordered ${reordered} ${op.label}(s)`);
    return { reordered };
  }

  private async withMappedPrismaErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      throw mapPrismaError(error);
    }
  }
}

/** One reorder, parameterised over the model it renumbers. */
interface ReorderOperation {
  /** Used only in messages and logs. */
  readonly label: 'course' | 'module' | 'lesson';
  readonly ids: readonly string[];
  /** The complete LIVE sibling set, read inside the transaction. */
  readonly readSiblings: (
    tx: Prisma.TransactionClient,
  ) => Promise<{ id: string }[]>;
  readonly write: (
    tx: Prisma.TransactionClient,
    id: string,
    sortOrder: number,
  ) => Promise<unknown>;
  readonly audit?: AuditHook;
}

/** What a reorder reports. */
export interface ReorderResult {
  readonly reordered: number;
}
