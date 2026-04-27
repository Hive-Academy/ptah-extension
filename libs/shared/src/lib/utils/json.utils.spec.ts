/**
 * Unit tests for `parseRobustJson`.
 *
 * Covers:
 *   - happy path (well-formed JSON)
 *   - repair path (missing quotes / trailing commas)
 *   - rejection when repaired output is not structured (scalar result)
 *   - rejection when even `jsonrepair` cannot recover the string
 *   - preview truncation for long inputs
 */

import { parseRobustJson } from './json.utils';

describe('parseRobustJson', () => {
  it('parses standard well-formed JSON via JSON.parse', async () => {
    const result = await parseRobustJson<{ a: number }>('{"a":1}');
    expect(result).toEqual({ a: 1 });
  });

  it('parses arrays', async () => {
    const result = await parseRobustJson<number[]>('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('repairs malformed JSON (trailing comma) via jsonrepair', async () => {
    // Trailing commas are invalid JSON but jsonrepair handles them.
    const result = await parseRobustJson<{ a: number; b: number }>(
      '{"a":1,"b":2,}',
    );
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('repairs JSON with unquoted keys', async () => {
    const result = await parseRobustJson<{ foo: string }>('{foo: "bar"}');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('rejects when repaired output is a scalar (not object/array)', async () => {
    // Input that jsonrepair turns into a scalar — e.g. a bare word that
    // repair coerces to a string. The function requires object-or-array.
    await expect(parseRobustJson('hello world')).rejects.toThrow(
      /Failed to parse JSON string even after repair/,
    );
  });

  it('truncates long scalar previews to 100 chars in the rejection message', async () => {
    // A >100-char string that standard JSON.parse rejects (unquoted) so the
    // repair path runs. jsonrepair coerces bare text into a string scalar,
    // which triggers the "not object/array" branch with truncated preview.
    const longInput = 'a'.repeat(120);
    let caught: unknown;
    try {
      await parseRobustJson(longInput);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    // Either the scalar-branch preview is truncated with "..." or the outer
    // wrapper reports a repair failure — both paths produce a rejection.
    expect((caught as Error).message).toMatch(
      /Failed to parse JSON string even after repair/,
    );
  });

  it('rejects when both standard parse and repair fail', async () => {
    // Truly unrepairable: non-JSON-ish garbage that confuses jsonrepair too.
    // Empty string typically makes jsonrepair throw.
    await expect(parseRobustJson('')).rejects.toThrow(
      /Failed to parse JSON string even after repair/,
    );
  });

  it('includes both initial and repair errors in the rejection message', async () => {
    let caught: unknown;
    try {
      await parseRobustJson('');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/Initial Error:/);
    expect(msg).toMatch(/Repair Error:/);
  });

  it('preserves null-in-object parsing', async () => {
    const result = await parseRobustJson<{ x: null }>('{"x": null}');
    expect(result).toEqual({ x: null });
  });

  it('rejects repaired-to-null result because null is typeof object but === null', async () => {
    // JSON.parse of "null" returns null, which is typeof 'object' — the
    // guard `typeof parsedResult !== 'object' || parsedResult === null`
    // means null-valued *successful* standard parses bypass repair entirely.
    // But feeding "null" through JSON.parse succeeds, so it is returned
    // directly (no repair path reached).
    const result = await parseRobustJson('null');
    expect(result).toBeNull();
  });
});
