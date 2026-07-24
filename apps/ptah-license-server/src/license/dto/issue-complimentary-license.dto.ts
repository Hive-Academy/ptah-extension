import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { Transform } from 'class-transformer';

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
 * EXACTLY-ONE-OF constraint: the request must carry precisely one recipient
 * identifier — `userId` XOR `email` — never both, never neither.
 *
 * Attached to the always-required `durationPreset` (an ungated property) so the
 * check runs even when BOTH identifiers are omitted. A `@IsOptional` /
 * `@ValidateIf` gate on `userId` / `email` themselves skips a field's validators
 * when that field is absent — which is exactly the neither/both case we must
 * reject — so the cross-field rule cannot live on those fields.
 */
function IsExactlyOneRecipientIdentifier(options?: ValidationOptions) {
  return function (target: object, propertyName: string): void {
    registerDecorator({
      name: 'isExactlyOneRecipientIdentifier',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as IssueComplimentaryLicenseDto;
          const hasUserId =
            typeof dto.userId === 'string' && dto.userId.trim().length > 0;
          const hasEmail =
            typeof dto.email === 'string' && dto.email.trim().length > 0;
          return hasUserId !== hasEmail; // XOR — exactly one
        },
        defaultMessage(): string {
          return 'Provide exactly one of `userId` or `email` (not both, not neither).';
        },
      },
    });
  };
}

/**
 * IssueComplimentaryLicenseDto — request body for
 * `POST /api/v1/admin/licenses/complimentary` (TASK_2025_292 §5.1, §6.3).
 *
 * Validation is structural only; semantic checks (custom date in the
 * future, conflicting active license) live in
 * `LicenseService.createComplimentaryLicense`.
 *
 * Recipient is targeted by EXACTLY ONE of `userId` / `email`:
 *  - `userId` — an existing `User` (the original admin-gift path).
 *  - `email` — the Early-Adopter approval path, where the grant starts from a
 *    waitlist row that may not yet have a `User`. The service find-or-creates
 *    the user by this (lowercased) email and stamps the waitlist lead converted.
 *
 * `plan` is hard-constrained to `'builders'` (the only premium tier) — the
 * architect's §6.3 leaves room for `'community'` later, but freeloader risk
 * and lack of use-case keep it out of scope today.
 */
export class IssueComplimentaryLicenseDto {
  /**
   * Target the recipient by existing user id. Validated as a v4 UUID only when
   * present; see `durationPreset` for the EXACTLY-ONE-OF `userId`/`email` rule.
   */
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  /**
   * Target the recipient by email (Early-Adopter path). Lowercased + trimmed at
   * the boundary; the service find-or-creates the user by this value. See
   * `durationPreset` for the EXACTLY-ONE-OF `userId`/`email` rule.
   */
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;

  @IsExactlyOneRecipientIdentifier()
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

  @IsIn(['builders'])
  plan!: 'builders';

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
