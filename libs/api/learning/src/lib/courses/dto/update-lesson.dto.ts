import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

import { IsOptionalNotNull } from '../../common/optional-field';

/**
 * `PATCH /api/v1/admin/lessons/:id` — R2.1, R2.2, R8.1, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(UpdateLessonDto)` (PRE-1).
 *
 * ⚠️ NO `moduleId`. Moving a lesson between modules changes which sequential
 * gate it sits behind (R2.4.2) and which module's `@@unique([moduleId, slug])`
 * its slug must be free in — a move that silently collides would have to
 * re-slug a live URL. Delete and recreate is the honest route.
 *
 * 🔴 `youtubeVideoIdOrUrl: ''` DETACHES THE VIDEO, AND THAT IS WHY THIS FILE
 * NEEDS NO `EXPECTED_NULLABLE_OPTIONALS` ENTRY. Batch 9B flagged
 * `UpdateLessonDto.youtubeVideoId` as a likely census entry (`null` = "detach
 * the video"), but `LessonVideoService.resolveVideoColumns` already treats an
 * EMPTY OR WHITESPACE string exactly as it treats an absent one — it returns
 * `NO_VIDEO`, clearing all five columns in the same single `update`. So the
 * tri-state the endpoint needs is already expressible without `null`:
 *
 *   key omitted      → leave the five video columns exactly as they are
 *   `""`             → detach: all five columns become `null`
 *   an id or a URL   → re-resolve and rewrite all five
 *
 * A `null` would be a fourth spelling of the second case, and every additional
 * spelling of one meaning is a place two of them can be handled differently.
 * The census stays at three entries, all in the two files that genuinely need
 * one.
 */
export class UpdateLessonDto {
  @IsOptionalNotNull()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  /** RAW MARKDOWN, never HTML — see {@link CreateLessonDto.bodyMarkdown}. */
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyMarkdown?: string;

  /**
   * An id, a URL, or `''` to detach — see the class docblock.
   *
   * ⚠️ `@MinLength` IS DELIBERATELY ABSENT. It is the one field here where the
   * empty string is meaningful, and a `@MinLength(1)` would make "remove the
   * video" un-expressible while looking like ordinary input hygiene.
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

  /** A DURATION IN SECONDS, never a position (RISK-O). Feature-off only. */
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  videoDurationSeconds?: number;

  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
