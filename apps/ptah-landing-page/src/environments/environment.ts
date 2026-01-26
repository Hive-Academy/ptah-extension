/**
 * Development Environment Configuration
 *
 * Used when running: nx serve ptah-landing-page
 *
 * API requests go to same origin (localhost) in development.
 * Angular CLI proxy handles forwarding to backend during development.
 */
export const environment = {
  production: false,

  /**
   * API base URL
   * - Development: Empty string (same origin, proxy handles routing)
   * - Production: Full URL to license server (e.g., https://api.ptah.dev)
   */
  apiBaseUrl: '',

  /**
   * Paddle configuration (sandbox for development)
   * @see docs/PADDLE_SETUP_SIMPLIFIED.md for pricing model details
   *
   * New Pricing Model (TASK_2025_121):
   * - Basic: $3/month, $30/year (14-day trial)
   * - Pro: $5/month, $50/year (14-day trial)
   */
  paddle: {
    /** Paddle environment: 'sandbox' for testing, 'production' for live */
    environment: 'sandbox' as const,

    /** Price ID for Basic Monthly ($3/month with 14-day trial) - Paddle sandbox */
    basicPriceIdMonthly: 'pri_REPLACE_BASIC_MONTHLY',
    /** Price ID for Basic Yearly ($30/year with 14-day trial) - Paddle sandbox */
    basicPriceIdYearly: 'pri_REPLACE_BASIC_YEARLY',

    /** Price ID for Pro Monthly ($5/month with 14-day trial) - Paddle sandbox */
    proPriceIdMonthly: 'pri_01kfr72reygmkapd0vtynrswm4',
    /** Price ID for Pro Yearly ($50/year with 14-day trial) - Paddle sandbox */
    proPriceIdYearly: 'pri_01kfr76e7fz41sp05w74jy4fx6',
  },
};
