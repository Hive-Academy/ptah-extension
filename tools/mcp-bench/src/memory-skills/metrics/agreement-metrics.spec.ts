import {
  cohenKappa,
  evaluateTrustBar,
  quadraticWeightedKappa,
  rawAgreement,
  spearmanRho,
  summarizeAgreement,
} from './agreement-metrics';

const options = { resamples: 100, seed: 'TASK_2026_620', alpha: 0.05 };

describe('agreement metrics', () => {
  it('uses average ranks for ties', () => {
    expect(
      spearmanRho({ a: 1, b: 1, c: 3 }, { a: 1, b: 2, c: 3 }).value,
    ).toBeCloseTo(Math.sqrt(3) / 2, 12);
  });

  it('matches hand-computed kappa values', () => {
    // p_o = 3/4, p_e = 0.5*0.25 + 0.5*0.75 = 1/2, kappa = (3/4 - 1/2) / (1/2).
    expect(
      cohenKappa(
        { a: true, b: true, c: false, d: false },
        { a: true, b: false, c: false, d: false },
        options,
      ).value,
    ).toBeCloseTo(0.5, 12);
    // Weighted disagreement observed 1/6, expected 1/3 (uniform marginals).
    expect(
      quadraticWeightedKappa(
        { a: 0, b: 1, c: 2 },
        { a: 0, b: 2, c: 1 },
        options,
      ).value,
    ).toBeCloseTo(0.5, 12);
  });

  it('reports constant vectors and n < 2 as undefined', () => {
    expect(
      cohenKappa({ a: true, b: true }, { a: true, b: false }, options),
    ).toMatchObject({ value: null, reason: 'constant-values', interval: null });
    expect(spearmanRho({ a: 1 }, { a: 2 })).toMatchObject({
      value: null,
      reason: 'fewer-than-two-observations',
    });
  });

  it('rejects mismatched opaque-id sets instead of joining them', () => {
    expect(() => rawAgreement({ a: true }, { b: true })).toThrow(
      'identical opaque-id sets',
    );
  });

  it('calculates weighted kappa with a reproducible interval', () => {
    const first = quadraticWeightedKappa(
      { a: 0, b: 1, c: 2 },
      { a: 0, b: 2, c: 1 },
      options,
    );
    expect(first.value).not.toBeNull();
    expect(first.interval).toEqual(
      quadraticWeightedKappa(
        { a: 0, b: 1, c: 2 },
        { a: 0, b: 2, c: 1 },
        options,
      ).interval,
    );
  });

  it('exposes every trust-bar condition', () => {
    const reference = {
      a: { pass: true, total: 80, criteria: [10, 10] },
      b: { pass: false, total: 20, criteria: [2, 3] },
      c: { pass: true, total: 70, criteria: [9, 9] },
    };
    const summary = summarizeAgreement(reference, reference, options);
    const trust = evaluateTrustBar(
      summary,
      summary,
      Array.from({ length: 10 }, () => ({
        baselineTotal: 80,
        rescoredTotal: 75,
      })),
    );
    expect(trust).toMatchObject({
      fullKappa: { passes: true },
      fullSpearman: { passes: true },
      candidatesSpearman: { passes: true },
      anchorStability: { value: 1, num: 10, den: 10, passes: true },
      trusted: true,
    });
  });
});
