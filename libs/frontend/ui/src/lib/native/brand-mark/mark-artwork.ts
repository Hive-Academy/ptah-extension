/**
 * The artwork shape every vendor or provider mark in the webview is drawn
 * from — the vendored brand table (`brand-marks.generated.ts`, produced by
 * `scripts/vendor-brand-icons.mjs`) and the hand-authored provider glyphs
 * alike. One renderer turns it into `<svg><path [attr.d] …>` bindings, so no
 * SVG markup is ever parsed at runtime.
 *
 * Type only: importing this file adds no bytes to a bundle.
 */

/**
 * `fill` artwork paints each path's `fill`. `stroke` artwork is the
 * hand-authored 24-grid line glyph style, drawn with a `currentColor` stroke.
 */
export type MarkArtworkKind = 'fill' | 'stroke';

/** One painted path, in document (paint) order. */
export interface MarkArtworkPath {
  /** SVG path data, already in the artwork's `viewBox` coordinates. */
  readonly d: string;
  /**
   * A lowercase `#rrggbb` colour, or `null` to paint with `currentColor`.
   * Mono rendering replaces every fill with `currentColor`.
   */
  readonly fill: string | null;
  /** Present only when the path needs the `evenodd` rule. */
  readonly fillRule?: 'evenodd';
  /** Effective opacity in `(0, 1)`; absent means fully opaque. */
  readonly opacity?: number;
}

/** A complete mark: its coordinate system, paint kind and paths. */
export interface MarkArtwork {
  /** `min-x min-y width height`, e.g. `'0 0 24 24'`. */
  readonly viewBox: string;
  readonly kind: MarkArtworkKind;
  readonly paths: readonly MarkArtworkPath[];
}
