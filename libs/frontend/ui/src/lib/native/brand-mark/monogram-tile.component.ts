import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/** Tile size shared by `ptah-monogram-tile` and `ptah-brand-mark`. */
export type MarkTileSize = 'sm' | 'md' | 'lg';

/**
 * Box of a mark tile per size: 24, 32 and 56 px, the three tile sizes of the
 * marketplace designs (health rows, table rows, detail headers).
 */
export const MARK_TILE_BOX_CLASS: Readonly<Record<MarkTileSize, string>> = {
  sm: 'h-6 w-6 rounded-md',
  md: 'h-8 w-8 rounded-lg',
  lg: 'h-14 w-14 rounded-xl',
};

/** Chrome every mark tile shares, whatever it holds. */
export const MARK_TILE_BASE_CLASS =
  'inline-flex shrink-0 items-center justify-center overflow-hidden border border-base-300';

const MONOGRAM_TEXT_CLASS: Readonly<Record<MarkTileSize, string>> = {
  sm: 'text-[11px]',
  md: 'text-sm',
  lg: 'text-2xl',
};

/**
 * The monogram tints, low-alpha theme colours over whatever the tile sits on.
 * The glyph is always `text-base-content`, so its contrast never depends on
 * the tint. The neutral entry is `bg-neutral/15`, not a solid `bg-neutral`: a
 * solid neutral is dark in light themes too, and dark base-content text on it
 * would be unreadable.
 */
export const MONOGRAM_TINT_CLASSES: readonly string[] = [
  'bg-primary/15',
  'bg-secondary/15',
  'bg-accent/15',
  'bg-info/15',
  // Plan D6 says `bg-neutral`; /15 keeps the glyph readable in light themes, where neutral is dark.
  'bg-neutral/15',
];

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over the UTF-16 code units of `text`. */
function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The tint of a label's monogram. Deterministic: the same label always gets
 * the same tint, in every session and on every host. Case and surrounding
 * whitespace are ignored, so `GitHub` and `github ` share one tint.
 */
export function monogramTintClass(label: string): string {
  const key = label.trim().toLowerCase();
  return MONOGRAM_TINT_CLASSES[fnv1a32(key) % MONOGRAM_TINT_CLASSES.length];
}

const LETTER_OR_DIGIT = /^[\p{L}\p{N}]/u;

/** Split text into user-perceived characters (grapheme clusters). */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    });
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

/**
 * The glyph of a label's monogram: its first grapheme, upper-cased. Leading
 * punctuation is skipped when a letter or digit follows, so `@scope/tool`
 * shows `S` and `io.github.user/server` shows `I`. A blank label shows `?`.
 */
export function monogramGlyph(label: string): string {
  const parts = graphemes(label.trim());
  const glyph = parts.find((part) => LETTER_OR_DIGIT.test(part)) ?? parts[0];
  return glyph === undefined ? '?' : glyph.toUpperCase();
}

/**
 * A lettered tile for anything without vendored artwork.
 *
 * Deliberately free of brand artwork: it imports nothing from
 * `brand-marks.generated.ts`, so an eagerly loaded host (the dashboard skill
 * picker, plugin cards) can render it without pulling the vendored logo table
 * into the initial bundle. `ptah-brand-mark` renders it too, as the fallback
 * for a slug with no artwork.
 *
 * Decorative: the host is `aria-hidden`; the visible label next to the tile
 * carries the name.
 */
@Component({
  selector: 'ptah-monogram-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'inline-flex shrink-0' },
  template: `
    <span [class]="tileClass()" data-testid="monogram-tile">{{ glyph() }}</span>
  `,
})
export class MonogramTileComponent {
  /** The name the tile stands for; its first grapheme is drawn. */
  readonly label = input.required<string>();

  /** Tile size. @default 'md' */
  readonly size = input<MarkTileSize>('md');

  protected readonly glyph = computed(() => monogramGlyph(this.label()));

  protected readonly tileClass = computed(() => {
    const size = this.size();
    return [
      MARK_TILE_BASE_CLASS,
      MARK_TILE_BOX_CLASS[size],
      MONOGRAM_TEXT_CLASS[size],
      monogramTintClass(this.label()),
      'select-none font-semibold leading-none text-base-content',
    ].join(' ');
  });
}
