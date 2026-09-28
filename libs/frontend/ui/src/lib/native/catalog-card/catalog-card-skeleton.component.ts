/**
 * CatalogCardSkeletonComponent - Loading placeholder shaped like a catalog card.
 *
 * The one shared loading tile of the storefront card language: every
 * discovery view renders these inside its `CatalogGridComponent` while its
 * list loads, instead of hand-copying the card's chrome. The outer box comes
 * from the same shell definition as `CatalogCardComponent`
 * (`catalog-card-shell.styles.ts`), so surface, border, radius, padding and
 * the compact-container rule cannot drift from the real card.
 *
 * Blocks: mark tile, heading, two description lines (one in compact density,
 * matching the card's 1-line clamp) and a footer action. Blocks use daisyUI
 * `skeleton`, which slows its shimmer under `prefers-reduced-motion`.
 *
 * ACCESSIBILITY. The whole tile is `aria-hidden="true"`: it carries no content.
 * The consumer announces loading itself (its existing status text or
 * `aria-busy` on the region). Inside a grid, set `role="listitem"` on the host,
 * the same contract as the card.
 *
 * @example
 * ```html
 * <ptah-catalog-grid>
 *   @if (loading()) {
 *     @for (tile of [1, 2, 3, 4]; track tile) {
 *       <ptah-catalog-card-skeleton role="listitem" />
 *     }
 *   }
 * </ptah-catalog-grid>
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import {
  CATALOG_CARD_SHELL_CLASS,
  CATALOG_CARD_SHELL_STYLES,
} from './catalog-card-shell.styles';

/**
 * Padding scale of the skeleton tile. `compact` forces the compact shell even
 * outside a narrow `ptah-catalog` container; `comfortable` still turns compact
 * inside one, exactly like the card.
 */
export type CatalogCardSkeletonDensity = 'comfortable' | 'compact';

@Component({
  selector: 'ptah-catalog-card-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[attr.data-density]': 'density()',
  },
  template: `
    <div [class]="shellClass()" data-testid="catalog-card-skeleton">
      <div class="flex min-w-0 items-start gap-3">
        <div
          class="skeleton h-10 w-10 shrink-0 rounded-xl"
          data-testid="catalog-card-skeleton-mark"
        ></div>
        <div class="min-w-0 flex-1 pt-1">
          <div
            class="skeleton h-4 w-2/3 rounded"
            data-testid="catalog-card-skeleton-heading"
          ></div>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <div
          class="skeleton h-3 w-full rounded"
          data-testid="catalog-card-skeleton-line"
        ></div>
        <div
          class="ptah-catalog-card-skeleton__line-2 skeleton h-3 w-4/5 rounded"
          data-testid="catalog-card-skeleton-line"
        ></div>
      </div>

      <div
        class="mt-auto flex justify-end border-t border-base-300 pt-3"
        data-testid="catalog-card-skeleton-footer"
      >
        <div class="skeleton h-8 w-20 rounded-md"></div>
      </div>
    </div>
  `,
  styles: [
    CATALOG_CARD_SHELL_STYLES,
    `
      .ptah-catalog-card--compact .ptah-catalog-card-skeleton__line-2 {
        display: none;
      }

      /* Compact density mirrors the card's 1-line description clamp. */
      @container ptah-catalog (width < 480px) {
        .ptah-catalog-card-skeleton__line-2 {
          display: none;
        }
      }
    `,
  ],
})
export class CatalogCardSkeletonComponent {
  /** Padding scale. @default 'comfortable' */
  readonly density = input<CatalogCardSkeletonDensity>('comfortable');

  protected readonly shellClass = computed(() =>
    this.density() === 'compact'
      ? `${CATALOG_CARD_SHELL_CLASS} ptah-catalog-card--compact`
      : CATALOG_CARD_SHELL_CLASS,
  );
}
