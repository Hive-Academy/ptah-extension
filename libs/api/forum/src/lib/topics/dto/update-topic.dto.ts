import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `PATCH /api/v1/members/community/topics/:id` — R1.2.3, R1.2.4, plan §3.3.
 *
 * ⚠️ BOUND WITH `dtoPipe(UpdateTopicDto)` (PRE-1).
 *
 * ⚠️ THE MEMBER EDIT PATH. Author only, inside the ASSUMPTION-5 window;
 * everything else is `403` (§3.3: `403 (not author / window closed)`). Admin
 * edits are a DIFFERENT endpoint with a DIFFERENT DTO
 * (`ModerateTopicDto`, `PATCH /v1/admin/community/topics/:id`, behind
 * `AdminGuard`) — see `common/edit-window.ts` for why that exemption is
 * structural rather than an `isAdmin` branch here.
 *
 * ⚠️ NO `categoryId`. Moving a topic between categories is MODERATION (R1.2.6,
 * R8.2) and lives on `ModerateTopicDto`. Allowing it here would let a member
 * move their own thread into a `staff` or `cohort` category they can see, and —
 * worse — out of one, making it visible to an audience the original
 * participants did not choose.
 *
 * ⚠️ NO `slug`. R1.2.2: a title edit never changes the slug. Every shared link,
 * bookmark and stored `Notification.route` keeps working.
 *
 * Both fields are optional so a client can fix a typo in one without resending
 * the other; sending neither is a no-op the service reports as a `400` rather
 * than a `200` that changed nothing.
 */
export class UpdateTopicDto {
  /** 3–200 characters (§3.3). Sets `Topic.editedAt`; leaves `slug` untouched. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  /**
   * 1–50 000 characters (§3.3).
   *
   * ⚠️ THIS EDITS POST #1, NOT A TOPIC COLUMN (AD-9). The topic has no body.
   * `TopicsService` writes it to the post whose `postNumber` is 1 and sets that
   * POST's `editedAt` — so the "edited" marker appears where the change
   * actually happened rather than on the thread header.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyMarkdown?: string;
}
