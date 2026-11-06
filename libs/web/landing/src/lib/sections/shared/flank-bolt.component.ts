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
  untracked,
  viewChild,
} from '@angular/core';
import { BoltPoint, generateBoltPath, paintBolt, seededRandom } from '../../shared/lightning-bolt';
import { StrikeLoop } from '../../shared/lightning/strike-loop';

/** Inset from the canvas ends, CSS px, so round caps never clip. */
const END_INSET = 6;
/** The sideways jag may use this share of the gutter's width. */
const GUTTER_SHARE = 0.3;
/** Widest sideways jag of `generateBoltPath`, as a share of its length. */
const MAX_JAG = 0.19;

/**
 * A thin canvas bolt that flanks a section's clip: along one of its edges or
 * in the gutter beside it, never over the picture or the copy. It shares the
 * page's periodic timing (`StrikeLoop`: brief strikes, dark seeded gaps,
 * a new jagged path per strike) and its thin three-layer stroke
 * (`paintBolt`). 2D canvas, so it costs no WebGL context. `strike` adds one
 * brief flash per scroll step. Size and place the host; it fills it.
 * Decorative.
 */
@Component({
  selector: 'ptah-flank-bolt',
  standalone: true,
  host: { 'aria-hidden': 'true', '[attr.data-axis]': 'axis()' },
  template: `<canvas #canvas class="flank-canvas"></canvas>`,
  styles: [
    `
      :host {
        display: block;
        pointer-events: none;
      }

      .flank-canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlankBoltComponent {
  /** `vertical` runs top to bottom; `horizontal` runs left to right. */
  public readonly axis = input<'vertical' | 'horizontal'>('vertical');
  public readonly seed = input(1);
  public readonly intensity = input(1);
  /** Change it on every reveal step to fire one brief flash. */
  public readonly strike = input(0);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private loop?: StrikeLoop;
  private path: BoltPoint[] = [];
  private pathFor = -1;
  private lastStrike?: number;
  private resizeObserver?: ResizeObserver;
  private dprQuery?: MediaQueryList;

  public constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => this.initialize());
    effect(() => {
      const strike = this.strike();
      untracked(() => {
        const first = this.lastStrike === undefined;
        this.lastStrike = strike;
        if (!first) this.loop?.strike();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = undefined;
      this.dprQuery?.removeEventListener?.('change', this.onDprChange);
      this.dprQuery = undefined;
      this.loop?.destroy();
      this.loop = undefined;
    });
  }

  /** A new pixel ratio: watch the next one and repaint (the still frame needs it). */
  private readonly onDprChange = (): void => {
    const view = this.document.defaultView;
    if (view) this.watchPixelRatio(view);
    this.loop?.refresh();
  };

  /** Listens for the current device pixel ratio to change (zoom, another screen). */
  private watchPixelRatio(view: Window): void {
    this.dprQuery?.removeEventListener?.('change', this.onDprChange);
    this.dprQuery = view.matchMedia?.(`(resolution: ${view.devicePixelRatio || 1}dppx)`);
    this.dprQuery?.addEventListener?.('change', this.onDprChange);
  }

  /** True while the strike loop has a frame or a gap timer scheduled. */
  public get running(): boolean {
    return this.loop?.running ?? false;
  }

  private initialize(): void {
    const view = this.document.defaultView;
    const context = this.canvas().nativeElement.getContext('2d');
    if (!view || !context) return;
    this.loop = new StrikeLoop(
      view,
      {
        draw: (level, _elapsed, strikeIndex) => this.paint(context, view, level, strikeIndex),
        clear: () => context.clearRect(0, 0, context.canvas.width, context.canvas.height),
      },
      this.host.nativeElement,
      this.seed(),
    );
    // A resize or a pixel-ratio change repaints the current state: the still
    // frame (reduced motion, save-data) is drawn once and would stay stale.
    if (typeof view.ResizeObserver === 'function') {
      this.resizeObserver = new view.ResizeObserver(() => this.loop?.refresh());
      this.resizeObserver.observe(this.host.nativeElement);
    }
    this.watchPixelRatio(view);
  }

  private paint(
    context: CanvasRenderingContext2D,
    view: Window & typeof globalThis,
    level: number,
    strikeIndex: number,
  ): void {
    const canvas = context.canvas;
    const ratio = Math.min(view.devicePixelRatio || 1, 1.5);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 1 || height < 1) return;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    if (strikeIndex !== this.pathFor) {
      this.pathFor = strikeIndex;
      this.path = generateBoltPath(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        seededRandom(this.seed() * 977 + strikeIndex),
      );
    }
    const vertical = this.axis() === 'vertical';
    const length = (vertical ? height : width) - 2 * END_INSET;
    const gutter = vertical ? width : height;
    const spread = Math.min(1, (gutter * GUTTER_SHARE) / (length * MAX_JAG));
    const from = vertical ? { x: width / 2, y: END_INSET } : { x: END_INSET, y: height / 2 };
    const to = vertical
      ? { x: width / 2, y: height - END_INSET }
      : { x: width - END_INSET, y: height / 2 };
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    paintBolt(context, this.path, from, to, Math.min(1, level * this.intensity()), spread);
  }
}
