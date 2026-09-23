/**
 * Native Brand Mark - Barrel Export
 *
 * The one mark system of the webview: the SVG renderer every vendor and
 * provider mark goes through (`ptah-mark-svg`), the brand logo tile
 * (`ptah-brand-mark`), the artwork-free monogram tile (`ptah-monogram-tile`)
 * and the slug tables with the two MCP server brand resolvers (installed rows
 * and discovery listings, kept apart by their input types).
 *
 * The vendored artwork table itself is not exported: consumers draw a brand
 * through `ptah-brand-mark`, which keeps the table reachable only from the
 * lazily loaded code that renders it.
 *
 * @module native/brand-mark
 */
export { MarkSvgComponent } from './mark-svg.component';
export type { MarkPaint } from './mark-svg.component';
export { MonogramTileComponent } from './monogram-tile.component';
export type { MarkTileSize } from './monogram-tile.component';
export { BrandMarkComponent } from './brand-mark.component';
export {
  CLI_TARGET_BRANDS,
  KNOWN_SERVER_BRANDS,
  LISTING_NAMESPACE_BRANDS,
  PROVIDER_BRAND_SLUGS,
  resolveInstalledBrandSlug,
  resolveListingBrandSlug,
} from './brand-slugs';
export type {
  CliTargetBrand,
  InstalledBrandQuery,
  ListingBrandQuery,
} from './brand-slugs';
export type {
  MarkArtwork,
  MarkArtworkKind,
  MarkArtworkPath,
} from './mark-artwork';
