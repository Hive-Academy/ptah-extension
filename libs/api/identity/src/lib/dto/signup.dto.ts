import { IsEmail, IsString, MinLength } from 'class-validator';

import { IsOptionalNotNull } from '@ptah-api/core';

/**
 * DTO for user signup
 * POST /api/v1/auth/signup
 */
export class SignupDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @IsOptionalNotNull()
  @IsString()
  firstName?: string;

  @IsOptionalNotNull()
  @IsString()
  lastName?: string;
}
