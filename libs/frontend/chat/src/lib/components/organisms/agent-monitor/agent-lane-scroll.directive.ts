import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
} from '@angular/core';

/** Each lane follows its own content until its reader scrolls away from the end. */
@Directive({
  selector: '[ptahAgentLaneScroll]',
  standalone: true,
  host: { '(scroll)': 'onScroll()' },
})
export class AgentLaneScrollDirective {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private pinned = true;

  constructor() {
    afterNextRender(() => {
      const container = this.element.nativeElement;
      const content = container.firstElementChild;
      if (!content || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
        if (this.pinned) container.scrollTop = container.scrollHeight;
      });
      observer.observe(content);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  onScroll(): void {
    const el = this.element.nativeElement;
    this.pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }
}
