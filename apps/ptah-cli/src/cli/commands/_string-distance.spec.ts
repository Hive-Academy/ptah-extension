/**
 * Unit tests for the Levenshtein-distance helper used by `did you mean…?`
 * suggestions in the CLI validation paths (TASK CLI-bug-batch item #10).
 */

import { levenshtein, suggestClosest } from './_string-distance.js';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('moonshot', 'moonshot')).toBe(0);
  });

  it('returns the length of the non-empty input when one side is empty', () => {
    expect(levenshtein('', 'kitten')).toBe(6);
    expect(levenshtein('kitten', '')).toBe(6);
  });

  it('counts single-edit transformations correctly', () => {
    expect(levenshtein('cat', 'bat')).toBe(1); // substitution
    expect(levenshtein('cat', 'cats')).toBe(1); // insertion
    expect(levenshtein('cats', 'cat')).toBe(1); // deletion
  });

  it('handles classic textbook examples', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('saturday', 'sunday')).toBe(3);
  });

  it('is symmetric (distance does not depend on argument order)', () => {
    expect(levenshtein('openrouter', 'openroutr')).toBe(
      levenshtein('openroutr', 'openrouter'),
    );
    expect(levenshtein('z-ai', 'zai')).toBe(levenshtein('zai', 'z-ai'));
  });
});

describe('suggestClosest', () => {
  const providers = ['openrouter', 'moonshot', 'z-ai'] as const;

  it('returns null when the candidate list is empty', () => {
    expect(suggestClosest('anything', [])).toBeNull();
  });

  it('returns the closest candidate within the default threshold (2)', () => {
    expect(suggestClosest('openroutr', providers)).toBe('openrouter');
    expect(suggestClosest('moonsht', providers)).toBe('moonshot');
    expect(suggestClosest('zai', providers)).toBe('z-ai');
  });

  it('returns null when no candidate is within maxDistance', () => {
    // 'gemini' is way more than 2 edits away from any provider above.
    expect(suggestClosest('gemini', providers, 2)).toBeNull();
  });

  it('returns the exact match when the input matches a candidate', () => {
    expect(suggestClosest('moonshot', providers)).toBe('moonshot');
  });

  it('honors a custom maxDistance', () => {
    // 'openroter' is 1 edit from 'openrouter', so threshold 0 rejects it
    // but threshold 1 accepts it.
    expect(suggestClosest('openroter', providers, 0)).toBeNull();
    expect(suggestClosest('openroter', providers, 1)).toBe('openrouter');
  });
});
