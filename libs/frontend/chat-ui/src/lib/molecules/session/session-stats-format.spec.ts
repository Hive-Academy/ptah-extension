import {
  formatCost,
  formatDuration,
  formatOptionalTokens,
  formatTokens,
} from './session-stats-format';

describe('session-stats-format', () => {
  describe('formatCost', () => {
    it.each([
      [null, '—'],
      [0, '$0.0000'],
      [0.0042, '$0.0042'],
      [0.01, '$0.01'],
      [38.18, '$38.18'],
    ])('formats %p as %p', (cost, expected) => {
      expect(formatCost(cost)).toBe(expected);
    });
  });

  describe('formatTokens', () => {
    it.each([
      [0, '0'],
      [999, '999'],
      [1_000, '1.0k'],
      [396_700, '396.7k'],
      [1_000_000, '1.0M'],
      [14_900_000, '14.9M'],
    ])('formats %p as %p', (count, expected) => {
      expect(formatTokens(count)).toBe(expected);
    });
  });

  describe('formatOptionalTokens', () => {
    it('renders an absent count as an em dash, never 0', () => {
      expect(formatOptionalTokens(undefined)).toBe('—');
    });

    it('formats a present count like formatTokens', () => {
      expect(formatOptionalTokens(0)).toBe('0');
      expect(formatOptionalTokens(388_100)).toBe('388.1k');
    });
  });

  describe('formatDuration', () => {
    it.each([
      [850, '850ms'],
      [1_000, '1.0s'],
      [12_500, '12.5s'],
      [60_000, '1m 0s'],
      [125_000, '2m 5s'],
    ])('formats %p ms as %p', (ms, expected) => {
      expect(formatDuration(ms)).toBe(expected);
    });
  });
});
