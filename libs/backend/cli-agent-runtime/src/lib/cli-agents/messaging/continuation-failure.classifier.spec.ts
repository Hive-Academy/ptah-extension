import { classifyContinuationFailure } from './continuation-failure.classifier';

function continueError(code: string): Error {
  const error = new Error(`continue failed: ${code}`);
  error.name = 'AgentContinueError';
  return Object.assign(error, { code });
}

describe('classifyContinuationFailure', () => {
  it('classifies a busy lane as transient', () => {
    expect(classifyContinuationFailure(continueError('busy'))).toBe('continuation_transient');
  });

  it.each(['not_found', 'invalid_params', 'unsupported', 'released', 'account_refused', 'unknown'])(
    'classifies the %s continue code as permanent',
    (code) => {
      expect(classifyContinuationFailure(continueError(code))).toBe('continuation_rejected');
    },
  );

  it('treats unrecognised errors and codes as permanent', () => {
    expect(classifyContinuationFailure(new Error('busy'))).toBe('continuation_rejected');
    expect(classifyContinuationFailure(continueError('timeout'))).toBe('continuation_rejected');
    expect(classifyContinuationFailure('busy')).toBe('continuation_rejected');
    expect(classifyContinuationFailure(undefined)).toBe('continuation_rejected');
  });
});
