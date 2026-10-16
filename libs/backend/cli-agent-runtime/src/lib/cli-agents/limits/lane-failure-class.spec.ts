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
  ] as const)('applies precedence for %p', (override, expected) => {
    expect(classifyLaneFailureClass({ ...base, ...override })).toBe(expected);
  });
});
