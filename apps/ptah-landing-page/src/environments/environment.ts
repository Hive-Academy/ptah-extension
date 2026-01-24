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
    /** Price ID for Pro Monthly ($8/month) - from Paddle dashboard */
    priceIdMonthly: 'pri_01jqbkwnq87xxxxxxxxx', // TODO: Replace with real Paddle price ID
    /** Price ID for Pro Yearly ($80/year) - from Paddle dashboard */
    priceIdYearly: 'pri_01jqbkwnq87yyyyyyyyy', // TODO: Replace with real Paddle price ID
  },
};
