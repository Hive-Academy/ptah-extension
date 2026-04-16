/**
 * Trial Configuration for Ptah License Server
 *
 * TASK_2025_143: Configurable trial duration via environment variable
 *
 * This allows testing the full trial workflow by setting a short trial
 * duration (e.g., 1 day or even minutes) without code changes.
 *
 * Environment Variables:
 * - TRIAL_DURATION_DAYS: Number of days for trial period (default: 30)
 *
 * Usage:
 * - Production: Leave unset (defaults to 30 days)
 * - Testing: Set TRIAL_DURATION_DAYS=1 for 1-day trial
 *
 * Example .env for testing:
 * ```
 * TRIAL_DURATION_DAYS=1
 * ```
 */

/**
 * Default trial duration in days
 * This matches the shared constant TRIAL_DURATION_DAYS
 */
const DEFAULT_TRIAL_DURATION_DAYS = process.env['TRIAL_DURATION_DAYS']
  ? parseInt(process.env['TRIAL_DURATION_DAYS'], 10)
  : 30;

/**
 * Get the configured trial duration in days
 *
 * Reads from TRIAL_DURATION_DAYS environment variable.
 * Falls back to 30 days if not set or invalid.
 *
 * @returns Trial duration in days
 */
export function getTrialDurationDays(): number {
  const envValue = process.env['TRIAL_DURATION_DAYS'];

  if (!envValue) {
    return DEFAULT_TRIAL_DURATION_DAYS;
  }

  const parsed = parseInt(envValue, 10);

  if (isNaN(parsed) || parsed < 1) {
    console.warn(
      `[TrialConfig] Invalid TRIAL_DURATION_DAYS value: "${envValue}". Using default: ${DEFAULT_TRIAL_DURATION_DAYS}`,
    );
    return DEFAULT_TRIAL_DURATION_DAYS;
  }

  return parsed;
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
