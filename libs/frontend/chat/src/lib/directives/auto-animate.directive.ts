import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import autoAnimate, {
  type AnimationController,
  type AutoAnimateOptions,
} from '@formkit/auto-animate';

/**
 * Standalone wrapper for @formkit/auto-animate.
 *
 * The upstream `@formkit/auto-animate/angular` package ships its directive
 * inside a non-standalone NgModule (`AutoAnimateModule`), which Angular's
 * strict standalone-imports check rejects. This thin wrapper re-exposes the
 * same `[auto-animate]` selector as a standalone directive so chat
 * components can import it directly.
 *
 * Inputs:
 * - `[auto-animate]` (alias of `options`): partial AutoAnimateOptions or '' (no opts)
 * - `[autoAnimateDisabled]`: when truthy, skips initialization entirely so the
 *   DOM updates without FLIP transforms. Useful while another animation system
 *   is driving layout (e.g., during streaming).
 *
 * Reduced motion:
 * - Honors `prefers-reduced-motion: reduce` explicitly. VS Code webviews do
 *   not always propagate the OS-level preference reliably, so we check the
 *   media query at init and react to runtime changes via the `change` event.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '[auto-animate]',
  standalone: true,
})
export class AutoAnimateDirective implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);

  /**
   * Options forwarded to autoAnimate(). Empty string == no options.
   * Aliased to the directive selector `[auto-animate]` so usage stays
   * `<div [auto-animate]>` or `<div [auto-animate]="opts">`. The alias is
   * intentional and matches the upstream FormKit directive's surface.
   */
  readonly options = input<Partial<AutoAnimateOptions> | '' | undefined>(
    undefined,
    { alias: 'auto-animate' },
  );

  /** When true, do not initialize auto-animate (DOM updates without FLIP). */
  readonly autoAnimateDisabled = input<boolean | undefined>(undefined);

  private controller?: AnimationController;
  private viewInited = false;

  /** Reactive flag: true when user/OS requests reduced motion. */
  private readonly reducedMotion = signal(false);
  private mediaQuery?: MediaQueryList;
  private mediaListener?: (e: MediaQueryListEvent) => void;

  /** True when we should run animations (not reduced, not disabled). */
  private readonly shouldAnimate = computed(
    () => !this.reducedMotion() && !this.autoAnimateDisabled(),
  );

  constructor() {
    // Initialize / tear down based on the combined gate. Runs after view-init
    // (the `viewInited` guard prevents premature init on the very first read).
    effect(() => {
      const animate = this.shouldAnimate();
      if (!this.viewInited) return;
      if (animate) {
        this.ensureController();
      } else {
        this.destroyController();
      }
    });
  }

  ngAfterViewInit(): void {
    // Detect prefers-reduced-motion. Window.matchMedia is available in webviews.
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion.set(this.mediaQuery.matches);
      this.mediaListener = (e: MediaQueryListEvent) => {
        this.reducedMotion.set(e.matches);
      };
      this.mediaQuery.addEventListener('change', this.mediaListener);
    }

    this.viewInited = true;

    if (this.shouldAnimate()) {
      this.ensureController();
    }
  }

  ngOnDestroy(): void {
    this.destroyController();
    if (this.mediaQuery && this.mediaListener) {
      this.mediaQuery.removeEventListener('change', this.mediaListener);
    }
    this.mediaQuery = undefined;
    this.mediaListener = undefined;
  }

  private ensureController(): void {
    if (this.controller) return;
    const raw = this.options();
    const opts = raw && typeof raw === 'object' ? raw : {};
    this.controller = autoAnimate(this.el.nativeElement, opts);
  }

  private destroyController(): void {
    this.controller?.destroy?.();
    this.controller = undefined;
  }
}
