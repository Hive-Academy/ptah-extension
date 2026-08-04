import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `PATCH /api/v1/admin/community/topics/:id` — R1.2.5, R1.2.6, R8.2, plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(ModerateTopicDto)` (PRE-1), behind `AdminGuard`.
 *
 * ⚠️ THIS IS THE ADMIN EDIT PATH, AND ITS EXISTENCE IS WHAT MAKES THE MEMBER
 * PATH SAFE. `common/edit-window.ts` has no `isAdmin` parameter because an admin
 * edit arrives HERE instead: a different route, a different guard, a different
 * DTO, and — the part an inline `if (isAdmin)` would silently skip — an
 * `AdminAuditLog` row written inside the mutation's own transaction (PRE-6).
 * The edit window is not consulted on this path at all, by construction.
 *
 * ⚠️ EVERY FIELD IS OPTIONAL AND `PATCH` SEMANTICS ARE STRICT: only supplied
 * keys are written. `pinned: false` and "do not change pinned" are different
 * requests and must stay distinguishable, which is why the service tests
 * `!== undefined` rather than truthiness.
 *
 * The four operations §3.3 lists — pin, lock, move, edit — share one DTO
 * because they share one route and one audit shape. The service records WHICH
 * keys were supplied so the audit row says "pinned" rather than "updated".
 */
export class ModerateTopicDto {
  /** R1.2.5 — sorts above unpinned topics in the feed. */
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  /**
   * R1.2.6, R1.3.4 — no NEW replies; existing content stays fully readable.
   *
   * A locked topic answers `403 { reason: 'topic_locked' }` on a reply attempt
   * (§3.3). It is not a soft delete and not a hide: locking preserves the thread
   * for reading, which is the whole difference between the two moderation
   * actions.
   */
  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  /**
   * R1.2.6 — move the topic to another category.
   *
   * ⚠️ MOVING A TOPIC CHANGES WHO CAN SEE IT, because visibility is evaluated on
   * the PARENT CATEGORY on every read (`buildTopicCategoryVisibilityWhere`).
   * Moving a `member` thread into a `staff` category hides it from every
   * participant instantly, and the reverse publishes a cohort discussion. It is
   * a deliberate, audited admin action and it is the reason this field is not on
   * `UpdateTopicDto`.
   *
   * The target category must exist; the service answers `400` if it does not,
   * rather than letting the FK raise a raw `P2003`.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  categoryId?: string;

  /** R8.2 — moderator title correction. Never changes the slug (R1.2.2). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  /** R8.2 — moderator body correction. Edits POST #1, not a topic column (AD-9). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyMarkdown?: string;
}
