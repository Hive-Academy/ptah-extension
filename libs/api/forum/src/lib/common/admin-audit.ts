import { InternalServerErrorException, type Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '@ptah-api/core';
import type {
  AdminAuditAction,
  AdminAuditTargetType,
  AuditLogService,
} from '@ptah-api/audit';

/**
 * The admin-side audit seam — PRE-6, R8, plan §3.3.
 *
 * ⚠️ WHAT THIS FILE IS FOR. Batch 6B left every admin mutation in this lib with
 * an OPTIONAL LAST PARAMETER — `AuditHook` / `ModerationAuditHook`, called with
 * the mutation's own `tx` from INSIDE its `$transaction`. It had to: the
 * `community.*` values an audit row needs did not exist in `AdminAuditAction`
 * until Task 6.13, and referencing one would not have compiled. This is the
 * other half — the real writer the three admin controllers pass in, so the row
 * commits or rolls back WITH the mutation.
 *
 * ⚠️ WHY THE ATOMICITY MATTERS CONCRETELY. An audit row written after the
 * transaction commits is a row that can be missing for the one mutation anybody
 * will ever ask about: the process dies between the two writes, the moderation
 * happened, and the history says it did not. The inverse is just as bad — a row
 * written first, for a mutation that then rolls back, accuses an admin of
 * something that never occurred. `packs.service.ts:98-141` is the pattern; this
 * is it, applied to a seam rather than to an injected service.
 *
 * ⚠️ IT IS SHARED BY THREE CONTROLLERS ON PURPOSE. Written per controller, the
 * three copies drift in exactly the way that is invisible: one forgets `tx`,
 * one forgets `ipAddress`, one starts forwarding a raw error. Since the whole
 * point is that every admin mutation is recorded identically, "identically" has
 * to have one implementation.
 */

/** Who is acting, as `AuditLogService.write` wants it. */
export interface AdminActor {
  readonly email: string | null;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/**
 * Read the acting admin off the request — the `AdminPacksController.actor`
 * shape, so audit rows from the forum and from packs are directly comparable.
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
 * The acting admin's USER ID, for `deletedBy`.
 *
 * ⚠️ REFUSES RATHER THAN WRITING A PLACEHOLDER. `deletedBy` is what makes R8.5's
 * restore window auditable ("who removed this, and when"); a soft delete that
 * stores `'unknown'` or `''` there is a deletion with no owner, and there is no
 * second record to recover it from — the audit row alone cannot repair the
 * column. `AdminGuard` runs after `JwtAuthGuard`, so `req.user.id` is present on
 * every route that reaches here and this branch is a wiring tripwire, exactly
 * like `requireMemberContext`.
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
        `not applied to ${controller}. Refusing to record a moderation action ` +
        `with no actor.`,
    );
    throw new InternalServerErrorException(
      'This moderation action could not be completed. Please try again.',
    );
  }
  return id;
}

/**
 * Build the audit writer the mutation calls INSIDE its own transaction.
 *
 * The returned function matches `CategoriesService`'s `AuditHook`
 * (`(tx, targetId) => Promise<void>`); {@link moderationAuditHook} below adapts
 * the same idea to `ModerationAuditHook`, which additionally carries what
 * changed.
 *
 * ⚠️ `metadata` CARRIES ONLY VALUES THE ADMIN SUPPLIED OR THE MUTATION
 * COMPUTED. No Prisma error text, no row dump — `targetSnapshot` exists for a
 * snapshot and is used deliberately where one is wanted, rather than by
 * default.
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
      // `undefined`, not `null`: `AuditLogService.write` strips undefined keys
      // so Postgres applies the column default. `reorder` has no single target.
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

/**
 * The moderation variant — one audit row PER INTENT the request expressed.
 *
 * ⚠️ ONE `PATCH` CAN LEGITIMATELY WRITE THREE ROWS, AND THAT IS THE DESIGN
 * (see `AdminAuditAction`'s docblock). "Who pinned this / who locked this / who
 * moved it out of my category" are the three questions actually asked of a
 * moderation log; collapsing a multi-field patch into one `community.topic.update`
 * row makes every one of them answerable only by diffing a `metadata` array,
 * which is reconstruction rather than record. All the rows go in the SAME
 * transaction as the mutation, so they are all present or none of them is.
 *
 * `title` and `bodyMarkdown` share one `community.topic.update` row: they are
 * the same intent (an admin corrected the content) and nobody asks them apart.
 */
export function moderationAuditHook(
  audit: AuditLogService,
  actor: AdminActor,
  targetType: AdminAuditTargetType,
  fallback: AdminAuditAction,
): (
  tx: Prisma.TransactionClient,
  targetId: string,
  changed: readonly string[],
) => Promise<void> {
  return async (tx, targetId, changed) => {
    const actions = moderationActions(changed, fallback);
    for (const action of actions) {
      await audit.write({
        actorEmail: actor.email,
        action,
        targetType,
        targetId,
        metadata: { changed: [...changed] },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        tx,
      });
    }
  };
}

/**
 * `ModerateTopicDto` keys → the actions they express.
 *
 * Deduplicated and ordered by the key order of {@link INTENT_BY_KEY}, so two
 * requests changing the same fields produce the same rows in the same order.
 * A `changed` list naming nothing recognised still writes ONE row — the
 * `fallback` — because "an admin did something here" is strictly better history
 * than silence, and the alternative is a new moderation field shipping unaudited.
 */
export function moderationActions(
  changed: readonly string[],
  fallback: AdminAuditAction,
): AdminAuditAction[] {
  const actions = new Set<AdminAuditAction>();
  for (const [key, action] of Object.entries(INTENT_BY_KEY)) {
    if (changed.includes(key)) actions.add(action as AdminAuditAction);
  }
  if (actions.size === 0) actions.add(fallback);
  return [...actions];
}

const INTENT_BY_KEY: Readonly<Record<string, AdminAuditAction>> = {
  pinned: 'community.topic.pin',
  locked: 'community.topic.lock',
  categoryId: 'community.topic.move',
  title: 'community.topic.update',
  bodyMarkdown: 'community.topic.update',
  deleted: 'community.topic.delete',
  restored: 'community.topic.restore',
  'post.deleted': 'community.post.delete',
  'post.restored': 'community.post.restore',
};
