/**
 * OpenAI Responses API Request Translator — unit specs.
 *
 * Surface under test:
 *   - `translateAnthropicToResponses()` end-to-end conversion of an
 *     Anthropic Messages request into an OpenAI Responses API request
 *     (GPT-5.3+, Codex API).
 *   - Shape differences vs. Chat Completions:
 *       * `input` array (not `messages`)
 *       * system → developer role + top-level `instructions` string
 *       * user text → `input_text`, assistant text → `output_text`
 *       * tool calls → `function_call` items
 *       * tool results → `function_call_output` items
 *       * FLAT tools (name at top level) — not nested under `function`
 *       * `store: false` (Codex requirement)
 *       * NO `max_output_tokens` (Codex rejects it)
 *       * NO `tool_choice` (unsupported)
 *   - Model-prefix idempotence (matches chat-completions translator).
 *   - Streaming flag passes through; thinking/metadata stripped.
 *
 * Pure functions → no mocks needed. Inline snapshots document the expected
 * shape as-of this batch.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/openai-translation/responses-request-translator.ts`
 */

import {
  translateAnthropicToResponses,
  translateToolsForResponses,
} from './responses-request-translator';
import type {
  AnthropicMessagesRequest,
  AnthropicToolDefinition,
} from './openai-translation.types';

const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

describe('translateToolsForResponses', () => {
  it('emits the FLAT tool shape with name at the top level (not nested under function)', () => {
    const tools: AnthropicToolDefinition[] = [
      {
        name: 'lookup',
        description: 'Find things',
        input_schema: { type: 'object' },
      },
    ];
    expect(translateToolsForResponses(tools)).toEqual([
      {
        type: 'function',
        name: 'lookup',
        description: 'Find things',
        parameters: { type: 'object' },
      },
    ]);
  });

  it('omits description / parameters when the Anthropic def has none', () => {
    const tools: AnthropicToolDefinition[] = [
      { name: 'bare', input_schema: {} as Record<string, unknown> },
    ];
    const [out] = translateToolsForResponses(tools);
    expect(out.name).toBe('bare');
    expect(out.description).toBeUndefined();
    // parameters is an empty object per the spread-guard behaviour (schema
    // is non-null but empty — we still emit parameters: {}).
    expect(out.parameters).toEqual({});
  });
});

describe('translateAnthropicToResponses (end-to-end round-trip)', () => {
  const baseRequest: AnthropicMessagesRequest = {
    model: 'gpt-5.4',
    max_tokens: 8192,
    system: 'you are helpful',
    messages: [
      { role: 'user', content: 'find things' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok, searching' },
          {
            type: 'tool_use',
            id: 'call_1',
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
            tool_use_id: 'call_1',
            content: 'found',
          },
        ],
      },
    ],
    stream: true,
    tools: [
      {
        name: 'search',
        description: 'Search',
        input_schema: { type: 'object' },
      },
    ],
    tool_choice: { type: 'auto' },
    thinking: { type: 'enabled', budget_tokens: 1000 },
    metadata: { user_id: 'u1' },
  };

  it('produces the expected Responses API request shape (inline snapshot)', () => {
    const out = translateAnthropicToResponses(baseRequest);
    expect(out).toMatchInlineSnapshot(`
{
  "input": [
    {
      "content": "you are helpful",
      "role": "developer",
    },
    {
      "content": [
        {
          "text": "find things",
          "type": "input_text",
        },
      ],
      "role": "user",
    },
    {
      "content": [
        {
          "text": "ok, searching",
          "type": "output_text",
        },
      ],
      "role": "assistant",
    },
    {
      "arguments": "{"q":"ptah"}",
      "call_id": "call_1",
      "name": "search",
      "type": "function_call",
    },
    {
      "call_id": "call_1",
      "output": "found",
      "type": "function_call_output",
    },
  ],
  "instructions": "you are helpful",
  "model": "gpt-5.4",
  "store": false,
  "stream": true,
  "tools": [
    {
      "description": "Search",
      "name": "search",
      "parameters": {
        "type": "object",
      },
      "type": "function",
    },
  ],
}
`);
  });

  it('does NOT emit max_output_tokens (Codex rejects it)', () => {
    const out = translateAnthropicToResponses(baseRequest);
    expect(out).not.toHaveProperty('max_output_tokens');
  });

  it('does NOT emit tool_choice (Responses API does not support it)', () => {
    const out = translateAnthropicToResponses(baseRequest);
    expect(out).not.toHaveProperty('tool_choice');
  });

  it('always sets store=false (Codex API contract)', () => {
    const out = translateAnthropicToResponses(baseRequest);
    expect(out.store).toBe(false);
  });

  it('applies modelPrefix idempotently (no double-prefix on already-prefixed model)', () => {
    const once = translateAnthropicToResponses(baseRequest, {
      modelPrefix: 'codex:',
    });
    expect(once.model).toBe('codex:gpt-5.4');

    const twice = translateAnthropicToResponses(
      { ...baseRequest, model: 'codex:gpt-5.4' },
      { modelPrefix: 'codex:' },
    );
    expect(twice.model).toBe('codex:gpt-5.4');
  });

  it('strips thinking and metadata fields silently', () => {
    const out = translateAnthropicToResponses(baseRequest);
    expect(out).not.toHaveProperty('thinking');
    expect(out).not.toHaveProperty('metadata');
  });

  it('omits stream when the Anthropic request did not request streaming', () => {
    const out = translateAnthropicToResponses({
      ...baseRequest,
      stream: false,
    });
    expect(out.stream).toBeUndefined();
  });

  it('drops images whose media_type cannot be resolved (poisoned sessions)', () => {
    const req: AnthropicMessagesRequest = {
      model: 'gpt-5.4',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hi' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/svg+xml',
                data: 'PHN2Zy8+',
              },
            },
          ],
        },
      ],
    };
    const out = translateAnthropicToResponses(req);
    const userMsg = out.input[0] as {
      role: string;
      content: Array<{ type: string }>;
    };
    expect(userMsg.role).toBe('user');
    expect(userMsg.content).toEqual([{ type: 'input_text', text: 'hi' }]);
  });

  it('preserves resolved PNG images as input_image parts', () => {
    const req: AnthropicMessagesRequest = {
      model: 'gpt-5.4',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: [
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
      ],
    };
    const out = translateAnthropicToResponses(req);
    const userMsg = out.input[0] as {
      content: Array<{ type: string; image_url?: string }>;
    };
    expect(userMsg.content[0]).toMatchObject({
      type: 'input_image',
      image_url: `data:image/png;base64,${PNG_1X1_B64}`,
    });
  });

  it('joins array tool_result content and prefixes Error: for is_error=true results', () => {
    const req: AnthropicMessagesRequest = {
      model: 'gpt-5.4',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'err_call',
              content: [
                { type: 'text', text: 'line 1' },
                { type: 'text', text: 'line 2' },
              ],
              is_error: true,
            },
          ],
        },
      ],
    };
    const out = translateAnthropicToResponses(req);
    expect(out.input[0]).toEqual({
      type: 'function_call_output',
      call_id: 'err_call',
      output: 'Error: line 1\nline 2',
    });
  });

  it('emits an empty developer message when system is absent (no instructions key)', () => {
    const req: AnthropicMessagesRequest = {
      model: 'gpt-5.4',
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'hi' }],
    };
    const out = translateAnthropicToResponses(req);
    expect(out).not.toHaveProperty('instructions');
    // First input is the user message — no developer message precedes it.
    expect(out.input[0]).toMatchObject({ role: 'user' });
  });
});
