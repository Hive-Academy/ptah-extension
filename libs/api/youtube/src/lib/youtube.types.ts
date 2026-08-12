/**
 * The wire-independent result vocabulary of this lib — plan §4.4.
 *
 * ⚠️ NOTHING HERE DESCRIBES HTTP. `422` vs `502` is an admin-API concern and
 * belongs to the consumer that owns a response (Batch 9, Task 9.12). This lib
 * reports WHAT HAPPENED; the caller decides what that is worth to a client.
 * Keeping the two apart is what lets `@ptah-api/community` reuse this provider
 * verbatim in Phase 4 (plan R3.2) with a different mapping.
 */

/**
 * The four columns persisted onto `Lesson` (and, in Phase 4, `LiveSession`)
 * after a successful authoring-time fetch — plan §1.4, R2.2.2, NFR-R2.
 *
 * Fetched ONCE, at authoring time. A member page view never calls YouTube
 * (NFR-P6); persistence *is* the cache (plan §4.5).
 */
export interface YouTubeVideoMetadata {
  /** The canonical 11-character id, matching `VIDEO_ID_PATTERN`. */
  videoId: string;
  /** `snippet.title` as YouTube reports it — persisted as `videoTitle`. */
  title: string;
  /**
   * `contentDetails.duration` in whole seconds.
   *
   * ⚠️ NON-NULLABLE HERE, unlike `Lesson.videoDurationSeconds`. A successful
   * fetch that could not produce a number is not a success: it is a
   * `malformed_response` (see {@link YouTubeFetchError}). The nullable column
   * exists for the FEATURE-OFF path (R2.2.6), where an admin typed the
   * metadata by hand and may have left the runtime blank — not for a fetch that
   * half-worked.
   *
   * ⚠️ THIS IS A DURATION IN SECONDS. It is not a position and it is not a
   * percentage. `LessonProgress.furthestPositionSeconds` is also an integer
   * count of seconds and the two are interchangeable at any call site without a
   * type error (RISK-O). The completion rule reads
   * `furthestPositionSeconds >= 0.9 * videoDurationSeconds`, and swapping the
   * operands produces a plausible boolean rather than a compile error.
   */
  durationSeconds: number;
  /**
   * `high ?? medium ?? default`, or `null` when YouTube supplied none of the
   * three. `null` rather than a throw: a missing thumbnail is a poster the
   * frontend renders as a placeholder (plan §4.6.1), not a reason to refuse a
   * lesson.
   */
  thumbnailUrl: string | null;
}

/**
 * The five failure reasons this lib may report — plan §4.4, rows 1-5.
 *
 * ⚠️ THESE ARE THE COMPLETE SET AND THEY ARE SANITISED BY CONSTRUCTION
 * (NFR-S7). No upstream text, no upstream error object and no fragment of a
 * response body ever reaches this type. Upstream detail goes to `logger.warn`
 * and nowhere else.
 *
 * - `not_found`          — `items: []`
 * - `private`            — `status.privacyStatus === 'private'`
 *                          (`'unlisted'` is ACCEPTED — it is the Checkpoint-0
 *                          delivery model, plan §4.4's footnote)
 * - `not_embeddable`     — `status.embeddable === false`
 * - `malformed_response` — the Zod boundary parse failed, or the response
 *                          parsed but carried a duration this lib cannot
 *                          convert to seconds
 * - `unavailable`        — HTTP >= 400, a transport failure, or the 10 s
 *                          AbortController timeout. Carries `status` when
 *                          there was one.
 */
export type YouTubeFetchError =
  | 'not_found'
  | 'private'
  | 'not_embeddable'
  | 'malformed_response'
  | 'unavailable';

/**
 * Every outcome of `YouTubeMetadataProvider.fetchVideo()` — plan §4.4.
 *
 * 🔴 `skipped: true` IS A DISTINCT ARM, NOT `error: 'disabled'`. §4.4's last
 * row says in terms that the feature-off outcome **is not an error**: the admin
 * save proceeds and persists whatever metadata the admin typed, with
 * `videoMetadataSource: 'manual'` (R2.2.6). A caller that pattern-matches on
 * `error` must be structurally UNABLE to fold "the integration is switched off"
 * into "this video is broken" — because those two produce a `200` and a `422`
 * respectively, and the difference is whether an admin can do their job with no
 * API key configured. That is exit-gate clause 3.
 *
 * The `error?: undefined` / `skipped?: undefined` witnesses are load-bearing,
 * not noise. They make the two `ok: false` arms mutually exclusive to the
 * compiler, so `if ('skipped' in r)` and `if (r.error)` both narrow correctly,
 * and so no producer can build an object carrying both fields.
 */
export type YouTubeFetchResult =
  | { ok: true; video: YouTubeVideoMetadata }
  | { ok: false; skipped: true; error?: undefined; status?: undefined }
  | {
      ok: false;
      skipped?: undefined;
      error: YouTubeFetchError;
      /** The upstream HTTP status, when the failure had one. */
      status?: number;
    };
