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
   */
  paddle: {
    /** Paddle environment: 'sandbox' for testing, 'production' for live */
    environment: 'production' as const,
    /** Price ID for Pro Monthly ($8/month) - from Paddle dashboard */
    priceIdMonthly: 'pri_REPLACE_WITH_REAL_ID', // TODO: Replace with real Paddle price ID
    /** Price ID for Pro Yearly ($80/year) - from Paddle dashboard */
    priceIdYearly: 'pri_REPLACE_WITH_REAL_ID', // TODO: Replace with real Paddle price ID
  },
};
