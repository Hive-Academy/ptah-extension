import { IsString, Length } from 'class-validator';

/**
 * DTO for email verification
 * POST /api/auth/verify-email
 */
export class VerifyEmailDto {
  @IsString()
  userId!: string;

  @IsString()
  @Length(6, 6, { message: 'Verification code must be 6 characters' })
  code!: string;
}
