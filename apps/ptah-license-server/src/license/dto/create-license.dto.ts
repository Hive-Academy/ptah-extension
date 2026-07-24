import { IsEmail, IsIn, IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for admin license creation requests
 *
 * Open-source + Builders model:
 * - 'community': Community plan (free forever)
 * - 'builders': Ptah Builders plan ($29/month, $290/year)
 *
 * Validates email format and plan name against allowed values
 */
export class CreateLicenseDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email!: string;

  @IsIn(['community', 'builders'], {
    message: 'Plan must be either "community" or "builders"',
  })
  plan!: 'community' | 'builders';

  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean;
}
