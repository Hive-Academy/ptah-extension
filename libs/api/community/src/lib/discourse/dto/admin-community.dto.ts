import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query DTO for GET /api/v1/admin/community/topics.
 *
 * ⚠️ THIS FILE CONTAINS QUERY DTOs ONLY, AND MUST CONTINUE TO.
 * The admin community surface is READ-ONLY: all Discourse moderation stays in
 * Discourse's own admin panel. There is no write endpoint, so there is no body
 * DTO to define, no `status` value to validate, and no moderation payload to
 * sanitize. A future contributor adding one here is reopening a surface that
 * was closed deliberately (structural test G5 fails the build if the controller
 * gains a non-`@Get` handler).
 */
export class ListTopicsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
