import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';

/** Decorative, theme-aware CSS Aurora for the board hero or single-chat brand. */
@Component({
  selector: 'ptah-aurora-effect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[class.brand]': "variant() === 'brand'",
    '[class.paused]': '!visible() || !inView() || !pageVisible() || reducedMotion()',
  },
  template: '<span class="lights"></span>',
  styles: [`
    :host {
      display: block;
      position: absolute;
      inset: 0 0 auto;
      height: 570px;
      overflow: hidden;
      pointer-events: none;
      z-index: 0;
      /* DaisyUI 4 exposes secondary and base-100 as OKLCH channel tokens. */
      --aurora-base: oklch(var(--b1));
      --aurora-gold: oklch(var(--s));
      --aurora-stripe: repeating-linear-gradient(100deg,
        color-mix(in oklch, var(--aurora-base) 94%, var(--aurora-gold)) 0% 7%,
        transparent 10% 12%,
        color-mix(in oklch, var(--aurora-base) 94%, var(--aurora-gold)) 16%);
      --aurora-colors: repeating-linear-gradient(100deg,
        var(--aurora-gold) 10%,
        color-mix(in oklch, var(--aurora-gold) 70%, var(--aurora-base)) 15%,
        color-mix(in oklch, var(--aurora-gold) 86%, var(--aurora-base)) 20%,
        color-mix(in oklch, var(--aurora-gold) 62%, var(--aurora-base)) 25%,
        var(--aurora-gold) 30%);
    }
    :host(.brand) { height: 100%; z-index: -1; }
    .lights {
      position: absolute;
      inset: -10px;
      opacity: .24;
      background-image: var(--aurora-stripe), var(--aurora-colors);
      background-size: 300%, 200%;
      background-position: 50% 50%;
      mask-image: radial-gradient(ellipse at 100% 0, #000 10%, transparent 70%);
      -webkit-mask-image: radial-gradient(ellipse at 100% 0, #000 10%, transparent 70%);
    }
    .lights::after {
      content: '';
      position: absolute;
      inset: 0 -25%;
      background-image: var(--aurora-stripe), var(--aurora-colors);
      background-size: 200%, 100%;
      /* Blend and blur are fixed on this layer; only its transform moves. */
      filter: blur(10px);
      mix-blend-mode: screen;
      animation: aurora-shift 60s linear infinite;
      animation-play-state: running;
    }
    :host-context([data-theme='anubis-light']) .lights { opacity: .33; }
    :host(.brand) .lights {
      opacity: .14;
      mask-image: radial-gradient(ellipse at 50% 0, #000 5%, transparent 68%);
      -webkit-mask-image: radial-gradient(ellipse at 50% 0, #000 5%, transparent 68%);
    }
    :host(.paused) .lights::after { animation-play-state: paused; }
    @media (prefers-reduced-motion: reduce) {
      .lights::after { animation: none; }
    }
    @keyframes aurora-shift {
      from { transform: translateX(-25%); }
      to { transform: translateX(25%); }
    }
  `],
})
export class AuroraEffectComponent {
  readonly variant = input<'board' | 'brand'>('board');
  readonly visible = input(true);

  protected readonly inView = signal(true);
  protected readonly pageVisible = signal(true);
  protected readonly reducedMotion = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onMotionChange = () => this.reducedMotion.set(media.matches);
      const onVisibilityChange = () => this.pageVisible.set(!document.hidden);
      onMotionChange();
      onVisibilityChange();
      media.addEventListener('change', onMotionChange);
      document.addEventListener('visibilitychange', onVisibilityChange);

      const observer = typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => this.inView.set(entry.isIntersecting));
      observer?.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => {
        observer?.disconnect();
        media.removeEventListener('change', onMotionChange);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      });
    });
  }
}
