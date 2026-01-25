import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * DTO for user signup
 * POST /api/auth/signup
 */
export class SignupDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
