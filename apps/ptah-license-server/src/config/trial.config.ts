/**
 * Trial Configuration for Ptah License Server
 *
 * TASK_2025_143: Configurable trial duration via environment variable
 *
 * This allows testing the full trial workflow by setting a short trial
 * duration (e.g., 1 day or even minutes) without code changes.
 *
 * Environment Variables:
 * - TRIAL_DURATION_DAYS: Number of days for trial period (default: 100 days)
 *
 * Usage:
 * - Production: Leave unset (defaults to 100 days)
 * - Testing: Set TRIAL_DURATION_DAYS=1 for 1-day trial
 *
 * Example .env for testing:
 * ```
 * TRIAL_DURATION_DAYS=100
 * ```
 */

/**
 * Default trial duration in days (default: 100 days)
 */
const DEFAULT_TRIAL_DURATION_DAYS = 100;

/**
 * Get the configured trial duration in days
 *
 * Reads from TRIAL_DURATION_DAYS environment variable.
 * Falls back to 100 days if not set, not a valid integer, not positive,
 * or exceeds 365 days.
 *
 * @returns Trial duration in days
 */
export function getTrialDurationDays(): number {
  const envValue = process.env['TRIAL_DURATION_DAYS'];

  if (envValue) {
    const parsed = parseInt(envValue, 10);

    if (!isNaN(parsed) && parsed > 0 && parsed <= 365) {
      return parsed;
    }

    console.warn(
      `[TrialConfig] Invalid TRIAL_DURATION_DAYS value: "${envValue}". Using default: ${DEFAULT_TRIAL_DURATION_DAYS}`,
    );
  }

  return DEFAULT_TRIAL_DURATION_DAYS;
}

/**
 * Get the trial duration in milliseconds
 *
 * Convenience function for calculating expiration dates.
 *
 * @returns Trial duration in milliseconds
 */
export function getTrialDurationMs(): number {
  return getTrialDurationDays() * 24 * 60 * 60 * 1000;
}

/**
 * Calculate trial expiration date from now
 *
 * @returns Date object representing trial end date
 */
export function calculateTrialExpirationDate(): Date {
  return new Date(Date.now() + getTrialDurationMs());
}
