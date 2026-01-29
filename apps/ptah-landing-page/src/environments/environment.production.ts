/**
 * Production Environment Configuration
 *
 * Used when running: nx build ptah-landing-page --configuration=production
 *
 * IMPORTANT: Update apiBaseUrl before production deployment!
 */
export const environment = {
  production: true,

  /**
   * API base URL
   * TODO: Update with production license server URL before deployment
   * Example: 'https://api.ptah.dev' or 'https://license.ptah.io'
   */
  apiBaseUrl: '',

  /**
   * Paddle configuration (production)
   * @see docs/PADDLE_SETUP_SIMPLIFIED.md for pricing model details
   *
   * TASK_2025_128: Freemium Model Conversion
   * - Community: FREE forever (no Paddle integration)
   * - Pro: $5/month, $50/year (14-day trial)
   *
   * Only Pro plan has price IDs - Community tier is FREE with no checkout.
   */
  paddle: {
    /** Paddle environment: 'sandbox' for testing, 'production' for live */
    environment: 'production' as const,

    /** Client-side token for Paddle.js SDK (production) */
    token: 'live_REPLACE_WITH_PRODUCTION_TOKEN', // TODO: Replace with real Paddle client-side token

    /** Price ID for Pro Monthly ($5/month with 14-day trial) - from Paddle dashboard */
    proPriceIdMonthly: 'pri_REPLACE_PRO_MONTHLY', // TODO: Replace with real Paddle price ID
    /** Price ID for Pro Yearly ($50/year with 14-day trial) - from Paddle dashboard */
    proPriceIdYearly: 'pri_REPLACE_PRO_YEARLY', // TODO: Replace with real Paddle price ID
  },
};
