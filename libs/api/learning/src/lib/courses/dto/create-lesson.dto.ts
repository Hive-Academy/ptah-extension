import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

import { IsOptionalNotNull } from '../../common/optional-field';

/**
 * `POST /api/v1/admin/lessons` — R2.1, R2.2, R8.1, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(CreateLessonDto)` (PRE-1).
 *
 * ⚠️ THE THREE VIDEO FIELDS ARE AN INPUT TO A RESOLVER, NOT COLUMNS.
 * `LessonVideoService.resolveVideoColumns` turns them into the five persisted
 * columns (`youtubeVideoId`, `videoTitle`, `videoDurationSeconds`,
 * `videoThumbnailUrl`, `videoMetadataSource`) and the controller hands the
 * RESULT to `CoursesService.createLesson`, which writes the lesson and those
 * columns in ONE transaction (R2.2.4 — "a fully-configured lesson or nothing").
 *
 * 🔴 AND THE RESOLUTION HAPPENS BEFORE THE TRANSACTION OPENS, DELIBERATELY. The
 * YouTube fetch has a 10-second abort budget; running it inside `$transaction`
 * would hold a Postgres connection for that long per save, which is how a slow
 * upstream becomes pool exhaustion. What R2.2.4 requires is atomicity of the
 * WRITE, and that is what the single `create` gives it.
 *
 * ⚠️ `videoTitle` AND `videoDurationSeconds` ARE IGNORED WHEN THE INTEGRATION IS
 * ON. They exist for R2.2.6's feature-off path, where an admin types what
 * YouTube would otherwise supply. With `YOUTUBE_API_KEY` set, YouTube is the
 * authority — otherwise an admin could type a duration onto an `'api'` row and
 * quietly change every member's 90% completion threshold for that lesson.
 */
export class CreateLessonDto {
  /**
   * The owning module.
   *
   * ⚠️ A MODULE INSIDE A SOFT-DELETED COURSE IS A `404`, checked in the same
   * `where` as the module itself (`CoursesService.requireLiveModule`).
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  moduleId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  /**
   * RAW MARKDOWN, NEVER HTML. It is stored as written and rendered by
   * `libs/frontend/markdown`'s member preset — the one sanitizer (PRE-4, AD-1).
   * The server does not sanitize on the way in and must not: escaping at write
   * time corrupts legitimate markdown and moves the security boundary away from
   * the single chokepoint that owns it.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyMarkdown!: string;

  /**
   * An 11-character YouTube id OR any recognised YouTube URL (R2.2.1). The
   * service extracts and VALIDATES the id — including when the integration is
   * off, so a disabled feature never becomes a hole through which an
   * unvalidated string reaches the column the frontend builds an embed URL from
   * (plan §4.6.3).
   *
   * An unrecognised value is `400 { reason: 'youtube_video_id_invalid' }` before
   * any fetch. Omitted (or empty) means a lesson with no video, which is legal
   * and manual-completion-only.
   */
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(2_048)
  youtubeVideoIdOrUrl?: string;

  /** R2.2.6 feature-off only — ignored when `YOUTUBE_API_KEY` is set. */
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(500)
  videoTitle?: string;

  /**
   * R2.2.6 feature-off only. A **DURATION IN SECONDS** — never a position
   * (RISK-O). It is the only number R2.3.2's 90% rule is computed against, so a
   * typo here changes when every member's lesson completes.
   *
   * `0` is accepted by the column and treated as "no usable duration" by
   * `progress/completion.ts` (Batch 9A's Finding 4: `PT0S` is a real YouTube
   * value and a zero threshold would mark every lesson complete on the first
   * frame). The floor here is `0` rather than `1` so the DTO does not disagree
   * with the column about what is storable.
   */
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  videoDurationSeconds?: number;

  /** Ascending within the module (R2.1.4). Omitted means "append" (R8.8). */
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
