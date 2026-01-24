/**
 * LicenseData Interface
 *
 * Data model for user license information fetched from backend API.
 *
 * Backend API: GET /api/v1/licenses/me
 * Evidence: implementation-plan.md Phase 4 - Profile Page
 */
export interface LicenseData {
  /** License key (format: PTAH-XXXX-XXXX-XXXX-XXXX) */
  licenseKey: string;

  /** License tier */
  tier: 'free' | 'early_adopter' | 'pro';

  /** User email */
  email: string;

  /** License status */
  status: 'active' | 'inactive' | 'expired';

  /** Activation date (ISO 8601) */
  activatedAt: string;

  /** Expiration date (ISO 8601, null for lifetime licenses) */
  expiresAt: string | null;

  /** Paddle transaction ID (if purchased) */
  paddleTransactionId?: string;
}
