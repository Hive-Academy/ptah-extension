import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Query DTO for GET /api/v1/admin/sessions.
 *
 * `daysAhead` widens the member endpoint's fixed 60-day window so an admin can
 * see further out. Capped at 365 to bound the upstream Calendar query.
 */
export class ListSessionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  daysAhead?: number = 60;
}

/**
 * Body DTO for POST /api/v1/admin/sessions.
 *
 * `startsAt` / `endsAt` are ISO-8601 timestamps; the service rejects a range
 * that does not strictly advance. `createMeetLink` mints a Google Meet link at
 * creation time (conferencing cannot be added by a later PATCH).
 */
export class CreateSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @IsOptional()
  @IsBoolean()
  createMeetLink?: boolean;
}

/**
 * Body DTO for PATCH /api/v1/admin/sessions/:eventId.
 *
 * All fields optional — only supplied keys are sent upstream. `createMeetLink`
 * is deliberately absent: Google sets conferencing at creation time, so
 * accepting it here would be a field that silently does nothing.
 */
export class UpdateSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}
