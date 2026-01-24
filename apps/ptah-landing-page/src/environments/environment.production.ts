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
   * TODO: Replace with real price IDs from Paddle dashboard
   */
  paddle: {
    environment: 'production' as const,
    priceIdEarlyAdopter: 'pri_REPLACE_WITH_REAL_ID',
    priceIdPro: 'pri_REPLACE_WITH_REAL_ID',
  },
};
