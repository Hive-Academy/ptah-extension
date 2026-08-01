import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * DTO for email/password login
 * POST /api/auth/login/email
 */
export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;
}
