import { DprGovernor } from './dpr-governor';
import { LIGHTFALL_DEFAULTS, hexToRgb } from './lightfall-options';

/** Feeds frames of `dtMs` until `untilMs`; returns the time reached and whether the ratio changed. */
function run(governor: DprGovernor, start: number, untilMs: number, dtMs: number): { now: number; changed: boolean } {
  let now = start;
  let changed = false;
  while (now < untilMs) {
    now += dtMs;
    changed = governor.sample(dtMs, now) || changed;
  }
  return { now, changed };
}

describe('DprGovernor', () => {
  it('keeps the base ratio at 60 fps', () => {
    const governor = new DprGovernor(2, 0);
    expect(run(governor, 0, 5000, 16.7).changed).toBe(false);
    expect(governor.ratio).toBe(2);
  });

  it('steps down 15% under 50 fps, no lower than 0.6, once per cooldown', () => {
    const governor = new DprGovernor(2, 0);
    const first = run(governor, 0, 2100, 40);
    expect(first.changed).toBe(true);
    expect(governor.ratio).toBeCloseTo(1.7);
    run(governor, first.now, 60_000, 40);
    expect(governor.ratio).toBeCloseTo(0.6);
  });

  it('climbs back toward the base when frames are fast again', () => {
    const governor = new DprGovernor(2, 0);
    const slow = run(governor, 0, 2100, 40);
    expect(governor.ratio).toBeLessThan(2);
    run(governor, slow.now, slow.now + 30_000, 16);
    expect(governor.ratio).toBe(2);
  });
});

describe('hexToRgb', () => {
  it('reads #rrggbb and #rgb', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('#fff')).toEqual([1, 1, 1]);
  });

  it('falls back to white for anything else', () => {
    expect(hexToRgb('gold')).toEqual([1, 1, 1]);
  });

  it('defaults to the brand amber', () => {
    const [r, g, b] = hexToRgb(LIGHTFALL_DEFAULTS.color);
    expect(r).toBe(1);
    expect(g).toBeGreaterThan(b);
  });
});
