import { InternalServerErrorException, type Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '@ptah-api/core';
import type {
  AdminAuditAction,
  AdminAuditTargetType,
  AuditLogService,
} from '@ptah-api/audit';

/**
 * THE ADMIN-SIDE AUDIT SEAM FOR `api-learning` — PRE-6, R8, plan §3.4.
 *
 * ⚠️ SIBLING FILE: `libs/api/forum/src/lib/common/admin-audit.ts`. This is a
 * deliberate RE-DECLARATION for the same reason as every other file in this
 * directory (AD-5's copy-rather-than-share decision, recorded by Batch 9A):
 * forum's `common/` is NOT barrel-exported and `forum.module.spec.ts` asserts
 * that surface, because a consumer that can reach `NOT_DELETED` can hand-build a
 * `where` and read that lib past every visibility clause. Widening a public
 * barrel to share three functions is a worse trade than the duplication. **The
 * two must change together.**
 *
 * ⚠️ WHAT THIS FILE IS FOR. Batch 9B left every admin mutation in this lib with
 * an OPTIONAL LAST PARAMETER — `AuditHook`, called with the mutation's own `tx`
 * from INSIDE its `$transaction`. It had to: the `learning.*` values an audit
 * row needs did not exist in `AdminAuditAction` until this dispatch, and
 * referencing one would not have compiled. This is the other half — the real
 * writer the three admin controllers pass in, so the row commits or rolls back
 * WITH the mutation.
 *
 * 🔴 AND IT MATTERS MORE HERE THAN IT DID IN THE FORUM. `Topic` and `Post` each
 * carry a `deletedBy` column, so a forum tombstone names its own actor and the
 * audit row is corroboration. `Course`, `CourseModule` and `Lesson` DO NOT —
 * plan §1.4 gives only `LessonComment` one among the five course models (Batch
 * 9B's F-1). For a course, a module or a lesson the audit row written here is
 * the ONLY record of who deleted it. An audit row written after the transaction
 * commits is a row that can be missing for precisely the deletion somebody asks
 * about, and there is no column to fall back on.
 *
 * `packs.service.ts:98-141` is the pattern; this is it, applied to a seam rather
 * than to an injected service.
 */

/** Who is acting, as `AuditLogService.write` wants it. */
export interface AdminActor {
  readonly email: string | null;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/**
 * Read the acting admin off the request — the `AdminPacksController.actor`
 * shape, so audit rows from packs, the forum and the curriculum are directly
 * comparable.
 *
 * `email` may legitimately be `null` (the column is nullable, and a
 * system-initiated write has no admin). `AdminGuard` guarantees a real one on
 * every route in this lib; the null is the type being honest, not a case that
 * fires.
 */
export function adminActor(req: Request): AdminActor {
  return {
    email: req.user?.email ?? null,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

/**
 * The acting admin's USER ID, for the `deletedBy` argument every soft delete in
 * this lib takes.
 *
 * 🔴 REFUSES RATHER THAN WRITING A PLACEHOLDER. Substituting an `'unknown'`
 * here would silently manufacture the one fact the audit row exists to carry.
 * `CoursesService.deleteCourse` DEMANDS a real actor id, so "who deleted this"
 * can never be answered with a placeholder — the request simply does not
 * happen.
 *
 * ✅ AND THE VALUE NOW REACHES A COLUMN, NOT ONLY A LOG AND AN AUDIT ROW.
 * Batch 9B's F-1 found that `Course`, `CourseModule` and `Lesson` carried no
 * `deletedBy`, so this id had nowhere to land on three of the four
 * soft-deletable models. **Migration 4 (`20260826090000_live_and_private_sessions`,
 * Batch 12) added the column to all three**, and `CoursesService`'s three
 * tombstone writes now include it.
 *
 * ⚠️ THAT CHANGES NOTHING ABOUT THIS FUNCTION OR ABOUT PRE-6. The audit row
 * still commits inside the mutation's own transaction, because the column and
 * the row answer different questions: the column says WHO, from the row alone;
 * the audit row says who, from where, with what user agent, and in a sequence
 * with every other admin action. An audit row written after the transaction
 * commits is a row that can be missing for precisely the deletion somebody asks
 * about — and that is still true now that there is a column to fall back on,
 * because the column is written in the same statement that would be rolled
 * back.
 *
 * `AdminGuard` runs after `JwtAuthGuard`, so `req.user.id` is present on every
 * route that reaches here and this branch is a wiring tripwire, exactly like
 * `requireMemberContext`.
 */
export function requireAdminUserId(
  req: Request,
  controller: string,
  logger: Logger,
): string {
  const id = req.user?.id;
  if (!id) {
    logger.error(
      `No authenticated user on ${req.method} ${req.path} — JwtAuthGuard is ` +
        `not applied to ${controller}. Refusing to record a curriculum ` +
        `mutation with no actor.`,
    );
    throw new InternalServerErrorException(
      'This action could not be completed. Please try again.',
    );
  }
  return id;
}

/**
 * Build the audit writer the mutation calls INSIDE its own transaction.
 *
 * The returned function matches `CoursesService`'s exported `AuditHook`
 * (`(tx, targetId) => Promise<void>`), which every mutation in `CoursesService`,
 * `ReorderService` and `LessonVideoService` accepts as its optional last
 * parameter.
 *
 * ⚠️ `metadata` CARRIES ONLY VALUES THE ADMIN SUPPLIED OR THE MUTATION
 * COMPUTED. No Prisma error text, no row dump (NFR-S7) — `targetSnapshot` exists
 * for a snapshot and is used deliberately where one is wanted, rather than by
 * default.
 *
 * ⚠️ `targetId: undefined`, NOT `null`, WHEN THERE IS NO TARGET.
 * `AuditLogService.write` strips undefined keys so Postgres applies the column
 * default; a literal `null` is refused by Prisma's generated `create` input. A
 * reorder is the case that has no single target row.
 */
export function auditHook(
  audit: AuditLogService,
  actor: AdminActor,
  action: AdminAuditAction,
  targetType: AdminAuditTargetType,
  metadata?: Record<string, unknown>,
): (tx: Prisma.TransactionClient, targetId: string | null) => Promise<void> {
  return async (tx, targetId) => {
    await audit.write({
      actorEmail: actor.email,
      action,
      targetType,
      targetId: targetId ?? undefined,
      metadata,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      // ⚠️ THE ENTIRE POINT (PRE-6). Without this the row is written on the
      // singleton client and commits independently of the mutation.
      tx,
    });
  };
}
