import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  effect,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** What the composer reports about itself; the store derives the fold. */
export interface ComposerCompactSources {
  /** The tab this composer writes to. A change starts a fresh fold. */
  readonly scope: Signal<string | null>;
  /** The tab is generating (the same predicate the Stop button reads). */
  readonly streaming: Signal<boolean>;
  /** Text, file chips or images are pending in the composer. */
  readonly hasContent: Signal<boolean>;
  /** Focus is inside the full composer (textarea, toolbar, its popovers). */
  readonly focused: Signal<boolean>;
  /** A composer popover is open: slash / @ suggestions, attach, model menu. */
  readonly overlayOpen: Signal<boolean>;
  /** Files are being dragged over the composer. */
  readonly dragging: Signal<boolean>;
}

/**
 * Two-state streaming composer: decides when the chat composer folds into
 * its one-row compact bar while the agent streams.
 *
 * - Compact only while streaming AND the composer is idle (no content, no
 *   focus inside it, no popover open, no file drag over it) AND the user
 *   has not expanded it.
 * - `expand()` during a stream keeps the composer open for the rest of that
 *   stream, until it has been idle for `REFOLD_DELAY_MS`.
 * - The stream ending, or the composer moving to another tab, clears the
 *   user's expansion; with streaming false the composer is always full.
 *
 * Provided per composer (component providers), so canvas tiles fold
 * independently.
 */
@Injectable()
export class ComposerCompactStore {
  /** Idle time after a user expansion before the composer folds again. */
  static readonly REFOLD_DELAY_MS = 1500;
  /**
   * How long the full composer stays clipped after it opens: just past its
   * 220 ms height animation. Clipping is what lets the row grow from zero,
   * but at rest it would cut off the slash / @ suggestions that open above
   * the textarea. Under reduced motion there is no animation, so the clip
   * is released at once.
   */
  static readonly UNCLIP_DELAY_MS = 240;

  private readonly sources = signal<ComposerCompactSources | null>(null);
  private readonly userExpanded = signal(false);
  private readonly settled = signal(true);
  /** The user prefers reduced motion; the fold then switches instantly. */
  private readonly reducedMotion = signal(false);

  /** Nothing in the composer needs it to stay open. */
  readonly idle = computed(() => {
    const s = this.sources();
    if (!s) return false;
    return (
      !s.hasContent() && !s.focused() && !s.overlayOpen() && !s.dragging()
    );
  });

  private readonly streaming = computed(
    () => this.sources()?.streaming() ?? false,
  );

  /** True while the composer shows the compact bar instead of the card. */
  readonly compact = computed(
    () => this.streaming() && this.idle() && !this.userExpanded(),
  );

  /** The full composer is open and done animating; it may overflow. */
  readonly unclipped = computed(
    () => !this.compact() && (this.settled() || this.reducedMotion()),
  );

  constructor() {
    this.watchReducedMotion();
    // A stream ending or a tab change resets the user's expansion.
    effect(() => {
      if (!this.streaming()) untracked(() => this.userExpanded.set(false));
    });
    let lastScope: string | null | undefined;
    effect(() => {
      const scope = this.sources()?.scope() ?? null;
      if (lastScope !== undefined && scope !== lastScope) {
        untracked(() => this.userExpanded.set(false));
      }
      lastScope = scope;
    });
    // An expanded composer that sits idle for the delay folds again. Any
    // change of the inputs restarts or cancels the timer through cleanup.
    effect((onCleanup) => {
      if (!this.streaming() || !this.userExpanded() || !this.idle()) return;
      const timer = setTimeout(
        () => this.userExpanded.set(false),
        ComposerCompactStore.REFOLD_DELAY_MS,
      );
      onCleanup(() => clearTimeout(timer));
    });
    effect((onCleanup) => {
      if (this.compact()) {
        untracked(() => this.settled.set(false));
        return;
      }
      if (untracked(this.settled)) return;
      const timer = setTimeout(
        () => this.settled.set(true),
        ComposerCompactStore.UNCLIP_DELAY_MS,
      );
      onCleanup(() => clearTimeout(timer));
    });
  }

  private watchReducedMotion(): void {
    const media = inject(DOCUMENT).defaultView?.matchMedia?.(
      REDUCED_MOTION_QUERY,
    );
    if (!media) return;
    this.reducedMotion.set(media.matches);
    const onChange = (event: MediaQueryListEvent): void =>
      this.reducedMotion.set(event.matches);
    media.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() =>
      media.removeEventListener('change', onChange),
    );
  }

  /** Wire the composer's signals. Call once, from the owning component. */
  connect(sources: ComposerCompactSources): void {
    this.sources.set(sources);
  }

  /** User asked for the full composer (bar click, typing, paste, drag). */
  expand(): void {
    if (this.streaming()) this.userExpanded.set(true);
  }
}
