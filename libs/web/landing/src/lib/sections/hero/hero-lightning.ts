export interface BoltPoint { x: number; y: number }

// Normalized points let one flicker shape follow symbols as GSAP moves them.
export function generateBoltPath(
  start: BoltPoint,
  end: BoltPoint,
  random: () => number = Math.random,
): BoltPoint[] {
  let points = [start, end];
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const normal = length ? { x: -(end.y - start.y) / length, y: (end.x - start.x) / length } : { x: 0, y: 0 };
  for (let depth = 0; depth < 4; depth++) {
    const next: BoltPoint[] = [points[0]];
    for (let index = 0; index < points.length - 1; index++) {
      const left = points[index];
      const right = points[index + 1];
      const offset = (random() * 2 - 1) * length * 0.09 / (depth + 1);
      next.push({
        x: (left.x + right.x) / 2 + normal.x * offset,
        y: (left.y + right.y) / 2 + normal.y * offset,
      }, right);
    }
    points = next;
  }
  return points;
}

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
    const second = this.symbols[(this.pairIndex + 1) % this.symbols.length];
    first.classList.add('lightning-lit');
    second.classList.add('lightning-lit');
    this.frame = this.view.requestAnimationFrame(this.draw);
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
        this.pairIndex = (this.pairIndex + 1) % this.symbols.length;
        this.scheduleNext();
      }
      return;
    }

    const shape = Math.floor(elapsed / FLICKER_INTERVAL);
    if (shape !== this.shapeAt) {
      this.shapeAt = shape;
      this.path = generateBoltPath({ x: 0, y: 0 }, { x: 1, y: 0 });
    }
    const fromIndex = this.direction === 1 ? this.pairIndex : (this.pairIndex + 1) % this.symbols.length;
    const toIndex = this.direction === 1 ? (this.pairIndex + 1) % this.symbols.length : this.pairIndex;
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
    const context = this.context;
    if (!context) return;
    const along = { x: to.x - from.x, y: to.y - from.y };
    const across = { x: -along.y, y: along.x };
    const map = (point: BoltPoint): BoltPoint => ({
      x: from.x + point.x * along.x + point.y * across.x,
      y: from.y + point.x * along.y + point.y * across.y,
    });
    const stroke = (points: BoltPoint[], width: number, color: string, alpha: number, blur: number): void => {
      context.beginPath();
      points.forEach((point, index) => {
        const mapped = map(point);
        if (index === 0) context.moveTo(mapped.x, mapped.y);
        else context.lineTo(mapped.x, mapped.y);
      });
      context.lineWidth = width;
      context.strokeStyle = color;
      context.globalAlpha = alpha * fade;
      context.shadowColor = color;
      context.shadowBlur = blur;
      context.stroke();
    };
    context.lineCap = 'round';
    context.lineJoin = 'round';
    stroke(this.path, 8, '#f5a524', 0.16, 20);
    stroke(this.path, 2.8, '#ffbb4d', 0.7, 9);
    stroke(this.path, 1, '#fff9eb', 0.88, 2);
    for (const index of [5, 11]) {
      const root = this.path[index];
      if (!root) continue;
      const tip = { x: root.x + 0.035, y: root.y + (index === 5 ? 0.055 : -0.05) };
      stroke([root, { x: (root.x + tip.x) / 2, y: tip.y * 0.65 + root.y * 0.35 }, tip], 1, '#ffbb4d', 0.35, 7);
    }
    context.globalAlpha = 1;
    context.shadowBlur = 0;
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
