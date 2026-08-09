import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { IsOptionalNotNull } from '@ptah-api/core';

/** Lowercase slug: 2–40 chars of [a-z0-9-]. */
const GROUP_KEY_REGEX = /^[a-z0-9-]{2,40}$/;

/**
 * Google Calendar event ids are opaque. Generated ids use base32hex (`a-v0-9`),
 * but imported and instance ids legitimately contain `_`, `-`, `@`, `.` and
 * uppercase, so this is a permissive CHARSET guard, not a format claim: it
 * exists to reject whitespace and shell/markup punctuation that could only be a
 * paste accident, never to second-guess what Google considers valid. Google
 * remains the authority — a syntactically fine id naming no event simply fails
 * the attendee patch, which is already best-effort and non-fatal.
 *
 * The empty string is allowed on purpose: it is how the admin UI clears the
 * field (the service normalizes '' → null).
 */
const SESSION_EVENT_ID_REGEX = /^[A-Za-z0-9_@.-]*$/;

/** Max length of a Google Calendar event id, per Google's documented limit. */
const SESSION_EVENT_ID_MAX = 1024;

/**
 * Body DTO for POST /api/v1/admin/groups.
 *
 * `key` is an immutable lowercase slug (validated against `GROUP_KEY_REGEX`).
 * Setting `isDefault: true` atomically clears the previous default.
 * `sessionEventId` opts this cohort into its own live-session Google Meet
 * event; omitting it leaves the cohort on `BUILDERS_SESSION_EVENT_ID`.
 */
export class CreateMemberGroupDto {
  @IsString()
  @Matches(GROUP_KEY_REGEX, {
    message: 'key must be a lowercase slug (2-40 chars of a-z, 0-9, -)',
  })
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptionalNotNull()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptionalNotNull()
  @IsString()
  @MaxLength(SESSION_EVENT_ID_MAX)
  @Matches(SESSION_EVENT_ID_REGEX, {
    message:
      'sessionEventId must be a Google Calendar event id (no whitespace)',
  })
  sessionEventId?: string;

  @IsOptionalNotNull()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * Body DTO for PATCH /api/v1/admin/groups/:id.
 *
 * All fields optional. `key` is intentionally NOT patchable (stable slug).
 *
 * ⚠️ TWO DISTINCT OPTIONALITIES HERE, AND THE DIFFERENCE IS THE POINT.
 * `description` and `sessionEventId` are declared `string | null` and keep
 * `@IsOptional()`: `null` is a REAL value meaning "clear this column", and the
 * service writes only KEYS PRESENT on the body, so `null` clears while omission
 * leaves the column untouched. `name` and `isDefault` have no such meaning —
 * `null` on them is never a request, only a malformed one — so they use
 * `@IsOptionalNotNull()`, which lets an explicit `null` fall through to the
 * field's own validator and become a `400` naming the property rather than an
 * unvalidated `null` reaching the service below the boundary (NFR-S7,
 * TASK_2026_188). See `@ptah-api/core`'s `optional-field.ts` and the census in
 * `common/nullable-dto.spec.ts`.
 */
export class UpdateMemberGroupDto {
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(SESSION_EVENT_ID_MAX)
  @Matches(SESSION_EVENT_ID_REGEX, {
    message:
      'sessionEventId must be a Google Calendar event id (no whitespace)',
  })
  sessionEventId?: string | null;

  @IsOptionalNotNull()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * Body DTO for POST /api/v1/admin/groups/:id/assign.
 *
 * Either or both of `userIds` (User uuids) and `emails` may be supplied; the
 * service resolves + dedupes them and skips any that do not map to a user.
 */
export class AssignMembersDto {
  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsEmail({}, { each: true })
  @MaxLength(320, { each: true })
  emails?: string[];
}

/**
 * Query DTO for GET /api/v1/admin/groups/:id/members (TASK_2026_169).
 *
 * `search` filters on a FIXED column (`user.email`) inside the service — it is
 * never a caller-supplied field NAME. `pageSize` is capped at 100, matching the
 * generic admin list envelope.
 */
export class ListGroupMembersQueryDto {
  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;

  @IsOptionalNotNull()
  @IsString()
  @MaxLength(256)
  search?: string;
}
