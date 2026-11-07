import {
  STRIKE,
  STRIKE_TOTAL_MS,
  hash01,
  strikeSeconds,
  strikeGap,
  strikeLevel,
  strikeLook,
} from './strike-envelope';

describe('strike envelope', () => {
  it('is visible for 3.5 s and dark outside it', () => {
    expect(STRIKE_TOTAL_MS).toBe(3500);
    expect(strikeLevel(-1)).toBe(0);
    expect(strikeLevel(STRIKE_TOTAL_MS)).toBe(0);
    expect(strikeLevel(Number.NaN)).toBe(0);
  });

  it('starts faint, ramps up to the cap, holds, then fades out', () => {
    expect(strikeLevel(0)).toBeCloseTo(STRIKE.startLevel);
    const quarter = strikeLevel(STRIKE.rampMs / 4);
    const half = strikeLevel(STRIKE.rampMs / 2);
    expect(quarter).toBeGreaterThan(STRIKE.startLevel);
    expect(half).toBeGreaterThan(quarter);
    expect(strikeLevel(STRIKE.rampMs)).toBe(1);
    expect(strikeLevel(STRIKE.rampMs + STRIKE.holdMs - 1)).toBe(1);
    const fadeStart = STRIKE.rampMs + STRIKE.holdMs;
    expect(strikeLevel(fadeStart + STRIKE.fadeMs / 2)).toBeCloseTo(0.5);
    expect(strikeLevel(STRIKE_TOTAL_MS - 1)).toBeLessThan(0.01);
  });

  it('thickens the core with the level and never passes the caps', () => {
    const early = strikeLook(0, 3);
    const peak = strikeLook(STRIKE.rampMs + 10, 3);
    expect(early.core).toBeLessThan(peak.core);
    expect(early.intensity).toBeLessThan(peak.intensity);
    for (let t = 0; t < STRIKE_TOTAL_MS; t += 25) {
      const look = strikeLook(t, 3);
      expect(look.intensity).toBeLessThanOrEqual(STRIKE.intensityCap);
      expect(look.intensity).toBeGreaterThanOrEqual(0);
      expect(look.core).toBeLessThanOrEqual(STRIKE.coreMax);
      expect(look.glow).toBeLessThanOrEqual(STRIKE.glowMax);
    }
  });

  it('flickers subtly: the waver stays within the flicker depth', () => {
    const t = STRIKE.rampMs + 50;
    const look = strikeLook(t, 11);
    expect(look.intensity).toBeGreaterThanOrEqual(STRIKE.intensityCap * (1 - STRIKE.flickerDepth));
    expect(hash01(4)).toBe(hash01(4));
    expect(hash01(4)).toBeGreaterThanOrEqual(0);
    expect(hash01(4)).toBeLessThan(1);
  });

  it('writes into a reused look instead of allocating one', () => {
    const out = { intensity: -1, core: -1, glow: -1 };
    const t = STRIKE.rampMs + 50;
    expect(strikeLook(t, 5, out)).toBe(out);
    expect(out).toEqual(strikeLook(t, 5));
  });

  it('converts the writhe clock and draws the gap from its range', () => {
    expect(strikeSeconds(-5)).toBe(0);
    expect(strikeSeconds(2500)).toBe(2.5);
    expect(strikeGap(() => 0)).toBe(STRIKE.minGapMs);
    expect(strikeGap(() => 0.5)).toBe((STRIKE.minGapMs + STRIKE.maxGapMs) / 2);
    expect(strikeGap(() => 0.999)).toBeLessThan(STRIKE.maxGapMs);
  });
});
