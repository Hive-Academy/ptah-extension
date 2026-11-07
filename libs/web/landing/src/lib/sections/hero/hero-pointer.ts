import type { BoltPoint } from '../../shared/lightning/lightning-renderer';

/** Only a mouse that can hover pulls the bolt; touch and no-hover devices never do. */
export const FINE_POINTER = '(hover: hover) and (pointer: fine)';

/**
 * Tracks a hovering mouse over the hero with passive listeners. It keeps only
 * the last client position, so reading it costs nothing per move; the bolt
 * converts it into canvas coordinates when it draws.
 */
export class HeroPointer {
  private client?: BoltPoint;
  private readonly enabled: boolean;

  public constructor(
    view: Window,
    private readonly host: HTMLElement,
  ) {
    this.enabled = view.matchMedia?.(FINE_POINTER).matches ?? false;
    if (!this.enabled) return;
    host.addEventListener('pointermove', this.onMove, { passive: true });
    host.addEventListener('pointerleave', this.onLeave, { passive: true });
  }

  /**
   * Writes the pointer relative to `box` (CSS px) into `out`, so a frame loop
   * allocates nothing. False, with `out` untouched, when it is not over the hero.
   */
  public positionInto(box: DOMRect, out: { x: number; y: number }): boolean {
    if (!this.client) return false;
    out.x = this.client.x - box.left;
    out.y = this.client.y - box.top;
    return true;
  }

  public destroy(): void {
    this.client = undefined;
    if (!this.enabled) return;
    this.host.removeEventListener('pointermove', this.onMove);
    this.host.removeEventListener('pointerleave', this.onLeave);
  }

  private readonly onMove = (event: PointerEvent): void => {
    this.client = event.pointerType === 'mouse' ? { x: event.clientX, y: event.clientY } : undefined;
  };

  private readonly onLeave = (): void => {
    this.client = undefined;
  };
}
