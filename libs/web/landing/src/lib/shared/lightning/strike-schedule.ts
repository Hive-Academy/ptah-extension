import { seededRandom } from '../lightning-bolt';

/**
 * Timing of the page's lightning: short strikes separated by dark idle gaps.
 * All values are milliseconds.
 */
export interface StrikeTiming {
  /** How long one strike is visible, flicker included. */
  readonly durationMs: number;
  /** The idle gap between two strikes is drawn from [minGapMs, maxGapMs). */
  readonly minGapMs: number;
  readonly maxGapMs: number;
  /** The first strike comes after firstDelayMs plus up to half a gap. */
  readonly firstDelayMs: number;
}

export const STRIKE_TIMING: StrikeTiming = {
  durationMs: 320,
  minGapMs: 2600,
  maxGapMs: 5200,
  firstDelayMs: 500,
};

/** The main flash peaks after RISE_MS, then decays with DECAY_MS. */
const RISE_MS = 24;
const DECAY_MS = 55;
/** One re-strike (flicker) at FLICKER_AT of the duration, at FLICKER_PEAK. */
const FLICKER_AT = 0.42;
const FLICKER_RISE_MS = 14;
const FLICKER_DECAY_MS = 40;
const FLICKER_PEAK = 0.7;

/**
 * Brightness (0 to 1) of one strike `t` ms after it began: a fast rise, an
 * exponential decay and one weaker re-strike. 0 before 0 and from
 * `durationMs` on, so between strikes the bolt is dark.
 */
export function strikeShape(t: number, durationMs = STRIKE_TIMING.durationMs): number {
  if (!(t >= 0 && t < durationMs)) return 0;
  const main = t < RISE_MS ? t / RISE_MS : Math.exp(-(t - RISE_MS) / DECAY_MS);
  const since = t - FLICKER_AT * durationMs;
  const flicker =
    since < 0
      ? 0
      : since < FLICKER_RISE_MS
        ? (FLICKER_PEAK * since) / FLICKER_RISE_MS
        : FLICKER_PEAK * Math.exp(-(since - FLICKER_RISE_MS) / FLICKER_DECAY_MS);
  return Math.min(1, Math.max(main, flicker));
}

/**
 * A deterministic sequence of strikes on a clock that starts at 0: the same
 * seed gives the same strike times, so tests and screenshots are repeatable
 * and two bolts with different seeds never strike in step. Only the current
 * strike is kept, so memory stays constant however long the page is open.
 * Query it with a clock that does not run backwards.
 */
export class StrikeSchedule {
  private readonly random: () => number;
  private start: number;

  public constructor(
    seed: number,
    private readonly timing: StrikeTiming = STRIKE_TIMING,
  ) {
    this.random = seededRandom(seed);
    this.start = timing.firstDelayMs + this.gap() / 2;
  }

  /** Brightness at `t`: 0 in the idle gaps. */
  public envelope(t: number): number {
    this.advanceTo(t);
    return strikeShape(t - this.start, this.timing.durationMs);
  }

  /** Milliseconds from `t` until the next strike starts; 0 while one is visible. */
  public untilNext(t: number): number {
    this.advanceTo(t);
    return Math.max(0, this.start - t);
  }

  /** Moves to the strike that is visible at `t`, or the next one after it. */
  private advanceTo(t: number): void {
    while (t >= this.start + this.timing.durationMs) {
      this.start += this.timing.durationMs + this.gap();
    }
  }

  private gap(): number {
    const { minGapMs, maxGapMs } = this.timing;
    return minGapMs + this.random() * (maxGapMs - minGapMs);
  }
}
