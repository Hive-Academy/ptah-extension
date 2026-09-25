/**
 * Native Mark SVG - Barrel Export
 *
 * The one SVG renderer of every vendor and provider mark (`ptah-mark-svg`) and
 * the artwork shape it draws. Artwork-free, so eager hosts may import it; kept
 * apart from `./brand-mark` for the same reason as `./monogram-tile` (R7,
 * TASK_2026_533 Batch 24a). This barrel must never import the brand-mark
 * component or its artwork table.
 *
 * @module native/mark-svg
 */
export { MarkSvgComponent } from '../brand-mark/mark-svg.component';
export type { MarkPaint } from '../brand-mark/mark-svg.component';
export type {
  MarkArtwork,
  MarkArtworkKind,
  MarkArtworkPath,
} from '../brand-mark/mark-artwork';
