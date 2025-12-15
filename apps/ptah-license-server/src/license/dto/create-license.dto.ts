import { IsEmail, IsIn, IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for admin license creation requests
 *
 * Validates email format and plan name against allowed values
 */
export class CreateLicenseDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email!: string;

  @IsIn(['free', 'early_adopter'], {
    message: 'Plan must be either "free" or "early_adopter"',
  })
  plan!: 'free' | 'early_adopter';

  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean;
}
