import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import {
  YouTubeMetadataProvider,
  extractVideoId,
  type YouTubeFetchError,
} from '@ptah-api/youtube';
import type { AdminLiveSession, Visibility } from '@ptah-contracts/community';

import type { AuditHook } from './common/admin-audit';
import {
  NOT_DELETED,
  assertRestored,
  restorableWhere,
} from './common/soft-delete';

/**
 * `LiveSessionsService` — the ADMIN authoring path for `LiveSession` (R3.1,
 * R3.2, R3.4, R8, R8.5, plan §2.9, §2.10, §4.5).
 *
 * Create / update / soft-delete / restore / refresh-metadata / list, plus the
 * cohort-key validation AD-10 makes necessary. Nothing here takes a
 * `MemberContext` and nothing here applies a visibility filter — the strongest
 * available statement that this file grants no member-side authority. The member
 * read model is `LiveFeedService`.
 *
 * 🔴 THIS IS THE ONLY FILE IN `live-sessions/` PERMITTED TO IMPORT
 * `@ptah-api/youtube` (NFR-P6, R3.2). Not `live-feed.service.ts`, not a DTO, not
 * a controller. Metadata is fetched ONCE, here, at authoring time, and persisted
 * onto the row — persistence IS the cache (plan §4.5), so a member opening the
 * Live feed issues zero third-party calls. `live-sessions.module.spec.ts`
 * asserts the importer set BY NAME.
 *
 * ⚠️ `@ptah-api/youtube` VERBATIM, NOT A SECOND PROVIDER. That lib's own
 * `index.ts` docblock names `libs/api/community` as its second consumer, and the
 * reason the outcome vocabulary carries no HTTP status is precisely so this
 * consumer can map it differently. What is NOT different is the fetch: one
 * provider, one abort budget, one `loggedDisabled` flag.
 *
 * 🔴 THE FETCH IS AWAITED BEFORE `$transaction` OPENS. Doing the network call
 * inside the transaction would hold a Postgres connection open for up to the
 * provider's 10-second abort budget per save — which is how a slow upstream
 * becomes pool exhaustion. What R2.2.4's "inside the transaction boundary"
 * actually asks for is ATOMICITY OF THE WRITE: the transaction then writes the
 * row and every metadata column TOGETHER, so a fetch failure means no session at
 * all rather than a half-configured one.
 *
 * ⚠️ ONE METADATA BLOCK, TWO VIDEO IDS — AND THE RULE IS STATED, NOT INFERRED.
 * `LiveSession` stores `youtubeVideoId` (the scheduled unlisted stream, R3.1)
 * and `replayYoutubeVideoId` (the recording, R3.4) SEPARATELY, so a re-uploaded
 * recording cannot overwrite the stream reference — but it carries only ONE
 * `video*` metadata block. {@link metadataVideoOf} resolves which id that block
 * describes: **the replay when one is attached, otherwise the stream.** Duration
 * and thumbnail only mean something for a finished recording, and
 * `LiveFeedItem.durationSeconds` is read on replay items; tracking the stream
 * for ever would leave a replayed session reporting the premiere's runtime.
 *
 * ⚠️ FEATURE-OFF TOLERANT (R2.2.6's posture, applied to R3). `YOUTUBE_API_KEY`
 * unset ⇒ `{ ok:false, skipped:true }` ⇒ the session is created with the id the
 * admin typed and null metadata, never a `500`. That is the LIVE path in this
 * workspace (ASSUMPTION-6/-10).
 *
 * ⚠️ `refresh-metadata` IS A MANUAL ADMIN ACTION AND THERE IS NO CRON (RK-6).
 * An automatic refresh job reintroduces the quota surface the authoring-time
 * decision removed.
 *
 * ⚠️ PRE-6 — EVERY MUTATION TAKES AN OPTIONAL {@link AuditHook} AND CALLS IT
 * WITH ITS OWN `tx`, FROM INSIDE ITS OWN `$transaction`.
 *
 * ⚠️ A PRISMA ERROR NEVER ESCAPES RAW (NFR-S7). See {@link mapPrismaError} —
 * and note that `P2002` here is NOT a slug collision but AD-2's
 * `calendar_event_id` unique, which earns its own typed `409`.
 */
