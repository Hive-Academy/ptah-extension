/**
 * OpenAI Request Translator — unit specs.
 *
 * Surface under test:
 *   - `translateAnthropicToOpenAI()` end-to-end conversion of an Anthropic
 *     Messages API request into an OpenAI Chat Completions request.
 *   - Exported helper primitives: `translateSystemPrompt`,
 *     `translateMessages`, `translateTools`, `translateToolChoice`.
 *   - Model-prefix handling (Copilot 'capi:' vs. Codex '' passthrough) with
 *     idempotence (never double-prefixing).
 *   - Field mapping invariants: max_tokens → max_completion_tokens (modern
 *     OpenAI field), stream → stream + stream_options.include_usage, strip
 *     unsupported thinking/metadata/cache_control.
 *   - tool_result blocks become separate role:'tool' messages preceding the
 *     remaining user content — matches OpenAI's expected ordering.
 *
 * These are pure functions, so no mocks are needed. We rely on inline
 * snapshots for the end-to-end round-trip assertions where the full shape
 * is load-bearing.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/openai-translation/request-translator.ts`
 */

import {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateMessages,
  translateTools,
  translateToolChoice,
} from './request-translator';
import type {
  AnthropicMessagesRequest,
  AnthropicMessage,
  AnthropicToolDefinition,
} from './openai-translation.types';

// 1×1 transparent PNG (magic bytes guarantee resolveImageMediaType returns
// 'image/png' regardless of what was declared as media_type).
const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

describe('translateSystemPrompt', () => {
  it('returns undefined for a missing system prompt', () => {
    expect(translateSystemPrompt(undefined)).toBeUndefined();
  });

  it('accepts a string and wraps it in a role=system message', () => {
    expect(translateSystemPrompt('you are helpful')).toEqual({
      role: 'system',
      content: 'you are helpful',
    });
  });

  it('concatenates array-of-text blocks with double newlines', () => {
    const out = translateSystemPrompt([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]);
    expect(out).toEqual({ role: 'system', content: 'first\n\nsecond' });
  });

  it('returns undefined for whitespace-only text', () => {
    expect(translateSystemPrompt('   \n\t ')).toBeUndefined();
    expect(
      translateSystemPrompt([{ type: 'text', text: '   ' }]),
    ).toBeUndefined();
  });
});

describe('translateToolChoice', () => {
  it('maps auto → "auto"', () => {
    expect(translateToolChoice({ type: 'auto' })).toBe('auto');
  });

  it('maps Anthropic "any" → OpenAI "required" (must pick SOME tool)', () => {
    expect(translateToolChoice({ type: 'any' })).toBe('required');
  });

  it('maps a named tool to the OpenAI function-choice object', () => {
    expect(translateToolChoice({ type: 'tool', name: 'search' })).toEqual({
      type: 'function',
      function: { name: 'search' },
    });
  });
});

describe('translateTools', () => {
  it('maps Anthropic tool definitions into OpenAI function tools, preserving schemas', () => {
    const tools: AnthropicToolDefinition[] = [
      {
        name: 'search',
        description: 'Search the web',
        input_schema: { type: 'object', properties: { q: { type: 'string' } } },
      },
      {
        name: 'ping',
        // No description or schema — exercises the spread-guards.
        input_schema: {} as Record<string, unknown>,
      },
    ];
    expect(translateTools(tools)).toEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search the web',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string' } },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'ping',
          parameters: {},
        },
      },
    ]);
  });
});

