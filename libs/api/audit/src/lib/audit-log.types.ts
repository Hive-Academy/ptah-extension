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
  // TASK_2026_177 P2: the NATIVE community forum's moderation writes (R8, plan
  // §2.5, §3.3). These are the actions the note that used to sit here predicted.
  //
  // ⚠️ WHY THEY EXIST AT ALL, since the note they replace is worth keeping in
  // substance: before P1b the admin community surface was READ-ONLY and the
  // external forum kept its own moderation history, so `community.*` silence
  // was a design statement. P1b deleted that forum. The native surface that
  // replaces it owns moderation WRITES, and this server is now the only place
  // that history can live — so an unaudited moderation route would lose it
  // outright rather than defer it elsewhere.
  //
  // ⚠️ EVERY ONE OF THESE IS WRITTEN INSIDE THE MUTATION'S OWN `$transaction`
  // (PRE-6), via `WriteAuditLogParams.tx`. An audit row written after the
  // transaction commits is a row that can be missing for the one mutation
  // anybody will ever ask about.
  //
  // The granularity is per-INTENT, not per-column: `pin`, `lock` and `move` are
  // separate from the catch-all `update` because "who pinned this / who locked
  // this / who moved this out of my category" are the three questions actually
  // asked of a forum's moderation log, and answering them from a diff of an
  // `update` row's `metadata.changed` array is reconstruction rather than
  // record. A single `PATCH` that changes several of them writes one row per
  // intent it expressed.
  | 'community.category.create'
  | 'community.category.update'
  | 'community.category.delete'
  | 'community.category.reorder'
  | 'community.topic.pin'
  | 'community.topic.lock'
  | 'community.topic.move'
  | 'community.topic.update'
  | 'community.topic.delete'
  // R8.5 — the counterpart to `delete`. A restore is not "an update that set
  // `deletedAt` back to null": it is the action a 30-day recovery window exists
  // for, and it is the one an admin has to justify.
  | 'community.topic.restore'
  | 'community.post.delete'
  | 'community.post.restore'
  // TASK_2026_169: admin Google Calendar session writes.
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
  // TASK_2026_177 P2 — the native forum's three moderatable entities (plan
  // §6.2). They are PRISMA MODEL NAMES, matching every other member of this
  // union, so `targetType` + `targetId` is enough to look a row up without
  // knowing which surface wrote it.
  | 'Category'
  | 'Topic'
  | 'Post'
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
