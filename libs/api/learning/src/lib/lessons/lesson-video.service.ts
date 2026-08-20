import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import {
  YouTubeMetadataProvider,
  extractVideoId,
  type YouTubeFetchError,
} from '@ptah-api/youtube';

import type { AuditHook } from '../courses/courses.service';
import { toAdminLesson } from '../courses/courses.service';
import { NOT_DELETED } from '../common/soft-delete';

import { NO_VIDEO, type LessonVideoColumns } from './lesson-video.types';

/**
 * LessonVideoService — R2.2.1 – R2.2.6, plan §4.1, §4.4, §4.5, NFR-R1, NFR-R2,
 * NFR-S7, ASSUMPTION-6, ASSUMPTION-9.
 *
 * 🔴 THIS IS THE ONLY FILE IN `libs/api/learning` PERMITTED TO IMPORT
 * `@ptah-api/youtube` (NFR-P6, RISK-P). Not `CourseReadService`, not
 * `ProgressService`, not `LessonCommentsService`, not a DTO. Task 9.17 asserts
 * the importer set BY NAME, the way `markdown-chokepoint.spec.ts` pins its
 * three importers, and it proves the assertion by deliberate failure. Metadata
 * is fetched ONCE, here, at authoring time, and persisted onto `Lesson` —
 * persistence IS the cache (plan §4.5), so a member page view issues zero
 * third-party calls.
 *
 * 🔴 "FETCH BEFORE THE WRITE, INSIDE THE TRANSACTION BOUNDARY — EITHER A
 * FULLY-CONFIGURED LESSON OR NOTHING" (R2.2.4). READ THIS CAREFULLY, BECAUSE
 * "INSIDE THE TRANSACTION BOUNDARY" READS LIKE "INSIDE `$transaction`" AND IT
 * MUST NOT BE.
 *
 * The fetch is AWAITED BEFORE `$transaction` OPENS. Doing the network call
 * inside the transaction would hold a Postgres connection open for up to the
 * provider's 10-second abort budget PER SAVE — which is how a slow upstream
 * becomes pool exhaustion on an endpoint that is otherwise measured in tens of
 * writes per month. What the requirement asks for is ATOMICITY OF THE WRITE:
 * the transaction then writes the row and every metadata column TOGETHER, so a
 * fetch failure means no lesson at all rather than a half-configured one, and
 * a database failure means no lesson rather than a lesson with four of five
 * columns.
 *
 * ⚠️ THE §4.4 OUTCOME → HTTP MAPPING IS OWNED HERE, AND ONLY HERE. The provider
 * owns the `error` half and describes WHAT HAPPENED; this service decides what
 * that is worth to a client. `422` vs `502` is the load-bearing distinction:
 * `422` means *your id is wrong, fix it*; `502` means *we could not ask, try
 * again*. A single `400` for both would make an admin re-check a correct id
 * during a YouTube outage.
 *
 * ⚠️ AND A MALFORMED ID STRING IS NEITHER. It is a `400`, and it is NOT a §4.4
 * row: conflating it with `not_found` would tell an admin the video does not
 * exist when what they pasted was not a video reference at all.
 *
 * ⚠️ ASSUMPTION-6 — `YOUTUBE_API_KEY` IS EMPTY IN THIS WORKSPACE, SO THE
 * FEATURE-OFF BRANCH IS THE LIVE PATH. Everything else is asserted against an
 * INJECTED PROVIDER DOUBLE returning `{ ok: true, video }`; no real YouTube
 * request is possible here and none was made. The cheapest way to overrule
 * that: put a real Data API v3 key in `.env` and add one live `V-CURL` against
 * a known unlisted video id.
 *
 * ⚠️ NFR-S7 — THE TYPED `reason` VALUES BELOW ARE THE WHOLE CLIENT-VISIBLE
 * VOCABULARY. No raw upstream text, no `error.message` from Prisma or from
 * `fetch`, reaches a response. The provider already guarantees its half.
 */
@Injectable()
export class LessonVideoService {
  private readonly logger = new Logger(LessonVideoService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(YouTubeMetadataProvider)
    private readonly provider: YouTubeMetadataProvider,
  ) {}

