/**
 * OpenAI Response Translator — unit specs (TASK_2025_294 W6.B1).
 *
 * Surface under test:
 *   - `OpenAIResponseTranslator.translateChunk()` converts OpenAI SSE chunks
 *     into Anthropic SSE event strings.
 *   - Full streaming lifecycle: message_start (on first chunk) →
 *     content_block_start (text or tool_use) → content_block_delta stream →
 *     content_block_stop → message_delta + message_stop (on finalize or
 *     finish_reason).
 *   - Multi-tool-call accumulation: each tool index gets its own Anthropic
 *     content block index to avoid collisions when the model calls parallel
 *     tools.
 *   - stop_reason inference: if any tool calls were seen in the stream the
 *     translator MUST emit stop_reason='tool_use' regardless of the
 *     upstream finish_reason (prevents premature SDK termination).
 *   - Idempotent finalize(): calling finalize after the stream already
 *     terminated via finish_reason is a no-op.
 *
 * Inline snapshots are used for the full round-trip assertions where event
 * ordering + framing is the load-bearing property.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/openai-translation/response-translator.ts`
 */

import { OpenAIResponseTranslator } from './response-translator';
import type {
  OpenAIStreamChunk,
  OpenAIStreamChoice,
} from './openai-translation.types';

// ---------------------------------------------------------------------------
// Helpers — parse a single SSE event string the translator produces into a
// typed {event, data} pair so assertions read clearly.
// ---------------------------------------------------------------------------

interface ParsedEvent {
  event: string;
  data: Record<string, unknown>;
}

function parse(sse: string): ParsedEvent {
  const lines = sse.split('\n');
  const eventLine = lines.find((l) => l.startsWith('event: ')) ?? '';
  const dataLine = lines.find((l) => l.startsWith('data: ')) ?? '';
  return {
    event: eventLine.slice(7),
    data: JSON.parse(dataLine.slice(6)) as Record<string, unknown>,
  };
}

function parseAll(sseArray: readonly string[]): ParsedEvent[] {
  return sseArray.map(parse);
}

function textChunk(text: string): OpenAIStreamChunk {
  return {
    choices: [
      {
        index: 0,
        delta: { content: text },
      } as OpenAIStreamChoice,
    ],
  };
}

function toolCallChunk(
  index: number,
  opts: { id?: string; name?: string; args?: string },
): OpenAIStreamChunk {
  const toolDelta: {
    index: number;
    id?: string;
    type?: 'function';
    function: { name?: string; arguments?: string };
  } = {
    index,
    function: {},
  };
  if (opts.id) {
    toolDelta.id = opts.id;
    toolDelta.type = 'function';
  }
  if (opts.name) toolDelta.function.name = opts.name;
  if (opts.args) toolDelta.function.arguments = opts.args;
  return {
    choices: [
      {
        index: 0,
        delta: { tool_calls: [toolDelta] },
      } as OpenAIStreamChoice,
    ],
  };
}

function finishChunk(reason: string): OpenAIStreamChunk {
  return {
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: reason,
      } as OpenAIStreamChoice,
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  };
}

// ---------------------------------------------------------------------------
// Text-only stream
// ---------------------------------------------------------------------------

describe('OpenAIResponseTranslator — text-only streaming round-trip', () => {
  it('emits message_start → content_block_start (text) → text_delta → content_block_stop → message_delta(end_turn) → message_stop', () => {
    const t = new OpenAIResponseTranslator('claude-sonnet-4', 'req-abc');

    const all: string[] = [];
    all.push(...t.translateChunk(textChunk('Hello ')));
    all.push(...t.translateChunk(textChunk('world')));
    all.push(...t.translateChunk(finishChunk('stop')));

    const parsed = parseAll(all);
    const sequence = parsed.map((p) => p.event);
    expect(sequence).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);

    // message_start carries model + request id framing.
    expect(parsed[0].data).toMatchObject({
      type: 'message_start',
      message: expect.objectContaining({
        id: 'msg_req-abc',
        model: 'claude-sonnet-4',
        role: 'assistant',
      }),
    });

    // text_delta payloads match chunk order.
    expect(parsed[2].data).toMatchObject({
      delta: { type: 'text_delta', text: 'Hello ' },
      index: 0,
    });
    expect(parsed[3].data).toMatchObject({
      delta: { type: 'text_delta', text: 'world' },
    });

    // No tool calls → end_turn.
    expect(parsed[5].data).toMatchObject({
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 50 },
    });
  });

  it('skips empty-string and null text deltas (no redundant content_block events)', () => {
    const t = new OpenAIResponseTranslator('m', 'req');
    const out1 = t.translateChunk({
      choices: [{ index: 0, delta: { content: '' } } as OpenAIStreamChoice],
    });
    const out2 = t.translateChunk({
      choices: [{ index: 0, delta: { content: null } } as OpenAIStreamChoice],
    });
    // First chunk still emits message_start — but no content_block_start /
    // delta for the empty content.
    expect(out1.map(parse).map((e) => e.event)).toEqual(['message_start']);
    expect(out2).toEqual([]); // message_start already sent, empty content = no events
  });
});

