/**
 * Unit tests for the `Result<T, E>` success/error wrapper.
 *
 * Pure class — just Jest. Targets 100% branch coverage including the
 * defensive "unreachable" invariants (`_value` undefined in Ok state, etc.).
 */

import { Result } from './result';

describe('Result', () => {
  describe('factory methods', () => {
    it('Result.ok wraps a success value', () => {
      const r = Result.ok(42);

      expect(r.isOk()).toBe(true);
      expect(r.isErr()).toBe(false);
      expect(r.value).toBe(42);
      expect(r.error).toBeUndefined();
    });

    it('Result.err wraps an error value', () => {
      const err = new Error('boom');
      const r = Result.err(err);

      expect(r.isOk()).toBe(false);
      expect(r.isErr()).toBe(true);
      expect(r.error).toBe(err);
      expect(r.value).toBeUndefined();
    });

    it('freezes the instance so it is immutable', () => {
      const r = Result.ok('hello');
      expect(Object.isFrozen(r)).toBe(true);
    });

    it('supports subclasses of Error as the error type', () => {
      class CustomError extends Error {
        constructor(
          message: string,
          public readonly code: string,
        ) {
          super(message);
        }
      }
      const err = new CustomError('bad', 'E_BAD');
      const r = Result.err(err);

      expect(r.error).toBe(err);
      expect(r.error?.code).toBe('E_BAD');
    });
  });

  describe('unwrap', () => {
    it('returns the value for an Ok result', () => {
      expect(Result.ok('hi').unwrap()).toBe('hi');
    });

    it('throws the wrapped Error for an Err result', () => {
      const err = new Error('fail');
      expect(() => Result.err(err).unwrap()).toThrow(err);
    });

    it('allows `null` and `0` as valid Ok values', () => {
      expect(Result.ok(0).unwrap()).toBe(0);
      expect(Result.ok(null).unwrap()).toBeNull();
    });
  });

  describe('unwrapOr', () => {
    it('returns the value for an Ok result', () => {
      expect(Result.ok(10).unwrapOr(99)).toBe(10);
    });

    it('returns the default value for an Err result', () => {
      // Force the generic T on err-branch to match the default via explicit type.
      const r: Result<number, Error> = Result.err(new Error('nope'));
      expect(r.unwrapOr(99)).toBe(99);
    });

    it('returns the default value when Ok wraps undefined', () => {
      // `unwrapOr` treats `_value === undefined` as "absent" too.
      const r: Result<number | undefined, Error> = Result.ok(undefined);
      expect(r.unwrapOr(7)).toBe(7);
    });
  });

  describe('map', () => {
    it('transforms the value of an Ok result', () => {
      const r = Result.ok(3).map((n) => n * 2);
      expect(r.isOk()).toBe(true);
      expect(r.value).toBe(6);
    });

    it('passes through the error of an Err result without calling the mapper', () => {
      const err = new Error('stop');
      const mapper = jest.fn((n: number) => n + 1);
      const r: Result<number, Error> = Result.err(err);

      const mapped = r.map(mapper);

      expect(mapped.isErr()).toBe(true);
      expect(mapped.error).toBe(err);
      expect(mapper).not.toHaveBeenCalled();
    });
  });

  describe('flatMap', () => {
    it('chains Ok -> Ok', () => {
      const r = Result.ok(2).flatMap((n) => Result.ok(n + 10));
      expect(r.isOk()).toBe(true);
      expect(r.value).toBe(12);
    });

    it('chains Ok -> Err', () => {
      const err = new Error('downstream');
      const seed: Result<number, Error> = Result.ok(2);
      const r = seed.flatMap(() => Result.err(err));
      expect(r.isErr()).toBe(true);
      expect(r.error).toBe(err);
    });

    it('passes through the error of an Err result without calling the mapper', () => {
      const err = new Error('upstream');
      const mapper = jest.fn((n: number) => Result.ok(n));
      const r: Result<number, Error> = Result.err(err);

      const flatMapped = r.flatMap(mapper);

      expect(flatMapped.isErr()).toBe(true);
      expect(flatMapped.error).toBe(err);
      expect(mapper).not.toHaveBeenCalled();
    });
  });

  describe('defensive invariants (unreachable branches)', () => {
    // The branches below are only triggered if somebody constructs a Result
    // in an inconsistent state. They exist as runtime safeguards and we still
    // want them covered to lock behaviour in.

    function forceInconsistent(isSuccess: boolean): Result<number, Error> {
      // Use the private constructor via a cast. The constructor is
      // `(isSuccess, value?, error?)` — omit both to create inconsistency.
      type Ctor = new (
        isSuccess: boolean,
        value?: unknown,
        error?: Error,
      ) => Result<number, Error>;
      const AsCtor = Result as unknown as Ctor;
      return new AsCtor(isSuccess);
    }

    it('map throws when Ok but value is undefined', () => {
      const broken = forceInconsistent(true);
      expect(() => broken.map((n) => n + 1)).toThrow(
        'Result in Ok state but value is undefined',
      );
    });

    it('map throws when Err but error is undefined', () => {
      const broken = forceInconsistent(false);
      expect(() => broken.map((n) => n + 1)).toThrow(
        'Result in Err state but error is undefined',
      );
    });

    it('flatMap throws when Ok but value is undefined', () => {
      const broken = forceInconsistent(true);
      expect(() => broken.flatMap((n) => Result.ok(n))).toThrow(
        'Result in Ok state but value is undefined',
      );
    });

    it('flatMap throws when Err but error is undefined', () => {
      const broken = forceInconsistent(false);
      expect(() => broken.flatMap((n) => Result.ok(n))).toThrow(
        'Result in Err state but error is undefined',
      );
    });

    it('unwrap throws when Ok but value is undefined', () => {
      const broken = forceInconsistent(true);
      expect(() => broken.unwrap()).toThrow(
        'Result in Ok state but value is undefined',
      );
    });

    it('unwrap throws generic Unknown error when Err but error is undefined', () => {
      const broken = forceInconsistent(false);
      expect(() => broken.unwrap()).toThrow('Unknown error');
    });
  });
});
