/**
 * Production Environment Configuration
 *
 * Used when running: nx build ptah-landing-page --configuration=production
 */
export const environment = {
  production: true,

  /**
   * Launch switch for Ptah Builders self-serve checkout.
   * While false, every pricing CTA (except the customer portal for existing
   * Builders/legacy Pro subscribers) routes to the Builders waitlist instead
   * of Paddle checkout. Flip to true when checkout opens.
   */
  buildersCheckoutEnabled: false,

  /** API base URL — must NOT have a trailing slash */
  apiBaseUrl: 'https://api.ptah.live',

  /**
   * Paddle configuration (production)
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
    environment: 'production' as const,

    /** Client-side token for Paddle.js SDK (production) */
    token: 'live_e6d7985ed0c5db90caecc145a68',

    /** Price ID for the Ptah Builders monthly membership - from Paddle dashboard */
    proPriceIdMonthly: 'pri_01kk26dzbsqrn8qfxbb5a5yhzr',
    /** Legacy yearly price ID, no longer offered - from Paddle dashboard */
    proPriceIdYearly: 'pri_01kk26enwra9ag3nta5m7v1ct0',
    /** Price ID for one-time session payment ($100) - from Paddle dashboard */
    sessionPriceId: 'pri_01kk28cjvvcv6eq4t61nft5jhb',
  },
};
