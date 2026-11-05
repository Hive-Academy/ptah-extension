import { STRIKE_TIMING, StrikeSchedule, strikeShape } from './strike-schedule';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
/** Brightness of the one still frame drawn for reduced motion or save-data. */
export const STILL_LEVEL = 0.3;
/** A scroll-step strike peaks a little below a scheduled strike. */
const STEP_STRIKE_PEAK = 0.85;

/** What a strike loop drives: a WebGL bolt or a canvas bolt. */
export interface StrikePainter {
  /** Draw at `level` (0 to 1); `elapsedMs` is the loop clock, `strikeIndex` counts strikes. */
  draw(level: number, elapsedMs: number, strikeIndex: number): void;
  clear(): void;
}

/**
 * The shared timing engine of the page's lightning. It runs a seeded
 * `StrikeSchedule` (short strikes, dark idle gaps) plus brief extra strikes
 * from `strike()`, and keeps cost near zero between strikes: frames run only
 * while a strike is visible; a gap sleeps on one timer. It stops while the
 * host is off screen, while the tab is hidden or while inactive. Reduced
 * motion and save-data draw one faint still frame and never flash; the
 * reduced-motion query is followed live. `destroy()` releases the observer,
 * the listeners and any pending frame or timer.
 */
export class StrikeLoop {
  private readonly schedule: StrikeSchedule;
  private readonly started: number;
  private readonly saveData: boolean;
  private readonly motionQuery?: MediaQueryList;
  private readonly observer?: IntersectionObserver;
  private visible: boolean;
  private stillOnly: boolean;
  private active = true;
  private frame?: number;
  private timeout?: number;
  private stepStrikeAt?: number;
  private strikeIndex = 0;
  private lit = false;

  public constructor(
    private readonly view: Window & typeof globalThis,
    private readonly painter: StrikePainter,
    host: Element,
    seed: number,
  ) {
    this.schedule = new StrikeSchedule(seed);
    this.started = view.performance.now();
    this.saveData =
      (view.navigator as Navigator & { connection?: { saveData?: boolean } }).connection
        ?.saveData === true;
    this.motionQuery = view.matchMedia?.(REDUCED_MOTION);
    this.stillOnly = this.saveData || (this.motionQuery?.matches ?? false);
    this.motionQuery?.addEventListener?.('change', this.onMotionChange);
    this.visible = typeof view.IntersectionObserver !== 'function';
    if (!this.visible) {
      this.observer = new view.IntersectionObserver((entries) => {
        this.visible = entries.some((entry) => entry.isIntersecting);
        this.sync();
      });
      this.observer.observe(host);
    }
    view.document.addEventListener('visibilitychange', this.sync);
    this.sync();
  }

  /** True while a frame or a gap timer is scheduled. */
  public get running(): boolean {
    return this.frame !== undefined || this.timeout !== undefined;
  }

  /** Off (e.g. zero intensity) stops the loop and clears the bolt. */
  public setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.painter.clear();
    this.sync();
  }

  /** One brief extra strike now; ignored for reduced motion and save-data. */
  public strike(): void {
    if (this.stillOnly) return;
    this.stepStrikeAt = this.view.performance.now();
    this.stop();
    this.sync();
  }

  /** Redraws the current state, e.g. after an input change. */
  public refresh(): void {
    this.sync();
  }

  public destroy(): void {
    this.stop();
    this.observer?.disconnect();
    this.motionQuery?.removeEventListener?.('change', this.onMotionChange);
    this.view.document.removeEventListener('visibilitychange', this.sync);
  }

  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    this.stillOnly = this.saveData || event.matches;
    this.stepStrikeAt = undefined;
    this.stop();
    this.sync();
  };

  private readonly sync = (): void => {
    if (!this.visible || this.view.document.hidden || !this.active) {
      this.stop();
      return;
    }
    if (this.stillOnly) {
      this.stop();
      this.painter.draw(STILL_LEVEL, 0, 0);
      return;
    }
    if (!this.running) this.frame = this.view.requestAnimationFrame(this.render);
  };

  private readonly render = (): void => {
    this.frame = undefined;
    const now = this.view.performance.now();
    const elapsed = now - this.started;
    const step =
      this.stepStrikeAt === undefined ? 0 : STEP_STRIKE_PEAK * strikeShape(now - this.stepStrikeAt);
    const level = Math.max(this.schedule.envelope(elapsed), step);
    if (level <= 0) {
      // Idle gap: draw nothing and sleep until the next scheduled strike.
      this.lit = false;
      this.painter.clear();
      if (this.stepStrikeAt !== undefined && now - this.stepStrikeAt >= STRIKE_TIMING.durationMs) {
        this.stepStrikeAt = undefined;
      }
      this.timeout = this.view.setTimeout(() => {
        this.timeout = undefined;
        this.sync();
      }, Math.max(16, this.schedule.untilNext(elapsed)));
      return;
    }
    if (!this.lit) this.strikeIndex++;
    this.lit = true;
    this.painter.draw(level, elapsed, this.strikeIndex);
    this.frame = this.view.requestAnimationFrame(this.render);
  };

  private stop(): void {
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    if (this.timeout !== undefined) this.view.clearTimeout(this.timeout);
    this.frame = undefined;
    this.timeout = undefined;
  }
}
