import { IsString } from 'class-validator';

/**
 * DTO for resend verification
 * POST /api/v1/auth/resend-verification
 */
export class ResendVerificationDto {
  @IsString()
  userId!: string;
}
