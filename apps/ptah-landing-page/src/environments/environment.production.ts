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
   * New Pricing Model (TASK_2025_121):
   * - Basic: $3/month, $30/year (14-day trial)
   * - Pro: $5/month, $50/year (14-day trial)
   */
  paddle: {
    /** Paddle environment: 'sandbox' for testing, 'production' for live */
    environment: 'production' as const,

    /** Client-side token for Paddle.js SDK (production) */
    token: 'live_REPLACE_WITH_PRODUCTION_TOKEN', // TODO: Replace with real Paddle client-side token

    /** Price ID for Basic Monthly ($3/month with 14-day trial) - from Paddle dashboard */
    basicPriceIdMonthly: 'pri_REPLACE_BASIC_MONTHLY', // TODO: Replace with real Paddle price ID
    /** Price ID for Basic Yearly ($30/year with 14-day trial) - from Paddle dashboard */
    basicPriceIdYearly: 'pri_REPLACE_BASIC_YEARLY', // TODO: Replace with real Paddle price ID

    /** Price ID for Pro Monthly ($5/month with 14-day trial) - from Paddle dashboard */
    proPriceIdMonthly: 'pri_REPLACE_PRO_MONTHLY', // TODO: Replace with real Paddle price ID
    /** Price ID for Pro Yearly ($50/year with 14-day trial) - from Paddle dashboard */
    proPriceIdYearly: 'pri_REPLACE_PRO_YEARLY', // TODO: Replace with real Paddle price ID
  },
};
