/**
 * Integrity worker protocol specs (TASK_2026_380 B1).
 *
 * The two functions here are the pure half of the worker, and they are unit
 * tested separately because the worker ENTRY cannot be imported in Jest: it
 * subscribes to a parent port at module scope and throws when there is none.
 * The entry itself is exercised end to end through a fake factory in
 * `integrity-check.service.spec.ts`.
 *
 * `classifyQuickCheck` carries the single most consequential rule in this
 * feature: which failures are allowed to be called corruption.
 */
import {
  classifyQuickCheck,
  isIntegrityCheckRequest,
} from './integrity-worker-protocol';

describe('classifyQuickCheck', () => {
  it("returns 'ok' only for the literal ok, trimmed", () => {
    expect(classifyQuickCheck('ok')).toBe('ok');
    expect(classifyQuickCheck('ok\n')).toBe('ok');
    expect(classifyQuickCheck('  ok  ')).toBe('ok');
  });

  it("returns 'corrupt' for any other string, because the pragma ANSWERED", () => {
    expect(classifyQuickCheck('*** in database main ***')).toBe('corrupt');
    expect(classifyQuickCheck('row 42 missing from index')).toBe('corrupt');
    expect(classifyQuickCheck('')).toBe('corrupt');
  });

  it("returns 'unavailable' for a non-string, because we got no answer", () => {
    // A driver that returned rows, `undefined`, or nothing at all has not told
    // us the file is bad — it has told us nothing. Calling that corruption is
    // the one mistake this vocabulary exists to prevent: the service writes no
    // record for `unavailable`, so an inconclusive check retries instead of
    // being remembered.
    expect(classifyQuickCheck(undefined)).toBe('unavailable');
    expect(classifyQuickCheck(null)).toBe('unavailable');
    expect(classifyQuickCheck([])).toBe('unavailable');
    expect(classifyQuickCheck({ ok: true })).toBe('unavailable');
    expect(classifyQuickCheck(1)).toBe('unavailable');
  });

  it('is pure — the same input always classifies the same way', () => {
    expect(classifyQuickCheck('ok')).toBe(classifyQuickCheck('ok'));
    expect(classifyQuickCheck('bad')).toBe(classifyQuickCheck('bad'));
  });
});

describe('isIntegrityCheckRequest', () => {
  it('accepts a well-formed check request', () => {
    expect(
      isIntegrityCheckRequest({
        id: 1,
        type: 'check',
        dbPath: 'C:\\db.sqlite',
      }),
    ).toBe(true);
  });

  it('rejects anything else, including an empty dbPath', () => {
    // An empty path would reach `better-sqlite3` and, without
    // `fileMustExist: true`, could open something that is not the database.
    expect(isIntegrityCheckRequest({ id: 1, type: 'check', dbPath: '' })).toBe(
      false,
    );
    expect(isIntegrityCheckRequest({ id: 1, type: 'init' })).toBe(false);
    expect(isIntegrityCheckRequest({ type: 'check', dbPath: 'x' })).toBe(false);
    expect(
      isIntegrityCheckRequest({ id: '1', type: 'check', dbPath: 'x' }),
    ).toBe(false);
    expect(isIntegrityCheckRequest(null)).toBe(false);
    expect(isIntegrityCheckRequest('check')).toBe(false);
  });
});
