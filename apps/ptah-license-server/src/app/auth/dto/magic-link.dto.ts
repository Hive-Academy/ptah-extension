import { IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * DTO for magic link request
 * POST /api/auth/magic-link
 */
export class MagicLinkDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @IsOptional()
  @IsString()
  returnUrl?: string;

  @IsOptional()
  @IsString()
  plan?: string;
}
