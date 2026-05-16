/**
 * Trial Period Constants
 *
 * Centralized trial duration to avoid magic numbers across the codebase.
 * All components should import from here.
 *
 * Backend uses TRIAL_DURATION_DAYS env var for configurability.
 * This constant is the default value and is used for:
 * - Frontend UI messaging ("Your 100-day trial")
 * - Trial progress calculations in the UI
 */

/**
 * Default duration of the Pro trial period in days.
 *
 * Used for:
 * - UI messaging ("Your 100-day trial")
 * - Trial progress calculations in frontend
 *
 * Note: The backend license server uses TRIAL_DURATION_DAYS env var
 * which defaults to this value. For testing, set the env var to
 * a shorter duration (e.g., 1 day).
 */
export const TRIAL_DURATION_DAYS = 100;
