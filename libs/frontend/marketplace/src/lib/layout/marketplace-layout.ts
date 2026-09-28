/**
 * Marketplace container tiers (implementation plan D3).
 *
 * The Marketplace renders inside a VS Code panel, an Electron tab or a canvas
 * tile, so a media query — which measures the WINDOW — cannot decide its
 * layout. The shell hands its host element to a {@link MarketplaceLayout},
 * which measures that element and publishes a tier. Structural switches (rail
 * vs sidebar, table vs cards, drawer vs docked detail) read `tier()`; purely
 * cosmetic density stays in native `@container ptah-mp-content` CSS rules.
 */

import { computed, signal, type DestroyRef, type Signal } from '@angular/core';

/** The three layout tiers. */
export type MarketplaceTier = 'compact' | 'regular' | 'wide';

/**
 * Below this width the provider table truncates: 240px sidebar + a 5-column
 * table (≈660px). Compact swaps to cards and a 56px rail.
 */
export const MARKETPLACE_REGULAR_MIN_WIDTH = 900;

/**
 * Below this width a docked 400px inspector starves the table
 * (240 sidebar + 400 inspector + ≈720 table + padding). Detail stays an overlay
 * drawer until here.
 */
export const MARKETPLACE_WIDE_MIN_WIDTH = 1400;

/**
 * Map a measured width to a tier: compact < 900, regular 900–1399,
 * wide ≥ 1400. Total — a non-finite or negative width is compact, the tier
 * that renders at any width without horizontal scroll.
 */
export function marketplaceTierForWidth(width: number): MarketplaceTier {
  if (!Number.isFinite(width) || width < MARKETPLACE_REGULAR_MIN_WIDTH) {
    return 'compact';
  }
  return width < MARKETPLACE_WIDE_MIN_WIDTH ? 'regular' : 'wide';
}

/**
 * Measures one element and exposes its width and tier as signals.
 *
 * Not `@Injectable`: the shell provides it with a factory
 * (`useFactory: () => new MarketplaceLayout(inject(DestroyRef))`) and calls
 * {@link observe} with its own host element, so the layout is scoped to one
 * shell instance and every page under it reads the same tier.
 *
 * Follows the `chat-view.component.ts` `observeHostWidth` pattern: seed the
 * width synchronously, fall back to the window width where `ResizeObserver`
 * does not exist (jsdom, very old hosts), and ignore zero-width reports so a
 * detached or hidden host never collapses the layout to compact.
 *
 * Signal writes from the observer callback need no `NgZone.run`: a signal
 * write notifies the change-detection scheduler whether or not it happens
 * inside the zone.
 */
export class MarketplaceLayout {
  private readonly _width = signal(0);
  private observer: ResizeObserver | null = null;

  /** The last measured width in CSS pixels; 0 until the first measurement. */
  public readonly width: Signal<number> = this._width.asReadonly();

  /** The tier for {@link width}. */
  public readonly tier: Signal<MarketplaceTier> = computed(() =>
    marketplaceTierForWidth(this._width()),
  );

  public constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => this.disconnect());
  }

  /**
   * Start measuring `element`. A second call moves the observation to the new
   * element; the previous observer is disconnected first.
   */
  public observe(element: HTMLElement): void {
    this.disconnect();

    const initialWidth = element.clientWidth;
    if (initialWidth > 0) {
      this._width.set(initialWidth);
    }

    if (typeof ResizeObserver === 'undefined') {
      // Without an observer the width would stay 0 and the tier compact
      // forever, even in a wide window. Seed the window width instead: it is
      // an upper bound on the host width, so a narrower host may get a roomier
      // tier than it can afford — the same outcome as a media-query layout —
      // rather than a permanently compact one.
      if (this._width() === 0 && typeof window !== 'undefined') {
        this._width.set(window.innerWidth);
      }
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const measured =
          entry.contentRect && entry.contentRect.width > 0
            ? entry.contentRect.width
            : (entry.target as HTMLElement).clientWidth;
        if (measured > 0) {
          this._width.set(measured);
        }
      }
    });
    observer.observe(element);
    this.observer = observer;
  }

  /** Stop measuring. Idempotent; the last width and tier are kept. */
  public disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
