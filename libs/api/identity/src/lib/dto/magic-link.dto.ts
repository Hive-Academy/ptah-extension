import { IsEmail, IsString } from 'class-validator';

import { IsOptionalNotNull } from '@ptah-api/core';

/**
 * DTO for magic link request
 * POST /api/v1/auth/magic-link
 */
export class MagicLinkDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @IsOptionalNotNull()
  @IsString()
  returnUrl?: string;

  @IsOptionalNotNull()
  @IsString()
  plan?: string;
}