  /**
   * Turn an admin's input into the five persisted columns — the FETCH half.
   *
   * 🔴 IT TOUCHES NO DATABASE, AND THAT IS ITS CONTRACT. `CoursesService.createLesson`
   * calls this BEFORE opening its own transaction and passes the result in, so
   * the network call and the write are never in the same transaction. Any
   * caller that awaited this inside a `$transaction` would be reintroducing the
   * pool-exhaustion shape the split exists to remove.
   *
   * Steps:
   *  1. No `youtubeVideoIdOrUrl` at all ⇒ {@link NO_VIDEO}. Detaching a video
   *     clears all five columns, not just the id — leaving the old title,
   *     thumbnail and DURATION behind would show a member metadata for a video
   *     the lesson no longer has, and would keep the 90% rule running against a
   *     runtime nobody can play.
   *  2. `extractVideoId` ⇒ `null` is a `400 { reason: 'youtube_video_id_invalid' }`.
   *  3. `provider.fetchVideo(id)`.
   *  4. Map per §4.4.
   *
   * ⚠️ THE ID IS EXTRACTED AND VALIDATED IN **EVERY** BRANCH, INCLUDING
   * FEATURE-OFF. A disabled integration must not become a hole through which an
   * unvalidated string reaches the column — the frontend builds a
   * `youtube-nocookie` embed URL from whatever is stored (plan §4.6.3), and
   * "the API key was unset that week" is not a defence.
   */
  async resolveVideoColumns(
    input: LessonVideoInput,
  ): Promise<LessonVideoColumns> {
    const raw = input.youtubeVideoIdOrUrl?.trim();
    if (raw === undefined || raw.length === 0) {
      return NO_VIDEO;
    }

    const videoId = extractVideoId(raw);
    if (videoId === null) {
      // ⚠️ NOT a §4.4 row and NOT a fetch failure — a malformed argument. The
      // message names no upstream anything and echoes nothing the caller sent.
      throw new BadRequestException({
        reason: VIDEO_ID_INVALID,
        message:
          'That is not a YouTube video id or a recognised YouTube URL. Paste ' +
          'the 11-character id or the watch/share link.',
      });
    }

    const result = await this.provider.fetchVideo(videoId);

    if (result.ok) {
      return {
        youtubeVideoId: result.video.videoId,
        videoTitle: result.video.title,
        videoDurationSeconds: result.video.durationSeconds,
        videoThumbnailUrl: result.video.thumbnailUrl,
        // ⚠️ SET ONLY ON AN `api` WRITE — it is the staleness signal §4.5
        // exists for.
        videoMetadataFetchedAt: new Date(),
        videoMetadataSource: 'api',
      };
    }

    if (result.skipped === true) {
      // R2.2.6 — the live path in this workspace (ASSUMPTION-6). The save
      // PROCEEDS, storing the extracted id plus whatever the admin typed.
      // `videoMetadataFetchedAt` stays `null`: stamping a hand-typed row as
      // freshly fetched would badge stale data as current in the admin table.
      return {
        youtubeVideoId: videoId,
        videoTitle: input.videoTitle ?? null,
        videoDurationSeconds: input.videoDurationSeconds ?? null,
        videoThumbnailUrl: null,
        videoMetadataFetchedAt: null,
        videoMetadataSource: 'manual',
      };
    }

    throw fetchErrorToHttp(result.error);
  }

