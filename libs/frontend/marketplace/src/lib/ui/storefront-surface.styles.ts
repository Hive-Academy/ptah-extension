/**
 * The storefront surface shared by the wide-tier Marketplace headers
 * (`ptah-storefront-hero` and the `storefront` layout of `ptah-source-band`).
 *
 * The gradient is the plan C8 hero gradient: theme tokens only, so it follows
 * every light and dark theme. Kept as one whole class string so Tailwind's
 * content scan sees every class.
 */

/** Tailwind classes of a storefront header's outer box. */
export const STOREFRONT_SURFACE_CLASS =
  'overflow-hidden rounded-2xl border border-base-300 bg-gradient-to-br from-base-200 via-base-100 to-primary/10 p-6';
