import { describeLibraryEntry, formatSuccessRate } from './skills-library.js';

describe('formatSuccessRate', () => {
  it('shows "No grade" for a null rate, never 0%', () => {
    expect(formatSuccessRate(null)).toBe('No grade');
  });

  it('rounds a graded rate to a whole percent', () => {
    expect(formatSuccessRate(0)).toBe('0%');
    expect(formatSuccessRate(0.666)).toBe('67%');
    expect(formatSuccessRate(1)).toBe('100%');
  });
});

describe('describeLibraryEntry', () => {
  it('combines invocations and the success rate', () => {
    expect(describeLibraryEntry({ invocationCount: 6, successRate: null })).toBe(
      '6 invocations · No grade',
    );
    expect(describeLibraryEntry({ invocationCount: 2, successRate: 0.5 })).toBe(
      '2 invocations · 50%',
    );
  });
});
