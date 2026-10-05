import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  NgZone,
} from '@angular/core';

/** Each lane follows its own content until its reader scrolls away from the end. */
@Directive({
  selector: '[ptahAgentLaneScroll]',
  standalone: true,
})
export class AgentLaneScrollDirective {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private pinned = true;
  private measureFrame: number | null = null;
  private readonly scrollHandler = (): void => this.onScroll();

  constructor() {
    const container = this.element.nativeElement;
    this.ngZone.runOutsideAngular(() => {
      container.addEventListener('scroll', this.scrollHandler, { passive: true });
    });
    this.destroyRef.onDestroy(() =>
      container.removeEventListener('scroll', this.scrollHandler),
    );
    afterNextRender(() => {
      const content = container.firstElementChild;
      if (!content || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
        if (this.pinned) container.scrollTop = container.scrollHeight;
      });
      observer.observe(content);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    this.destroyRef.onDestroy(() => this.cancelMeasure());
  }

  /**
   * Recompute the pin state in the next animation frame instead of reading
   * `scrollHeight`/`scrollTop`/`clientHeight` synchronously in the scroll
   * handler. While a turn streams, the document is usually layout-dirty, so a
   * synchronous read forces a full layout on every scroll event; coalescing
   * into one read per frame pays that cost at most once. The ResizeObserver
   * above still follows within the frame the content grows.
   */
  onScroll(): void {
    if (this.measureFrame !== null) return;
    this.measureFrame = requestAnimationFrame(() => {
      this.measureFrame = null;
      const el = this.element.nativeElement;
      this.pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    });
  }

  private cancelMeasure(): void {
    if (this.measureFrame === null) return;
    cancelAnimationFrame(this.measureFrame);
    this.measureFrame = null;
  }
}
