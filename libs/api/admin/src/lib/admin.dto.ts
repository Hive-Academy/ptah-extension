import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { IsOptionalNotNull } from '@ptah-api/core';

/**
 * Query DTO for GET /api/v1/admin/:model
 *
 * All fields are optional; defaults applied in AdminService.list().
 * `sortBy` is a string capped at 64 chars — the service validates it
 * against the per-model `sortableFields` allowlist before passing to
 * Prisma (see AdminService.list / admin-models.config.ts).
 */
export class ListQueryDto {
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
  @MaxLength(64)
  sortBy?: string;

  @IsOptionalNotNull()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsOptionalNotNull()
  @IsString()
  @MaxLength(256)
  search?: string;

  /**
   * Optional single-field filter, format `field:value`
   * (e.g. `resolved:false`, `status:past_due`, `notified:true`).
   *
   * The `field` MUST be in the model's `filterableFields` allowlist
   * (see admin-models.config.ts) — this is validated server-side in
   * `AdminService.list`, which rejects unknown fields with 400. Combined with
   * `search` using AND semantics (search within the filtered set).
   */
  @IsOptionalNotNull()
  @IsString()
  @MaxLength(128)
  filter?: string;
}

/**
 * PATCH body DTO for `PATCH /api/v1/admin/records/:model/:id` — intentionally
 * permissive (index signature, ZERO class-validator metadata).
 *
 * ⚠️ THIS CLASS IS BOUND WITH `passthroughDtoPipe`, NOT `dtoPipe`
 * (`AdminRecordsController.update`). That binding is deliberate and it is the
 * ONLY `passthroughDtoPipe` call site in the server (TASK_2026_170 F1).
 *
 * Why it cannot be `dtoPipe`: `dtoPipe` sets `whitelist + forbidNonWhitelisted`,
 * and class-validator's `ValidationExecutor.whitelist()` collects every property
 * for which it finds no metadata — for a zero-metadata class that is EVERY
 * property — then `forbidNonWhitelisted` turns each into
 * `property <key> should not exist`. So `dtoPipe(UpdateRecordDto)` would 400
 * every non-empty admin PATCH, across all nine admin models. The real callers
 * send computed keys (`buildDirtyPatch()` in the admin detail view, and
 * `{ resolved, resolvedAt }` from webhook triage), so nothing would survive.
 *
 * An earlier version of this docblock claimed the global `ValidationPipe`'s
 * `forbidNonWhitelisted` "would otherwise reject unknown keys" and that this
 * class relies on `filterEditable()` instead. The first half was never true in
 * practice: esbuild emits no `design:paramtypes`, so the global pipe
 * short-circuited and NO pipe ever ran on this parameter. That comment described
 * intended behaviour under a pipe that had never executed.
 *
 * The enforcement contract, correctly stated: `passthroughDtoPipe` binds the
 * parameter honestly (a real `ValidationPipe` with a real `expectedType`, so the
 * structural guard in
 * `apps/ptah-license-server/src/common/controller-validation.spec.ts` sees it)
 * while applying NO property policy; `AdminService.filterEditable()` against
 * `ADMIN_MODELS[key].editableFields` is the AUTHORITATIVE allowlist and the
 * single source of truth. Do NOT add decorators here — that would duplicate
 * that source of truth into a second place and start 400-ing valid edits.
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
  @IsOptionalNotNull()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids?: string[];

  @IsOptionalNotNull()
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
