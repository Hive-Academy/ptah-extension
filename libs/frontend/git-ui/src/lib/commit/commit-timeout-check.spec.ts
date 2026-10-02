import { judgeHead, subjectOf } from './commit-timeout-check';

describe('commit-timeout-check (SER-1)', () => {
  const baseline = { headHash: 'aaa', subject: 'feat: add composer' };

  it('takes the first line of the message, trimmed, as the subject', () => {
    expect(subjectOf('  feat: x  \r\n\nbody')).toBe('feat: x');
    expect(subjectOf('fix: y')).toBe('fix: y');
  });

  it('counts a moved HEAD with this subject as landed', () => {
    expect(
      judgeHead(baseline, { hash: 'bbb', subject: 'feat: add composer' }),
    ).toBe('landed');
  });

  it('never counts a moved HEAD with another subject as landed', () => {
    expect(judgeHead(baseline, { hash: 'bbb', subject: 'chore: other' })).toBe(
      'other-commit',
    );
    expect(
      judgeHead(baseline, { hash: 'bbb', subject: 'feat: add composer more' }),
    ).toBe('other-commit');
  });

  it('reads an unmoved HEAD as not found', () => {
    expect(
      judgeHead(baseline, { hash: 'aaa', subject: 'feat: add composer' }),
    ).toBe('not-found');
  });

  it('cannot prove anything without a baseline HEAD', () => {
    expect(
      judgeHead(
        { headHash: null, subject: 'feat: add composer' },
        { hash: 'bbb', subject: 'feat: add composer' },
      ),
    ).toBe('unknown');
  });
});
