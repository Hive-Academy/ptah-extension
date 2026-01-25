import { IsEmail, IsIn, IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for admin license creation requests
 *
 * Validates email format and plan name against allowed values
 */
export class CreateLicenseDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email!: string;

  @IsIn(['free', 'pro'], {
    message: 'Plan must be either "free" or "pro"',
  })
  plan!: 'free' | 'pro';

  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean;
}
