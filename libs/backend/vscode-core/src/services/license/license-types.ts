/**
 * License Types — shared types used by the coordinator and helpers
 * in the license service split.
 *
 * These types mirror the public contracts of {@link LicenseService} and are
 * re-exported from the coordinator file so no public API changes are needed.
 *
 * @packageDocumentation
 */

/**
 * License tier values for the freemium model
 *
 * - 'community': FREE forever, always valid, no license required
 * - 'builders': Active Ptah Builders membership (paid tier)
 * - 'expired': Revoked or payment failed only (NOT for unlicensed users)
 */
export type LicenseTierValue =
  | 'community' // FREE tier, always valid
  | 'builders'
  | 'expired'; // Only for revoked/explicitly expired

/**
 * License verification status returned by the server
 *
 * - No license key: valid: false with reason 'not_found' (triggers registration prompt)
 * - Expired Builders (non-revoked): falls back to Community tier (valid: true)
 * - Revoked licenses: valid: false — this is identity/status only; it does NOT
 *   block extension activation or any local feature (no gating exists).
 */
export interface LicenseStatus {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** Current license tier (community, builders, or expired) */
  tier: LicenseTierValue;
  /** Plan details (if applicable) */
  plan?: {
    name: string;
    features: string[];
    expiresAfterDays: number | null;
    isPremium: boolean;
    description: string;
  };
  /** Subscription expiration timestamp (ISO 8601) */
  expiresAt?: string;
  /** Days remaining before subscription expires */
  daysRemaining?: number;
  /** Reason for invalid status */
  reason?: 'expired' | 'revoked' | 'not_found';
  /** User profile data from license server */
  user?: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  /** Ed25519 signature of the response payload (MITM prevention) */
  signature?: string;
}

/**
 * Events emitted by LicenseService for license status changes
 */
export interface LicenseEvents {
  'license:verified': (status: LicenseStatus) => void;
  'license:expired': (status: LicenseStatus) => void;
  'license:updated': (status: LicenseStatus) => void;
}

/**
 * Persisted cache structure for offline grace period
 *
 * Stored in VS Code globalState to survive restarts.
 * Used when network verification fails.
 */
export interface PersistedLicenseCache {
  /** Cached license status */
  status: LicenseStatus;
  /** Timestamp when cache was persisted (ms since epoch) */
  persistedAt: number;
  /** Timestamp when cache was last validated (ms since epoch) */
  lastValidatedAt: number;
}

/**
 * Persisted user context for expired users
 *
 * When a license key is auto-cleared due to expiration, we persist the
 * user's context so that on next restart they see an expiration notice
 * instead of the new-user welcome screen.
 */
export interface PreviousUserContext {
  /** Reason the key was cleared */
  reason: 'expired';
  /** User profile from the expired license */
  user?: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  /** Timestamp when context was persisted (ms since epoch) - auto-expires after 90 days */
  persistedAt: number;
}
