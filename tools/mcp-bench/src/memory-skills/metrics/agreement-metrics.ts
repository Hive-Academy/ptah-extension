import {
  bootstrapInterval,
  type BootstrapInterval,
  type BootstrapOptions,
} from './bootstrap';

export interface Rate {
  readonly value: number | null;
  readonly num: number;
  readonly den: number;
}

export interface Statistic {
  readonly value: number | null;
  readonly reason?: 'fewer-than-two-observations' | 'constant-values';
}

export interface KappaStatistic extends Statistic {
  readonly interval: BootstrapInterval;
}

export interface RubricRating {
  readonly pass: boolean;
  readonly total: number;
  readonly criteria: readonly number[];
}

export interface AgreementSummary {
  readonly passFailKappa: KappaStatistic;
  readonly totalsSpearman: Statistic;
  readonly criterionKappas: readonly KappaStatistic[];
  readonly rawAgreement: Rate;
}

export interface AnchorComparison {
  readonly baselineTotal: number;
  readonly rescoredTotal: number;
}

export interface TrustBar {
  readonly fullKappa: Statistic & { readonly passes: boolean };
  readonly fullSpearman: Statistic & { readonly passes: boolean };
  readonly candidatesSpearman: Statistic & { readonly passes: boolean };
  readonly anchorStability: Rate & { readonly passes: boolean };
  readonly trusted: boolean;
}

/** Returns the raw proportion of exactly matching values. */
export function rawAgreement<T>(
  left: Readonly<Record<string, T>>,
  right: Readonly<Record<string, T>>,
): Rate {
  const ids = assertSameIds(left, right);
  return rate(ids.filter((id) => left[id] === right[id]).length, ids.length);
}

/** Cohen's kappa for paired pass/fail labels, with a seeded 95% interval. */
export function cohenKappa(
  left: Readonly<Record<string, boolean>>,
  right: Readonly<Record<string, boolean>>,
  options: BootstrapOptions,
): KappaStatistic {
  const ids = assertSameIds(left, right);
  if (ids.length < 2) return undefinedKappa('fewer-than-two-observations');

  const leftValues = ids.map((id) => left[id]);
  const rightValues = ids.map((id) => right[id]);
  if (isConstant(leftValues) || isConstant(rightValues)) {
    return undefinedKappa('constant-values');
  }

  const leftPositive = proportion(leftValues);
  const rightPositive = proportion(rightValues);
  const expected =
    leftPositive * rightPositive + (1 - leftPositive) * (1 - rightPositive);
  if (expected === 1) return undefinedKappa('constant-values');

  const observed = proportion(
    leftValues.map((value, index) => value === rightValues[index]),
  );
  const value = (observed - expected) / (1 - expected);
  // These contributions have mean kappa while keeping the marginal expectation
  // fixed; bootstrapInterval supplies the reproducible percentile interval.
  const contributions = leftValues.map(
    (leftValue, index) =>
      ((leftValue === rightValues[index] ? 1 : 0) - expected) / (1 - expected),
  );
  return { value, interval: bootstrapInterval(contributions, options) };
}

/** Spearman's rank correlation, using average ranks for tied values. */
export function spearmanRho(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): Statistic {
  const ids = assertSameIds(left, right);
  if (ids.length < 2)
    return { value: null, reason: 'fewer-than-two-observations' };

  const leftRanks = averageRanks(ids.map((id) => left[id]));
  const rightRanks = averageRanks(ids.map((id) => right[id]));
  if (isConstant(leftRanks) || isConstant(rightRanks)) {
    return { value: null, reason: 'constant-values' };
  }

  const leftMean = mean(leftRanks);
  const rightMean = mean(rightRanks);
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < ids.length; index += 1) {
    const leftDelta = leftRanks[index] - leftMean;
    const rightDelta = rightRanks[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSum += leftDelta ** 2;
    rightSum += rightDelta ** 2;
  }
  return { value: numerator / Math.sqrt(leftSum * rightSum) };
}

/** Quadratic-weighted kappa for ordinal criterion scores. */
export function quadraticWeightedKappa(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
  options: BootstrapOptions,
): KappaStatistic {
  const ids = assertSameIds(left, right);
  if (ids.length < 2) return undefinedKappa('fewer-than-two-observations');
  const leftValues = ids.map((id) => left[id]);
  const rightValues = ids.map((id) => right[id]);
  if (isConstant(leftValues) || isConstant(rightValues)) {
    return undefinedKappa('constant-values');
  }

  const categories = [...new Set([...leftValues, ...rightValues])].sort(
    (a, b) => a - b,
  );
  if (categories.length < 2) return undefinedKappa('constant-values');
  const denominator = (categories.length - 1) ** 2;
  const leftIndex = new Map(categories.map((value, index) => [value, index]));
  const rightIndex = new Map(categories.map((value, index) => [value, index]));
  const observed = leftValues.map(
    (value, index) =>
      (leftIndex.get(value)! - rightIndex.get(rightValues[index])!) ** 2 /
      denominator,
  );
  const expected = expectedQuadraticDisagreement(
    leftValues,
    rightValues,
    leftIndex,
    rightIndex,
    denominator,
  );
  if (expected === 0) return undefinedKappa('constant-values');
  const value = 1 - mean(observed) / expected;
  const contributions = observed.map((item) => 1 - item / expected);
  return { value, interval: bootstrapInterval(contributions, options) };
}

