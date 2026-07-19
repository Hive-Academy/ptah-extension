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
   * Launch switch for Ptah Builders self-serve checkout.
   * While false, every pricing CTA (except the customer portal for existing
   * Builders/legacy Pro subscribers) routes to the Builders waitlist instead
   * of Paddle checkout. Flip to true when checkout opens.
   */
  buildersCheckoutEnabled: false,

  /**
   * API base URL
   * - Development: Empty string (same origin, proxy handles routing)
   * - Production: Full URL to license server (e.g., https://api.ptah.live)
   */
  apiBaseUrl: '',

  /**
   * Paddle configuration (sandbox for development)
   * @see docs/PADDLE_SETUP_SIMPLIFIED.md for pricing model details
   *
   * TASK_2025_128: Freemium Model Conversion
   * - Community: FREE forever (no Paddle integration)
   * - Ptah Builders: founding-member monthly membership
   *
   * Only the Builders plan has price IDs - Community tier is FREE with no checkout.
   */
  paddle: {
    /** Paddle environment: 'sandbox' for testing, 'production' for live */
    environment: 'sandbox' as const,

    /** Client-side token for Paddle.js SDK (sandbox) */
    token: 'test_4cc7e17dbf1a71a998fa7e12e31',

    /** Price ID for the Ptah Builders monthly membership - Paddle sandbox */
    proPriceIdMonthly: 'pri_01kfr72reygmkapd0vtynrswm4',
    /** Legacy yearly price ID, no longer offered - Paddle sandbox */
    proPriceIdYearly: 'pri_01kfr76e7fz41sp05w74jy4fx6',
    /** Price ID for one-time session payment ($100 per 2-hour session) - Paddle sandbox */
    sessionPriceId: 'pri_SESSION_SANDBOX_PLACEHOLDER',
  },
};