  /**
   * Re-fetch and persist ONE lesson's metadata —
   * `POST /v1/admin/lessons/:id/refresh-metadata`, and the update path.
   *
   * ⚠️ SIGNATURE NOTE, RECORDED DELIBERATELY. `tasks.md` writes this as
   * `resolveAndPersist(lessonId, input, tx)`. A `tx` parameter would mean the
   * caller had ALREADY opened a transaction before this method's fetch ran —
   * which is exactly what the same task's "the fetch is awaited before
   * `$transaction` opens" forbids. The transaction is therefore owned HERE, and
   * the third parameter is the PRE-6 audit seam instead. The composition
   * `CoursesService.createLesson` needs is the other public method,
   * {@link resolveVideoColumns}, whose result it writes inside its own
   * transaction.
   */
  async resolveAndPersist(
    lessonId: string,
    input: LessonVideoInput,
    audit?: AuditHook,
  ): Promise<ReturnType<typeof toAdminLesson>> {
    // 🔴 BEFORE THE TRANSACTION. See the class docblock.
    const columns = await this.resolveVideoColumns(input);

    const row = await this.prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.findFirst({
        where: {
          id: lessonId,
          ...NOT_DELETED,
          module: { ...NOT_DELETED, course: { ...NOT_DELETED } },
        },
        select: { id: true },
      });
      if (!lesson) throw new NotFoundException('Lesson not found');

      const updated = await tx.lesson.update({
        where: { id: lessonId },
        data: { ...columns },
      });

      await audit?.(tx, lessonId);
      return updated;
    });

    this.logger.log(
      `Lesson video metadata written: id=${lessonId} source=${columns.videoMetadataSource ?? 'none'}`,
    );

    const commentCount = await this.prisma.lessonComment.count({
      where: { ...NOT_DELETED, lessonId },
    });
    return toAdminLesson(row, commentCount);
  }

  /**
   * Re-fetch metadata for a BATCH of lessons —
   * `POST /v1/admin/lessons/refresh-metadata` with `{ lessonIds }` (R2.2.5).
   *
   * 🔴 ASSUMPTION-9 — PER-LESSON ATOMIC AND BATCH-TOLERANT. Each lesson updates
   * FULLY OR NOT AT ALL, and ONE BAD ID DOES NOT ROLL BACK THE GOOD ONES.
   *
   * A single all-or-nothing transaction across N lessons would make ONE deleted
   * or newly-private video block every other refresh in the batch — which is
   * the exact opposite of what a maintenance action is for, and it would get
   * worse as the curriculum grew, because the probability that at least one of
   * N videos has changed state rises with N. So the atomic unit is the LESSON,
   * not the request, and the response reports what happened to each:
   * `{ refreshed, skipped, failed: [{ lessonId, reason }] }`.
   *
   * ⚠️ WITH THE INTEGRATION OFF IT IS `{ refreshed: 0, skipped: n, reason:
   * 'youtube_disabled' }` (§4.1's exact shape) AND IT WRITES NOTHING. Rewriting
   * every lesson to `videoMetadataSource: 'manual'` because the key is unset
   * would DESTROY previously-fetched metadata — every title, duration and
   * thumbnail replaced by whatever the admin has not typed. That is a data-loss
   * path with a `200` on it, and the short-circuit is what removes it.
   *
   * ⚠️ IT IS A MANUAL ACTION AND THERE IS NO CRON (RK-6, plan §4.5). An
   * automatic refresh job reintroduces the quota surface the authoring-time
   * decision removed.
   */
  async refreshMetadata(
    lessonIds: readonly string[],
    audit?: AuditHook,
  ): Promise<RefreshMetadataResult> {
    if (lessonIds.length === 0) {
      return { refreshed: 0, skipped: 0, failed: [] };
    }

    if (!this.provider.isEnabled()) {
      // §4.1's exact shape. Nothing is written — see the docblock.
      return {
        refreshed: 0,
        skipped: lessonIds.length,
        failed: [],
        reason: YOUTUBE_DISABLED,
      };
    }

    const lessons = await this.prisma.lesson.findMany({
      where: {
        id: { in: [...lessonIds] },
        ...NOT_DELETED,
        module: { ...NOT_DELETED, course: { ...NOT_DELETED } },
      },
      select: { id: true, youtubeVideoId: true },
    });
    const found = new Map(lessons.map((l) => [l.id, l.youtubeVideoId]));

    let refreshed = 0;
    let skipped = 0;
    const failed: RefreshFailure[] = [];

    for (const lessonId of lessonIds) {
      if (!found.has(lessonId)) {
        failed.push({ lessonId, reason: LESSON_NOT_FOUND });
        continue;
      }

      const videoId = found.get(lessonId) ?? null;
      if (videoId === null) {
        // A lesson with no video has nothing to refresh. Not a failure — an
        // admin selecting a whole module will include text-only lessons, and
        // reporting those as errors would bury the ones that matter.
        skipped++;
        continue;
      }

      try {
        // ⚠️ ONE TRANSACTION PER LESSON, ENTERED ONLY AFTER THAT LESSON'S FETCH
        // HAS RETURNED. Same rule as the single path, applied N times.
        await this.resolveAndPersist(
          lessonId,
          { youtubeVideoIdOrUrl: videoId },
          audit,
        );
        refreshed++;
      } catch (error: unknown) {
        // ⚠️ THE REASON IS THE TYPED ONE OR A FIXED FALLBACK — never
        // `error.message` (NFR-S7). An unexpected error here is still one bad
        // lesson, not a failed batch.
        failed.push({ lessonId, reason: reasonOf(error) });
      }
    }

    this.logger.log(
      `Refreshed metadata: refreshed=${refreshed} skipped=${skipped} failed=${failed.length}`,
    );
    return { refreshed, skipped, failed };
  }
}

/* -------------------------------------------------------------------------- */
/* The §4.4 mapping                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Plan §4.4, verbatim — the ONE construction site for every video-save refusal.
 *
 * | `YouTubeFetchResult`                       | HTTP                                       |
 * | ------------------------------------------ | ------------------------------------------ |
 * | `{ ok:false, error:'not_found' }`          | `422 { reason: 'youtube_video_not_found' }` |
 * | `{ ok:false, error:'private' }`            | `422 { reason: 'youtube_video_private' }`   |
 * | `{ ok:false, error:'not_embeddable' }`     | `422 { reason: 'youtube_video_not_embeddable' }` |
 * | `{ ok:false, error:'malformed_response' }` | `502 { reason: 'youtube_unavailable' }`     |
 * | `{ ok:false, error:'unavailable', status? }` | `502 { reason: 'youtube_unavailable' }`   |
 * | `{ ok:false, skipped:true }`               | NOT an error — handled by the caller        |
 * | `{ ok:true, video }`                       | `200`/`201` — handled by the caller         |
 *
 * ⚠️ `422` MEANS "YOUR ID IS WRONG, FIX IT"; `502` MEANS "WE COULD NOT ASK, TRY
 * AGAIN". That is the whole point of having two statuses: the first is a
 * request the admin must change, the second is a request they should repeat.
 * Collapsing them into one `400` would make an admin re-check a perfectly good
 * id during a YouTube outage, and would make a genuinely wrong id look
 * transient.
 *
 * ⚠️ `malformed_response` IS A `502`, NOT A `422`. "YouTube answered and its
 * answer made no sense" is our problem to report as an upstream failure, not
 * the admin's id to correct — and Batch 9A's provider deliberately routes an
 * unconvertible duration here rather than half-succeeding, so a `422` would
 * tell an admin to fix an id that is correct.
 *
 * ⚠️ THE UPSTREAM `status` IS NEVER FORWARDED. It reaches the log through the
 * provider and stops there; a `403 quotaExceeded` echoed to an admin panel is
 * an operational detail with no action attached to it.
 */
