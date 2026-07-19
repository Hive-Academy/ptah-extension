import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Query DTO for GET /api/v1/admin/:model
 *
 * All fields are optional; defaults applied in AdminService.list().
 * `sortBy` is a string capped at 64 chars — the service validates it
 * against the per-model `sortableFields` allowlist before passing to
 * Prisma (see AdminService.list / admin-models.config.ts).
 */
export class ListQueryDto {
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
  @MaxLength(64)
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;
}

/**
 * PATCH body DTO — intentionally permissive (index signature).
 *
 * The global `ValidationPipe` is configured with `forbidNonWhitelisted: true`,
 * which would otherwise reject unknown keys. Because editable fields vary per
 * model, we accept any shape here and rely on `AdminService.filterEditable()`
 * to drop any key not in `ADMIN_MODELS[key].editableFields`.
 *
 * This is the enforcement contract: the server-side filter in AdminService
 * is the authoritative allowlist — the DTO is only a transport envelope.
 */
export class UpdateRecordDto {
  [key: string]: unknown;
}

/**
 * Bulk-email DTO for POST /api/v1/admin/users/bulk-email
 *
 * Caps enforced:
 *   - userIds: 1..500 UUIDv4 values (User.id is uuid v4 per Prisma schema)
 *   - subject: up to 200 chars
 *   - html:    up to 50,000 chars
 */
/**
 * Body DTO for POST /api/v1/admin/waitlist/invite.
 *
 * Both fields optional; `ids` wins when non-empty (invites exactly those
 * waitlist rows), otherwise `batchSize` invites the N oldest un-notified rows.
 * When neither is supplied the service applies its own default batch size.
 *
 * `ids` are Waitlist primary keys (cuid, not uuid) so they are validated as
 * plain strings with a length cap rather than `@IsUUID`.
 */
export class InviteWaitlistDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  batchSize?: number;
}

export class BulkEmailDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  userIds!: string[];

  @IsString()
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MaxLength(50000)
  html!: string;
}
