import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  PROVIDER_MARKS,
  type ProviderMark,
  type ProviderMarkLucideIcon,
} from './provider-marks.data';

/**
 * Lucide fallback glyphs, hand-inlined as path data so `libs/frontend/ui`
 * (`type:ui`) stays free of a lucide runtime dependency. The segments are
 * lucide's `bot`, `server` and `terminal` icons converted to stroke paths
 * (lucide is ISC-licensed; its `rect`/`line`/`polyline` primitives are
 * rewritten as `path` data here).
 */
const LUCIDE_MARK_PATHS: Readonly<
  Record<ProviderMarkLucideIcon, readonly string[]>
> = {
  Bot: [
    'M12 8 L12 4 L8 4',
    'M6 8 L18 8 A2 2 0 0 1 20 10 L20 18 A2 2 0 0 1 18 20 L6 20 A2 2 0 0 1 4 18 L4 10 A2 2 0 0 1 6 8 Z',
    'M2 14 L4 14',
    'M20 14 L22 14',
    'M15 13 L15 15',
    'M9 13 L9 15',
  ],
  Server: [
    'M4 2 L20 2 A2 2 0 0 1 22 4 L22 8 A2 2 0 0 1 20 10 L4 10 A2 2 0 0 1 2 8 L2 4 A2 2 0 0 1 4 2 Z',
    'M4 14 L20 14 A2 2 0 0 1 22 16 L22 20 A2 2 0 0 1 20 22 L4 22 A2 2 0 0 1 2 20 L2 16 A2 2 0 0 1 4 14 Z',
    'M6 6 L6.01 6',
    'M6 18 L6.01 18',
  ],
  Terminal: ['M4 17 L10 11 L4 5', 'M12 19 L20 19'],
};

const LUCIDE_MARK_VIEWBOX = '0 0 24 24';

/**
 * Presentational vendor mark for a provider id (plan Decision 10).
 *
 * Renders a 32 px box (`h-8 w-8`) holding a 24 px mark (`h-6 w-6`) in
 * `currentColor`, `aria-hidden="true"` — marks are decorative; the
 * surrounding label carries the accessible name. The svg is built in the
 * template from the sanitized path constants in `provider-marks.data.ts`;
 * no markup is ever parsed — the svg is built from `[attr.d]` path
 * bindings only.
 *
 * Resolution rule — the table IS the allowlist, and no branch on a provider
 * id is permitted outside `provider-marks.data.ts`:
 * - a `kind: 'path'` record renders its own `viewBox` + `d` segments;
 * - a `kind: 'lucide'` record renders the named fallback glyph;
 * - an id absent from the table renders the glyph named by the `fallback`
 *   input (`Bot` by default; `Terminal` for a CLI route, `Server` for an
 *   endpoint or local server).
 */
@Component({
  selector: 'ptah-provider-mark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="flex h-8 w-8 shrink-0 items-center justify-center text-base-content"
      aria-hidden="true"
      data-testid="provider-mark-box"
    >
      <svg
        class="h-6 w-6"
        [attr.viewBox]="viewBox()"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        data-testid="provider-mark-svg"
      >
        @for (segment of pathSegments(); track $index) {
          <path [attr.d]="segment" />
        }
      </svg>
    </span>
  `,
})
export class ProviderMarkComponent {
  /** Registry provider id (or CLI agent id) the mark stands for. */
  readonly providerId = input<string>('');
  /**
   * Lucide glyph used when `providerId` is absent from the marks table.
   * Ignored when the table pins a `kind: 'lucide'` record for the id.
   */
  readonly fallback = input<ProviderMarkLucideIcon>('Bot');

  private readonly resolvedMark = computed<ProviderMark | null>(
    () => PROVIDER_MARKS[this.providerId()] ?? null,
  );

  protected readonly viewBox = computed<string>(() => {
    const mark = this.resolvedMark();
    return mark?.kind === 'path' ? mark.viewBox : LUCIDE_MARK_VIEWBOX;
  });

  protected readonly pathSegments = computed<readonly string[]>(() => {
    const mark = this.resolvedMark();
    if (mark?.kind === 'path') return mark.d;
    return LUCIDE_MARK_PATHS[
      mark?.kind === 'lucide' ? mark.icon : this.fallback()
    ];
  });
}
