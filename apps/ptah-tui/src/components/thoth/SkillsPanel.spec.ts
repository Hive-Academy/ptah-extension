import { mapPromoteOutcome } from './promote-outcome.js';

describe('mapPromoteOutcome', () => {
  it('maps promoted:true to a success outcome', () => {
    const outcome = mapPromoteOutcome({
      promoted: true,
      reason: null,
      filePath: '/skills/foo.md',
    });
    expect(outcome.kind).toBe('success');
    expect(outcome.text).toBe('Promoted');
    expect(outcome.reason).toBe('/skills/foo.md');
  });

  it('maps promoted:false to a warning outcome, never success (FINDING-1)', () => {
    const outcome = mapPromoteOutcome({
      promoted: false,
      reason: 'judge-score-too-low',
      filePath: null,
    });
    expect(outcome.kind).toBe('warning');
    expect(outcome.kind).not.toBe('success');
    expect(outcome.text).toBe('Not promoted');
    expect(outcome.reason).toBe('judge-score-too-low');
  });

  it('supplies a fallback reason when promoted:false omits one', () => {
    const outcome = mapPromoteOutcome({
      promoted: false,
      reason: null,
      filePath: null,
    });
    expect(outcome.kind).toBe('warning');
    expect(outcome.reason).toBe('rejected by evaluation');
  });

  it('maps a null transport result to an error outcome', () => {
    const outcome = mapPromoteOutcome(null);
    expect(outcome.kind).toBe('error');
    expect(outcome.kind).not.toBe('success');
  });
});
