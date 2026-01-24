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
   */
  paddle: {
    /** Paddle environment: 'sandbox' for testing, 'production' for live */
    environment: 'sandbox' as const,
    /** Price ID for Pro Monthly ($8/month with 14-day trial) - Paddle sandbox */
    priceIdMonthly: 'pri_01kfr72reygmkapd0vtynrswm4',
    /** Price ID for Pro Yearly ($80/year with 14-day trial) - Paddle sandbox */
    priceIdYearly: 'pri_01kfr76e7fz41sp05w74jy4fx6',
  },
};
