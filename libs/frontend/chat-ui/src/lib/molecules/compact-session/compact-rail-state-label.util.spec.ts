import { compactRailStateLabel } from './compact-rail-state-label.util';

describe('compactRailStateLabel', () => {
  it.each([
    ['running', 'Running'], ['needs', 'Needs input'], ['error', 'Error'],
    ['idle', 'Idle'], ['done', 'Done'],
  ] as const)('labels %s as %s', (state, label) => {
    expect(compactRailStateLabel(state)).toBe(label);
  });
});
