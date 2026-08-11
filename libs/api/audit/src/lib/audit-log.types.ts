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
  // ⚠️ HISTORICAL — NO WRITER REMAINS AFTER TASK_2026_201. The paid
  // founding-invite wave (`POST v1/admin/waitlist/invite`,
  // `AdminWaitlistController.inviteWaitlist`, `WaitlistService.inviteBatch`)
  // was DELETED outright rather than repointed (context.md C2). The value stays
  // in the union because `admin_audit_log` ROWS carrying it exist and a read of
  // the table must still type-check against this union. Do not add a writer.
  | 'waitlist.invite'
  // TASK_2026_201 R7 — approve a waitlist row to the founding cohort: a free
  // `builders` licence + a `founding` cohort assignment + the `approvedAt`
  // stamp, all in one transaction.
  //
  // ⚠️ WHY THIS IS NOT `license.complimentary.issue`. That action answers "who
  // gifted a licence" and nothing more: it targets a `License`, so it cannot
  // name the WAITLIST ROW the grant came from, and its metadata has no place to
  // record the COHORT the person was placed in. Neither fact is recoverable by
  // joining — the licence carries no waitlist id and the cohort assignment
  // carries no actor. So "who let this person into the founding cohort for
  // free, and when" is a question only this row can answer, which is exactly
  // R7's argument. A grant that reuses the licence core legitimately writes
  // BOTH rows; they answer two different questions and neither is redundant.
  //
  // ⚠️ WRITTEN INSIDE THE ROW'S OWN `$transaction` VIA `WriteAuditLogParams.tx`
  // (PRE-6), with NO `try/catch` around it. That is a deliberate divergence
  // from the deleted `waitlist.invite` writer, which swallowed audit failures
  // *because the invite mail had already gone out*. Here nothing has gone out
  // when the audit runs — the welcome mail is post-commit — so an audit failure
  // must roll the whole grant back rather than leave an unrecorded one (R2.2).
  //
  // ⚠️ SKIPPED ROWS WRITE NOTHING (R7.3). `already_approved`, `already_paid`
  // and `not_found` are non-events; a log of non-events buries the events.
  //
  // ⚠️ THE LICENCE KEY NEVER APPEARS IN THIS METADATA (R7.4). `licenseId` does;
  // the key travels only in the member's email.
  | 'waitlist.approve'
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
  // TASK_2026_202 C4 — `POST v1/admin/course-modules/schedule` sets `releaseAt`
  // on every live module of one course from a single cohort start date.
  //
  // ONE ROW PER SCHEDULE, NOT ONE PER MODULE, for `reorder`'s reason exactly:
  // "the admin scheduled this course" is ONE intent, and ten rows would make
  // the log useless for the one question it exists to answer. `targetId` is
  // `undefined` for the same reason as `reorder` — there is no single target
  // row.
  //
  // 🔴 THE METADATA CARRIES `{ slug, from, to }` PER CHANGED MODULE, AND THAT
  // IS LOAD-BEARING RATHER THAN VERBOSE. The action OVERWRITES any manual date
  // an admin set through `PATCH .../:id`, and `CourseModule` has no column
  // recording a previous `releaseAt` — so this row is the ONLY record of what
  // the old dates were, and therefore the only thing that makes a wrong
  // re-schedule recoverable. The list is bounded by the course's live module
  // count.
  //
  // ⚠️ AND NO ROW IS WRITTEN BY `…/schedule/preview`. The preview exists to be
  // run repeatedly until the dates look right; a log full of rehearsals is a
  // log nobody reads.
  | 'learning.module.schedule'
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
  | 'sessions.event.invite'
  // TASK_2026_177 P4 — Ptah-scheduled live sessions (plan §1.5, R3, R8).
  //
  // ⚠️ NAMESPACED `community.*`, NOT `sessions.*`. The `sessions.event.*` block
  // above describes writes to the founder's GOOGLE CALENDAR made through
  // `AdminSessionsService`; these describe writes to the `live_sessions` TABLE.
  // They are two different systems of record that happen to both be called
  // "sessions", and a shared prefix would make "what did an admin change about
  // sessions" unanswerable without inspecting `targetType` on every row.
  | 'community.live_session.create'
  | 'community.live_session.update'
  | 'community.live_session.delete'
  | 'community.live_session.restore'
  // R3.2 — a MANUAL admin action for the same reason
  // `learning.lesson.refresh_metadata` is one (RK-6): no refresh cron, because
  // an automatic job reintroduces the YouTube quota surface the authoring-time
  // fetch decision removed.
  | 'community.live_session.refresh_metadata'
  // TASK_2026_177 P4 — the private-session request lifecycle (R4, plan §3.5).
  //
  // ⚠️ THREE ACTIONS, AND NO `create`. A request is CREATED BY THE MEMBER
  // through `v1/members/session-requests`, which is not an admin action and has
  // no admin actor to record — `AdminAuditLog.actorEmail` would be null for
  // every row and the ledger would be mostly member traffic. Only the three
  // ADMIN decisions are audited, and each one either creates, patches or
  // deletes a real Google Calendar event, which is exactly the class of action
  // this log exists for.
  | 'community.session_request.accept'
  | 'community.session_request.reschedule'
  | 'community.session_request.decline';

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
  // (`v1/members/lesson-comments`), which is not an admin audit path. Adding a
  // target type for it would imply an admin moderation surface that plan §3.4
  // does not ship.
  //
  // (This comment used to add "and it is the one course model carrying its own
  // `deletedBy`". That stopped being true with migration 4, which gave the
  // column to `Course`, `CourseModule` and `Lesson` as well — Batch 9B's F-1.
  // The reason above never depended on it.)
  | 'Course'
  | 'CourseModule'
  | 'Lesson'
  | 'Pack'
  | 'CalendarEvent'
  // TASK_2026_177 P4 (plan §1.5, §3.5). PRISMA MODEL NAMES, like every other
  // member of this union.
  //
  // ⚠️ `LiveSession` IS NOT `CalendarEvent`. `CalendarEvent` above targets a
  // row in the founder's Google Calendar, addressed by a Google event id;
  // `LiveSession` targets a row in OUR `live_sessions` table, addressed by its
  // cuid. A `LiveSession` may CLAIM a calendar event (AD-3), which is precisely
  // why the two need distinguishing — an audit row whose `targetId` could be
  // either kind of id is not a lookup key.
  | 'LiveSession'
  | 'SessionRequest';

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
