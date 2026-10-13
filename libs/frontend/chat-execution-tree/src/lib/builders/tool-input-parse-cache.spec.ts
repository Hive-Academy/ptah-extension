/**
 * `parseToolInputCached` lives in `@ptah-extension/chat-types`, which has no
 * Jest target; its first consumer (`tool-node.fn.ts`) hosts the spec.
 */
import {
  clearToolInputParseCache,
  parseToolInputCached,
  TOOL_INPUT_PARSE_CACHE_LIMIT,
  TOOL_INPUT_PARSE_CACHE_MAX_ENTRY_CHARS,
  TOOL_INPUT_PARSE_CACHE_MAX_RETAINED_CHARS,
} from '@ptah-extension/chat-types';

/** A JSON object whose text is exactly `length` characters. */
function rawOfLength(length: number): string {
  const shell = '{"p":""}';
  return `{"p":"${'x'.repeat(length - shell.length)}"}`;
}

describe('parseToolInputCached', () => {
  beforeEach(() => clearToolInputParseCache());
  afterEach(() => jest.restoreAllMocks());

  it('parses an input over the per-entry cap fresh each time and keeps none', () => {
    const raw = rawOfLength(TOOL_INPUT_PARSE_CACHE_MAX_ENTRY_CHARS + 1);
    const parse = jest.spyOn(JSON, 'parse');

    const first = parseToolInputCached('big', raw);
    const second = parseToolInputCached('big', raw);

    expect(first.success).toBe(true);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('caches an input exactly at the per-entry cap', () => {
    const raw = rawOfLength(TOOL_INPUT_PARSE_CACHE_MAX_ENTRY_CHARS);
    const first = parseToolInputCached('edge', raw);
    expect(parseToolInputCached('edge', raw)).toBe(first);
  });

  it('evicts the oldest entries once the retained-size budget is exceeded', () => {
    // Each entry retains 3x its raw length (raw + 2x parsed estimate).
    const length = 30_000;
    const perEntry = length * 3;
    const fits = Math.floor(TOOL_INPUT_PARSE_CACHE_MAX_RETAINED_CHARS / perEntry);
    const results = [];
    for (let i = 0; i <= fits; i++) {
      results.push(parseToolInputCached(`call-${i}`, rawOfLength(length)));
    }

    // One entry over budget: only the oldest (call-0) was dropped.
    expect(parseToolInputCached('call-1', rawOfLength(length))).toBe(results[1]);
    expect(parseToolInputCached(`call-${fits}`, rawOfLength(length))).toBe(
      results[fits],
    );
    expect(parseToolInputCached('call-0', rawOfLength(length))).not.toBe(
      results[0],
    );
  });

  it('returns the identical result object for the same id and raw string', () => {
    const parse = jest.spyOn(JSON, 'parse');
    const raw = JSON.stringify({ file_path: '/tmp/a.txt' });

    const first = parseToolInputCached('call-1', raw);
    const second = parseToolInputCached('call-1', raw);

    expect(first).toEqual({ success: true, data: { file_path: '/tmp/a.txt' } });
    expect(second).toBe(first);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('parses again and replaces the entry when the raw string changes', () => {
    const first = parseToolInputCached('call-1', '{"a":1}');
    const second = parseToolInputCached('call-1', '{"a":2}');

    expect(second).not.toBe(first);
    expect(second).toEqual({ success: true, data: { a: 2 } });
    expect(parseToolInputCached('call-1', '{"a":2}')).toBe(second);
  });

  it('returns the failure shape for invalid JSON and for a non-object', () => {
    const invalid = parseToolInputCached('call-1', '{file_path:bad');
    expect(invalid.success).toBe(false);
    expect(invalid).toMatchObject({ raw: '{file_path:bad' });
    expect(invalid.success === false && invalid.error).toContain('SyntaxError');

    expect(parseToolInputCached('call-2', '42')).toEqual({
      success: false,
      error: 'Not an object',
      raw: '42',
    });
    expect(parseToolInputCached('call-3', 'null')).toEqual({
      success: false,
      error: 'Not an object',
      raw: 'null',
    });
  });

  it('evicts the least recently used id past the cap', () => {
    const first = parseToolInputCached('call-0', '{"n":0}');
    const second = parseToolInputCached('call-1', '{"n":1}');
    for (let i = 2; i < TOOL_INPUT_PARSE_CACHE_LIMIT; i++) {
      parseToolInputCached(`call-${i}`, `{"n":${i}}`);
    }
    // Touch call-0 so call-1 becomes the oldest, then overflow by one.
    expect(parseToolInputCached('call-0', '{"n":0}')).toBe(first);
    parseToolInputCached('call-overflow', '{"n":-1}');

    expect(parseToolInputCached('call-0', '{"n":0}')).toBe(first);
    expect(parseToolInputCached('call-1', '{"n":1}')).not.toBe(second);
  });
});
