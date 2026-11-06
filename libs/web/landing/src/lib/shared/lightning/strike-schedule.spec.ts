import { STRIKE_TIMING, StrikeSchedule, strikeShape } from './strike-schedule';

/** Start times of every strike before `until`, sampled every millisecond. */
function strikeStarts(schedule: StrikeSchedule, until: number): number[] {
  const starts: number[] = [];
  let lit = false;
  for (let t = 0; t < until; t++) {
    const now = schedule.envelope(t) > 0;
    if (now && !lit) starts.push(t);
    lit = now;
  }
  return starts;
}

describe('strikeShape', () => {
  it('is dark outside the strike and peaks at full brightness right after it starts', () => {
    expect(strikeShape(-1)).toBe(0);
    expect(strikeShape(STRIKE_TIMING.durationMs)).toBe(0);
    expect(strikeShape(10_000)).toBe(0);
    expect(strikeShape(24)).toBeCloseTo(1, 5);
    expect(strikeShape(12)).toBeCloseTo(0.5, 5);
  });

  it('decays quickly, then flickers once before going dark', () => {
    expect(strikeShape(110)).toBeLessThan(0.25);
    // The re-strike: 0.42 of 320 ms plus its 14 ms rise.
    const flicker = strikeShape(0.42 * STRIKE_TIMING.durationMs + 14);
    expect(flicker).toBeCloseTo(0.7, 2);
    expect(flicker).toBeGreaterThan(strikeShape(110));
    expect(strikeShape(STRIKE_TIMING.durationMs - 1)).toBeLessThan(0.02);
  });
});

describe('StrikeSchedule', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = strikeStarts(new StrikeSchedule(7), 30_000);
    const b = strikeStarts(new StrikeSchedule(7), 30_000);
    const c = strikeStarts(new StrikeSchedule(8), 30_000);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('separates brief strikes by dark gaps of a few seconds', () => {
    const schedule = new StrikeSchedule(3);
    const starts = strikeStarts(schedule, 60_000);
    expect(starts.length).toBeGreaterThanOrEqual(10);
    expect(starts[0]).toBeGreaterThanOrEqual(STRIKE_TIMING.firstDelayMs);
    for (let i = 1; i < starts.length; i++) {
      const period = starts[i] - starts[i - 1];
      expect(period).toBeGreaterThanOrEqual(STRIKE_TIMING.durationMs + STRIKE_TIMING.minGapMs - 1);
      expect(period).toBeLessThanOrEqual(STRIKE_TIMING.durationMs + STRIKE_TIMING.maxGapMs + 1);
    }
    // Dark most of the time: well under 15% of the minute is lit.
    const fresh = new StrikeSchedule(3);
    let lit = 0;
    for (let t = 0; t < 60_000; t++) if (fresh.envelope(t) > 0) lit++;
    expect(lit / 60_000).toBeLessThan(0.15);
  });

  it('reports the wait until the next strike, and 0 during one', () => {
    const schedule = new StrikeSchedule(5);
    const wait = schedule.untilNext(0);
    expect(wait).toBeGreaterThan(0);
    expect(schedule.envelope(wait - 1)).toBe(0);
    expect(schedule.untilNext(wait + 30)).toBe(0);
    expect(schedule.envelope(wait + 24)).toBeCloseTo(1, 5);
    expect(schedule.untilNext(wait + STRIKE_TIMING.durationMs)).toBeGreaterThanOrEqual(
      STRIKE_TIMING.minGapMs,
    );
  });
});
