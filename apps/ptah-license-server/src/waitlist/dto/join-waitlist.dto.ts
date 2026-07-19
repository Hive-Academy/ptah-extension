import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload for POST /api/v1/waitlist.
 *
 * `source` is a free-form origin hint (e.g. 'landing', 'pricing', 'profile',
 * 'vscode') used purely for lead attribution — kept permissive on purpose so
 * new surfaces can start tagging signups without a backend change.
 */
export class JoinWaitlistDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;
}
