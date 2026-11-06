import { DprGovernor } from './dpr-governor';
import { LightfallOptions } from './lightfall-options';
import { LightfallFrame, LightfallRenderer } from './lightfall-renderer';
import { PointerTilt } from './pointer-tilt';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** What the runtime reports back to its host component. */
export interface LightfallEvents {
  /** The first frame is on screen: the static fallback can go. */
  readonly onLive: () => void;
  /** No light any more (context lost): show the fallback again. */
  readonly onDark: () => void;
}

/**
 * Drives one Lightfall canvas: sizing (DPR, resize), a frame loop that runs
 * only while the canvas is on screen and the tab is visible, the pointer tilt,
 * and WebGL context loss and restore. `destroy()` releases every listener,
 * observer, frame request and GL object.
 */
export class LightfallRuntime {
  private renderer?: LightfallRenderer;
  private governor: DprGovernor;
  private resizeObserver?: ResizeObserver;
  private intersection?: IntersectionObserver;
  private frameId = 0;
  private previous = 0;
  private flowTime = 0;
  private fade = 0;
  private inView = true;
  private live = false;
  /** Reused every frame: the loop allocates nothing. */
  private readonly frameState: Mutable<LightfallFrame> = { flowTime: 0, fogTime: 0, fade: 0, pointerX: 0, pointerY: 0 };
  private readonly tilt: PointerTilt;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: Window,
    private options: LightfallOptions,
    private readonly events: LightfallEvents,
  ) {
    this.governor = this.createGovernor();
    this.tilt = new PointerTilt(canvas, view);
  }

  /** False when WebGL is unavailable; nothing is left attached in that case. */
  public start(): boolean {
    this.renderer = LightfallRenderer.create(this.canvas);
    if (!this.renderer) return false;
    this.renderer.setOptions(this.options);
    this.resize();
    const view = this.view;
    if ('ResizeObserver' in view) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    }
    if ('IntersectionObserver' in view) {
      this.intersection = new IntersectionObserver(([entry]) => {
        this.inView = entry?.isIntersecting ?? true;
        this.schedule();
      });
      this.intersection.observe(this.canvas);
    }
    view.document.addEventListener('visibilitychange', this.onVisibility);
    this.tilt.attach();
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.schedule();
    return true;
  }

  public setOptions(options: LightfallOptions): void {
    const dprChanged = options.maxDpr !== this.options.maxDpr;
    this.options = options;
    this.renderer?.setOptions(options);
    if (dprChanged) {
      this.governor = this.createGovernor();
      this.resize();
    }
  }

  public destroy(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    this.view.document.removeEventListener('visibilitychange', this.onVisibility);
    this.tilt.detach();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer?.dispose();
    this.renderer = undefined;
  }

  private createGovernor(): DprGovernor {
    const base = Math.min(this.view.devicePixelRatio || 1, this.options.maxDpr);
    return new DprGovernor(base, this.view.performance.now());
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.tilt.invalidate();
    this.renderer?.resize(clientWidth || 1, clientHeight || 1, this.governor.ratio);
  }

  private get running(): boolean {
    return !!this.renderer && this.inView && !this.view.document.hidden;
  }

  private schedule(): void {
    if (!this.running) return this.stop();
    if (this.frameId) return;
    this.previous = 0;
    // The layout may have moved while the loop was paused.
    this.tilt.invalidate();
    this.governor.reset(this.view.performance.now());
    this.frameId = this.view.requestAnimationFrame(this.frame);
  }

  private stop(): void {
    if (this.frameId) this.view.cancelAnimationFrame(this.frameId);
    this.frameId = 0;
  }

  private readonly frame = (now: number): void => {
    this.frameId = 0;
    const renderer = this.renderer;
    if (!renderer || !this.running) return;
    const dtMs = this.previous ? now - this.previous : 16.7;
    this.previous = now;
    // NGXUI clamps the step so a long frame does not jump the flow.
    const dt = Math.min(0.033, Math.max(0.001, dtMs / 1000));
    this.flowTime += dt;
    this.fade = Math.min(1, this.fade + dt);
    this.tilt.update(this.frameState, dt, this.governor.ratio, this.options.mouseSmoothTime);
    this.frameState.flowTime = this.flowTime;
    this.frameState.fogTime = this.flowTime;
    this.frameState.fade = this.fade;
    renderer.draw(this.frameState);
    if (!this.live) {
      this.live = true;
      this.events.onLive();
    }
    if (this.governor.sample(dtMs, now)) this.resize();
    this.frameId = this.view.requestAnimationFrame(this.frame);
  };

  private readonly onVisibility = (): void => this.schedule();

  private readonly onContextLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    this.stop();
    this.renderer = undefined;
    this.live = false;
    this.events.onDark();
  };

  private readonly onContextRestored = (): void => {
    this.renderer = LightfallRenderer.create(this.canvas);
    if (!this.renderer) return;
    this.renderer.setOptions(this.options);
    this.fade = 0;
    this.resize();
    this.schedule();
  };
}
