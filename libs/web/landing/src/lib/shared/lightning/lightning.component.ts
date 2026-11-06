import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LightningRenderer } from './lightning-renderer';
import { StrikeLoop } from './strike-loop';

export { STILL_LEVEL } from './strike-loop';

/** Core half-width and halo decay, CSS pixels: a thin, crisp line. */
export const BOLT_CORE_PX = 0.6;
export const BOLT_GLOW_PX = 4;

/**
 * Local stand-in for NGXUI's `<om-lightning>` (`@omnedia/ngx-lightning`): one
 * jagged WebGL bolt, drawn as a thin crisp line. Periodic (see `StrikeLoop`):
 * short strikes with one flicker, separated by dark idle gaps of a few
 * seconds from a seeded schedule; nothing is drawn and no frame runs between
 * strikes, off screen, in a hidden tab or at zero `intensity`. Reduced
 * motion and save-data draw one faint still frame. Without WebGL a faint
 * static CSS line stands in. The GL context is released on destroy. Size the
 * host (it fills it). Decorative.
 *
 * Additions over the package: `seed` (pick a different one per bolt so they
 * do not strike together) and `strike` (each new value fires one extra brief
 * strike now, so scroll steps can mark themselves).
 */
@Component({
  selector: 'ptah-lightning',
  standalone: true,
  template: `
    <canvas #canvas class="bolt-canvas" [class]="styleClass()" aria-hidden="true"></canvas>
    @if (fallback()) {
      <span class="bolt-fallback" [style.opacity]="intensity()" aria-hidden="true"></span>
    }
  `,
  styles: [
    `
      :host {
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }

      .bolt-canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      /* Static stand-in: a faint 1px line, no bloom. */
      .bolt-fallback {
        position: absolute;
        inset: 0 auto 0 50%;
        width: 1px;
        transform: translateX(-50%);
        background: linear-gradient(
          180deg,
          transparent,
          rgb(255 187 77 / 35%) 25%,
          rgb(255 249 235 / 45%) 50%,
          rgb(255 187 77 / 35%) 75%,
          transparent
        );
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LightningComponent {
  public readonly hue = input(230);
  public readonly xOffset = input(0);
  public readonly speed = input(1);
  public readonly intensity = input(1);
  public readonly size = input(1);
  public readonly transparent = input(false);
  public readonly styleClass = input('');
  /** Seeds the strike schedule; equal seeds strike at equal times. */
  public readonly seed = input(1);
  /** Change the value to fire one brief extra strike now. */
  public readonly strike = input(0);

  /** True on the server and when WebGL is unavailable. */
  public readonly fallback = signal(true);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private renderer?: LightningRenderer;
  private loop?: StrikeLoop;
  private lastStrike?: number;

  public constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => this.initialize());
    effect(() => {
      const on = this.intensity() > 0.01;
      untracked(() => {
        this.loop?.setActive(on);
        this.loop?.refresh();
      });
    });
    effect(() => {
      const strike = this.strike();
      untracked(() => {
        const first = this.lastStrike === undefined;
        this.lastStrike = strike;
        if (!first) this.loop?.strike();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.loop?.destroy();
      this.renderer?.dispose();
      this.loop = undefined;
      this.renderer = undefined;
    });
  }

  /** True while the strike loop has a frame or a gap timer scheduled. */
  public get running(): boolean {
    return this.loop?.running ?? false;
  }

  private initialize(): void {
    const view = this.document.defaultView;
    if (!view || typeof view.WebGLRenderingContext === 'undefined') return;
    const renderer = LightningRenderer.create(this.canvas().nativeElement);
    if (!renderer) return;
    this.renderer = renderer;
    this.fallback.set(false);
    this.loop = new StrikeLoop(
      view,
      {
        draw: (level, elapsedMs) =>
          renderer.draw(elapsedMs / 1000, {
            hue: this.hue(),
            xOffset: this.xOffset(),
            speed: this.speed(),
            intensity: this.intensity() * level,
            size: this.size(),
            transparent: this.transparent(),
            core: BOLT_CORE_PX,
            glow: BOLT_GLOW_PX,
          }),
        clear: () => renderer.clear(),
      },
      this.host.nativeElement,
      this.seed(),
    );
    this.loop.setActive(this.intensity() > 0.01);
  }
}
