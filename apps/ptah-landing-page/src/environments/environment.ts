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
   * TASK_2025_128: Freemium Model Conversion
   * - Community: FREE forever (no Paddle integration)
   * - Pro: $5/month, $50/year (14-day trial)
   *
   * NOTE: Basic price IDs removed - Community tier is FREE with no checkout.
   */
  paddle: {
    /** Paddle environment: 'sandbox' for testing, 'production' for live */
    environment: 'sandbox' as const,

    /** Client-side token for Paddle.js SDK (sandbox) */
    token: 'test_4cc7e17dbf1a71a998fa7e12e31',

    /** Price ID for Pro Monthly ($5/month with 14-day trial) - Paddle sandbox */
    proPriceIdMonthly: 'pri_01kfr72reygmkapd0vtynrswm4',
    /** Price ID for Pro Yearly ($50/year with 14-day trial) - Paddle sandbox */
    proPriceIdYearly: 'pri_01kfr76e7fz41sp05w74jy4fx6',
  },
};
