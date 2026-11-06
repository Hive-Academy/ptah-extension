/**
 * Paint-only rail motion (FLIP). Keys survive Angular moving a card between
 * group views, so a card recreated in another group still slides from where
 * it was. Positions are viewport positions: capture and measure run in one
 * task, so a user scroll cannot fall between them, and a clamped or anchored
 * scroll moves a card on screen exactly as much as the slide shows.
 */
export interface RailFlipSnapshot {
  readonly top: number;
  /** Below 1 while a fade-in was in flight; the new animation resumes it. */
  readonly opacity: number;
}

export interface RailFlipMove {
  readonly element: HTMLElement;
  readonly delta: number;
  readonly fresh: boolean;
  readonly opacity: number;
}

const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
const SLIDE_MS = 240;
const ENTER_MS = 180;

export class CanvasRailFlip {
  private readonly running = new Map<HTMLElement, Animation>();

  constructor(private readonly container: HTMLElement) {}

  /** First: the visual position (and fade) of every rendered card and header. */
  capture(): Map<string, RailFlipSnapshot> {
    const snapshots = new Map<string, RailFlipSnapshot>();
    // All reads first, then the cancels, so one layout serves every read.
    for (const [key, element] of this.elements()) {
      const opacity = this.running.has(element) ? visualOpacity(element) : 1;
      snapshots.set(key, { top: element.getBoundingClientRect().top, opacity });
    }
    this.cancel();
    return snapshots;
  }

  /** Last + Invert: how far each element moved since `first`. */
  measure(first: ReadonlyMap<string, RailFlipSnapshot>): RailFlipMove[] {
    const moves: RailFlipMove[] = [];
    for (const [key, element] of this.elements()) {
      const previous = first.get(key);
      const last = element.getBoundingClientRect().top;
      moves.push({
        element,
        delta: previous ? previous.top - last : 0,
        fresh: !previous,
        opacity: previous ? previous.opacity : 0,
      });
    }
    return moves;
  }

  play(moves: readonly RailFlipMove[]): void {
    if (typeof Element.prototype.animate !== 'function') return;
    for (const { element, delta, fresh, opacity } of moves) {
      const moved = Math.abs(delta) >= 1;
      if (!fresh && !moved && opacity >= 1) continue;
      const offset = fresh ? 4 : moved ? delta : 0;
      const from: Keyframe = { transform: offset ? `translateY(${offset}px)` : 'none' };
      if (opacity < 1) from['opacity'] = opacity;
      const to: Keyframe = { transform: 'none' };
      if (opacity < 1) to['opacity'] = 1;
      this.running.get(element)?.cancel();
      const animation = element.animate([from, to], {
        duration: fresh ? ENTER_MS : SLIDE_MS,
        easing: EASE,
      });
      this.running.set(element, animation);
      animation.onfinish = () => {
        if (this.running.get(element) === animation) this.running.delete(element);
      };
    }
  }

  cancel(): void {
    for (const animation of this.running.values()) animation.cancel();
    this.running.clear();
  }

  private elements(): Array<[string, HTMLElement]> {
    const result: Array<[string, HTMLElement]> = [];
    for (const card of this.container.querySelectorAll<HTMLElement>('[data-rail-card][data-tab-id]')) {
      const id = card.getAttribute('data-tab-id');
      if (id && isRendered(card)) result.push([`card:${id}`, card]);
    }
    for (const group of this.container.querySelectorAll<HTMLElement>('[data-rail-group]')) {
      const key = group.getAttribute('data-rail-group');
      // Only the section's own header; a collapsed rail has none, and a
      // nested card button must never get a second transform.
      const header = group.querySelector<HTMLElement>(':scope > h2, :scope > button');
      if (key && header && isRendered(header)) result.push([`group:${key}`, header]);
    }
    return result;
  }
}

/**
 * A card in the folded "finished" list (display: none) has a zero rect.
 * Skip it, so it fades in when the list opens instead of sliding from the top.
 */
function isRendered(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/** The in-flight opacity; 0 (a fade that just started) is a real value. */
export function visualOpacity(element: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(element).opacity);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;
}
