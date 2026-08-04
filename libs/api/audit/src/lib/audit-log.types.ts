import type { Prisma } from '@ptah-api/core';

/**
 * Audit log types for cross-cutting admin action tracking (TASK_2025_292).
 *
 * The `AdminAuditAction` union enumerates every destructive or compliance-relevant
 * admin action we record in the `admin_audit_log` table. Keeping this as a const
 * union (not a Prisma enum) mirrors the Q1/Q2 decision in
 * `implementation-plan.md` §1 — strings are cheap to extend without migrations.
 */
export type AdminAuditAction =
  | 'user.delete'
  | 'user.unsubscribe'
  | 'user.resubscribe'
  | 'user.bounced'
  | 'user.complained'
  | 'license.complimentary.issue'
  | 'marketing.campaign.send'
  | 'circle.member.invite'
  | 'circle.member.remove'
  | 'sessions.attendee.add'
  | 'sessions.attendee.remove'
  | 'waitlist.invite'
  | 'group.create'
  | 'group.update'
  | 'group.assign'
  | 'group.unassign'
  // TASK_2026_169: admin-only Builders pack registry (bookkeeping rows only —
  // a pack mutation grants and revokes no repository access, which lives on
  // GitHub). Written inside the same transaction as the mutation.
  | 'pack.create'
  | 'pack.update'
  | 'pack.delete'
  // TASK_2026_169: admin Google Calendar session writes.
  // NOTE: there is no `community.*` action YET — but the reason has changed.
  // It used to be that the admin community surface was READ-ONLY and the forum
  // kept its own moderation history externally. TASK_2026_177 P1b deleted that
  // external forum; the native community surface it replaces owns moderation
  // WRITES, so `community.*` actions land with the moderation controllers in
  // Phase 2 (plan §2.5, R8) and MUST be audited here — silence is no longer a
  // design statement, only a not-yet.
  | 'sessions.event.create'
  | 'sessions.event.update'
  | 'sessions.event.delete'
  // The only admin action in this module that sends email. Audited separately
  // from `sessions.event.update` precisely so "who emailed this guest list, and
  // when" is answerable without reconstructing it from patch rows.
  | 'sessions.event.invite';

/**
 * Target type enum — the kind of entity an audit row describes.
 * Kept as a union (not enum) for the same reasons as `AdminAuditAction`.
 */
export type AdminAuditTargetType =
  | 'User'
  | 'License'
  | 'MarketingCampaign'
  | 'Subscription'
  | 'Waitlist'
  | 'MemberGroup'
  // Phase 2 adds `Category` / `Topic` / `Post` here with the native forum's
  // moderation controllers (plan §6.2).
  | 'Pack'
  | 'CalendarEvent';

/**
 * Input shape for `AuditLogService.write`.
 *
 * Fields map 1:1 to the `admin_audit_log` Prisma model. Nullable fields are
 * stripped by the service before calling `prisma.adminAuditLog.create` so
 * Postgres gets `NULL` (via column default) rather than a literal `null`
 * that Prisma's generated `create` input refuses.
 *
 * `tx` lets callers enlist the audit write in their own transaction (e.g. the
 * cascade-delete flow in B2). When omitted, the service uses the singleton
 * `PrismaService` client.
 */
export interface WriteAuditLogParams {
  actorEmail: string | null;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId?: string;
  targetSnapshot?: unknown;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  /**
   * Optional interactive-transaction client supplied by callers that already
   * opened `prisma.$transaction(async tx => …)`. When provided, the audit
   * row commits/rolls back atomically with the caller's transaction.
   */
  tx?: Prisma.TransactionClient;
}
