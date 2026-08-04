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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SESSION_EVENT_ID_MAX)
  @Matches(SESSION_EVENT_ID_REGEX, {
    message:
      'sessionEventId must be a Google Calendar event id (no whitespace)',
  })
  sessionEventId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * Body DTO for PATCH /api/v1/admin/groups/:id.
 *
 * All fields optional. `key` is intentionally NOT patchable (stable slug).
 * `description` / `sessionEventId` accept `null` to clear the
 * stored value — `@IsOptional()` skips validation for both `null` and
 * `undefined`, and the service writes only KEYS PRESENT on the body, so `null`
 * clears while omission leaves the column untouched.
 */
export class UpdateMemberGroupDto {
  @IsOptional()
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

  @IsOptional()
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
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @IsOptional()
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
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;
}
