/**
 * Checkout-mode environment — dev config with Builders self-serve checkout ON.
 *
 * Identical to `environment.ts` (same sandbox Paddle token + real sandbox price
 * ids) EXCEPT `buildersCheckoutEnabled: true`. Because that flag is read at
 * COMPILE time by the pricing grid, the only way to render/exercise checkout-mode
 * UI (button CTA, promo affordance, auto-checkout, etc.) is a build with this
 * replacement. Used by the `checkout` build/serve configuration and the P1
 * checkout e2e suite (`playwright.checkout.config.ts`).
 *
 * NOT for production — production checkout is governed by
 * `environment.production.ts` + the server `BUILDERS_CHECKOUT_ENABLED` flag.
 */
export const environment = {
  production: false,

  buildersCheckoutEnabled: true,

  apiBaseUrl: '',

  paddle: {
    environment: 'sandbox' as const,
    token: 'test_4cc7e17dbf1a71a998fa7e12e31',
    proPriceIdMonthly: 'pri_01kxx5bgmepb6w0y43sqk7szaz',
    proPriceIdYearly: 'pri_01kxx5eb8m36kn6t3h1ss8dy0b',
    sessionPriceId: 'pri_SESSION_SANDBOX_PLACEHOLDER',
  },
};
