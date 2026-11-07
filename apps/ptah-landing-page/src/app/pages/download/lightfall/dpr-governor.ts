/**
 * NGXUI Lightfall's adaptive resolution: every 750 ms it averages the frame
 * rate and steps the pixel ratio down 15% under 50 fps or up 10% over 58 fps,
 * between a 0.6 floor and the base ratio, at most once every two seconds.
 */
export class DprGovernor {
  private static readonly FLOOR = 0.6;
  private static readonly LOW_FPS = 50;
  private static readonly HIGH_FPS = 58;
  private static readonly WINDOW_MS = 750;
  private static readonly COOLDOWN_MS = 2000;

  private current: number;
  private emaDt = 16.7;
  private samples: number[] = [];
  private lastCheck: number;
  private lastChange = Number.NEGATIVE_INFINITY;

  public constructor(private readonly base: number, now: number) {
    this.current = base;
    this.lastCheck = now;
  }

  public get ratio(): number {
    return this.current;
  }

  /** Feeds one frame; returns true when the ratio changed and the canvas must resize. */
  public sample(dtMs: number, now: number): boolean {
    this.emaDt = this.emaDt * 0.9 + dtMs * 0.1;
    this.samples.push(1000 / Math.max(1, this.emaDt));
    if (now - this.lastCheck < DprGovernor.WINDOW_MS) return false;
    const fps = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    this.samples = [];
    this.lastCheck = now;
    let next = this.current;
    if (fps < DprGovernor.LOW_FPS) next = this.current * 0.85;
    else if (fps > DprGovernor.HIGH_FPS && this.current < this.base) next = this.current * 1.1;
    next = Math.max(DprGovernor.FLOOR, Math.min(this.base, next));
    if (Math.abs(next - this.current) <= 0.01 || now - this.lastChange <= DprGovernor.COOLDOWN_MS) return false;
    this.current = next;
    this.lastChange = now;
    return true;
  }

  /** Forgets the frame history, e.g. after a pause, so a stall does not read as a slow frame. */
  public reset(now: number): void {
    this.samples = [];
    this.lastCheck = now;
    this.emaDt = 16.7;
  }
}
