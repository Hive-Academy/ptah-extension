import { InjectionToken, Provider } from '@angular/core';

/**
 * Launch switch for Ptah Builders self-serve checkout.
 *
 * While `false`, every pricing CTA (except the customer portal for existing
 * Builders/legacy Pro subscribers) routes to the Builders waitlist instead of
 * Paddle checkout.
 *
 * The value still originates from `environments/environment*.ts` in the app and
 * is still swapped at build time by the `fileReplacements` of the `production`
 * and `checkout` build configurations — the app just hands it over through DI
 * instead of the pricing grid importing the environment file directly, which is
 * what allows the pricing UI to live in a lib.
 *
 * Note this makes the flag a *runtime* value rather than a compile-time
 * constant, so the disabled branches are no longer dead-code-eliminated. They
 * live in the lazy `/pricing` chunk, so the initial bundle is unaffected.
 *
 * Defaults to `false` (checkout closed) so a missing provider fails safe:
 * visitors get the waitlist, never a half-configured checkout.
 */
export const BUILDERS_CHECKOUT_ENABLED = new InjectionToken<boolean>(
  'BUILDERS_CHECKOUT_ENABLED',
  {
    providedIn: 'root',
    factory: () => false,
  },
);

/**
 * Provider factory for {@link BUILDERS_CHECKOUT_ENABLED}.
 *
 * @example
 * ```typescript
 * // In app.config.ts
 * provideBuildersCheckoutEnabled(environment.buildersCheckoutEnabled)
 * ```
 */
export function provideBuildersCheckoutEnabled(enabled: boolean): Provider {
  return {
    provide: BUILDERS_CHECKOUT_ENABLED,
    useValue: enabled,
  };
}
