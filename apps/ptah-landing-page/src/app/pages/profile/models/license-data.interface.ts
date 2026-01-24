/**
 * LicenseData Interface
 *
 * Data model for user license information fetched from backend API.
 * MUST match backend response from GET /api/v1/licenses/me
 *
 * Backend API: GET /api/v1/licenses/me
 * Evidence: apps/ptah-license-server/src/license/controllers/license.controller.ts:132-140
 */
export interface LicenseData {
  /** License plan (maps to tier in UI) */
  plan: 'free' | 'early_adopter' | 'pro';

  /** License status */
  status: 'active' | 'none' | 'expired';

  /** User email */
  email: string;

  /** Creation date (ISO 8601) */
  createdAt: string;

  /** Expiration date (ISO 8601, null for lifetime licenses) */
  expiresAt: string | null;

  /** Days remaining until expiration */
  daysRemaining?: number;

  /** Features included in this plan */
  features: string[];

  /** Message for free tier users */
  message?: string;
}
