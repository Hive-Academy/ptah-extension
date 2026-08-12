/**
 * `isUniqueConstraintError` is a one-code matcher, and the narrowness IS the
 * contract: every caller wraps it around a claim INSERT and treats `true` as
 * "another worker won, move on". Widen it — to any `SQLITE_CONSTRAINT_*`, say —
 * and a NOT NULL or CHECK violation starts reading as a lost race, so real
 * corruption gets logged as routine contention and never surfaces.
 */
import { isUniqueConstraintError } from './sqlite-errors';

describe('isUniqueConstraintError', () => {
  it('matches the better-sqlite3 UNIQUE violation', () => {
    expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(
      true,
    );
  });

  it('matches a real Error carrying the code', () => {
    const err = Object.assign(new Error('UNIQUE constraint failed'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    expect(isUniqueConstraintError(err)).toBe(true);
  });

  it('does NOT match sibling constraint failures', () => {
    for (const code of [
      'SQLITE_CONSTRAINT',
      'SQLITE_CONSTRAINT_PRIMARYKEY',
      'SQLITE_CONSTRAINT_NOTNULL',
      'SQLITE_CONSTRAINT_CHECK',
      'SQLITE_CONSTRAINT_FOREIGNKEY',
      'SQLITE_BUSY',
    ]) {
      expect(isUniqueConstraintError({ code })).toBe(false);
    }
  });

  it('does not match a message that merely mentions UNIQUE', () => {
    expect(
      isUniqueConstraintError(new Error('UNIQUE constraint failed: t.a')),
    ).toBe(false);
  });

  it('is total over non-objects', () => {
    for (const value of [null, undefined, '', 'SQLITE_CONSTRAINT_UNIQUE', 0]) {
      expect(isUniqueConstraintError(value)).toBe(false);
    }
  });
});
