/**
 * The five persisted video columns on `Lesson`, as one value — R2.2.2, §4.5.
 *
 * 🔴 THIS FILE EXISTS SO THAT `courses/` NEVER HAS TO REACH INTO THE YOUTUBE
 * PATH (NFR-P6, RISK-P).
 *
 * `CoursesService.createLesson` has to write these columns in the SAME
 * transaction that creates the row (R2.2.4 — "either a fully-configured lesson
 * or nothing"), so it needs their TYPE. If that type lived in
 * `lesson-video.service.ts`, `courses.service.ts` would import a module that
 * imports `@ptah-api/youtube`, and the one-importer rule Task 9.17 asserts by
 * name would be true only in the letter. This module imports NOTHING — not
 * Nest, not Prisma, not the provider — so the edge it creates carries no
 * transitive reach at all.
 *
 * ⚠️ THE VALUES ARE PRODUCED IN EXACTLY ONE PLACE: `LessonVideoService`. Nothing
 * else in this lib may construct one from a fetch, and nothing at all may
 * construct one from a member request — a member never supplies video metadata.
 */

/**
 * ⚠️ ALL FIVE COLUMNS ARE WRITTEN TOGETHER OR NOT AT ALL. That is R2.2.4 stated
 * as a type: there is no partial variant, so "the title updated but the
 * duration did not" is not a state this lib can express. A lesson carrying a
 * title and no duration IS reachable — it is the R2.2.6 feature-off path — but
 * it is reachable by writing all five, two of which are `null`, not by writing
 * three of them.
 */
export interface LessonVideoColumns {
  /** The 11-character id, extracted server-side from an id OR a URL (R2.2.1). */
  readonly youtubeVideoId: string | null;
  readonly videoTitle: string | null;
  /**
   * A DURATION IN SECONDS (RISK-O — never a position).
   *
   * ⚠️ `null` MAKES THE LESSON MANUAL-COMPLETION-ONLY FOR EVERY MEMBER, even
   * when {@link youtubeVideoId} is set (ASSUMPTION-8). `progress/completion.ts`
   * additionally treats `0` and negatives that way (Batch 9A, Finding 4).
   */
  readonly videoDurationSeconds: number | null;
  readonly videoThumbnailUrl: string | null;
  /**
   * ⚠️ SET ONLY ON AN `'api'` WRITE, AND LEFT `null` ON A `'manual'` ONE. It is
   * the staleness signal §4.5 exists for; stamping a hand-typed row as freshly
   * fetched would badge stale data as current in the admin table.
   */
  readonly videoMetadataFetchedAt: Date | null;
  /** `'api'` | `'manual'` | `null` (no video). */
  readonly videoMetadataSource: LessonVideoMetadataSource | null;
}

/**
 * Where a lesson's video metadata came from.
 *
 * The column is a Postgres `String`, not an enum (plan §1.4), so nothing at the
 * database layer catches a typo — which is why the two values are a union here
 * and are never written as bare literals at a call site.
 */
export type LessonVideoMetadataSource = 'api' | 'manual';

/**
 * The "this lesson has no video" value.
 *
 * ⚠️ FIVE EXPLICIT `null`s, NOT AN OMITTED OBJECT. Detaching a video must CLEAR
 * the four metadata columns as well as the id; leaving them behind would show a
 * member the old title and thumbnail of a video the lesson no longer has, and
 * would leave `videoDurationSeconds` in place — which would keep the 90% rule
 * running against a video nobody can play.
 */
export const NO_VIDEO: LessonVideoColumns = Object.freeze({
  youtubeVideoId: null,
  videoTitle: null,
  videoDurationSeconds: null,
  videoThumbnailUrl: null,
  videoMetadataFetchedAt: null,
  videoMetadataSource: null,
});
