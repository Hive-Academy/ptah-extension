import type { Page } from '@playwright/test';

/**
 * Deterministic Paddle SDK stub for checkout-mode specs.
 *
 * `@paddle/paddle-js` `initializePaddle()` injects
 * `https://cdn.paddle.com/paddle/v2/paddle.js`, then on that script's `load`
 * event resolves `window.PaddleBillingV1` and calls `.Environment.set()` +
 * `.Initialize({ token, eventCallback })`. The app then calls
 * `paddleInstance.Checkout.open(...)`. We fulfill the CDN request with a fake
 * that satisfies exactly this contract, so the service's `_isReady` flips true
 * (openCheckout no longer bails) WITHOUT loading the real cross-origin overlay.
 *
 * With `autoComplete: true` the fake fires the app's `eventCallback` with
 * `checkout.completed` shortly after `Checkout.open` — driving the §3.2
 * post-completed path (navigate to /profile) without touching Paddle's iframe.
 *
 * Introspection (in the browser context): `window.__paddleCheckoutOpen` holds the
 * options passed to `Checkout.open` (undefined if never called).
 */
const PADDLE_STUB_JS = `
(function () {
  var api = {
    Environment: { set: function () {} },
    Initialized: false,
    Initialize: function (opts) {
      this.Initialized = true;
      window.__paddleEventCb = opts && opts.eventCallback;
    },
    Update: function () {},
    Checkout: {
      open: function (o) {
        window.__paddleCheckoutOpen = o;
        if (window.__paddleAutoComplete && window.__paddleEventCb) {
          setTimeout(function () {
            window.__paddleEventCb({ name: 'checkout.completed', data: {} });
          }, 100);
        }
      },
      close: function () {
        if (window.__paddleEventCb) {
          window.__paddleEventCb({ name: 'checkout.closed', data: {} });
        }
      },
    },
  };
  window.PaddleBillingV1 = api;
  window.Paddle = api;
})();
`;

export async function stubPaddle(
  page: Page,
  opts: { autoComplete?: boolean } = {},
): Promise<void> {
  await page.addInitScript((auto) => {
    (
      window as unknown as { __paddleAutoComplete?: boolean }
    ).__paddleAutoComplete = auto;
  }, !!opts.autoComplete);

  await page.route(/cdn\.paddle\.com\/paddle\/v2\/paddle\.js/, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: PADDLE_STUB_JS }),
  );
}

/** Options captured from the app's `Paddle.Checkout.open(...)` call, or null. */
export async function getCheckoutOpenOptions(
  page: Page,
): Promise<{
  items?: Array<{ priceId: string }>;
  discountCode?: string;
} | null> {
  return page.evaluate(
    () =>
      (window as unknown as { __paddleCheckoutOpen?: unknown })
        .__paddleCheckoutOpen ?? null,
  ) as Promise<{
    items?: Array<{ priceId: string }>;
    discountCode?: string;
  } | null>;
}
