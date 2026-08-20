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
 * `PATCH /v1/admin/live-sessions/:id` — R3.1, R3.2, R3.4, plan §2.10.
 *
 * Every field optional; only supplied keys are written.
 *
 * 🔴 THE `null` HOLE IS CLOSED ON EVERY FIELD, AND THE CENSUS IS EMPTY.
 * `@IsOptional()` skips validation for `null` as well as `undefined`, so
 * `{"title": null}` would reach the service typed as though it could not exist
 * and throw there as a `500`. Every field here uses `@IsOptionalNotNull()`
 * instead, and `nullable-dto.spec.ts`'s `EXPECTED_NULLABLE_OPTIONALS` is `[]`
 * and should stay `[]`.
 *
 * ⚠️ THERE IS NO "CLEAR THIS FIELD" REQUEST ON THIS SURFACE, WHICH IS WHY THE
 * CENSUS CAN BE EMPTY. Detaching a video is expressed as an EMPTY STRING —
 * `{"youtubeVideoIdOrUrl": ""}` clears all seven video columns through the same
 * resolver — so the tri-state exists without `null` needing a second spelling of
 * it. `UpdateLessonDto` made exactly this call one phase earlier.
 *
 * ⚠️ AND `description` / `endsAt` DELIBERATELY DO NOT ACCEPT `null` EITHER.
 * Clearing either is not a request this surface supports today. If it becomes
 * one, the fix is a nullable declared type plus a census entry — a REVIEW EVENT,
 * not a decorator swap.
 */
export class UpdateLiveSessionDto {
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsISO8601()
  startsAt?: string;

  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsISO8601()
  endsAt?: string;

  /** @see CreateLiveSessionDto.visibility — the same three-value narrowing. */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;

  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  cohortKeys?: string[];

  /**
   * ⚠️ `''` DETACHES THE VIDEO — all seven columns, together. `MinLength` is
   * deliberately absent here (unlike `title`) for exactly that reason.
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(200)
  youtubeVideoIdOrUrl?: string;

  /** @see youtubeVideoIdOrUrl */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(200)
  replayYoutubeVideoIdOrUrl?: string;

  /**
   * AD-3. `''` releases the claim.
   *
   * ⚠️ RELEASING A CLAIM IS A REAL ADMIN ACTION, because AD-2's `@unique` means
   * a stale claim on a deleted Google event blocks any future session from
   * claiming an event Google reissues under the same id.
   */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(1024)
  calendarEventId?: string;

  /** FEATURE-OFF ONLY — see `CreateLiveSessionDto.videoTitle`. */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @IsString()
  @MaxLength(300)
  videoTitle?: string;

  /** FEATURE-OFF ONLY. A DURATION IN SECONDS (RISK-O). */
  @IsOptionalNotNull()
  @NullMeansAbsent()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86_400)
  videoDurationSeconds?: number;
}

/**
 * The service input, resolved OUTSIDE the class — see
 * `toCreateLiveSessionInput`'s note on why there are no field initialisers.
 *
 * ⚠️ `undefined` SURVIVES AS `undefined`. `startsAt: undefined` must reach the
 * service meaning "do not touch", not `new Date(undefined)` — which is an
 * Invalid Date and would write `NULL` or throw at the driver.
 */
export function toUpdateLiveSessionInput(dto: UpdateLiveSessionDto): {
  title?: string;
  description?: string;
  startsAt?: Date;
  endsAt?: Date;
  visibility?: Visibility;
  cohortKeys?: string[];
  youtubeVideoIdOrUrl?: string;
  replayYoutubeVideoIdOrUrl?: string;
  calendarEventId?: string;
  videoTitle?: string;
  videoDurationSeconds?: number;
} {
  return {
    title: dto.title,
    description: dto.description,
    startsAt: dto.startsAt === undefined ? undefined : new Date(dto.startsAt),
    endsAt: dto.endsAt === undefined ? undefined : new Date(dto.endsAt),
    visibility: dto.visibility,
    cohortKeys: dto.cohortKeys,
    youtubeVideoIdOrUrl: dto.youtubeVideoIdOrUrl,
    replayYoutubeVideoIdOrUrl: dto.replayYoutubeVideoIdOrUrl,
    calendarEventId: dto.calendarEventId,
    videoTitle: dto.videoTitle,
    videoDurationSeconds: dto.videoDurationSeconds,
  };
}