@Injectable()
export class LiveSessionsService {
  private readonly logger = new Logger(LiveSessionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(YouTubeMetadataProvider)
    private readonly youtube: YouTubeMetadataProvider,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Admin reads                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Every LIVE session, for the authoring surface — `GET /v1/admin/live-sessions`.
   *
   * ⚠️ NO VISIBILITY FILTER, AND THAT IS THE POINT OF A SEPARATE METHOD FROM
   * `LiveFeedService`. An admin managing the schedule must see the `cohort`
   * sessions they are not in and the `staff` ones nobody else can reach.
   * Reusing one method with an `isAdmin` branch would put a write-surface
   * concern inside the member visibility path.
   *
   * ⚠️ IT EXCLUDES TOMBSTONES AND TAKES NO AD-5 EXEMPTION. Plan §2.10's admin
   * table has no `?includeDeleted` read; see {@link restore} for the
   * consequence.
   *
   * ⚠️ `filter.from` / `filter.to` BOUND `startsAt`, AND NOTHING ELSE. They do
   * not touch visibility and they do not touch `NOT_DELETED` — see
   * `ListAdminLiveQueryDto` for why there is deliberately no `?includeDeleted`
   * beside them.
   *
   * TWO QUERIES, NO N+1: the sessions, then the member groups named by the union
   * of every `cohortKeys` array.
   */
  async listForAdmin(
    filter: AdminLiveFilter = {},
  ): Promise<AdminLiveSession[]> {
    const sessions = await this.prisma.liveSession.findMany({
      where: {
        ...NOT_DELETED,
        ...(filter.from === undefined && filter.to === undefined
          ? {}
          : {
              startsAt: {
                ...(filter.from === undefined ? {} : { gte: filter.from }),
                // Exclusive, so `?from=2026-08-01&to=2026-09-01` and
                // `?from=2026-09-01&…` partition the year rather than
                // double-counting its boundaries.
                ...(filter.to === undefined ? {} : { lt: filter.to }),
              },
            }),
      },
      orderBy: [{ startsAt: 'desc' }],
    });

    if (sessions.length === 0) return [];

    const cohortNames = await this.resolveCohortNames(
      sessions.flatMap((session) => session.cohortKeys),
    );
    return sessions.map((session) => toAdminLiveSession(session, cohortNames));
  }

  /** ONE live session in its admin shape. `404` for a tombstone. */
  async getForAdmin(id: string): Promise<AdminLiveSession> {
    const session = await this.requireLive(this.prisma, id);
    return this.hydrate(session);
  }

  /* ---------------------------------------------------------------------- */
  /* Mutations                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Create a live session. Unknown `cohortKey` → `400`; a Calendar event another
   * session already claims → `409` (AD-2, RISK-Y).
   *
   * ⚠️ NO `published` FLAG (ASSUMPTION-13). Unlike a course, a `LiveSession` is
   * visible the moment it is created, to whom `visibility` says. If a draft
   * posture is wanted it is one column and one clause — say so before B13
   * renders the admin surface.
   */
  async create(
    input: CreateLiveSessionInput,
    audit?: AuditHook,
  ): Promise<AdminLiveSession> {
    const cohortKeys = input.cohortKeys ?? [];
    await this.assertCohortKeysExist(cohortKeys);

    // 🔴 BEFORE THE TRANSACTION. See the class docblock.
    const video = await this.resolveVideoColumns(input);

    const created = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.liveSession.create({
          data: {
            title: input.title,
            description: input.description ?? null,
            startsAt: input.startsAt,
            endsAt: input.endsAt ?? null,
            visibility: input.visibility,
            cohortKeys: [...cohortKeys],
            calendarEventId: input.calendarEventId ?? null,
            createdBy: input.createdBy,
            ...video,
          },
        });

        await audit?.(tx, row.id);
        return row;
      }),
    );

    this.logger.log(
      `Live session created: id=${created.id} visibility=${created.visibility} ` +
        `videoSource=${created.videoMetadataSource ?? 'none'}`,
    );
    return toAdminLiveSession(
      created,
      await this.resolveCohortNames(cohortKeys),
    );
  }

  /**
   * Patch a live session. Only supplied keys are written.
   *
   * ⚠️ THE VIDEO BLOCK MOVES AS A UNIT, NEVER FIELD BY FIELD. If either video id
   * is present on the input, all seven columns (two ids + five metadata) are
   * re-resolved together — so an admin cannot type a title onto an
   * `'api'`-sourced row and leave `videoMetadataFetchedAt` claiming it came from
   * YouTube. If neither is present the whole block is left exactly as it is.
   *
   * ⚠️ AND RE-RESOLVING NEEDS BOTH IDS, WHICH IS WHY THE CURRENT ROW IS READ
   * FIRST. Attaching a replay to a session whose stream id is already stored
   * must not clear the stream id; the resolver therefore works from
   * `{ ...stored, ...supplied }` rather than from the patch alone.
   */
  async update(
    id: string,
    input: UpdateLiveSessionInput,
    audit?: AuditHook,
  ): Promise<AdminLiveSession> {
    if (input.cohortKeys !== undefined) {
      await this.assertCohortKeysExist(input.cohortKeys);
    }

    const current = await this.requireLive(this.prisma, id);

    // 🔴 BEFORE THE TRANSACTION, and only when the request said something about
    // a video at all.
    const video = touchesVideo(input)
      ? await this.resolveVideoColumns({
          youtubeVideoIdOrUrl:
            input.youtubeVideoIdOrUrl ?? current.youtubeVideoId ?? undefined,
          replayYoutubeVideoIdOrUrl:
            input.replayYoutubeVideoIdOrUrl ??
            current.replayYoutubeVideoId ??
            undefined,
          videoTitle: input.videoTitle,
          videoDurationSeconds: input.videoDurationSeconds,
        })
      : undefined;

    const updated = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        const data: Prisma.LiveSessionUpdateInput = {};
        if (input.title !== undefined) data.title = input.title;
        if (input.description !== undefined) {
          data.description = input.description;
        }
        if (input.startsAt !== undefined) data.startsAt = input.startsAt;
        if (input.endsAt !== undefined) data.endsAt = input.endsAt;
        if (input.visibility !== undefined) data.visibility = input.visibility;
        if (input.cohortKeys !== undefined) {
          data.cohortKeys = [...input.cohortKeys];
        }
        if (input.calendarEventId !== undefined) {
          data.calendarEventId = input.calendarEventId;
        }
        // All seven, or none. Spreading the block is what makes "they move
        // together" a property of the shape rather than of this if-statement.
        if (video !== undefined) Object.assign(data, video);

        const row = await tx.liveSession.update({ where: { id }, data });
        await audit?.(tx, row.id);
        return row;
      }),
    );

    this.logger.log(`Live session updated: id=${id}`);
    return this.hydrate(updated);
  }

  /**
   * Soft-delete a live session — AD-5, R8.5.
   *
   * `deletedBy` is WRITTEN (ASSUMPTION-14) and the actor id is DEMANDED, never
   * substituted: `requireAdminUserId` refuses rather than writing a placeholder,
   * so the column can never claim an actor nobody authenticated as.
   */
  async remove(
    id: string,
    deletedBy: string,
    audit?: AuditHook,
  ): Promise<{ deleted: boolean }> {
    await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.requireLive(tx, id);
        await tx.liveSession.update({
          where: { id },
          data: { deletedAt: new Date(), deletedBy },
        });
        await audit?.(tx, id);
      }),
    );

    this.logger.log(`Live session soft-deleted: id=${id} by=${deletedBy}`);
    return { deleted: true };
  }

  /**
   * Restore a soft-deleted live session — R8.5.
   *
   * 🔴 THE WINDOW IS INSIDE THE `UPDATE`'s OWN `WHERE`, AND THAT IS WHY THIS
   * DIRECTORY TAKES NO AD-5 EXEMPTION. Written as read-the-tombstone /
   * check-the-window / update, the pre-flight read would be an unfiltered read
   * of a soft-deletable model — an exemption comment and a census entry, on a
   * WRITE path, which is exactly where such an exemption should be refused in
   * review. Here `updateMany().count` IS the outcome.
   *
   * ⚠️ `deletedBy` IS CLEARED ALONGSIDE `deletedAt`. Leaving it set would make a
   * restored, live row still name the admin who deleted it — which reads, in the
   * admin table, as though the session were deleted.
   *
   * ⚠️ AND A CAVEAT WORTH STATING: plan §2.10 gives live sessions a restore
   * route but NO read that surfaces tombstones, so an admin has no API path to
   * DISCOVER a restorable session — they must already hold its id. Flagged
   * rather than fixed, because the fix is an `?includeDeleted` admin list, which
   * is a route and a census entry and belongs to whoever adds it.
   */
  async restore(
    id: string,
    now: Date,
    audit?: AuditHook,
  ): Promise<{ restored: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.liveSession.updateMany({
        where: { id, ...restorableWhere(now) },
        data: { deletedAt: null, deletedBy: null },
      });

      assertRestored(count);
      await audit?.(tx, id);
    });

    this.logger.log(`Live session restored: id=${id}`);
    return { restored: true };
  }

  /**
   * Re-fetch and persist ONE session's video metadata —
   * `POST /v1/admin/live-sessions/:id/refresh-metadata` (R3.2).
   *
   * ⚠️ WITH THE INTEGRATION OFF IT WRITES NOTHING AND SAYS SO. Rewriting the row
   * to `videoMetadataSource: 'manual'` because the key is unset would DESTROY
   * previously-fetched metadata — the title, the duration and the thumbnail
   * replaced by whatever the admin has not typed. That is a data-loss path with
   * a `200` on it, and the short-circuit is what removes it. Same decision as
   * `LessonVideoService.refreshMetadata`.
   *
   * ⚠️ A SESSION WITH NO VIDEO AT ALL IS A `400`, NOT A SILENT NO-OP. "Refresh
   * the metadata of a session that has no video" is a request that cannot mean
   * anything, and answering `200` would tell an admin their click worked.
   */
  async refreshMetadata(
    id: string,
    audit?: AuditHook,
  ): Promise<RefreshLiveMetadataResult> {
    const current = await this.requireLive(this.prisma, id);

    if (!this.youtube.isEnabled()) {
      this.logger.log(
        `Live session metadata refresh skipped: id=${id} — YOUTUBE_API_KEY unset`,
      );
      return {
        refreshed: false,
        reason: YOUTUBE_DISABLED,
        session: await this.hydrate(current),
      };
    }

    const target = metadataVideoOf(current);
    if (target === null) {
      throw new BadRequestException({
        reason: NO_VIDEO_ATTACHED,
        message:
          'This session has no YouTube video attached, so there is no ' +
          'metadata to refresh. Attach a stream or a replay first.',
      });
    }

    // 🔴 BEFORE THE TRANSACTION. See the class docblock.
    const video = await this.resolveVideoColumns({
      youtubeVideoIdOrUrl: current.youtubeVideoId ?? undefined,
      replayYoutubeVideoIdOrUrl: current.replayYoutubeVideoId ?? undefined,
    });

    const updated = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.liveSession.update({
          where: { id },
          data: { ...video },
        });
        await audit?.(tx, id);
        return row;
      }),
    );

    this.logger.log(
      `Live session metadata refreshed: id=${id} video=${target} ` +
        `source=${updated.videoMetadataSource ?? 'none'}`,
    );
    return { refreshed: true, session: await this.hydrate(updated) };
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Turn an admin's video input into the seven persisted columns — the FETCH
   * half.
   *
   * 🔴 IT TOUCHES NO DATABASE, AND THAT IS ITS CONTRACT. Every caller awaits it
   * BEFORE opening a transaction.
   *
   * ⚠️ BOTH IDS ARE EXTRACTED AND VALIDATED IN EVERY BRANCH, INCLUDING
   * FEATURE-OFF. A disabled integration must not become a hole through which an
   * unvalidated string reaches a column the frontend turns into a
   * `youtube-nocookie` embed URL (plan §4.6.3), and "the API key was unset that
   * week" is not a defence.
   *
   * ⚠️ ONLY THE METADATA VIDEO IS FETCHED — one network call per save, never
   * two. See {@link metadataVideoOf}.
   */
  private async resolveVideoColumns(
    input: LiveVideoInput,
  ): Promise<LiveVideoColumns> {
    const streamId = normaliseVideoId(input.youtubeVideoIdOrUrl, 'stream');
    const replayId = normaliseVideoId(
      input.replayYoutubeVideoIdOrUrl,
      'replay',
    );

    const target = replayId ?? streamId;
    if (target === null) {
      return { ...NO_VIDEO };
    }

    const result = await this.youtube.fetchVideo(target);

    if (result.ok) {
      return {
        youtubeVideoId: streamId,
        replayYoutubeVideoId: replayId,
        videoTitle: result.video.title,
        videoDurationSeconds: result.video.durationSeconds,
        videoThumbnailUrl: result.video.thumbnailUrl,
        // ⚠️ SET ONLY ON AN `api` WRITE — it is the staleness signal §4.5 exists
        // for.
        videoMetadataFetchedAt: new Date(),
        videoMetadataSource: 'api',
      };
    }

    if (result.skipped === true) {
      // R2.2.6's posture, applied to R3 — the LIVE path in this workspace. The
      // save PROCEEDS, storing the extracted ids plus whatever the admin typed.
      // `videoMetadataFetchedAt` stays `null`: stamping a hand-typed row as
      // freshly fetched would badge stale data as current in the admin table.
      return {
        youtubeVideoId: streamId,
        replayYoutubeVideoId: replayId,
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
   * Every `cohortKey` must name a real `MemberGroup.key` — AD-10.
   *
   * ⚠️ AN UNKNOWN KEY IS A `400`, NOT A SILENTLY INVISIBLE SESSION. AD-10 stores
   * cohort keys as a `String[]` column rather than a join table, so there is NO
   * foreign key to catch a typo: a session with `cohortKeys: ['foundng']` saves
   * cleanly, matches `hasSome` for nobody, and is invisible to every member
   * INCLUDING the admin who created it — with no error anywhere.
   */
  private async assertCohortKeysExist(
    cohortKeys: readonly string[],
  ): Promise<void> {
    if (cohortKeys.length === 0) return;

    const groups = await this.prisma.memberGroup.findMany({
      where: { key: { in: [...cohortKeys] } },
      select: { key: true },
    });

    const found = new Set(groups.map((group) => group.key));
    const unknown = cohortKeys.filter((key) => !found.has(key));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown cohort key(s): ${unknown.join(', ')} — create the member group first`,
      );
    }
  }

  /**
   * `MemberGroup.name` per key.
   *
   * ⚠️ RESOLVED, NOT ECHOED. A key naming a group that has since been renamed or
   * deleted stays in the array and matches nobody; the admin table is the only
   * surface that can show that, and it can only show it if a missing name
   * renders as `"<key> (unknown group)"` rather than being dropped.
   */
  private async resolveCohortNames(
    keys: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return new Map();

    const groups = await this.prisma.memberGroup.findMany({
      where: { key: { in: unique } },
      select: { key: true, name: true },
    });
    return new Map(groups.map((group) => [group.key, group.name]));
  }

  private async hydrate(session: LiveSessionRow): Promise<AdminLiveSession> {
    return toAdminLiveSession(
      session,
      await this.resolveCohortNames(session.cohortKeys),
    );
  }

  /**
   * Resolve a live session, or `404`.
   *
   * ⚠️ `findFirst`, NOT `findUnique`. `LiveSession` is soft-deletable and
   * `findUnique`'s `where` accepts unique fields only, so
   * `{ id, ...NOT_DELETED }` would not compile — it is the one read shape that
   * can look filtered and not be. Without the filter, an admin could "update" a
   * session they had already deleted and get a `200` for a write nobody can see.
   */
  private async requireLive(
    client: Pick<PrismaService, 'liveSession'> | Prisma.TransactionClient,
    id: string,
  ): Promise<LiveSessionRow> {
    const session = await client.liveSession.findFirst({
      where: { id, ...NOT_DELETED },
    });
    if (!session) throw new NotFoundException('Live session not found');
    return session;
  }

  /**
   * Run a write and translate any Prisma failure into a typed Nest exception
   * (NFR-S7).
   *
   * ⚠️ AN `HttpException` THROWN FROM INSIDE THE TRANSACTION PASSES THROUGH
   * UNTOUCHED. It is already typed and sanitized, and re-wrapping a deliberate
   * `404` would turn it into a `500`.
   */
  private async withMappedPrismaErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      throw mapPrismaError(error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Video helpers                                                               */
/* -------------------------------------------------------------------------- */

/** The five metadata columns cleared together when no video is attached. */
export const NO_VIDEO = {
  youtubeVideoId: null,
  replayYoutubeVideoId: null,
  videoTitle: null,
  videoDurationSeconds: null,
  videoThumbnailUrl: null,
  videoMetadataFetchedAt: null,
  videoMetadataSource: null,
} as const satisfies LiveVideoColumns;

/**
 * WHICH OF THE TWO IDS THE SINGLE `video*` BLOCK DESCRIBES — the replay when one
 * is attached, otherwise the stream.
 *
 * 🔴 THIS IS A DECISION, NOT A DERIVATION, AND IT IS THE ONE PLACE IT IS MADE.
 * The schema stores two ids and ONE metadata block, so something has to say
 * which. Duration and thumbnail are properties of a finished recording — a
 * scheduled unlisted stream reports a placeholder runtime and a premiere
 * thumbnail — and `LiveFeedItem.durationSeconds` is what a replay card renders.
 * Tracking the stream for ever would leave every replayed session reporting the
 * premiere's numbers.
 *
 * ⚠️ THE CONSEQUENCE, STATED: attaching a replay REPLACES the stream's metadata.
 * That is intended. The stream id itself is untouched (R3.4's whole point), so
 * nothing is lost that a re-fetch could not restore, and the alternative — a
 * second metadata block on the row — is four more columns for a value nothing
 * renders.
 */
export function metadataVideoOf(session: {
  youtubeVideoId: string | null;
  replayYoutubeVideoId: string | null;
}): string | null {
  return session.replayYoutubeVideoId ?? session.youtubeVideoId;
}

/**
 * Extract and validate one id, or `null` when the field was omitted or blank.
 *
 * ⚠️ AN EMPTY STRING IS "DETACH", NOT "INVALID". `''` and an absent key both
 * yield `null`, which is what lets `PATCH { youtubeVideoIdOrUrl: '' }` clear a
 * video without the DTO needing a nullable field and a census entry — the same
 * tri-state `UpdateLessonDto` uses, for the same reason.
 */
function normaliseVideoId(
  raw: string | undefined,
  which: 'stream' | 'replay',
): string | null {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;

  const videoId = extractVideoId(trimmed);
  if (videoId === null) {
    // ⚠️ NOT a §4.4 row and NOT a fetch failure — a malformed argument. The
    // message names no upstream anything and echoes nothing the caller sent.
    throw new BadRequestException({
      reason: VIDEO_ID_INVALID,
      message:
        `That ${which} value is not a YouTube video id or a recognised ` +
        `YouTube URL. Paste the 11-character id or the watch/share link.`,
    });
  }
  return videoId;
}

/** Did the request say ANYTHING about a video? */
function touchesVideo(input: UpdateLiveSessionInput): boolean {
  return (
    input.youtubeVideoIdOrUrl !== undefined ||
    input.replayYoutubeVideoIdOrUrl !== undefined ||
    input.videoTitle !== undefined ||
    input.videoDurationSeconds !== undefined
  );
}

/**
 * Plan §4.4's outcome → HTTP mapping, applied to the live-session surface.
 *
 * ⚠️ SIBLING: `libs/api/learning/src/lib/lessons/lesson-video.service.ts`'s
 * `fetchErrorToHttp`. A deliberate re-declaration rather than a cross-lib
 * import: `@ptah-api/learning` and `@ptah-api/community` are both `type:feature`
 * and neither may depend on the other, and `@ptah-api/youtube` deliberately
 * carries no HTTP vocabulary (its `index.ts` says so in terms) precisely so each
 * consumer owns its own mapping. The two must change together.
 *
 * ⚠️ `422` MEANS "YOUR ID IS WRONG, FIX IT"; `502` MEANS "WE COULD NOT ASK, TRY
 * AGAIN". Collapsing them into one `400` would make an admin re-check a
 * perfectly good id during a YouTube outage.
 *
 * ⚠️ THE UPSTREAM `status` IS NEVER FORWARDED (NFR-S7).
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

/* -------------------------------------------------------------------------- */
/* Error mapping                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Prisma failure → a typed, sanitized exception.
 *
 * 🔴 `P2002` HERE IS AD-2's `calendar_event_id` UNIQUE, AND IT IS THE ONLY
 * UNIQUE ON THIS TABLE A CALLER CAN COLLIDE WITH (RISK-Y). `LiveSession` has no
 * slug. So the refusal is a `409` carrying a machine `reason`, not the `400`
 * `CoursesService` answers for a slug collision — two admins claiming the same
 * Google event is a CONFLICT between two valid requests, not a malformed one,
 * and the client can act on it (reload the schedule, see who claimed it).
 *
 * ⚠️ THE RAW PRISMA MESSAGE IS LOGGED AND DROPPED. It names the constraint, the
 * table and the column — a schema disclosure on an endpoint that already told
 * the caller it refused.
 */
export function mapPrismaError(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new ConflictException({
        reason: CALENDAR_EVENT_ALREADY_CLAIMED,
        message:
          'Another live session already claims that calendar event. Reload ' +
          'the schedule and edit that session instead.',
      });
    }
    if (error.code === 'P2003') {
      return new BadRequestException(
        'That reference does not exist, or is still referenced by other rows.',
      );
    }
    if (error.code === 'P2025') {
      return new NotFoundException('Not found');
    }
  }
  return error instanceof Error
    ? error
    : new Error('Unknown live session persistence error');
}

/**
 * The client-visible refusal vocabulary — NFR-S7's complete list for this file.
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
const NO_VIDEO_ATTACHED = 'live_session_has_no_video';
export const CALENDAR_EVENT_ALREADY_CLAIMED = 'calendar_event_already_claimed';

/* -------------------------------------------------------------------------- */
/* Mapper                                                                      */
/* -------------------------------------------------------------------------- */

/** The `LiveSession` row shape these reads and writes return. */
export type LiveSessionRow = Prisma.LiveSessionModel;

/**
 * A `LiveSession` row as the admin wire type.
 *
 * ⚠️ `visibility` IS CAST, AND THE CAST ASSERTS A PROPERTY THE WRITE PATH
 * ENFORCES. The column is a Postgres `String`, not an enum (plan §1.5); it was
 * written through a DTO carrying `@IsIn(VISIBILITIES)`, so this is an assertion
 * about the write path rather than a hope about the data.
 */
export function toAdminLiveSession(
  session: LiveSessionRow,
  cohortNames: ReadonlyMap<string, string>,
): AdminLiveSession {
  return {
    id: session.id,
    title: session.title,
    description: session.description,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt?.toISOString() ?? null,
    visibility: session.visibility as Visibility,
    cohortKeys: [...session.cohortKeys],
    cohortNames: session.cohortKeys.map(
      (key) => cohortNames.get(key) ?? `${key} (unknown group)`,
    ),
    youtubeVideoId: session.youtubeVideoId,
    replayYoutubeVideoId: session.replayYoutubeVideoId,
    videoTitle: session.videoTitle,
    videoDurationSeconds: session.videoDurationSeconds,
    videoThumbnailUrl: session.videoThumbnailUrl,
    videoMetadataFetchedAt:
      session.videoMetadataFetchedAt?.toISOString() ?? null,
    // Narrowed rather than cast blindly: a value outside the two this lib writes
    // is data corruption, and reporting it as `null` is safer than handing an
    // admin UI a source it does not switch on.
    videoMetadataSource:
      session.videoMetadataSource === 'api' ||
      session.videoMetadataSource === 'manual'
        ? session.videoMetadataSource
        : null,
    calendarEventId: session.calendarEventId,
    createdBy: session.createdBy,
    deletedAt: session.deletedAt?.toISOString() ?? null,
    deletedBy: session.deletedBy,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Inputs and results                                                          */
/* -------------------------------------------------------------------------- */

/** The seven columns the video resolver writes as one block. */
export interface LiveVideoColumns {
  readonly youtubeVideoId: string | null;
  readonly replayYoutubeVideoId: string | null;
  readonly videoTitle: string | null;
  readonly videoDurationSeconds: number | null;
  readonly videoThumbnailUrl: string | null;
  readonly videoMetadataFetchedAt: Date | null;
  readonly videoMetadataSource: 'api' | 'manual' | null;
}

/**
 * What an admin supplies for a session's video.
 *
 * ⚠️ `videoTitle` AND `videoDurationSeconds` ARE ONLY EVER USED ON THE
 * FEATURE-OFF PATH (R2.2.6's posture). When the integration is on, YouTube is
 * the authority and typed values are ignored — otherwise an admin could type a
 * duration onto an `'api'` row.
 */
export interface LiveVideoInput {
  /** An 11-character id, a YouTube URL, or `''` to detach. */
  readonly youtubeVideoIdOrUrl?: string;
  /** @see youtubeVideoIdOrUrl */
  readonly replayYoutubeVideoIdOrUrl?: string;
  /** Feature-off only. */
  readonly videoTitle?: string;
  /** Feature-off only. A DURATION IN SECONDS (RISK-O — never a position). */
  readonly videoDurationSeconds?: number;
}

/**
 * ⚠️ THESE ARE THE SERVICE'S INPUT TYPES, NOT THE DTOs. Task 12.10 declares the
 * `class-validator` DTOs the controllers bind to and they structurally satisfy
 * these.
 */
export interface CreateLiveSessionInput extends LiveVideoInput {
  readonly title: string;
  readonly description?: string | null;
  readonly startsAt: Date;
  readonly endsAt?: Date | null;
  readonly visibility: Visibility;
  readonly cohortKeys?: readonly string[];
  /** AD-3 — claim an existing Google Calendar event. `@unique`. */
  readonly calendarEventId?: string | null;
  /** The acting admin's user id — never a placeholder. */
  readonly createdBy: string;
}

/**
 * The admin list's date-range filter — @see LiveSessionsService.listForAdmin.
 *
 * ⚠️ NO `includeDeleted`. Its absence is the control that keeps
 * `EXPECTED_EXEMPTIONS` at `[]`; see `ListAdminLiveQueryDto`'s docblock.
 */
export interface AdminLiveFilter {
  /** Inclusive lower bound on `startsAt`. */
  readonly from?: Date;
  /** EXCLUSIVE upper bound on `startsAt`. */
  readonly to?: Date;
}

/** @see CreateLiveSessionInput */
export interface UpdateLiveSessionInput extends LiveVideoInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly startsAt?: Date;
  readonly endsAt?: Date | null;
  readonly visibility?: Visibility;
  readonly cohortKeys?: readonly string[];
  readonly calendarEventId?: string | null;
}

/**
 * The result of a manual metadata refresh.
 *
 * ⚠️ `refreshed: false` WITH A `reason` IS A `200`, NOT AN ERROR. The
 * integration being switched off is a supported runtime state (ASSUMPTION-6),
 * and the admin needs to be told which of "it refreshed" and "there is no key
 * configured" happened — a bare `200 { session }` cannot say.
 */
export interface RefreshLiveMetadataResult {
  readonly refreshed: boolean;
  /** Present only on the feature-off short-circuit. */
  readonly reason?: string;
  readonly session: AdminLiveSession;
}
