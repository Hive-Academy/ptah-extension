import {
  afterNextRender,
  Directive,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  OnChanges,
  Renderer2,
  SimpleChanges,
  type AfterRenderRef,
} from '@angular/core';

export type MotionDirection = 'forward' | 'back';

export interface MotionStageState {
  readonly index: number | null;
  readonly direction: MotionDirection;
}

@Directive({
  selector: '[ptahMotionStage]',
  standalone: true,
  exportAs: 'ptahMotionStage',
  host: { class: 'ptah-motion-stage' },
})
export class MotionStageDirective implements OnChanges {
  readonly motionIndex = input<number | null>(null);
  readonly motionReplayKey = input<unknown>(undefined);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);
  private readonly injector = inject(Injector);
  private state: MotionStageState = { index: null, direction: 'forward' };
  private renderRef: AfterRenderRef | null = null;
  private replayCleanup: (() => void) | null = null;

  constructor() {
    this.renderer.setAttribute(this.host, 'data-motion-dir', 'forward');
    inject(DestroyRef).onDestroy(() => this.clearReplay());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['motionIndex']) this.setIndex(this.motionIndex());
    if (changes['motionReplayKey'] && !changes['motionReplayKey'].firstChange) {
      this.replay();
    }
  }

  setIndex(index: number | null): void {
    const previous = this.state.index;
    const direction = previous === null || index === null || index === previous
      ? this.state.direction
      : index > previous ? 'forward' : 'back';
    this.state = { index, direction };
    this.renderer.setAttribute(this.host, 'data-motion-dir', direction);
  }

  captureState(): MotionStageState {
    return { ...this.state };
  }

  restoreState(state: MotionStageState): void {
    this.state = { ...state };
    this.renderer.setAttribute(this.host, 'data-motion-dir', state.direction);
  }

  replay(): void {
    this.clearReplay();
    if (this.host.ownerDocument.documentElement.classList.contains('ptah-vt-active')) return;
    this.renderRef = afterNextRender({ write: () => {
      if (this.host.ownerDocument.documentElement.classList.contains('ptah-vt-active')) return;
      const target = this.host.querySelector<HTMLElement>(':scope > .ptah-motion-panel:not([data-motion-clone])');
      if (!target) return;
      let frame = 0;
      const cleanup = () => {
        this.renderer.removeClass(target, 'ptah-motion-enter');
        target.removeEventListener('animationend', onAnimation);
        target.removeEventListener('animationcancel', onAnimation);
        if (frame) cancelAnimationFrame(frame);
        this.replayCleanup = null;
      };
      const onAnimation = (event: AnimationEvent) => {
        if (event.target === target && event.animationName === 'ptahMotionEnter') cleanup();
      };
      this.replayCleanup = cleanup;
      this.renderer.removeClass(target, 'ptah-motion-enter');
      void target.offsetWidth;
      this.renderer.addClass(target, 'ptah-motion-enter');
      target.addEventListener('animationend', onAnimation);
      target.addEventListener('animationcancel', onAnimation);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const animations = target.getAnimations?.() ?? [];
        const running = animations.some((animation) =>
          'animationName' in animation && animation.animationName === 'ptahMotionEnter' &&
          animation.playState === 'running',
        );
        if (!running) cleanup();
      });
    } }, { injector: this.injector });
  }

  private clearReplay(): void {
    this.renderRef?.destroy();
    this.renderRef = null;
    this.replayCleanup?.();
  }
}
