import {
  Directive,
  ElementRef,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';

/**
 * Arms older-history auto-loading only after the user moves upward, then emits
 * once when this sentinel enters the expanded top edge of the scrollport.
 */
@Directive({
  selector: '[ptahTranscriptOlderHistorySentinel]',
})
export class TranscriptOlderHistorySentinelDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly scrollContainer = input.required<HTMLElement>({
    alias: 'ptahTranscriptOlderHistorySentinel',
  });
  readonly disabled = input(false);
  readonly olderHistoryRequested = output<void>();

  constructor() {
    effect((onCleanup) => {
      const root = this.scrollContainer();
      untracked(() => {
        let armed = false;
        let intersecting = false;
        let lastScrollTop = root.scrollTop;

        const emitWhenReady = (): void => {
          if (
            !armed ||
            !intersecting ||
            this.disabled() ||
            root.scrollHeight <= root.clientHeight
          ) {
            return;
          }
          armed = false;
          this.olderHistoryRequested.emit();
        };

        const onScroll = (): void => {
          const nextScrollTop = root.scrollTop;
          if (nextScrollTop < lastScrollTop && !this.disabled()) armed = true;
          lastScrollTop = nextScrollTop;
          emitWhenReady();
        };

        root.addEventListener('scroll', onScroll, { passive: true });

        let observer: IntersectionObserver | null = null;
        if (typeof IntersectionObserver !== 'undefined') {
          observer = new IntersectionObserver(
            (entries) => {
              intersecting = entries.some(
                (entry) =>
                  entry.target === this.host.nativeElement &&
                  entry.isIntersecting,
              );
              emitWhenReady();
            },
            {
              root,
              rootMargin: `${Math.max(0, root.clientHeight / 2)}px 0px 0px`,
            },
          );
          observer.observe(this.host.nativeElement);
        }

        onCleanup(() => {
          root.removeEventListener('scroll', onScroll);
          observer?.disconnect();
        });
      });
    });
  }
}
