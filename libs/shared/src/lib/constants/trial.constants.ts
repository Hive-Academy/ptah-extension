/**
 * Trial Period Constants (LEGACY — server-side only)
 *
 * The trial-banner / trial-progress UI that used to consume this constant
 * has been removed from the frontend (open-access purge — licensing is
 * identity-only now, no gating or countdown UI). This constant survives
 * only as the default mirrored by the license server's TRIAL_DURATION_DAYS
 * env var, kept for existing legacy 'trial_pro' subscribers whose trials
 * are still draining server-side. Do not wire this back into new UI.
 */

/**
 * Default duration of the legacy Pro trial period in days.
 *
 * Note: The backend license server uses TRIAL_DURATION_DAYS env var
 * which defaults to this value. No frontend UI reads this constant
 * anymore — it exists for legacy server-side reference only.
 */
export const TRIAL_DURATION_DAYS = 100;
