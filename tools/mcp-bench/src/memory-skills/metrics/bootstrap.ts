export type BootstrapInterval = readonly [lo: number, hi: number] | null;

export interface BootstrapOptions {
  resamples: number;
  seed: string;
  alpha: number;
}

/**
 * Returns a percentile bootstrap confidence interval for the mean.
 * The seeded generator makes benchmark intervals reproducible across platforms.
 */
export function bootstrapInterval(
  values: readonly number[],
  options: BootstrapOptions,
): BootstrapInterval {
  validateOptions(options);
  if (values.length === 0) return null;

  const random = seededRandom(options.seed);
  const means = Array.from({ length: options.resamples }, () =>
    resampledMean(values, random),
  ).sort((left, right) => left - right);

  return intervalFromSorted(means, options.alpha);
}

/**
 * Returns the paired confidence interval for mean(b - a), preserving task pairs
 * on every resample rather than independently sampling each arm.
 */
export function pairedBootstrapDelta(
  a: readonly number[],
  b: readonly number[],
  options: BootstrapOptions,
): BootstrapInterval {
  validateOptions(options);
  if (a.length !== b.length) {
    throw new RangeError('Paired bootstrap inputs must have the same length.');
  }
  if (a.length === 0) return null;

  const deltas = a.map((value, index) => b[index] - value);
  return bootstrapInterval(deltas, options);
}

function validateOptions(options: BootstrapOptions): void {
  if (!Number.isInteger(options.resamples) || options.resamples <= 0) {
    throw new RangeError('Bootstrap resamples must be a positive integer.');
  }
  if (!(options.alpha > 0 && options.alpha < 1)) {
    throw new RangeError('Bootstrap alpha must be between zero and one.');
  }
}

function resampledMean(
  values: readonly number[],
  random: () => number,
): number {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[Math.floor(random() * values.length)];
  }
  return sum / values.length;
}

function intervalFromSorted(
  sorted: readonly number[],
  alpha: number,
): BootstrapInterval {
  const lowerIndex = Math.floor((alpha / 2) * (sorted.length - 1));
  const upperIndex = Math.ceil((1 - alpha / 2) * (sorted.length - 1));
  return [sorted[lowerIndex], sorted[upperIndex]];
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
