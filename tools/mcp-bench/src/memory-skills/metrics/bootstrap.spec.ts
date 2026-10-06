import { bootstrapInterval, pairedBootstrapDelta } from './bootstrap';

describe('bootstrap metrics', () => {
  const options = { resamples: 1_000, seed: 'TASK_2026_620', alpha: 0.05 };

  it('is byte-identical for the same seed and inputs', () => {
    const first = JSON.stringify(bootstrapInterval([1, 2, 3, 4], options));
    const second = JSON.stringify(bootstrapInterval([1, 2, 3, 4], options));
    expect(first).toBe(second);
  });

  it('pins a non-degenerate interval around the sample mean', () => {
    const interval = bootstrapInterval([1, 2, 3, 4], options);
    expect(interval).toEqual([1.5, 3.5]);
    expect(interval).not.toBeNull();
    const wider = bootstrapInterval([0, 0, 0, 8], options);
    expect(wider).not.toBeNull();
    if (interval === null || wider === null) {
      throw new Error('Expected non-empty samples to produce intervals.');
    }
    expect(interval[0]).toBeLessThanOrEqual(2.5);
    expect(interval[1]).toBeGreaterThanOrEqual(2.5);
    expect(wider[1] - wider[0]).toBeGreaterThan(interval[1] - interval[0]);
  });

  it('returns null for an empty input', () => {
    expect(bootstrapInterval([], options)).toBeNull();
    expect(pairedBootstrapDelta([], [], options)).toBeNull();
  });

  it('returns the exact interval for a constant sample', () => {
    expect(bootstrapInterval([3, 3, 3], options)).toEqual([3, 3]);
  });

  it('calculates b minus a while preserving pairs', () => {
    expect(pairedBootstrapDelta([1, 2, 3], [3, 4, 5], options)).toEqual([2, 2]);
  });

  it('rejects unequal paired inputs', () => {
    expect(() => pairedBootstrapDelta([1], [], options)).toThrow(RangeError);
  });
});
