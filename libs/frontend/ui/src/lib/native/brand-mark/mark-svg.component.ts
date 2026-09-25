import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import type { MarkArtwork } from './mark-artwork';

/**
 * How a mark is painted.
 *
 * - `brand` keeps each path's own colour; a `null` fill uses `currentColor`.
 * - `mono` paints every path in `currentColor`, so the mark takes the text
 *   colour of wherever it sits (provider settings, inline labels).
 */
export type MarkPaint = 'brand' | 'mono';

/** One `<path>` as the template binds it. `null` removes the attribute. */
interface RenderedMarkPath {
  readonly d: string;
  readonly fill: string | null;
  readonly fillRule: 'evenodd' | null;
  readonly opacity: number | null;
}

/**
 * The one place in the webview that turns `MarkArtwork` into SVG.
 *
 * Every vendor or provider mark — the vendored brand table and the
 * hand-authored provider glyphs — is drawn here, so there is one renderer and
 * one sanitisation boundary. The template builds `<svg><path>` from attribute
 * bindings only (`[attr.d]`, `[attr.fill]`, `[attr.fill-rule]`,
 * `[attr.opacity]`); no SVG markup is parsed at runtime and no raw-HTML
 * binding exists.
 *
 * `fill` artwork paints each path's fill. `stroke` artwork is the 24-grid line
 * glyph style (`provider-marks.data.ts`): no fill, a 2-unit round
 * `currentColor` stroke, whatever the paint.
 *
 * SIZING. The host is a block box and the `<svg>` fills it, so the consumer
 * sizes the host (`class="h-5 w-5"`). The mark is decorative and hidden from
 * assistive technology; the surrounding label carries the accessible name.
 */
@Component({
  selector: 'ptah-mark-svg',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'block' },
  template: `
    <svg
      class="block h-full w-full"
      [attr.viewBox]="art().viewBox"
      [attr.fill]="isStroke() ? 'none' : 'currentColor'"
      [attr.stroke]="isStroke() ? 'currentColor' : null"
      [attr.stroke-width]="isStroke() ? 2 : null"
      [attr.stroke-linecap]="isStroke() ? 'round' : null"
      [attr.stroke-linejoin]="isStroke() ? 'round' : null"
      [attr.data-kind]="art().kind"
      [attr.data-paint]="paint()"
      focusable="false"
      aria-hidden="true"
      data-testid="mark-svg"
    >
      @for (path of paths(); track $index) {
        <path
          [attr.d]="path.d"
          [attr.fill]="path.fill"
          [attr.fill-rule]="path.fillRule"
          [attr.opacity]="path.opacity"
        />
      }
    </svg>
  `,
})
export class MarkSvgComponent {
  /** The artwork to draw. */
  readonly art = input.required<MarkArtwork>();

  /** `brand` keeps the artwork's colours; `mono` paints in `currentColor`. */
  readonly paint = input<MarkPaint>('brand');

  protected readonly isStroke = computed(() => this.art().kind === 'stroke');

  protected readonly paths = computed<readonly RenderedMarkPath[]>(() => {
    const stroke = this.isStroke();
    const mono = this.paint() === 'mono';
    return this.art().paths.map((path) => ({
      d: path.d,
      fill: pathFill(path.fill, stroke, mono),
      fillRule: path.fillRule ?? null,
      opacity: path.opacity ?? null,
    }));
  });
}

/**
 * The `fill` attribute of one path. Stroke glyphs get none, so they inherit
 * the svg's `fill="none"` and stay outlines; mono paints `currentColor`;
 * brand keeps the artwork colour and paints a `null` fill in `currentColor`.
 */
function pathFill(
  fill: string | null,
  stroke: boolean,
  mono: boolean,
): string | null {
  if (stroke) return null;
  if (mono) return 'currentColor';
  return fill ?? 'currentColor';
}
