import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VISIBILITIES, type Visibility } from '@ptah-contracts/community';

import { IsOptionalNotNull, NullMeansAbsent } from '../common/optional-field';

/**
 * `POST /v1/admin/live-sessions` — R3.1, R3.2, plan §2.10.
 *
 * 🔴 EVERY FIELD HERE IS INERT UNLESS THE PARAMETER BINDS `dtoPipe(...)` (PRE-1).
 * esbuild emits no `emitDecoratorMetadata`, so a bare `@Body() dto: X` skips
 * every decorator below — including `@IsIn(VISIBILITIES)`, which is the only
 * thing standing between a typo'd visibility and a session visible to nobody.
 * `controller-validation.spec.ts` enforces the binding structurally.
 *
 * ⚠️ THERE IS NO `published` FIELD, AND THAT IS NOT AN OMISSION
 * (ASSUMPTION-13). `LiveSession` has no such column; `forbidNonWhitelisted`
 * therefore turns an attempt to send one into a `400`, which is the right answer
 * — a client that thinks sessions have a draft state should find out at the
 * first request rather than discover the flag was ignored.
 *
 * ⚠️ AND NO `deletedAt` / `deletedBy` / `createdBy` EITHER. `createdBy` comes
 * from `requireAdminUserId(req)`, never from the body — a body-supplied actor is
 * an actor a caller chose.
 */
export class CreateLiveSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  /**
   * ⚠️ `@IsOptionalNotNull()` + `@NullMeansAbsent()`, NOT `@IsOptional()`.
   * On a CREATE, "no description" and "the key was omitted" are the same
   * request — there is nothing to clear — so `null` is normalised to absent
   * rather than earning a census entry. See `optional-field.ts`.
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsISO8601()
  startsAt!: string;

  /**
   * ⚠️ OPTIONAL, AND ITS ABSENCE HAS A RUNTIME MEANING. A session with no
   * `endsAt` is treated as live for `LIVE_FALLBACK_MINUTES` after it starts
   * (RISK-W) rather than for ever. Omitting it is legitimate — a stream whose
   * length nobody knows in advance — which is why it is not required.
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsISO8601()
  endsAt?: string;

  /**
   * 🔴 `@IsIn(VISIBILITIES)` IS THE ONLY THING NARROWING THIS COLUMN.
   * `LiveSession.visibility` is a Postgres `String`, not an enum (plan §1.5), so
   * a value outside the three would save cleanly and match no branch of
   * `buildLiveSessionVisibilityWhere` — a session invisible to everyone,
   * including the admin who created it, with no error anywhere.
   */
  @IsIn(VISIBILITIES)
  visibility!: Visibility;

  /**
   * AD-10 — a `String[]` column, not a join table.
   *
   * ⚠️ AN UNKNOWN KEY IS A `400` FROM THE SERVICE, NOT FROM HERE. There is no
   * foreign key to validate against at the DTO layer, so
   * `LiveSessionsService.assertCohortKeysExist` performs the check against
   * `MemberGroup.key`. This decorator only bounds the shape.
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  cohortKeys?: string[];

  /**
   * R3.1 — the scheduled unlisted stream. An 11-character id OR any recognised
   * YouTube URL; `LiveSessionsService` extracts and validates it, and a
   * malformed value is a `400 { reason: 'youtube_video_id_invalid' }`.
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(200)
  youtubeVideoIdOrUrl?: string;

  /** R3.4 — the recording. Kept separate from the stream id, deliberately. */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(200)
  replayYoutubeVideoIdOrUrl?: string;

  /**
   * AD-3 — claim an existing Google Calendar event so the Live feed
   * de-duplicates deterministically rather than on a fuzzy match.
   *
   * ⚠️ NORMALLY THE MASTER SERIES ID, which is what an admin copies out of
   * Google Calendar. The merge matches it against both an event's own id and its
   * `recurringEventId` precisely because of that (RISK-V).
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(1024)
  calendarEventId?: string;

  /**
   * FEATURE-OFF ONLY (R2.2.6's posture). Used only when `YOUTUBE_API_KEY` is
   * unset — which is the live path in this workspace. With the integration on,
   * YouTube is the authority and this is ignored, so an admin cannot type a
   * title onto an `'api'`-sourced row.
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(300)
  videoTitle?: string;

  /**
   * FEATURE-OFF ONLY. A DURATION IN SECONDS (RISK-O — never a position).
   * Bounded at 24 hours, which is far beyond any real session and far short of
   * a typo that would render as a nonsense runtime.
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86_400)
  videoDurationSeconds?: number;
}

/**
 * The service input, resolved OUTSIDE the class.
 *
 * ⚠️ NOT CLASS-FIELD INITIALISERS. `plainToInstance` runs initialisers before
 * the whitelist, so a defaulted field can survive a request that never sent it
 * and then be indistinguishable from one the caller supplied. Resolving here
 * keeps "the caller said nothing" and "the caller said this" apart all the way
 * to the service, which is what makes `undefined` mean "do not touch".
 */
export function toCreateLiveSessionInput(
  dto: CreateLiveSessionDto,
  createdBy: string,
): {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt?: Date;
  visibility: Visibility;
  cohortKeys?: string[];
  youtubeVideoIdOrUrl?: string;
  replayYoutubeVideoIdOrUrl?: string;
  calendarEventId?: string;
  videoTitle?: string;
  videoDurationSeconds?: number;
  createdBy: string;
} {
  return {
    title: dto.title,
    description: dto.description,
    startsAt: new Date(dto.startsAt),
    endsAt: dto.endsAt === undefined ? undefined : new Date(dto.endsAt),
    visibility: dto.visibility,
    cohortKeys: dto.cohortKeys,
    youtubeVideoIdOrUrl: dto.youtubeVideoIdOrUrl,
    replayYoutubeVideoIdOrUrl: dto.replayYoutubeVideoIdOrUrl,
    calendarEventId: dto.calendarEventId,
    videoTitle: dto.videoTitle,
    videoDurationSeconds: dto.videoDurationSeconds,
    createdBy,
  };
}
