import { blankToNull, blankToUndefined } from './session-id.utils';

/**
 * First spec coverage for the blankness rule anywhere in the repo. Both
 * implementations this module replaces — `blankToUndefined` in
 * `cli-agent-runtime` and the module-private `sessionIdOrNull` in
 * `memory-curator` — shipped with ZERO tests, which is how four different trim
 * policies coexisted without anything failing.
 */
describe('session-id blankness primitives', () => {
  const REAL_ID = '9f2c1b40-5e7a-4c31-8d16-2b0a7e4f9c83';

  describe('blankToUndefined', () => {
    it('treats undefined as absent', () => {
      expect(blankToUndefined(undefined)).toBeUndefined();
    });

    it('treats null as absent', () => {
      expect(blankToUndefined(null)).toBeUndefined();
    });

    it('treats the empty string as absent', () => {
      expect(blankToUndefined('')).toBeUndefined();
    });

    /**
     * The policy decision. A whitespace-only id is ABSENT, not a valid id —
     * this is the half of the rule the no-trim implementations got wrong, and
     * the reason a stray space could previously defeat every blank guard.
     */
    it('treats a whitespace-only id as absent', () => {
      expect(blankToUndefined('   ')).toBeUndefined();
      expect(blankToUndefined('\t')).toBeUndefined();
      expect(blankToUndefined('\n  \t ')).toBeUndefined();
    });

    /** The trimmed value is what comes back — not the original. */
    it('returns the trimmed value when the id has surrounding whitespace', () => {
      expect(blankToUndefined('  abc  ')).toBe('abc');
      expect(blankToUndefined(`\n${REAL_ID}\t`)).toBe(REAL_ID);
    });

    it('returns a real session id unchanged', () => {
      expect(blankToUndefined(REAL_ID)).toBe(REAL_ID);
    });

    /**
     * Paired isolation: absence must be spelled `undefined` so a normalised id
     * falls through a `??` chain. `null` would stop it dead.
     */
    it('spells absence as undefined so it falls through a ?? chain', () => {
      expect(blankToUndefined('   ') ?? 'fallback').toBe('fallback');
      expect(blankToUndefined(REAL_ID) ?? 'fallback').toBe(REAL_ID);
    });
  });

  describe('blankToNull', () => {
    it('treats undefined as absent', () => {
      expect(blankToNull(undefined)).toBeNull();
    });

    it('treats null as absent', () => {
      expect(blankToNull(null)).toBeNull();
    });

    it('treats the empty string as absent', () => {
      expect(blankToNull('')).toBeNull();
    });

    it('treats a whitespace-only id as absent', () => {
      expect(blankToNull('   ')).toBeNull();
      expect(blankToNull('\t')).toBeNull();
      expect(blankToNull('\n  \t ')).toBeNull();
    });

    it('returns the trimmed value when the id has surrounding whitespace', () => {
      expect(blankToNull('  abc  ')).toBe('abc');
      expect(blankToNull(`\n${REAL_ID}\t`)).toBe(REAL_ID);
    });

    it('returns a real session id unchanged', () => {
      expect(blankToNull(REAL_ID)).toBe(REAL_ID);
    });

    /**
     * The SQL-bind contract. better-sqlite3 THROWS on an `undefined` bind
     * parameter, so every absent case must produce `null` and never merely a
     * falsy value. `toBeNull()` alone would pass on `undefined` in some
     * matchers' hands; assert the absence of `undefined` explicitly.
     */
    it('never returns undefined for any absent case (better-sqlite3 cannot bind it)', () => {
      for (const absent of [undefined, null, '', '   ', '\t', '\n  \t ']) {
        const result = blankToNull(absent);
        expect(result).toBeNull();
        expect(result).not.toBeUndefined();
      }
    });
  });
});
