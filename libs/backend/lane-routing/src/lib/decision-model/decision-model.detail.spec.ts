import { errorName } from './decision-model.detail';

/*
 * `errorName` is the only part of an untrusted rejection that reaches a log
 * or a row detail (review re-review round 1, R1-1). The dependency sets
 * `name` as freely as `message`, so anything outside the fixed built-in set
 * reads 'other'.
 */

const SENTINEL = 'sk-sentinel-5d7a-never-surfaced';

function named(name: string): Error {
  const error = new Error('message is never read');
  error.name = name;
  return error;
}

describe('errorName', () => {
  it.each([
    ['Error', new Error('x')],
    ['TypeError', new TypeError('x')],
    ['SyntaxError', new SyntaxError('x')],
    ['RangeError', new RangeError('x')],
    ['AbortError', named('AbortError')],
    ['TimeoutError', named('TimeoutError')],
  ])('passes the built-in name %s through', (expected, error) => {
    expect(errorName(error)).toBe(expected);
  });

  it.each([
    ['an Authorization header', `Authorization: Bearer ${SENTINEL}`],
    ['a bare key', SENTINEL],
    ['a URL with a key', `https://user:${SENTINEL}@gateway.example`],
    ['an allowlisted name with a suffix', `TypeError ${SENTINEL}`],
    ['a custom class name', 'KeychainError'],
    ['an empty name', ''],
  ])('reads %s as other', (_case, name) => {
    const result = errorName(named(name));
    expect(result).toBe('other');
    expect(result).not.toContain(SENTINEL);
  });

  it('reads a name getter that throws as other, without throwing', () => {
    const error = new Error('x');
    Object.defineProperty(error, 'name', {
      get(): string {
        throw new Error(`getter leaked ${SENTINEL}`);
      },
    });
    expect(() => errorName(error)).not.toThrow();
    expect(errorName(error)).toBe('other');
  });

  it('reads a name getter that returns a non-string as other', () => {
    const error = new Error('x');
    Object.defineProperty(error, 'name', {
      value: { toString: () => 'Error' },
    });
    expect(errorName(error)).toBe('other');
  });

  it.each([
    ['a string', `Authorization: Bearer ${SENTINEL}`],
    ['an object with a name', { name: 'TypeError', message: SENTINEL }],
    ['undefined', undefined],
    ['null', null],
  ])('reads a non-Error rejection (%s) as other', (_case, rejection) => {
    expect(errorName(rejection)).toBe('other');
  });
});
