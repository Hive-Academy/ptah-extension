import {
  classifyLaneFailureClass,
  type LaneFailureClassInput,
} from './lane-failure-class';

const base: LaneFailureClassInput = {
  verdict: 'failed',
  status: 'failed',
  failureKind: null,
  authMatched: false,
};

describe('classifyLaneFailureClass', () => {
  it.each([
    [{ verdict: 'delivered', failureKind: 'quota' }, null],
    [{ verdict: 'unverified', status: 'timeout' }, null],
    [
      { failureKind: 'quota', status: 'timeout', authMatched: true },
      'usage-limit',
    ],
    [{ status: 'timeout', authMatched: true }, 'timeout'],
    [{ authMatched: true }, 'auth'],
    [{}, 'crash'],
    [{ status: 'completed', verdict: 'no-deliverable' }, 'bad-output'],
    [{ status: 'stopped' }, null],
    [{ rateLimited: true }, 'usage-limit'],
    [
      { status: 'completed', verdict: 'no-deliverable', rateLimited: true },
      'usage-limit',
    ],
    [{ verdict: 'delivered', rateLimited: true }, null],
    [{ verdict: 'unverified', rateLimited: true }, null],
    [
      { failureKind: 'quota', rateLimited: true, status: 'timeout' },
      'usage-limit',
    ],
    [{ rateLimited: true, status: 'timeout' }, 'usage-limit'],
    [{ rateLimited: true, authMatched: true }, 'usage-limit'],
    [{ rateLimited: false }, 'crash'],
  ] as const)('applies precedence for %p', (override, expected) => {
    expect(classifyLaneFailureClass({ ...base, ...override })).toBe(expected);
  });
});
