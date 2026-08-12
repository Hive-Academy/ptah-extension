import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `POST /api/v1/admin/lessons/refresh-metadata` — R2.2.5, ASSUMPTION-9,
 * plan §3.4, §4.5.
 *
 * ⚠️ BOUND WITH `dtoPipe(RefreshMetadataDto)` (PRE-1).
 *
 * ⚠️ THE BULK FORM ONLY. The single-lesson form is
 * `POST /v1/admin/lessons/:id/refresh-metadata`, which takes its id from the
 * path and carries NO body — so it has no DTO and contributes nothing to
 * `MIN_TOTAL_PAYLOAD_PARAMS`. The two are declared bulk-first in the controller:
 * they have different segment counts and cannot unify, so RI-3 has nothing to
 * arbitrate, but the ordering is free and the habit is the one that matters.
 *
 * ⚠️ IT IS A MANUAL ACTION AND THERE IS NO CRON (RK-6). An automatic refresh job
 * would reintroduce the YouTube quota surface the authoring-time fetch decision
 * removed, which is exactly the scope boundary Batch 9 is drawn at.
 *
 * ⚠️ PER-LESSON ATOMIC, BATCH-TOLERANT (ASSUMPTION-9). One dead video id does
 * not roll back the lessons that refreshed successfully; the response is
 * `{ refreshed, skipped, failed: [{ lessonId, reason }] }`. A single
 * all-or-nothing transaction across N lessons would let one deleted video block
 * every other refresh, which is the opposite of what a maintenance action is
 * for.
 *
 * ⚠️ AND WITH `YOUTUBE_API_KEY` UNSET IT WRITES NOTHING AT ALL, returning
 * `{ refreshed: 0, skipped: n, failed: [], reason: 'youtube_disabled' }` (§4.1).
 * That short-circuit is not cosmetic: without it the natural implementation
 * would run every lesson through the feature-off branch and rewrite each one to
 * `videoMetadataSource: 'manual'` with a null title and duration — a data-loss
 * path with a `200` on it, and in this workspace (ASSUMPTION-6) the only path
 * this endpoint would ever take.
 */
export class RefreshMetadataDto {
  /**
   * The lessons to re-fetch. A lesson with no `youtubeVideoId` is SKIPPED, not
   * failed — an admin selecting a whole module includes text-only lessons, and
   * reporting those as errors buries the ones that matter.
   *
   * Capped at 100: each id costs one YouTube round trip with a 10-second abort
   * budget, and an unbounded list is a request that cannot finish.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  lessonIds!: string[];
}
