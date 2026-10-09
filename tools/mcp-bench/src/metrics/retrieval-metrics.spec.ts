import {
  Answer,
  callsPerAnswer,
  LOWER_IS_BETTER,
  Truth,
  hitAt1,
  hitAt5,
  meanReciprocalRank,
  ndcgAtK,
  normalizePath,
  precision,
  recallAtAll,
  recallAtK,
  strictAccuracyAtK,
} from './retrieval-metrics';
import {
  errorRate,
  p50Latency,
  p95Latency,
  resultTokens,
  truncationRate,
} from './cost-metrics';

describe('retrieval metrics', () => {
  const answer: Answer = {
    ranked: ['miss', 'a', 'b', 'other'],
    abstained: false,
  };
  const truth: Truth = { items: ['a', 'b'] };

  it('calculates hand-checked ranking metrics', () => {
    expect(hitAt1(answer, truth)).toBe(0);
    expect(hitAt5(answer, truth)).toBe(1);
    expect(meanReciprocalRank(answer, truth)).toBe(1 / 2);
    expect(recallAtK(answer, truth, 2)).toBe(1 / 2);
    expect(recallAtAll(answer, truth)).toBe(1);
    expect(precision(answer, truth)).toBe(1 / 2);
    expect(strictAccuracyAtK(answer, truth, 2)).toBe(0);
    expect(strictAccuracyAtK(answer, truth, 3)).toBe(1);
    expect(ndcgAtK(answer, truth, 3)).toBeCloseTo(
      (1 / Math.log2(3) + 1 / 2) / (1 + 1 / Math.log2(3)),
    );
  });

  it('returns zero for empty, non-abstention ground truth and empty rankings', () => {
    const emptyAnswer: Answer = { ranked: [], abstained: false };
    const emptyTruth: Truth = { items: [] };
    expect(hitAt1(emptyAnswer, emptyTruth)).toBe(0);
    expect(meanReciprocalRank(emptyAnswer, emptyTruth)).toBe(0);
    expect(recallAtAll(emptyAnswer, emptyTruth)).toBe(0);
    expect(precision(emptyAnswer, emptyTruth)).toBe(0);
    expect(strictAccuracyAtK(emptyAnswer, emptyTruth, 5)).toBe(0);
    expect(ndcgAtK(emptyAnswer, emptyTruth, 5)).toBe(0);
  });

  it('scores correct and wrong abstention consistently across retrieval metrics', () => {
    const abstainTruth: Truth = { items: [], abstain: true };
    const correct: Answer = { ranked: [], abstained: true };
    const wrong: Answer = { ranked: ['file.ts'], abstained: false };
    expect(hitAt1(correct, abstainTruth)).toBe(1);
    expect(recallAtAll(correct, abstainTruth)).toBe(1);
    expect(ndcgAtK(correct, abstainTruth, 5)).toBe(1);
    expect(hitAt1(wrong, abstainTruth)).toBe(0);
    expect(precision(wrong, abstainTruth)).toBe(0);
    expect(strictAccuracyAtK(wrong, abstainTruth, 5)).toBe(0);
    expect(
      hitAt1({ ranked: [], abstained: true }, { items: ['file.ts'] }),
    ).toBe(0);
  });

  it('does not inflate scores for duplicate ranked results', () => {
    const duplicateAnswer: Answer = {
      ranked: ['a', 'a', 'miss'],
      abstained: false,
    };
    const duplicateTruth: Truth = { items: ['a', 'a'] };
    expect(recallAtAll(duplicateAnswer, duplicateTruth)).toBe(1);
    expect(precision(duplicateAnswer, duplicateTruth)).toBe(1 / 2);
    expect(ndcgAtK(duplicateAnswer, duplicateTruth, 3)).toBe(1);
  });

  it('normalizes separators, drive-letter case, and workspace-relative paths', () => {
    const options = { workspaceRoot: 'C:\\Repo\\Workspace' };
    expect(normalizePath('C:\\Repo\\Workspace\\src\\file.ts', options)).toBe(
      'src/file.ts',
    );
    expect(normalizePath('c:/Repo/Workspace/src/file.ts', options)).toBe(
      'src/file.ts',
    );
    expect(normalizePath('./src/file.ts', options)).toBe('src/file.ts');
    expect(
      hitAt1(
        { ranked: ['C:\\Repo\\Workspace\\src\\file.ts'], abstained: false },
        { items: ['src/file.ts'] },
        options,
      ),
    ).toBe(1);
    const deepRoot = `/${'src/'.repeat(20_000)}root`;
    expect(
      normalizePath(`${deepRoot}/file.ts`, {
        workspaceRoot: `${deepRoot}////`,
      }),
    ).toBe('file.ts');
  });

  it('relativises case-insensitively beyond the drive letter on win32 only', () => {
    const root = 'D:\\Projects\\Ptah-Extension';
    expect(
      normalizePath('d:/projects/ptah-extension/libs/A.ts', {
        workspaceRoot: root,
        platform: 'win32',
      }),
    ).toBe('libs/A.ts');
    expect(
      normalizePath('/srv/Repo/libs/a.ts', {
        workspaceRoot: '/srv/repo',
        platform: 'linux',
      }),
    ).toBe('/srv/Repo/libs/a.ts');
  });

  it('exports the scorecard sign convention', () => {
    expect(LOWER_IS_BETTER.hitAt1).toBe(false);
    expect(LOWER_IS_BETTER.resultTokens).toBe(true);
    expect(LOWER_IS_BETTER.errorRate).toBe(true);
  });

  it('calculates token, latency, error, and truncation metrics', () => {
    expect(resultTokens('hello world')).toBeGreaterThan(0);
    expect(resultTokens('a <|endoftext|> b')).toBeGreaterThan(3);
    expect(p50Latency([10, 20, 30, 40])).toBe(20);
    expect(p95Latency([10, 20, 30, 40])).toBe(40);
    expect(p50Latency([])).toBeUndefined();
    expect(p95Latency([])).toBeUndefined();
    expect(callsPerAnswer(9, 4)).toBe(2.25);
    expect(callsPerAnswer(0, 0)).toBeUndefined();
    const outcomes = [
      { errored: false, truncated: false },
      { errored: true, truncated: false },
      { errored: true, truncated: true },
      { errored: false, truncated: true },
    ];
    expect(errorRate(outcomes)).toBe(1 / 2);
    expect(truncationRate(outcomes)).toBe(1 / 2);
    expect(errorRate([])).toBeUndefined();
    expect(truncationRate([])).toBeUndefined();
  });
});
