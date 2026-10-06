import {
  archivedThenNeededRate,
  classifyUpdate,
  duplicateClusterRate,
  falseDeleteRate,
  falseMemoryRate,
  falseRetainRate,
  mergeF1,
  mergePrecision,
  mergeRecall,
  overSuppression,
  precision,
  rate,
  recall,
  singletonSubjectShare,
  updateOutcomeRate,
} from './curation-metrics';

describe('curation metrics', () => {
  it('calculates extraction metrics with unlabelled rows excluded', () => {
    expect(recall(['a', 'b'], ['b', 'other'])).toEqual({
      value: 1 / 2,
      num: 1,
      den: 2,
    });
    expect(precision(['seeded', 'unlabelled', 'other', 'seeded'])).toEqual({
      value: 2 / 3,
      num: 2,
      den: 3,
    });
    expect(falseMemoryRate(1, 4)).toEqual({ value: 3 / 4, num: 3, den: 4 });
    expect(overSuppression(['a', 'b'], ['b'])).toEqual({
      value: 1 / 2,
      num: 1,
      den: 2,
    });
  });

  it('returns null for every empty denominator', () => {
    expect(rate(0, 0)).toEqual({ value: null, num: 0, den: 0 });
    expect(recall([], [])).toEqual({ value: null, num: 0, den: 0 });
    expect(precision(['unlabelled'])).toEqual({ value: null, num: 0, den: 0 });
    expect(falseMemoryRate(0, 0)).toEqual({ value: null, num: 0, den: 0 });
  });

  it('uses v1 absence for a correct update when no superseded marker exists', () => {
    expect(classifyUpdate({ hasV1: false, hasV2: true, hasBait: false })).toBe(
      'correct',
    );
    expect(classifyUpdate({ hasV1: true, hasV2: true, hasBait: false })).toBe(
      'stale',
    );
    expect(classifyUpdate({ hasV1: false, hasV2: false, hasBait: false })).toBe(
      'omission',
    );
    expect(classifyUpdate({ hasV1: false, hasV2: true, hasBait: true })).toBe(
      'hallucination',
    );
    expect(
      updateOutcomeRate(
        [
          { hasV1: false, hasV2: true, hasBait: false },
          { hasV1: true, hasV2: false, hasBait: false },
        ],
        'correct',
      ),
    ).toEqual({ value: 1 / 2, num: 1, den: 2 });
  });

  it('calculates hand-checked merge and cluster metrics', () => {
    const counts = { truePositive: 3, falsePositive: 1, falseNegative: 2 };
    expect(mergePrecision(counts)).toEqual({ value: 3 / 4, num: 3, den: 4 });
    expect(mergeRecall(counts)).toEqual({ value: 3 / 5, num: 3, den: 5 });
    expect(mergeF1(counts)).toEqual({ value: 2 / 3, num: 6, den: 9 });
    expect(duplicateClusterRate([1, 2, 3])).toEqual({
      value: 2 / 3,
      num: 2,
      den: 3,
    });
    expect(singletonSubjectShare([1, 1, 2])).toEqual({
      value: 2 / 3,
      num: 2,
      den: 3,
    });
  });

  it('calculates retention metrics', () => {
    const cases = [
      { deleted: true, neededAfterDeletion: true },
      { deleted: true, neededAfterDeletion: false },
      { deleted: false, neededAfterDeletion: false },
    ];
    expect(falseDeleteRate(cases)).toEqual({ value: 1 / 2, num: 1, den: 2 });
    expect(falseRetainRate(cases)).toEqual({ value: 1 / 2, num: 1, den: 2 });
    expect(archivedThenNeededRate(cases)).toEqual({
      value: 1 / 3,
      num: 1,
      den: 3,
    });
  });
});
