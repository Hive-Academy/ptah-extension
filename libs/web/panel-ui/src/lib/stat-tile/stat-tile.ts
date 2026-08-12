import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';

/** Visual weight of a tile — `hero` gets the largest number on the page. */
export type StatTileSize = 'default' | 'hero';

/** Semantic tone of the optional delta chip. */
export type StatTileDeltaTone =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral';

/**
 * StatTile — shared metric tile for the admin dashboard.
 *
 * Presentational (design spec §3.5, §7.4, §8.4). Replaces the raw daisyUI
 * `.stat` markup duplicated across the Overview. Supports:
 *   - a `hero` size variant (the one number allowed to dominate the page),
 *   - an optional delta/context chip (e.g. "+18 · last 7 days"),
 *   - an optional `routerLink` making the whole tile a deep-link.
 *
 * Dumb by design — no data fetching; the parent passes resolved values.
 */
@Component({
  selector: 'ptah-stat-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule, NgTemplateOutlet],
  templateUrl: './stat-tile.html',
})
export class StatTile {
  /** Uppercase section label above the value. */
  public readonly label = input<string>('');

  /** The metric itself — rendered big and `tabular-nums`. */
  public readonly value = input<string | number | null>(null);

  /** `hero` = `text-4xl md:text-5xl`, `default` = `text-2xl md:text-3xl`. */
  public readonly size = input<StatTileSize>('default');

  /** Optional delta/context chip text (omit to hide the chip). */
  public readonly delta = input<string | null>(null);

  /** Semantic tone of the delta chip. */
  public readonly deltaTone = input<StatTileDeltaTone>('info');

  /** Optional deep-link target — when set, the whole tile is a router link. */
  public readonly link = input<string | unknown[] | null>(null);

  /** Optional query params paired with `link`. */
  public readonly linkQueryParams = input<Record<string, unknown> | null>(null);

  /**
   * Renders the value in brand amber rather than `base-content`. Reserve this
   * for the one metric a section is actually about — the Stitch reference
   * (`docs/design-system/.../member_home`) carries amber on the hero metric,
   * not on every tile, and the effect dies if every tile claims it.
   */
  public readonly emphasis = input<boolean>(false);

  protected readonly ChevronRightIcon = ChevronRight;

  /** Displayed value, with an em-dash fallback for null/empty. */
  protected readonly valueText = computed<string>(() => {
    const raw = this.value();
    if (raw == null || raw === '') return '—';
    return String(raw);
  });

  protected readonly valueClass = computed<string>(() => {
    const size =
      this.size() === 'hero' ? 'text-4xl md:text-5xl' : 'text-2xl md:text-3xl';
    // Literal tone strings so Tailwind's scanner keeps both variants.
    const tone = this.emphasis() ? 'text-primary' : 'text-base-content';
    return `${size} font-bold tabular-nums ${tone}`;
  });

  /** Delta-chip class — literal daisyUI modifiers so Tailwind keeps them. */
  protected readonly deltaClass = computed<string>(
    () =>
      `badge badge-outline badge-sm text-xs ${DELTA_MODIFIER[this.deltaTone()]}`,
  );
}

const DELTA_MODIFIER: Record<StatTileDeltaTone, string> = {
  info: 'badge-info',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  neutral: 'badge-ghost',
};
