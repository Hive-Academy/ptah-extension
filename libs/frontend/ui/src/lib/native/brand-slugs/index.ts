/**
 * Native Brand Slugs - Barrel Export
 *
 * The slug tables and the two MCP server brand resolvers (installed rows and
 * discovery listings, kept apart by their input types). Slugs, not artwork, so
 * eager hosts may import them; kept apart from `./brand-mark` for the same
 * reason as `./monogram-tile` (R7, TASK_2026_533 Batch 24a). This barrel must
 * never import the brand-mark component or its artwork table.
 *
 * @module native/brand-slugs
 */
export {
  CLI_TARGET_BRANDS,
  KNOWN_SERVER_BRANDS,
  LISTING_NAMESPACE_BRANDS,
  PROVIDER_BRAND_SLUGS,
  resolveInstalledBrandSlug,
  resolveListingBrandSlug,
} from '../brand-mark/brand-slugs';
export type {
  CliTargetBrand,
  InstalledBrandQuery,
  ListingBrandQuery,
} from '../brand-mark/brand-slugs';
