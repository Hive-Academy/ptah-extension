/**
 * ResponsesStreamTranslator — unit specs (TASK_2025_294 W6.B1).
 *
 * Surface under test:
 *   - `ResponsesStreamTranslator.getInitialEvents()` emits a properly framed
 *     `message_start` SSE block containing model + request id.
 *   - `processChunk()` walks incoming raw SSE bytes, reassembles event
 *     boundaries across chunk splits (partial lines in the buffer), and
 *     dispatches to the correct handler for each Responses API event type:
 *       * `response.output_text.delta` → text_delta
 *       * `response.output_item.added` (function_call) → tool_use start
 *       * `response.function_call_arguments.delta` → input_json_delta
 *       * `response.output_item.done` → content_block_stop
 *       * `response.completed` → message_delta + message_stop
 *   - stop_reason inference matches the Chat Completions translator:
 *     `tool_use` whenever function calls appeared in the stream,
 *     `end_turn` otherwise.
 *   - `[DONE]` sentinel triggers finalisation exactly once even when
 *     `response.completed` never arrives.
 *
 * Pure class, no mocks needed. We parse each produced SSE block back into
 * `{event, data}` pairs so assertions read clearly.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/openai-translation/responses-stream-translator.ts`
 */

import { ResponsesStreamTranslator } from './responses-stream-translator';

// ---------------------------------------------------------------------------
// SSE chunk builders
// ---------------------------------------------------------------------------

function responsesSse(
  eventType: string,
  data: Record<string, unknown>,
): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

interface ParsedEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseAnthropicSse(raw: string): ParsedEvent {
  const lines = raw.split('\n');
  const eventLine = lines.find((l) => l.startsWith('event: ')) ?? '';
  const dataLine = lines.find((l) => l.startsWith('data: ')) ?? '';
  return {
    event: eventLine.slice(7),
    data: JSON.parse(dataLine.slice(6)) as Record<string, unknown>,
  };
}

