import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

// Imported from the vendored file directly: the barrel does not re-export
// it, and only this small subset (never `BRAND_MARKS`) may reach the eager
// chat-settings bundle (plan R7).
import { PROVIDER_BRAND_ART } from '../brand-mark/provider-brand-art.vendored';
import { PROVIDER_BRAND_SLUGS } from '../brand-mark/brand-slugs';
import type { MarkArtwork } from '../brand-mark/mark-artwork';
import { MarkSvgComponent } from '../brand-mark/mark-svg.component';
import {
  PROVIDER_MARKS,
  strokeMark,
  type ProviderMarkLucideIcon,
} from './provider-marks.data';

/**
 * Lucide fallback glyphs, hand-inlined as stroke artwork so `libs/frontend/ui`
 * (`type:ui`) stays free of a lucide runtime dependency. The segments are
 * lucide's `bot`, `server` and `terminal` icons converted to stroke paths
 * (lucide is ISC-licensed; its `rect`/`line`/`polyline` primitives are
 * rewritten as `path` data here).
 */
const LUCIDE_MARKS: Readonly<Record<ProviderMarkLucideIcon, MarkArtwork>> = {
  Bot: strokeMark([
    'M12 8 L12 4 L8 4',
    'M6 8 L18 8 A2 2 0 0 1 20 10 L20 18 A2 2 0 0 1 18 20 L6 20 A2 2 0 0 1 4 18 L4 10 A2 2 0 0 1 6 8 Z',
    'M2 14 L4 14',
    'M20 14 L22 14',
    'M15 13 L15 15',
    'M9 13 L9 15',
  ]),
  Server: strokeMark([
    'M4 2 L20 2 A2 2 0 0 1 22 4 L22 8 A2 2 0 0 1 20 10 L4 10 A2 2 0 0 1 2 8 L2 4 A2 2 0 0 1 4 2 Z',
    'M4 14 L20 14 A2 2 0 0 1 22 16 L22 20 A2 2 0 0 1 20 22 L4 22 A2 2 0 0 1 2 20 L2 16 A2 2 0 0 1 4 14 Z',
    'M6 6 L6.01 6',
    'M6 18 L6.01 18',
  ]),
  Terminal: strokeMark(['M4 17 L10 11 L4 5', 'M12 19 L20 19']),
};

/**
 * Presentational vendor mark for a provider id (plan Decision 10, C14).
 *
 * Renders a 32 px box (`h-8 w-8`) holding a 24 px mark (`h-6 w-6`) in
 * `currentColor`, `aria-hidden="true"` — marks are decorative; the
 * surrounding label carries the accessible name. The artwork is drawn by the
 * shared renderer `ptah-mark-svg` with `paint="mono"`, which builds the svg
 * from attribute bindings only; no markup is ever parsed.
 *
 * Resolution rule — the tables ARE the allowlist, and no branch on a provider
 * id is permitted outside them:
 * 1. an id in `PROVIDER_BRAND_SLUGS` renders its vendored artwork from the
 *    `PROVIDER_BRAND_ART` subset (R1: real marks);
 * 2. a `kind: 'stroke'` record in `PROVIDER_MARKS` renders that hand-authored
 *    glyph;
 * 3. a `kind: 'lucide'` record renders the named fallback glyph;
 * 4. any other id renders the glyph named by the `fallback` input (`Bot` by
 *    default; `Terminal` for a CLI route, `Server` for an endpoint or local
 *    server).
 */
@Component({
  selector: 'ptah-provider-mark',
  standalone: true,
  imports: [MarkSvgComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="flex h-8 w-8 shrink-0 items-center justify-center text-base-content"
      aria-hidden="true"
      data-testid="provider-mark-box"
    >
      <ptah-mark-svg
        class="h-6 w-6"
        [art]="art()"
        paint="mono"
        data-testid="provider-mark-svg"
      />
    </span>
  `,
})
export class ProviderMarkComponent {
  /** Registry provider id (or CLI agent id) the mark stands for. */
  readonly providerId = input<string>('');
  /**
   * Lucide glyph used when `providerId` has neither a vendored nor a tabled
   * mark. Ignored when the table pins a `kind: 'lucide'` record for the id.
   */
  readonly fallback = input<ProviderMarkLucideIcon>('Bot');

  protected readonly art = computed<MarkArtwork>(() => {
    const id = this.providerId();
    const vendored = vendoredArt(id);
    if (vendored) return vendored;
    const mark = Object.hasOwn(PROVIDER_MARKS, id) ? PROVIDER_MARKS[id] : null;
    if (mark?.kind === 'stroke') return mark;
    return LUCIDE_MARKS[mark?.kind === 'lucide' ? mark.icon : this.fallback()];
  });
}

/** The vendored artwork of a provider id, or `null` when it has none. */
function vendoredArt(providerId: string): MarkArtwork | null {
  if (!Object.hasOwn(PROVIDER_BRAND_SLUGS, providerId)) return null;
  const slug = PROVIDER_BRAND_SLUGS[providerId];
  return Object.hasOwn(PROVIDER_BRAND_ART, slug)
    ? PROVIDER_BRAND_ART[slug]
    : null;
}
