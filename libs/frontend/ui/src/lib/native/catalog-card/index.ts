/**
 * Native Catalog Card - Barrel Export
 *
 * Storefront card language shared by the marketplace and the chat-ui
 * discovery views: the catalog card (mark is a slot) and its loading skeleton
 * (same shell), the self-sizing catalog
 * grid (native `@container ptah-catalog`) and the single storefront panel for
 * forms and gates. Presentational only; no brand artwork is imported here.
 *
 * @module native/catalog-card
 */
export {
  CatalogCardComponent,
  CATALOG_CARD_MAX_META,
} from './catalog-card.component';
export type {
  CatalogCardBadge,
  CatalogCardBadgeTone,
  CatalogHeadingLevel,
} from './catalog-card.component';
export { CatalogCardSkeletonComponent } from './catalog-card-skeleton.component';
export type { CatalogCardSkeletonDensity } from './catalog-card-skeleton.component';
export {
  CatalogGridComponent,
  CATALOG_CONTAINER_NAME,
} from './catalog-grid.component';
export { StorefrontPanelComponent } from './storefront-panel.component';
