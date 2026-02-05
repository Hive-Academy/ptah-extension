/**
 * Trial Period Constants
 *
 * TASK_2025_142: Centralized trial duration to avoid magic numbers
 * across the codebase. All components should import from here.
 */

/**
 * Duration of the Pro trial period in days.
 * Used for:
 * - Trial progress calculations
 * - UI messaging ("Your 14-day trial")
 * - Backend trial expiration logic
 */
export const TRIAL_DURATION_DAYS = 14;
