import {
  type BoltPoint,
  type LightningBolt,
  LightningRenderer,
} from '../../shared/lightning/lightning-renderer';
import {
  STRIKE,
  STRIKE_TOTAL_MS,
  shimmerStep,
  strikeGap,
  strikeLook,
} from '../../shared/lightning/strike-envelope';
import { HeroPointer } from './hero-pointer';

const LIT = 'lightning-lit';
const MAX_PIXEL_RATIO = 2;
/** The mouse bolt jags differently from the icon bolt drawn beside it. */
const POINTER_SEED_OFFSET = 31;

/**
 * The hero's WebGL lightning between the floating symbols: the page's only
 * WebGL context. Each strike joins a pair of opposite symbols (cycling pairs)
 * and, while a mouse hovers the hero, also joins the symbol nearest the mouse
 * to the mouse itself, following it live. Frames run only while a strike is
 * visible; a dark gap sleeps on one timer. The host decides when it runs
 * (`start` / `stop`). Without WebGL it draws nothing. If the context is lost
 * it stops drawing and resumes once the browser restores it.
 */
export class HeroLightning {
  private renderer?: LightningRenderer;
  private readonly pointer?: HeroPointer;
  private readonly observer?: ResizeObserver;
  private running = false;
  private timeout?: number;
  private frame?: number;
  private strikeStart?: number;
  private seed = 0;
  private pairIndex = 0;

  public constructor(
    private readonly view: Window,
    private readonly artifacts: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly symbols: HTMLElement[],
    pointerHost: HTMLElement,
  ) {
    if (symbols.length < 2) return;
    this.renderer = LightningRenderer.create(canvas);
    if (!this.renderer) return;
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.pointer = new HeroPointer(view, pointerHost);
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(artifacts);
    }
  }

  public start(): void {
    if (this.running || !this.renderer) return;
    this.running = true;
    this.schedule(STRIKE.firstDelayMs);
  }

  public stop(): void {
    this.running = false;
    this.halt();
    this.renderer?.clear();
  }

  public destroy(): void {
    this.stop();
    this.observer?.disconnect();
    this.pointer?.destroy();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer?.dispose();
    this.renderer = undefined;
  }

  /** Cancels the pending timer or frame and unlights the symbols. */
  private halt(): void {
    if (this.timeout !== undefined) this.view.clearTimeout(this.timeout);
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.timeout = undefined;
    this.frame = undefined;
    this.strikeStart = undefined;
    this.light(new Set());
  }

  private schedule(delay: number): void {
    this.timeout = this.view.setTimeout(this.beginStrike, delay);
  }

  private readonly beginStrike = (): void => {
    this.timeout = undefined;
    if (!this.running || !this.renderer) return;
    this.strikeStart = undefined;
    // A new jag shape for every strike.
    this.seed = Math.floor(Math.random() * 997);
    this.frame = this.view.requestAnimationFrame(this.draw);
  };

  private readonly draw = (time: number): void => {
    this.frame = undefined;
    const renderer = this.renderer;
    if (!this.running || !renderer) return;
    this.strikeStart ??= time;
    const elapsed = time - this.strikeStart;
    if (elapsed >= STRIKE_TOTAL_MS) {
      this.halt();
      renderer.clear();
      this.pairIndex = (this.pairIndex + 1) % Math.ceil(this.symbols.length / 2);
      this.schedule(strikeGap(Math.random));
      return;
    }
    const look = strikeLook(elapsed, this.seed);
    const box = this.artifacts.getBoundingClientRect();
    const centers = this.symbols.map((symbol) => center(symbol, box));
    const lit = new Set([this.pairIndex, this.partnerIndex()]);
    const bolts: LightningBolt[] = [
      { ...look, from: centers[this.pairIndex], to: centers[this.partnerIndex()], seed: this.seed },
    ];
    const mouse = this.pointer?.position(box);
    if (mouse) {
      const nearest = nearestIndex(centers, mouse);
      lit.add(nearest);
      bolts.push({ ...look, from: centers[nearest], to: mouse, seed: this.seed + POINTER_SEED_OFFSET });
    }
    this.light(lit);
    renderer.draw(bolts, shimmerStep(elapsed));
    this.frame = this.view.requestAnimationFrame(this.draw);
  };

  // Symbols run clockwise from top-left, so the opposite symbol is half the ring away (crossways arcs).
  private partnerIndex(): number {
    return (this.pairIndex + Math.floor(this.symbols.length / 2)) % this.symbols.length;
  }

  private light(lit: ReadonlySet<number>): void {
    this.symbols.forEach((symbol, index) => symbol.classList.toggle(LIT, lit.has(index)));
  }

  private resize(): void {
    const rect = this.artifacts.getBoundingClientRect();
    const ratio = Math.min(this.view.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.renderer?.resize(rect.width, rect.height, ratio);
  }

  private readonly onContextLost = (event: Event): void => {
    // Default prevented: the browser may restore the context later.
    event.preventDefault();
    this.halt();
    this.renderer = undefined;
  };

  private readonly onContextRestored = (): void => {
    this.renderer = LightningRenderer.create(this.canvas);
    this.resize();
    if (!this.running || !this.renderer) return;
    this.schedule(STRIKE.firstDelayMs);
  };
}

function center(symbol: HTMLElement, box: DOMRect): BoltPoint {
  const rect = symbol.getBoundingClientRect();
  return { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 };
}

function nearestIndex(points: readonly BoltPoint[], target: BoltPoint): number {
  let best = 0;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}
