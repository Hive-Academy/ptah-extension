import {
  parsePartialToolInput,
  parseStreamingToolInputCached,
  STREAMING_TOOL_INPUT_PARSE_CHARS,
} from '@ptah-extension/chat-types';

describe('parsePartialToolInput', () => {
  it.each([
    ['{"command":"echo hi"}', { command: 'echo hi' }],
    ['{"command":"echo hi', { command: 'echo hi' }],
    ['{"command":"echo \\', { command: 'echo ' }],
    ['{"command":"hi\\u00', { command: 'hi' }],
    ['{"nested":{"items":[1,2', { nested: { items: [1, 2] } }],
    ['{"a":1,', { a: 1 }],
    ['{"a":1,"b":', { a: 1 }],
    ['{"a":[1,2,', { a: [1, 2] }],
    ['garbage', null],
  ])('recovers %s', (raw, expected) => {
    expect(parsePartialToolInput(raw)).toEqual(expected);
  });
});

describe('parseStreamingToolInputCached', () => {
  it('returns the full parse when the input is complete', () => {
    expect(
      parseStreamingToolInputCached('call-full', '{"command":"ls"} '),
    ).toEqual({ command: 'ls' });
  });

  it('parses only the capped head of a large streaming input', () => {
    const content = 'x'.repeat(STREAMING_TOOL_INPUT_PARSE_CHARS * 2);
    const raw = '{"file_path":"a.ts","content":"' + content;
    const value = parseStreamingToolInputCached('call-big', raw);
    expect(value?.['file_path']).toBe('a.ts');
    expect(String(value?.['content']).length).toBeLessThan(
      STREAMING_TOOL_INPUT_PARSE_CHARS,
    );
  });

  it('does not fully parse a large input that ends with a brace', () => {
    const head = '{"content":"' + 'z'.repeat(STREAMING_TOOL_INPUT_PARSE_CHARS);
    const parseSpy = jest.spyOn(JSON, 'parse');
    parseStreamingToolInputCached('call-brace', head + '}');
    parseSpy.mockClear();
    parseStreamingToolInputCached('call-brace', head + '}}');
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it('reuses the result while the capped head is unchanged', () => {
    const head = '{"content":"' + 'y'.repeat(STREAMING_TOOL_INPUT_PARSE_CHARS);
    const first = parseStreamingToolInputCached('call-same', head + 'a');
    const second = parseStreamingToolInputCached('call-same', head + 'ab');
    expect(second).toBe(first);
  });
});
