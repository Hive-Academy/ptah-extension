import { IsEmail, IsIn, IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for admin license creation requests
 *
 * TASK_2025_121: Updated for two-tier paid model
 * - 'basic': Basic plan ($3/month)
 * - 'pro': Pro plan ($5/month)
 *
 * Validates email format and plan name against allowed values
 */
export class CreateLicenseDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email!: string;

  @IsIn(['basic', 'pro'], {
    message: 'Plan must be either "basic" or "pro"',
  })
  plan!: 'basic' | 'pro';

  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean;
}