describe('translateMessages', () => {
  it('returns a string-content user message when the Anthropic message content is a plain string', () => {
    const input: AnthropicMessage[] = [{ role: 'user', content: 'hi' }];
    expect(translateMessages(input)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('collapses a single text block into string content (not an array)', () => {
    const input: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];
    expect(translateMessages(input)).toEqual([
      { role: 'user', content: 'hello' },
    ]);
  });

  it('emits multi-part content parts when images are mixed in', () => {
    const input: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: PNG_1X1_B64,
            },
          },
        ],
      },
    ];
    const out = translateMessages(input);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
    expect(Array.isArray(out[0].content)).toBe(true);
    const parts = out[0].content as Array<{ type: string }>;
    expect(parts[0]).toEqual({ type: 'text', text: 'describe this' });
    expect(parts[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${PNG_1X1_B64}` },
    });
  });

  it('drops images whose media_type cannot be resolved (poisoned sessions)', () => {
    const input: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/svg+xml', // unsupported by OpenAI shape
              data: 'PHN2Zy8+', // <svg/> in base64 — no PNG magic bytes
            },
          },
        ],
      },
    ];
    const out = translateMessages(input);
    // Image dropped → single-text collapse kicks in.
    expect(out).toEqual([{ role: 'user', content: 'look' }]);
  });

  it('splits tool_result blocks into role:"tool" messages emitted BEFORE the residual user content', () => {
    const input: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: '42',
            is_error: false,
          },
          { type: 'text', text: 'and here is a follow-up' },
        ],
      },
    ];
    const out = translateMessages(input);
    expect(out).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: '42' },
      { role: 'user', content: 'and here is a follow-up' },
    ]);
  });

  it('flattens tool_result array content to joined text and prefixes "Error: " on error results', () => {
    const input: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_err',
            content: [
              { type: 'text', text: 'line 1' },
              { type: 'text', text: 'line 2' },
            ],
            is_error: true,
          },
        ],
      },
    ];
    expect(translateMessages(input)).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_err',
        content: 'Error: line 1\nline 2',
      },
    ]);
  });

  it('translates assistant tool_use blocks into tool_calls with JSON-stringified arguments', () => {
    const input: AnthropicMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'search',
            input: { q: 'ptah' },
          },
        ],
      },
    ];
    expect(translateMessages(input)).toEqual([
      {
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"ptah"}' },
          },
        ],
      },
    ]);
  });

  it('emits an assistant message with null content when only tool calls are present', () => {
    const input: AnthropicMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_only',
            name: 'search',
            input: {},
          },
        ],
      },
    ];
    const out = translateMessages(input);
    expect(out[0]).toMatchObject({
      role: 'assistant',
      content: null,
      tool_calls: [expect.objectContaining({ id: 'toolu_only' })],
    });
  });
});

describe('translateAnthropicToOpenAI (end-to-end round-trip)', () => {
  const baseRequest: AnthropicMessagesRequest = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: 'you are helpful',
    messages: [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'one moment' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'search',
            input: { q: 'ptah' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'found it',
          },
        ],
      },
    ],
    stream: true,
    tools: [
      {
        name: 'search',
        description: 'Search the web',
        input_schema: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ],
    tool_choice: { type: 'auto' },
    // These fields MUST be stripped.
    thinking: { type: 'enabled', budget_tokens: 1000 },
    metadata: { user_id: 'u1' },
  };

  it('produces the expected full OpenAI Chat Completions shape (no prefix)', () => {
    const out = translateAnthropicToOpenAI(baseRequest);
    expect(out).toMatchInlineSnapshot(`
{
  "max_completion_tokens": 4096,
  "messages": [
    {
      "content": "you are helpful",
      "role": "system",
    },
    {
      "content": "hello",
      "role": "user",
    },
    {
      "content": "one moment",
      "role": "assistant",
      "tool_calls": [
        {
          "function": {
            "arguments": "{"q":"ptah"}",
            "name": "search",
          },
          "id": "toolu_1",
          "type": "function",
        },
      ],
    },
    {
      "content": "found it",
      "role": "tool",
      "tool_call_id": "toolu_1",
    },
  ],
  "model": "claude-sonnet-4-20250514",
  "stream": true,
  "stream_options": {
    "include_usage": true,
  },
  "tool_choice": "auto",
  "tools": [
    {
      "function": {
        "description": "Search the web",
        "name": "search",
        "parameters": {
          "properties": {
            "q": {
              "type": "string",
            },
          },
          "type": "object",
        },
      },
      "type": "function",
    },
  ],
}
`);
  });

  it("applies a Copilot-style 'capi:' prefix exactly once (idempotent)", () => {
    const out = translateAnthropicToOpenAI(baseRequest, {
      modelPrefix: 'capi:',
    });
    expect(out.model).toBe('capi:claude-sonnet-4-20250514');

    // Re-translating a pre-prefixed request must NOT double-prefix.
    const preprefixed = {
      ...baseRequest,
      model: 'capi:claude-sonnet-4-20250514',
    };
    const out2 = translateAnthropicToOpenAI(preprefixed, {
      modelPrefix: 'capi:',
    });
    expect(out2.model).toBe('capi:claude-sonnet-4-20250514');
  });

  it('omits stream_options when stream is falsy', () => {
    const { ...req } = baseRequest;
    const out = translateAnthropicToOpenAI({ ...req, stream: false });
    expect(out.stream).toBeUndefined();
    expect(out.stream_options).toBeUndefined();
  });

  it('strips thinking, metadata, and cache_control silently', () => {
    const out = translateAnthropicToOpenAI(baseRequest);
    expect(out).not.toHaveProperty('thinking');
    expect(out).not.toHaveProperty('metadata');
    for (const msg of out.messages) {
      expect(msg).not.toHaveProperty('cache_control');
    }
  });
});
