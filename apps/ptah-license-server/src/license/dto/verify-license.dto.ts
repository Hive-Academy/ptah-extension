import { IsString, Matches } from 'class-validator';

/**
 * DTO for license verification requests
 *
 * Validates that the license key follows the required format:
 * ptah_lic_{64 hex characters}
 */
export class VerifyLicenseDto {
  @IsString()
  @Matches(/^ptah_lic_[a-f0-9]{64}$/, {
    message: 'License key must follow format: ptah_lic_{64 hex characters}',
  })
  licenseKey!: string;
}
