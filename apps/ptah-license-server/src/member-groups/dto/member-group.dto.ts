import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Lowercase slug: 2–40 chars of [a-z0-9-]. */
const GROUP_KEY_REGEX = /^[a-z0-9-]{2,40}$/;

/**
 * Body DTO for POST /api/v1/admin/groups.
 *
 * `key` is an immutable lowercase slug (validated against `GROUP_KEY_REGEX`).
 * Setting `isDefault: true` atomically clears the previous default.
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
  @MaxLength(120)
  discourseGroup?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * Body DTO for PATCH /api/v1/admin/groups/:id.
 *
 * All fields optional. `key` is intentionally NOT patchable (stable slug).
 * `description` / `discourseGroup` accept `null` to clear the stored value.
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
  @MaxLength(120)
  discourseGroup?: string | null;

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
