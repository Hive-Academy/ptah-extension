/**
 * Catalog card shell - the one definition of the card's outer box.
 *
 * Shared by `CatalogCardComponent` and `CatalogCardSkeletonComponent` so a
 * loading tile can never drift from the real card: surface, border, radius,
 * padding and the compact-density rule all come from here.
 *
 * Density: comfortable by default; compact inside a `ptah-catalog` container
 * narrower than 480px (a single-column `CatalogGridComponent`), or when the
 * `ptah-catalog-card--compact` modifier is applied explicitly.
 */

/** Tailwind classes of the card's outer box (theme tokens only). */
export const CATALOG_CARD_SHELL_CLASS =
  'ptah-catalog-card relative flex flex-1 flex-col rounded-xl border border-base-300 bg-base-200';

/** Component styles for the shell's host and density padding. */
export const CATALOG_CARD_SHELL_STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .ptah-catalog-card {
    gap: 0.75rem;
    padding: 1rem;
  }

  .ptah-catalog-card.ptah-catalog-card--compact {
    gap: 0.5rem;
    padding: 0.75rem;
  }

  /* Compact density: a single-column catalog grid (< 480px). */
  @container ptah-catalog (width < 480px) {
    .ptah-catalog-card {
      gap: 0.5rem;
      padding: 0.75rem;
    }
  }
`;
