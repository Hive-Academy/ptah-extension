import {
  Injectable,
  DestroyRef,
  inject,
  signal,
  effect,
  afterRenderEffect,
} from '@angular/core';
import { SURFACE_ACTIVE } from '@ptah-extension/core';

/** Position contract for canvas tiles. */
export interface TileLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

@Injectable()
export class CanvasLayoutService {
  private readonly destroyRef = inject(DestroyRef);
  readonly active = inject(SURFACE_ACTIVE);
  private wasActive = this.active();
  private element: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private frameGeneration = 0;

  private readonly _containerWidth = signal(0);
  readonly containerWidth = this._containerWidth.asReadonly();

  constructor() {
    effect(() => {
      if (!this.active()) this.cancelFrame();
    });
    afterRenderEffect(() => {
      const active = this.active();
      if (active && !this.wasActive && this.element && this.resizeObserver) {
        // Request fresh content-box geometry after the surface becomes visible.
        this.resizeObserver.disconnect();
        this.resizeObserver.observe(this.element);
      }
      this.wasActive = active;
    });
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  observe(element: HTMLElement): void {
    this.disconnect();
    this.element = element;
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!this.active() || !entry || entry.contentRect.width <= 0) return;
      this.cancelFrame();
      const generation = this.frameGeneration;
      this.rafId = requestAnimationFrame(() => {
        if (generation !== this.frameGeneration) return;
        if (this.active()) {
          this._containerWidth.set(Math.floor(entry.contentRect.width));
        }
        this.rafId = null;
      });
    });
    this.resizeObserver.observe(element);
  }

  private cancelFrame(): void {
    this.frameGeneration++;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private disconnect(): void {
    this.cancelFrame();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element = null;
  }
}
