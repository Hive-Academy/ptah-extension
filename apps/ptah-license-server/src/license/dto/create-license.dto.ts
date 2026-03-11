import { IsEmail, IsIn, IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for admin license creation requests
 *
 * TASK_2025_128: Freemium model conversion
 * - 'community': Community plan (free forever)
 * - 'pro': Pro plan ($5/month)
 *
 * Validates email format and plan name against allowed values
 */
export class CreateLicenseDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email!: string;

  @IsIn(['community', 'pro'], {
    message: 'Plan must be either "community" or "pro"',
  })
  plan!: 'community' | 'pro';

  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean;
}
