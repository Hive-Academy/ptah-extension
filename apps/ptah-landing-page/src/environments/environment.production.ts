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
  apiBaseUrl: 'https://api.ptah.live',

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
    token: 'live_e6d7985ed0c5db90caecc145a68',

    /** Price ID for Pro Monthly ($5/month with 14-day trial) - from Paddle dashboard */
    proPriceIdMonthly: 'pri_01kk26dzbsqrn8qfxbb5a5yhzr',
    /** Price ID for Pro Yearly ($50/year with 14-day trial) - from Paddle dashboard */
    proPriceIdYearly: 'pri_01kk26enwra9ag3nta5m7v1ct0',
    /** Price ID for one-time session payment ($100) - from Paddle dashboard */
    sessionPriceId: 'pri_01kk28cjvvcv6eq4t61nft5jhb',
  },
};
