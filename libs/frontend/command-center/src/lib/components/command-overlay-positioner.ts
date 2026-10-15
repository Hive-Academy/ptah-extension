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
    this.observer = new MutationObserver(() => this.schedule());
    for (const label of this.labels().filter(
      (item) => item.id === this.activeId(),
    ))
      this.observer.observe(label.element, {
        attributes: true,
        attributeFilter: ['style'],
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
    const key = `${id}:${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
    if (anchor === this.lastAnchor && key === this.lastRect) return;
    this.lastAnchor = anchor;
    this.lastRect = key;
    void this.floating
      .position(anchor, card, { offset: 8, flip: true, shift: true })
      .then(() => {
        if (this.activeId() === id && this.lastAnchor === anchor)
          this.rebuildBridge(anchor, card);
      });
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
