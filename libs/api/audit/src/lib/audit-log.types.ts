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
  // TASK_2026_177 P3: the COURSE AUTHORING writes (R2, R8, plan §2.6, §3.4).
  //
  // ⚠️ THESE ARE THE ONLY RECORD OF WHO DELETED A COURSE, MODULE OR LESSON.
  // `Course`, `CourseModule` and `Lesson` carry `deletedAt` and NO `deletedBy`
  // column (plan §1.4 — `LessonComment` is the one course model that has one).
  // So unlike the `community.*` deletes above, where the row itself names the
  // actor, `learning.course.delete` and its two siblings are the whole answer to
  // "who removed this". That is why every one of them is written INSIDE the
  // mutation's own `$transaction` (PRE-6) via `WriteAuditLogParams.tx`: a row
  // written after the commit is a row that can be missing for exactly the
  // deletion somebody asks about, and here there is no column to fall back on.
  //
  // The granularity is per-INTENT, matching `community.*`: `publish` is separate
  // from `update` because "who made this course visible to members" is a
  // different question from "who corrected its description", and `reorder` is
  // separate because it has no single target row at all (its `targetId` is
  // `undefined`).
  | 'learning.course.create'
  | 'learning.course.update'
  | 'learning.course.delete'
  | 'learning.course.publish'
  | 'learning.course.restore'
  | 'learning.course.reorder'
  | 'learning.module.create'
  | 'learning.module.update'
  | 'learning.module.delete'
  | 'learning.module.reorder'
  | 'learning.lesson.create'
  | 'learning.lesson.update'
  | 'learning.lesson.delete'
  | 'learning.lesson.reorder'
  // R2.2.5 — a MANUAL admin action, deliberately (RK-6, plan §4.5): there is no
  // refresh cron, because an automatic job would reintroduce the YouTube quota
  // surface the authoring-time fetch decision removed. Audited separately from
  // `learning.lesson.update` so "who last re-pulled this video's metadata, and
  // when" is answerable without diffing update rows.
  | 'learning.lesson.refresh_metadata'
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
  // TASK_2026_177 P3 — the three authorable course entities (plan §1.4, §6.2).
  // PRISMA MODEL NAMES, like every other member of this union, so `targetType` +
  // `targetId` locates a row without knowing which surface wrote it.
  //
  // ⚠️ `CourseModule`, NOT `Module`. The Prisma model is `CourseModule` (its
  // table is `course_modules`); `Module` would be both ambiguous with a Nest
  // module and unresolvable against the schema.
  //
  // ⚠️ THERE IS NO `LessonComment` HERE, AND THAT IS DELIBERATE. Lesson comments
  // are moderated by their AUTHOR or an admin through the MEMBER surface
  // (`v1/members/lesson-comments`), which is not an admin audit path — and that
  // model is the one course model that carries its own `deletedBy` column, so
  // the row records its own actor. Adding a target type for it would imply an
  // admin moderation surface that plan §3.4 does not ship.
  | 'Course'
  | 'CourseModule'
  | 'Lesson'
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