// ---------------------------------------------------------------------------
// Tool-call stream
// ---------------------------------------------------------------------------

describe('OpenAIResponseTranslator — tool-call streaming', () => {
  it('accumulates id/name/arguments across deltas and emits tool_use content block with input_json_delta chunks', () => {
    const t = new OpenAIResponseTranslator('m', 'req-1');

    const events: string[] = [];
    // First tool delta: id + name
    events.push(
      ...t.translateChunk(
        toolCallChunk(0, { id: 'call_A', name: 'search', args: '{"q":' }),
      ),
    );
    // Next tool deltas: argument continuations
    events.push(...t.translateChunk(toolCallChunk(0, { args: '"ptah"}' })));
    events.push(...t.translateChunk(finishChunk('tool_calls')));

    const parsed = parseAll(events);
    const seq = parsed.map((p) => p.event);
    expect(seq).toEqual([
      'message_start',
      'content_block_start', // tool_use
      'content_block_delta', // input_json_delta 1
      'content_block_delta', // input_json_delta 2
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);

    expect(parsed[1].data).toMatchObject({
      content_block: {
        type: 'tool_use',
        id: 'call_A',
        name: 'search',
        input: {},
      },
    });
    expect(parsed[2].data).toMatchObject({
      delta: { type: 'input_json_delta', partial_json: '{"q":' },
    });
    expect(parsed[3].data).toMatchObject({
      delta: { type: 'input_json_delta', partial_json: '"ptah"}' },
    });

    // stop_reason MUST be 'tool_use' so the SDK continues the agentic loop.
    expect(parsed[5].data).toMatchObject({
      delta: { stop_reason: 'tool_use', stop_sequence: null },
    });
  });

  it("forces stop_reason='tool_use' even when upstream reports finish_reason='stop' after tool calls", () => {
    const t = new OpenAIResponseTranslator('m', 'req-2');

    const events: string[] = [];
    events.push(
      ...t.translateChunk(
        toolCallChunk(0, { id: 'call_X', name: 'go', args: '{}' }),
      ),
    );
    events.push(...t.translateChunk(finishChunk('stop')));

    const parsed = parseAll(events);
    const messageDelta = parsed.find((p) => p.event === 'message_delta');
    // This is the Copilot/GPT footgun — upstream lies, translator corrects.
    expect(messageDelta?.data).toMatchObject({
      delta: { stop_reason: 'tool_use' },
    });
  });

  it('assigns a unique block index to each parallel tool call', () => {
    const t = new OpenAIResponseTranslator('m', 'req-par');

    const events: string[] = [];
    events.push(
      ...t.translateChunk(
        toolCallChunk(0, { id: 'call_0', name: 'first', args: '{}' }),
      ),
    );
    events.push(
      ...t.translateChunk(
        toolCallChunk(1, { id: 'call_1', name: 'second', args: '{}' }),
      ),
    );
    events.push(...t.translateChunk(finishChunk('tool_calls')));

    const starts = parseAll(events).filter(
      (p) => p.event === 'content_block_start',
    );
    expect(starts).toHaveLength(2);
    const idx0 = starts[0].data['index'] as number;
    const idx1 = starts[1].data['index'] as number;
    expect(idx0).not.toBe(idx1);
  });

  it('maps finish_reason=length → max_tokens when no tool calls were present', () => {
    const t = new OpenAIResponseTranslator('m', 'req-len');
    const events = [
      ...t.translateChunk(textChunk('truncated')),
      ...t.translateChunk(finishChunk('length')),
    ];
    const messageDelta = parseAll(events).find(
      (p) => p.event === 'message_delta',
    );
    expect(messageDelta?.data).toMatchObject({
      delta: { stop_reason: 'max_tokens' },
    });
  });
});

// ---------------------------------------------------------------------------
// Edge cases: finalize(), empty stream, idempotence
// ---------------------------------------------------------------------------

describe('OpenAIResponseTranslator — finalize() edge cases', () => {
  it('finalize() on a translator that never saw a chunk emits message_start + message_delta(end_turn) + message_stop', () => {
    const t = new OpenAIResponseTranslator('m', 'req-empty');
    const events = parseAll(t.finalize());
    expect(events.map((e) => e.event)).toEqual([
      'message_start',
      'message_delta',
      'message_stop',
    ]);
  });

  it('finalize() is idempotent after a finish_reason already terminated the stream', () => {
    const t = new OpenAIResponseTranslator('m', 'req-term');
    void t.translateChunk(textChunk('done'));
    void t.translateChunk(finishChunk('stop'));
    const extra = t.finalize();
    expect(extra).toEqual([]);
  });

  it('captures usage from the final chunk and surfaces it in the message_delta event', () => {
    const t = new OpenAIResponseTranslator('m', 'req-u');
    const events = [
      ...t.translateChunk(textChunk('x')),
      ...t.translateChunk(finishChunk('stop')),
    ];
    const md = parseAll(events).find((p) => p.event === 'message_delta');
    expect(md?.data).toMatchObject({ usage: { output_tokens: 50 } });
  });
});
