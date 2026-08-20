/**
 * Checkout / Builders configuration helpers.
 *
 * The Builders paid tier ships behind a flag so the open-source product can go
 * live before billing is wired up. All values are read through Nest's
 * `ConfigService` (never `process.env` directly) to stay consistent with the
 * rest of the server.
 *
 * Environment variables:
 * - BUILDERS_CHECKOUT_ENABLED        — 'true' to open Builders checkout (default false)
 * - PADDLE_PRICE_ID_BUILDERS_MONTHLY — Paddle price ID for the monthly Builders plan
 * - PADDLE_PRICE_ID_BUILDERS_YEARLY  — Paddle price ID for the yearly Builders plan
 */
import { ConfigService } from '@nestjs/config';

/**
 * Whether Builders checkout is currently open.
 * Defaults to `false` unless BUILDERS_CHECKOUT_ENABLED is exactly 'true'.
 */
export function isBuildersCheckoutEnabled(config: ConfigService): boolean {
  return config.get<string>('BUILDERS_CHECKOUT_ENABLED') === 'true';
}

/**
 * Configured Paddle price ID for the monthly Builders plan (or undefined).
 */
export function getBuildersMonthlyPriceId(
  config: ConfigService,
): string | undefined {
  return config.get<string>('PADDLE_PRICE_ID_BUILDERS_MONTHLY') || undefined;
}

/**
 * Configured Paddle price ID for the yearly Builders plan (or undefined).
 */
export function getBuildersYearlyPriceId(
  config: ConfigService,
): string | undefined {
  return config.get<string>('PADDLE_PRICE_ID_BUILDERS_YEARLY') || undefined;
}
