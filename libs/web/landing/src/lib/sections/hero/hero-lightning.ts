import { BoltPoint, generateBoltPath, paintBolt } from '../../shared/lightning-bolt';

// Re-exported for existing importers; the implementation lives in the shared util.
export { generateBoltPath };
export type { BoltPoint };

const ARC_DURATION = 360;
const FLICKER_INTERVAL = 95;
const REVERSE_PAUSE = 110;

export class HeroLightning {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly observer?: ResizeObserver;
  private timeout?: number;
  private frame?: number;
  private running = false;
  private pairIndex = 0;
  private direction = 1;
  private arcStart?: number;
  private shapeAt = -1;
  private path: BoltPoint[] = [];
  private pixelRatio = 1;

  constructor(
    private readonly view: Window,
    private readonly artifacts: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly symbols: HTMLElement[],
  ) {
    this.context = canvas.getContext('2d');
    if (!this.context || symbols.length < 2) return;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(artifacts);
    }
  }

  start(): void {
    if (this.running || !this.context || this.symbols.length < 2) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timeout !== undefined) this.view.clearTimeout(this.timeout);
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.timeout = undefined;
    this.frame = undefined;
    this.arcStart = undefined;
    this.direction = 1;
    this.clear();
    this.symbols.forEach((symbol) => symbol.classList.remove('lightning-lit'));
  }

  destroy(): void {
    this.stop();
    this.observer?.disconnect();
  }

  private scheduleNext(): void {
    this.timeout = this.view.setTimeout(() => this.beginArc(), 3000 + Math.random() * 3000);
  }

  private beginArc(): void {
    if (!this.running) return;
    this.timeout = undefined;
    this.resize();
    this.arcStart = undefined;
    this.shapeAt = -1;
    const first = this.symbols[this.pairIndex];
    const second = this.symbols[this.partnerIndex()];
    first.classList.add('lightning-lit');
    second.classList.add('lightning-lit');
    this.frame = this.view.requestAnimationFrame(this.draw);
  }

  // Symbols run clockwise from top-left, so the opposite symbol is half the ring away (crossways arcs).
  private partnerIndex(): number {
    return (this.pairIndex + Math.floor(this.symbols.length / 2)) % this.symbols.length;
  }

  private readonly draw = (time: number): void => {
    this.frame = undefined;
    if (!this.running || !this.context) return;
    this.arcStart ??= time;
    const elapsed = time - this.arcStart;
    if (elapsed >= ARC_DURATION) {
      this.clear();
      this.symbols.forEach((symbol) => symbol.classList.remove('lightning-lit'));
      if (this.direction === 1) {
        this.direction = -1;
        this.timeout = this.view.setTimeout(() => this.beginArc(), REVERSE_PAUSE);
      } else {
        this.direction = 1;
        this.pairIndex = (this.pairIndex + 1) % Math.ceil(this.symbols.length / 2);
        this.scheduleNext();
      }
      return;
    }

    const shape = Math.floor(elapsed / FLICKER_INTERVAL);
    if (shape !== this.shapeAt) {
      this.shapeAt = shape;
      this.path = generateBoltPath({ x: 0, y: 0 }, { x: 1, y: 0 });
    }
    const fromIndex = this.direction === 1 ? this.pairIndex : this.partnerIndex();
    const toIndex = this.direction === 1 ? this.partnerIndex() : this.pairIndex;
    const box = this.artifacts.getBoundingClientRect();
    const from = this.center(this.symbols[fromIndex], box);
    const to = this.center(this.symbols[toIndex], box);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const fade = Math.min(1, (ARC_DURATION - elapsed) / 110);
    this.clear();
    if (distance > 0) this.paint(from, to, fade);
    this.frame = this.view.requestAnimationFrame(this.draw);
  };

  private paint(from: BoltPoint, to: BoltPoint, fade: number): void {
    if (!this.context) return;
    paintBolt(this.context, this.path, from, to, fade);
  }

  private center(symbol: HTMLElement, box: DOMRect): BoltPoint {
    const rect = symbol.getBoundingClientRect();
    return { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 };
  }

  private resize(): void {
    if (!this.context) return;
    const rect = this.artifacts.getBoundingClientRect();
    const ratio = Math.min(this.view.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width === width && this.canvas.height === height && this.pixelRatio === ratio) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.pixelRatio = ratio;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private clear(): void {
    if (!this.context) return;
    this.context.clearRect(0, 0, this.canvas.width / this.pixelRatio, this.canvas.height / this.pixelRatio);
  }
}