function parseAll(sseArray: readonly string[]): ParsedEvent[] {
  return sseArray.map(parseAnthropicSse);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResponsesStreamTranslator — initial framing', () => {
  it('getInitialEvents() emits a message_start with the model, request id and zero usage', () => {
    const t = new ResponsesStreamTranslator('gpt-5.4', 'req-xyz');
    const parsed = parseAnthropicSse(t.getInitialEvents());
    expect(parsed.event).toBe('message_start');
    expect(parsed.data).toMatchObject({
      type: 'message_start',
      message: {
        id: 'msg_req-xyz',
        model: 'gpt-5.4',
        role: 'assistant',
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  });
});

describe('ResponsesStreamTranslator — text-only streaming round-trip', () => {
  it('maps response.output_text.delta events to Anthropic text_delta blocks and terminates cleanly on response.completed', () => {
    const t = new ResponsesStreamTranslator('gpt-5.4', 'req-1');

    const events: string[] = [];
    events.push(
      ...t.processChunk(
        responsesSse('response.output_text.delta', { delta: 'Hello ' }),
      ),
    );
    events.push(
      ...t.processChunk(
        responsesSse('response.output_text.delta', { delta: 'world' }),
      ),
    );
    events.push(
      ...t.processChunk(
        responsesSse('response.completed', {
          response: {
            status: 'completed',
            usage: { input_tokens: 20, output_tokens: 2 },
          },
        }),
      ),
    );

    const parsed = parseAll(events);
    expect(parsed.map((p) => p.event)).toEqual([
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);

    expect(parsed[1].data).toMatchObject({
      delta: { type: 'text_delta', text: 'Hello ' },
    });
    expect(parsed[2].data).toMatchObject({
      delta: { type: 'text_delta', text: 'world' },
    });
    // No tool calls → end_turn.
    expect(parsed[4].data).toMatchObject({
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 2 },
    });
  });

  it('reassembles events split across processChunk() boundaries (partial-line buffer)', () => {
    const t = new ResponsesStreamTranslator('m', 'req-split');
    const raw = responsesSse('response.output_text.delta', { delta: 'ABC' });

    // Split the raw SSE string in the MIDDLE of the data line.
    const mid = Math.floor(raw.length / 2);
    const part1 = raw.slice(0, mid);
    const part2 = raw.slice(mid);

    const chunk1 = t.processChunk(part1);
    const chunk2 = t.processChunk(part2);

    expect(chunk1).toHaveLength(0);
    const parsed = parseAll(chunk2);
    expect(parsed.map((e) => e.event)).toEqual([
      'content_block_start',
      'content_block_delta',
    ]);
    expect(parsed[1].data).toMatchObject({
      delta: { type: 'text_delta', text: 'ABC' },
    });
  });

  it('ignores unrecognised Responses API event types (response.created, response.in_progress)', () => {
    const t = new ResponsesStreamTranslator('m', 'req-unk');
    const out = t.processChunk(
      responsesSse('response.created', { id: 'x' }) +
        responsesSse('response.in_progress', {}),
    );
    expect(out).toEqual([]);
  });
});

describe('ResponsesStreamTranslator — tool-call streaming', () => {
  it('maps output_item.added(function_call) + arguments.delta + output_item.done into a full tool_use content block', () => {
    const t = new ResponsesStreamTranslator('m', 'req-tool');

    const events: string[] = [];
    events.push(
      ...t.processChunk(
        responsesSse('response.output_item.added', {
          output_index: 0,
          item: {
            type: 'function_call',
            call_id: 'call_A',
            name: 'search',
          },
        }),
      ),
    );
    events.push(
      ...t.processChunk(
        responsesSse('response.function_call_arguments.delta', {
          output_index: 0,
          delta: '{"q":',
        }),
      ),
    );
    events.push(
      ...t.processChunk(
        responsesSse('response.function_call_arguments.delta', {
          output_index: 0,
          delta: '"ptah"}',
        }),
      ),
    );
    events.push(
      ...t.processChunk(
        responsesSse('response.output_item.done', {
          output_index: 0,
          item: {
            type: 'function_call',
            call_id: 'call_A',
            name: 'search',
            arguments: '{"q":"ptah"}',
          },
        }),
      ),
    );
    events.push(
      ...t.processChunk(
        responsesSse('response.completed', {
          response: { usage: { input_tokens: 30, output_tokens: 10 } },
        }),
      ),
    );

    const parsed = parseAll(events);
    expect(parsed.map((p) => p.event)).toEqual([
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);

    expect(parsed[0].data).toMatchObject({
      content_block: {
        type: 'tool_use',
        id: 'call_A',
        name: 'search',
        input: {},
      },
    });
    expect(parsed[1].data).toMatchObject({
      delta: { type: 'input_json_delta', partial_json: '{"q":' },
    });
    expect(parsed[4].data).toMatchObject({
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 10 },
    });
  });

  it('closes an open text block before starting a tool_use block (interleaving safety)', () => {
    const t = new ResponsesStreamTranslator('m', 'req-mix');

    const events: string[] = [];
    events.push(
      ...t.processChunk(
        responsesSse('response.output_text.delta', { delta: 'thinking...' }),
      ),
    );
    events.push(
      ...t.processChunk(
        responsesSse('response.output_item.added', {
          output_index: 0,
          item: { type: 'function_call', call_id: 'c1', name: 'do' },
        }),
      ),
    );

    const parsed = parseAll(events);
    const seq = parsed.map((p) => p.event);
    // Text start → text_delta → text_stop → tool_use start.
    expect(seq).toEqual([
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
    ]);
    // The indices must differ — separate content blocks.
    const textStopIdx = parsed[2].data['index'] as number;
    const toolStartIdx = parsed[3].data['index'] as number;
    expect(toolStartIdx).toBeGreaterThan(textStopIdx);
  });
});

describe('ResponsesStreamTranslator — [DONE] sentinel + idempotence', () => {
  it("finalises exactly once on '[DONE]' even if response.completed never arrived", () => {
    const t = new ResponsesStreamTranslator('m', 'req-done');

    const events: string[] = [];
    events.push(
      ...t.processChunk(
        responsesSse('response.output_text.delta', { delta: 'x' }),
      ),
    );
    events.push(...t.processChunk('data: [DONE]\n\n'));

    const parsed = parseAll(events);
    const tail = parsed.slice(-2).map((p) => p.event);
    expect(tail).toEqual(['message_delta', 'message_stop']);

    // Subsequent chunks are silent.
    const extra = t.processChunk('data: [DONE]\n\n');
    expect(extra).toEqual([]);
  });

  it('handleResponseCompleted is a no-op after finalisation', () => {
    const t = new ResponsesStreamTranslator('m', 'req-done2');
    void t.processChunk('data: [DONE]\n\n');
    const extra = t.processChunk(
      responsesSse('response.completed', {
        response: { usage: { input_tokens: 1, output_tokens: 1 } },
      }),
    );
    expect(extra).toEqual([]);
  });

  it('silently skips unparseable data: lines', () => {
    const t = new ResponsesStreamTranslator('m', 'req-bad');
    const out = t.processChunk('data: {not valid json}\n\n');
    expect(out).toEqual([]);
  });
});