export function summarizeAgreement(
  reference: Readonly<Record<string, RubricRating>>,
  comparison: Readonly<Record<string, RubricRating>>,
  options: BootstrapOptions,
): AgreementSummary {
  const ids = assertSameIds(reference, comparison);
  const criterionCount =
    ids.length === 0 ? 0 : reference[ids[0]].criteria.length;
  if (
    ids.some(
      (id) =>
        reference[id].criteria.length !== criterionCount ||
        comparison[id].criteria.length !== criterionCount,
    )
  ) {
    throw new RangeError(
      'Every rating must contain the same number of criteria.',
    );
  }
  const passReference = mapValues(reference, (rating) => rating.pass);
  const passComparison = mapValues(comparison, (rating) => rating.pass);
  return {
    passFailKappa: cohenKappa(passReference, passComparison, options),
    totalsSpearman: spearmanRho(
      mapValues(reference, (rating) => rating.total),
      mapValues(comparison, (rating) => rating.total),
    ),
    criterionKappas: Array.from({ length: criterionCount }, (_, criterion) =>
      quadraticWeightedKappa(
        mapValues(reference, (rating) => rating.criteria[criterion]),
        mapValues(comparison, (rating) => rating.criteria[criterion]),
        options,
      ),
    ),
    rawAgreement: rawAgreement(passReference, passComparison),
  };
}

/** Evaluates all published rubric-ground-truth trust-bar conditions. */
export function evaluateTrustBar(
  full: AgreementSummary,
  candidates: AgreementSummary,
  anchors: readonly AnchorComparison[],
): TrustBar {
  const anchorStability = rate(
    anchors.filter(
      (anchor) => Math.abs(anchor.baselineTotal - anchor.rescoredTotal) <= 8,
    ).length,
    anchors.length,
  );
  const fullKappa = withPass(full.passFailKappa, 0.6);
  const fullSpearman = withPass(full.totalsSpearman, 0.7);
  const candidatesSpearman = withPass(candidates.totalsSpearman, 0.6);
  const stableAnchors = {
    ...anchorStability,
    passes: anchorStability.num >= 8 && anchorStability.den === 10,
  };
  return {
    fullKappa,
    fullSpearman,
    candidatesSpearman,
    anchorStability: stableAnchors,
    trusted:
      fullKappa.passes &&
      fullSpearman.passes &&
      candidatesSpearman.passes &&
      stableAnchors.passes,
  };
}

function assertSameIds<T, U>(
  left: Readonly<Record<string, T>>,
  right: Readonly<Record<string, U>>,
): string[] {
  const leftIds = Object.keys(left).sort();
  const rightIds = Object.keys(right).sort();
  if (
    leftIds.length !== rightIds.length ||
    leftIds.some((id, index) => id !== rightIds[index])
  ) {
    throw new RangeError(
      'Agreement inputs must have identical opaque-id sets.',
    );
  }
  return leftIds;
}

function rate(num: number, den: number): Rate {
  return { value: den === 0 ? null : num / den, num, den };
}

function undefinedKappa(reason: Statistic['reason']): KappaStatistic {
  return { value: null, reason, interval: null };
}

function withPass(
  statistic: Statistic,
  threshold: number,
): Statistic & { readonly passes: boolean } {
  return {
    ...statistic,
    passes: statistic.value !== null && statistic.value >= threshold,
  };
}

function mapValues<T, U>(
  record: Readonly<Record<string, T>>,
  mapper: (value: T) => U,
): Record<string, U> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, mapper(value)]),
  );
}

function proportion(values: readonly boolean[]): number {
  return values.filter(Boolean).length / values.length;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isConstant<T>(values: readonly T[]): boolean {
  return values.every((value) => value === values[0]);
}

function averageRanks(values: readonly number[]): number[] {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks: number[] = Array.from({ length: values.length }, () => 0);
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value)
      end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1)
      ranks[ordered[index].index] = rank;
    start = end;
  }
  return ranks;
}

function expectedQuadraticDisagreement(
  left: readonly number[],
  right: readonly number[],
  leftIndex: ReadonlyMap<number, number>,
  rightIndex: ReadonlyMap<number, number>,
  denominator: number,
): number {
  let sum = 0;
  for (const leftValue of left) {
    for (const rightValue of right) {
      sum +=
        (leftIndex.get(leftValue)! - rightIndex.get(rightValue)!) ** 2 /
        denominator;
    }
  }
  return sum / (left.length * right.length);
}
