import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';
import type { AdminCreateTopicRequest } from '@ptah-contracts/community';

import { IsOptionalNotNull } from '../../common/optional-field';

/** `POST /api/v1/admin/community/topics` — admin-authored opening thread. */
export class CreateAdminTopicDto implements AdminCreateTopicRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  categoryId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  /** Raw markdown for post #1. */
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  body!: string;

  @IsOptionalNotNull()
  @IsBoolean()
  pinned?: boolean;

  @IsOptionalNotNull()
  @IsBoolean()
  locked?: boolean;
}