export function fetchErrorToHttp(error: YouTubeFetchError): Error {
  switch (error) {
    case 'not_found':
      return new UnprocessableEntityException({
        reason: VIDEO_NOT_FOUND,
        message: 'YouTube has no video with that id.',
      });
    case 'private':
      return new UnprocessableEntityException({
        reason: VIDEO_PRIVATE,
        message:
          'That video is private. Set it to unlisted or public and try again.',
      });
    case 'not_embeddable':
      return new UnprocessableEntityException({
        reason: VIDEO_NOT_EMBEDDABLE,
        message:
          'That video cannot be embedded. Allow embedding in YouTube Studio ' +
          'and try again.',
      });
    case 'malformed_response':
    case 'unavailable':
      return new BadGatewayException({
        reason: YOUTUBE_UNAVAILABLE,
        message: 'YouTube could not be reached. Please try again shortly.',
      });
  }
}

/**
 * The client-visible refusal vocabulary — NFR-S7's complete list for this
 * service.
 *
 * ⚠️ MACHINE VALUES, NOT SENTENCES. The admin UI matches on these; the `message`
 * beside them is for a human and may be reworded without breaking a screen.
 */
const VIDEO_ID_INVALID = 'youtube_video_id_invalid';
const VIDEO_NOT_FOUND = 'youtube_video_not_found';
const VIDEO_PRIVATE = 'youtube_video_private';
const VIDEO_NOT_EMBEDDABLE = 'youtube_video_not_embeddable';
const YOUTUBE_UNAVAILABLE = 'youtube_unavailable';
const YOUTUBE_DISABLED = 'youtube_disabled';
const LESSON_NOT_FOUND = 'lesson_not_found';
const UNKNOWN_FAILURE = 'refresh_failed';

/**
 * A thrown failure as a machine reason for the batch report.
 *
 * ⚠️ IT READS THE TYPED `reason` OFF THE EXCEPTION BODY AND FALLS BACK TO A
 * FIXED STRING — never `error.message`. An unexpected error inside one lesson's
 * refresh must not leak a Prisma sentence into a `200` response body.
 */
function reasonOf(error: unknown): string {
  const response = (error as { response?: unknown } | null)?.response;
  const reason = (response as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' ? reason : UNKNOWN_FAILURE;
}

/* -------------------------------------------------------------------------- */
/* Inputs and results                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What an admin supplies for a lesson's video — plan §3.4.
 *
 * ⚠️ `videoTitle` AND `videoDurationSeconds` ARE ONLY EVER USED ON THE
 * FEATURE-OFF PATH (R2.2.6). When the integration is on, YouTube is the
 * authority and typed values are ignored — otherwise an admin could type a
 * duration onto an `'api'` row and quietly change every member's 90%
 * completion threshold for that lesson.
 */
export interface LessonVideoInput {
  /** An 11-character id OR any recognised YouTube URL (R2.2.1). */
  readonly youtubeVideoIdOrUrl?: string;
  /** Feature-off only. */
  readonly videoTitle?: string;
  /**
   * Feature-off only. A DURATION IN SECONDS (RISK-O — never a position).
   *
   * ⚠️ `progress/completion.ts` treats `null`, `0` and negatives alike as "no
   * usable duration", so a typo here makes the lesson manual-completion-only
   * rather than instantly complete for everyone.
   */
  readonly videoDurationSeconds?: number;
}

/** One lesson that could not be refreshed. */
export interface RefreshFailure {
  readonly lessonId: string;
  /** A machine reason from the vocabulary above. Never upstream text. */
  readonly reason: string;
}

/** ASSUMPTION-9's response shape. */
export interface RefreshMetadataResult {
  readonly refreshed: number;
  readonly skipped: number;
  readonly failed: RefreshFailure[];
  /** Present only on the feature-off short-circuit (§4.1's exact shape). */
  readonly reason?: string;
}
