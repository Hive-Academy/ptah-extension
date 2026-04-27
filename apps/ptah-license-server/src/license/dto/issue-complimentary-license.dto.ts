import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

/**
 * Duration presets supported by the complimentary-license flow.
 *
 * Mirrors the admin dropdown options in
 * `apps/ptah-landing-page/src/app/pages/admin/components/issue-comp-license-modal`.
 * `custom` requires `customExpiresAt`; `never` maps to `expiresAt = null`.
 */
export type ComplimentaryDurationPreset =
  | '30d'
  | '1y'
  | '5y'
  | 'custom'
  | 'never';

export const COMPLIMENTARY_DURATION_PRESETS: readonly ComplimentaryDurationPreset[] =
  ['30d', '1y', '5y', 'custom', 'never'] as const;

/**
 * IssueComplimentaryLicenseDto — request body for
 * `POST /api/v1/admin/licenses/complimentary` (TASK_2025_292 §5.1, §6.3).
 *
 * Validation is structural only; semantic checks (custom date in the
 * future, conflicting active license) live in
 * `LicenseService.createComplimentaryLicense`.
 *
 * `plan` is hard-constrained to `'pro'` for now — the architect's §6.3
 * leaves room for `'community'` later, but freeloader risk and lack of
 * use-case keep it out of scope today.
 */
export class IssueComplimentaryLicenseDto {
  @IsUUID('4')
  userId!: string;

  @IsIn(COMPLIMENTARY_DURATION_PRESETS)
  durationPreset!: ComplimentaryDurationPreset;

  /**
   * ISO-8601 datetime. Required when `durationPreset === 'custom'`.
   * The service rejects past dates with `400 INVALID_CUSTOM_DATE`.
   */
  @ValidateIf(
    (o: IssueComplimentaryLicenseDto) => o.durationPreset === 'custom',
  )
  @IsISO8601()
  @IsOptional()
  customExpiresAt?: string;

  @IsIn(['pro'])
  plan!: 'pro';

  @IsString()
  @Length(1, 500)
  reason!: string;

  /** Defaults to `true` in the service when omitted. */
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  /**
   * When `true`, suppresses the `EXISTING_ACTIVE_LICENSE` 409 and stacks the
   * new complimentary license on top of the active paid license. The paid
   * license is NOT revoked.
   */
  @IsOptional()
  @IsBoolean()
  stackOnTopOfPaid?: boolean;
}
