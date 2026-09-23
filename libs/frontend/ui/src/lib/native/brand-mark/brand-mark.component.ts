import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { BRAND_MARKS, type BrandMarkRecord } from './brand-marks.generated';
import { MarkSvgComponent } from './mark-svg.component';
import {
  MARK_TILE_BASE_CLASS,
  MARK_TILE_BOX_CLASS,
  MonogramTileComponent,
  type MarkTileSize,
} from './monogram-tile.component';

/** Size of the artwork inside its tile, about 60 % of the tile edge. */
const MARK_ART_CLASS: Readonly<Record<MarkTileSize, string>> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-9 w-9',
};

/**
 * Which backdrop a tile gets.
 *
 * - `theme`: `bg-base-200`, the theme's own surface.
 * - `light`: a fixed white tile, for a mark whose colours all fall below 3:1
 *   on the dark base-200 and that has no dark-theme variant. `text-black`
 *   makes any `currentColor` path in it dark as well.
 */
type BrandMarkTile = 'theme' | 'light';

const TILE_BACKDROP_CLASS: Readonly<Record<BrandMarkTile, string>> = {
  theme: 'bg-base-200 text-base-content',
  light: 'bg-white text-black',
};

/**
 * The vendored record for a slug, or `null`. Own keys only, so a slug such as
 * `constructor` never resolves to something inherited from `Object`.
 */
function brandRecord(slug: string | null): BrandMarkRecord | null {
  if (slug === null || !Object.hasOwn(BRAND_MARKS, slug)) return null;
  return BRAND_MARKS[slug];
}

/**
 * The tile rule (implementation-plan D6), checked in this order:
 *
 * 1. a dark-theme variant exists → the theme tile; CSS picks the artwork that
 *    suits the current theme, so the mark never needs a white backdrop;
 * 2. `surface: 'light'` → the white tile;
 * 3. otherwise → the theme tile.
 */
function tileFor(record: BrandMarkRecord): BrandMarkTile {
  if (record.onDark !== undefined) return 'theme';
  return record.surface === 'light' ? 'light' : 'theme';
}

/**
 * The dark-variant switch. `art` shows unless the page is in a dark theme
 * mode; `onDark` shows only then. Held in a constant rather than inline so the
 * unit tests render it too (jest-preset-angular drops inline `styles` literals
 * from components, which would leave the switch untested).
 */
const BRAND_MARK_THEME_STYLES = `
  .ptah-brand-mark__on-dark {
    display: none;
  }

  :host-context([data-theme-mode='dark']) .ptah-brand-mark__on-light {
    display: none;
  }

  :host-context([data-theme-mode='dark']) .ptah-brand-mark__on-dark {
    display: block;
  }
`;

/**
 * A vendor's logo on a small tile, or a monogram when there is no artwork.
 *
 * `brandSlug` looks up the vendored table (`brand-marks.generated.ts`). An
 * unknown, monogram-only or `null` slug renders `ptah-monogram-tile` with the
 * first grapheme of `label`. Never throws.
 *
 * DARK VARIANT WITHOUT AN INPUT. When the brand ships a dark-theme variant
 * both artworks are rendered and CSS shows one of them, keyed on the
 * `data-theme-mode` attribute that `ThemeService` (and, before first paint,
 * `index.html`) writes on `<html>`. No consumer passes a theme and nothing is
 * injected. A brand without a dark variant shows its `art` in every theme.
 *
 * BUNDLE. This component references the full artwork table, so render it only
 * from lazily loaded code. Eagerly loaded hosts use `ptah-monogram-tile`.
 *
 * Decorative: the host is `aria-hidden`; the visible label carries the name.
 *
 * @example
 * ```html
 * <ptah-brand-mark [brandSlug]="row.brand" [label]="row.name" size="md" />
 * ```
 */
@Component({
  selector: 'ptah-brand-mark',
  standalone: true,
  imports: [MarkSvgComponent, MonogramTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'inline-flex shrink-0' },
  template: `
    @if (record(); as brand) {
      <span
        [class]="tileClass()"
        [attr.data-tile]="tile()"
        data-testid="brand-mark-tile"
      >
        @if (brand.onDark; as onDark) {
          <ptah-mark-svg
            [class]="artClass() + ' ptah-brand-mark__on-light'"
            [art]="brand.art"
            data-testid="brand-mark-art"
          />
          <ptah-mark-svg
            [class]="artClass() + ' ptah-brand-mark__on-dark'"
            [art]="onDark"
            data-testid="brand-mark-on-dark"
          />
        } @else {
          <ptah-mark-svg
            [class]="artClass()"
            [art]="brand.art"
            data-testid="brand-mark-art"
          />
        }
      </span>
    } @else {
      <ptah-monogram-tile [label]="label()" [size]="size()" />
    }
  `,
  // A bare constant, not `[BRAND_MARK_THEME_STYLES]`: jest-preset-angular
  // deletes any array- or string-literal `styles` from a component
  // (`replace-resources.js`), which would leave the dark switch untested.
  styles: BRAND_MARK_THEME_STYLES,
})
export class BrandMarkComponent {
  /**
   * Vendored brand slug: a catalogue `brandSlug`, or the result of
   * `resolveInstalledBrandSlug` / `resolveListingBrandSlug`.
   */
  readonly brandSlug = input<string | null>(null);

  /** Name the mark stands for; drawn as the monogram when there is no art. */
  readonly label = input.required<string>();

  /** Tile size. @default 'md' */
  readonly size = input<MarkTileSize>('md');

  protected readonly record = computed(() => brandRecord(this.brandSlug()));

  protected readonly tile = computed<BrandMarkTile>(() => {
    const record = this.record();
    return record === null ? 'theme' : tileFor(record);
  });

  protected readonly tileClass = computed(() =>
    [
      MARK_TILE_BASE_CLASS,
      MARK_TILE_BOX_CLASS[this.size()],
      TILE_BACKDROP_CLASS[this.tile()],
    ].join(' '),
  );

  protected readonly artClass = computed(() => MARK_ART_CLASS[this.size()]);
}
