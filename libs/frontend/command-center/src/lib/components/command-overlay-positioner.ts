import type { FloatingUIService } from '@ptah-extension/ui';
import type { SceneLabel } from '../scene/command-scene-renderer';

/** Keeps transform-only scene writes out of Angular's change detection. */
export class CommandOverlayPositioner {
  private frame = 0;
  private observer: MutationObserver | null = null;
  private lastAnchor: HTMLElement | null = null;
  private lastRect = '';
  private destroyed = false;

  public constructor(
    private readonly floating: FloatingUIService,
    private readonly activeId: () => string | null,
    private readonly labels: () => readonly SceneLabel[],
    private readonly sphereAnchor: () => HTMLElement,
    private readonly card: () => HTMLElement | null,
    private readonly bridge: () => HTMLElement | null,
  ) {}

  public schedule(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.activeId()) return;
      if (!this.observer) this.observe();
      this.position();
    });
  }

  public stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.lastAnchor = null;
    this.lastRect = '';
    this.floating.cleanup();
  }

  public destroy(): void {
    this.destroyed = true;
    this.stop();
  }

  private observe(): void {
    this.observer = new MutationObserver((changes) => {
      if (
        changes.some(
          (change) =>
            change.target instanceof HTMLElement &&
            change.target.dataset['nodeId'],
        )
      ) {
        this.schedule();
      }
    });
    const firstLabel = this.labels()[0]?.element;
    if (firstLabel?.parentElement)
      this.observer.observe(firstLabel.parentElement, {
        attributes: true,
        attributeFilter: ['style'],
        subtree: true,
      });
    this.observer.observe(this.sphereAnchor(), {
      attributes: true,
      attributeFilter: ['style'],
    });
  }

  private position(): void {
    const id = this.activeId();
    const card = this.card();
    if (!id || !card) return;
    const label = this.labels().find((item) => item.id === id)?.element;
    const anchor =
      label && label.style.display !== 'none' ? label : this.sphereAnchor();
    const rect = anchor.getBoundingClientRect();
    const neighbors = this.labels().filter(
      (item) => item.id !== id && item.element.style.display !== 'none',
    );
    const key = `${id}:${rect.left}:${rect.top}:${rect.width}:${rect.height}:${neighbors
      .map((item) => {
        const neighbor = item.element.getBoundingClientRect();
        return `${item.id}:${neighbor.left}:${neighbor.top}`;
      })
      .join('|')}`;
    if (anchor === this.lastAnchor && key === this.lastRect) return;
    this.lastAnchor = anchor;
    this.lastRect = key;
    void this.floating
      .position(anchor, card, { offset: 8, flip: true, shift: true })
      .then(() => {
        if (this.activeId() === id && this.lastAnchor === anchor) {
          this.avoidNeighborPlates(anchor, card, neighbors);
          this.rebuildBridge(anchor, card);
        }
      });
  }

  private avoidNeighborPlates(
    anchor: HTMLElement,
    card: HTMLElement,
    neighbors: readonly SceneLabel[],
  ): void {
    const plates = neighbors.map((item) =>
      item.element.getBoundingClientRect(),
    );
    const cardRect = card.getBoundingClientRect();
    const overlaps = (left: number, top: number): boolean =>
      plates.some(
        (plate) =>
          left < plate.right + 6 &&
          left + cardRect.width + 6 > plate.left &&
          top < plate.bottom + 6 &&
          top + cardRect.height + 6 > plate.top,
      );
    if (!overlaps(cardRect.left, cardRect.top)) {
      card.style.visibility = 'visible';
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const clamp = (value: number, max: number): number =>
      Math.max(8, Math.min(value, Math.max(8, max - 8)));
    const candidates = [
      [rect.right + 8, rect.top],
      [rect.left - cardRect.width - 8, rect.top],
      [rect.left, rect.bottom + 8],
      [rect.left, rect.top - cardRect.height - 8],
    ] as const;
    for (const [x, y] of candidates) {
      const left = clamp(x, window.innerWidth - cardRect.width);
      const top = clamp(y, window.innerHeight - cardRect.height);
      if (overlaps(left, top)) continue;
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      card.style.visibility = 'visible';
      return;
    }
    card.style.visibility = 'hidden';
  }

  private rebuildBridge(anchor: HTMLElement, card: HTMLElement): void {
    const bridge = this.bridge();
    if (!bridge) return;
    const a = anchor.getBoundingClientRect();
    const b = card.getBoundingClientRect();
    bridge.style.left = `${Math.min(a.left, b.left)}px`;
    bridge.style.top = `${Math.min(a.top, b.top)}px`;
    bridge.style.width = `${Math.max(a.right, b.right) - Math.min(a.left, b.left)}px`;
    bridge.style.height = `${Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top)}px`;
    bridge.style.zIndex = '19';
  }
}
