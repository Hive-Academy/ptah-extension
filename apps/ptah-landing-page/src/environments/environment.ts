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
   * TODO: Replace with real price IDs from Paddle dashboard
   */
  paddle: {
    environment: 'sandbox' as const,
    priceIdEarlyAdopter: 'pri_01jqbkwnq87xxxxxxxxx',
    priceIdPro: 'pri_01jqbkwnq87yyyyyyyyy',
  },
};
