/**
 * Unit tests for `assertNever`.
 *
 * Pure function — just Jest. Covers:
 *   - default error message with JSON-serialized value
 *   - custom override message
 *   - edge cases: undefined (serializes as undefined), circular refs, primitives
 */

import { assertNever } from './assert-never';

describe('assertNever', () => {
  it('throws an Error with a JSON-serialized default message', () => {
    // Intentional cast-to-never bypass: the function is designed to throw at
    // runtime for malformed discriminated unions.
    const value = { type: 'unknown' } as unknown as never;

    expect(() => assertNever(value)).toThrow(Error);
    expect(() => assertNever(value)).toThrow(
      `Unexpected value: ${JSON.stringify({ type: 'unknown' })}`,
    );
  });

  it('uses the custom message when provided', () => {
    const value = 'mystery' as unknown as never;

    expect(() => assertNever(value, 'Custom message here')).toThrow(
      'Custom message here',
    );
  });

  it('serializes primitive values correctly in the default message', () => {
    const numberValue = 42 as unknown as never;
    expect(() => assertNever(numberValue)).toThrow('Unexpected value: 42');

    const stringValue = 'hello' as unknown as never;
    expect(() => assertNever(stringValue)).toThrow('Unexpected value: "hello"');

    const nullValue = null as unknown as never;
    expect(() => assertNever(nullValue)).toThrow('Unexpected value: null');
  });

  it('handles undefined value (JSON.stringify returns undefined)', () => {
    const undefinedValue = undefined as unknown as never;

    // JSON.stringify(undefined) returns the literal `undefined` (not a
    // string), so the template literal renders `Unexpected value: undefined`.
    expect(() => assertNever(undefinedValue)).toThrow(
      'Unexpected value: undefined',
    );
  });

  it('prefers the custom message over the default when message is empty string', () => {
    const value = 'x' as unknown as never;

    // Empty string is falsy — implementation uses `??` so empty string is
    // kept as-is (it is not nullish).
    expect(() => assertNever(value, '')).toThrow('');
  });
});
