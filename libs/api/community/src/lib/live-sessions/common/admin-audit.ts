import { InternalServerErrorException, type Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '@ptah-api/core';
import type {
  AdminAuditAction,
  AdminAuditTargetType,
  AuditLogService,
} from '@ptah-api/audit';

/**
 * THE ADMIN-SIDE AUDIT SEAM FOR THE PHASE-4 SURFACES — PRE-6, R8, plan §3.4.
 *
 * ⚠️ SIBLING FILES — THE THREE MUST CHANGE TOGETHER:
 *   - `libs/api/forum/src/lib/common/admin-audit.ts`
 *   - `libs/api/learning/src/lib/common/admin-audit.ts`
 *
 * A deliberate THIRD re-declaration (ASSUMPTION-11): both existing copies live
 * in a `common/` that is not barrel-exported, and widening a public barrel to
 * share three functions is a worse trade than the duplication.
 *
 * ⚠️ WHAT THIS FILE IS FOR. Every admin mutation in `LiveSessionsService` and
 * `SessionRequestsService` takes an optional last parameter — an `AuditHook`,
 * called with the mutation's own `tx` from INSIDE its `$transaction`. This is
 * the writer the four admin controllers pass in, so the row commits or rolls
 * back WITH the mutation.
 *
 * 🔴 AND IT MATTERS PARTICULARLY ON THE SESSION-REQUEST SIDE. `SessionRequest`
 * has NO `deletedBy`, no `acceptedBy` and no actor column of any kind: R4.10
 * froze its existing columns and migration 4 added only `calendar_event_id`,
 * `meet_link`, `duration_minutes` and `decline_reason`. So for
 * `community.session_request.{accept,reschedule,decline}` the audit row written
 * here is the ONLY record of WHICH admin scheduled, moved or refused a member's
 * private session — including the one where the member disputes the decline
 * reason. A row written after the transaction commits is a row that can be
 * missing for exactly the action somebody asks about.
 *
 * `LiveSession` is the easier half: it carries `createdBy` and `deletedBy`
 * (ASSUMPTION-14), so its tombstone names its own actor and the audit row is
 * corroboration rather than the sole record.
 */

/** Who is acting, as `AuditLogService.write` wants it. */
export interface AdminActor {
  readonly email: string | null;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/**
 * Read the acting admin off the request — the `AdminPacksController.actor`
 * shape, so audit rows from packs, the forum, the curriculum and the live
 * sessions are directly comparable.
 *
 * `email` may legitimately be `null` (the column is nullable, and a
 * system-initiated write has no admin). `AdminGuard` guarantees a real one on
 * every route in this directory; the null is the type being honest, not a case
 * that fires.
 */
export function adminActor(req: Request): AdminActor {
  return {
    email: req.user?.email ?? null,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

/**
 * The acting admin's USER ID, for the `createdBy` / `deletedBy` arguments the
 * live-session writes take.
 *
 * 🔴 REFUSES RATHER THAN WRITING A PLACEHOLDER. Substituting an `'unknown'` here
 * would silently manufacture the one fact the column exists to carry.
 * `LiveSessionsService.remove` DEMANDS a real actor id, so "who deleted this"
 * can never be answered with a placeholder — the request simply does not happen.
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
        `not applied to ${controller}. Refusing to record a session ` +
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
 * The returned function matches this directory's exported `AuditHook`
 * (`(tx, targetId) => Promise<void>`), which every mutation in
 * `LiveSessionsService` and `SessionRequestsService` accepts as its optional
 * last parameter.
 *
 * ⚠️ `metadata` CARRIES ONLY VALUES THE ADMIN SUPPLIED OR THE MUTATION
 * COMPUTED. No Google error text, no Prisma error text, no row dump (NFR-S7).
 *
 * ⚠️ `targetId: undefined`, NOT `null`, WHEN THERE IS NO TARGET.
 * `AuditLogService.write` strips undefined keys so Postgres applies the column
 * default; a literal `null` is refused by Prisma's generated `create` input.
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

/**
 * A caller-supplied audit write, enlisted in the mutation's OWN transaction.
 *
 * ⚠️ WHY A HOOK RATHER THAN AN INJECTED `AuditLogService` IN EACH SERVICE. The
 * services in this directory are constructed in unit tests with a Prisma double
 * and nothing else; a hook keeps the atomicity guarantee PRE-6 asks for while
 * leaving the audit vocabulary at the controller, where the action name and the
 * request context both live. It is the shape `CoursesService` already uses, and
 * the alternative — a controller opening its own transaction around the
 * service's — is exactly the non-atomic form PRE-6 forbids.
 *
 * `targetId` is `null` for a mutation with no single target row.
 */
export type AuditHook = (
  tx: Prisma.TransactionClient,
  targetId: string | null,
) => Promise<void>;
