import { IsString } from 'class-validator';

/**
 * DTO for resend verification
 * POST /api/auth/resend-verification
 */
export class ResendVerificationDto {
  @IsString()
  userId!: string;
}
