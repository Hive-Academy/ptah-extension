/** The smoothed pointer position the fog leans toward, in drawing-buffer pixels (y up). */
export interface TiltTarget {
  pointerX: number;
  pointerY: number;
}

/**
 * Tracks the pointer for the Lightfall fog tilt without per-frame allocations
 * or layout reads: one passive `pointermove` listener, and the canvas bounds
 * measured once after each resize, scroll or resume (`invalidate()`).
 */
export class PointerTilt {
  private readonly pointer = { x: 0, y: 0, active: false };
  private readonly bounds = { left: 0, bottom: 0, dirty: true };

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: Window,
  ) {}

  public attach(): void {
    this.view.addEventListener('pointermove', this.onPointer, { passive: true });
    this.view.addEventListener('scroll', this.invalidate, { passive: true });
    this.view.document.documentElement.addEventListener('pointerleave', this.onPointerLeave);
  }

  public detach(): void {
    this.view.removeEventListener('pointermove', this.onPointer);
    this.view.removeEventListener('scroll', this.invalidate);
    this.view.document.documentElement.removeEventListener('pointerleave', this.onPointerLeave);
  }

  /** The canvas may have moved: measure it again before the next pointer read. */
  public readonly invalidate = (): void => {
    this.bounds.dirty = true;
  };

  /** Eases `out` toward the pointer (or the origin when it left) over `smoothTime` seconds. */
  public update(out: TiltTarget, dt: number, ratio: number, smoothTime: number): void {
    let targetX = 0;
    let targetY = 0;
    if (this.pointer.active) {
      if (this.bounds.dirty) this.measure();
      targetX = (this.pointer.x - this.bounds.left) * ratio;
      targetY = (this.bounds.bottom - this.pointer.y) * ratio;
    }
    const alpha = 1 - Math.exp(-dt / Math.max(1e-3, smoothTime));
    out.pointerX += (targetX - out.pointerX) * alpha;
    out.pointerY += (targetY - out.pointerY) * alpha;
  }

  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.bounds.left = rect.left;
    this.bounds.bottom = rect.bottom;
    this.bounds.dirty = false;
  }

  private readonly onPointer = (event: PointerEvent): void => {
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    this.pointer.active = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointer.active = false;
  };
}
