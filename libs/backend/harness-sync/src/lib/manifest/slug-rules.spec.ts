/**
 * Slug admissibility rules (edge case E20), unit-tested exhaustively per the
 * task-owner's list. Pure functions — no filesystem needed.
 *
 * Source-under-test: `isReservedSlug`, `canonicalSlug`.
 */

import { canonicalSlug, isReservedSlug } from './slug-rules';

describe('isReservedSlug', () => {
  it.each([
    ['CON', 'bare Windows device name, upper case'],
    ['con.md', 'device name with an extension'],
    ['LPT9', 'the highest numbered LPT device'],
    ['NUL', 'another bare device name'],
    ['a?b', 'contains an illegal NTFS character'],
    ['a/b', 'contains a path separator'],
    ['trailing.', 'trailing dot Windows silently strips'],
    ['trailing ', 'trailing space Windows silently strips'],
    ['', 'empty string'],
    ['.', 'current-directory marker'],
    ['..', 'parent-directory marker'],
  ])('[E20] rejects %s (%s)', (slug) => {
    expect(isReservedSlug(slug)).toBe(true);
  });

  it.each([
    ['run-tests', 'ordinary hyphenated slug'],
    ['ui-ux-designer', 'ordinary hyphenated slug with acronyms'],
    ['skill.name.v2', 'dotted slug that is not a trailing dot'],
  ])('[E20] admits %s (%s)', (slug) => {
    expect(isReservedSlug(slug)).toBe(false);
  });

  it('[E20] rejects every COM/LPT device number 1 through 9, case-insensitively', () => {
    for (let i = 1; i <= 9; i++) {
      expect(isReservedSlug(`com${i}`)).toBe(true);
      expect(isReservedSlug(`COM${i}`)).toBe(true);
      expect(isReservedSlug(`lpt${i}`)).toBe(true);
      expect(isReservedSlug(`LPT${i}`)).toBe(true);
    }
  });

  it('[E20] treats control characters as reserved', () => {
    expect(isReservedSlug('badname')).toBe(true);
  });
});

describe('canonicalSlug', () => {
  it('lower-cases so case-variant slugs compare equal, matching NTFS/APFS directory identity', () => {
    expect(canonicalSlug('Run-Tests')).toBe('run-tests');
    expect(canonicalSlug('RUN-TESTS')).toBe('run-tests');
    expect(canonicalSlug('run-tests')).toBe('run-tests');
  });
});
