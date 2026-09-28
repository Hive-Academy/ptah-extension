/**
 * ResponsesStreamTranslator — unit specs.
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

import { translateResponsesUsage } from './translation-proxy-helpers';
import { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
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

describe('ResponsesStreamTranslator — final usage', () => {
  it.each([undefined, null, {}])('defaults missing usage %j without inventing cache', (usage) => {
    expect(translateResponsesUsage(usage)).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
  it.each([
    { input_tokens: -1 }, { output_tokens: -1 },
    { input_tokens_details: { cached_tokens: -1 } },
    { input_tokens: '42' }, { input_tokens: Infinity },
  ])('rejects malformed usage %j at the boundary', (usage) => {
    expect(() => translateResponsesUsage(usage)).toThrow();
  });
  it.each([-1, 'private-upstream-value', null])('terminates malformed completed usage %j safely', async (input) => {
    const t = new ResponsesStreamTranslator('m', 'invalid');
    const initial = t.getInitialEvents();
    const output = t.processChunk(responsesSse('response.completed', {
      response: { usage: { input_tokens: input, output_tokens: 9 } },
    }));
    expect(parseAll(output)).toEqual([{ event: 'error', data: {
      type: 'error', error: { type: 'api_error', message: 'Invalid upstream Responses usage' },
    } }]);
    expect(t.processChunk('data: [DONE]\n\n' +
      responsesSse('response.completed', { response: { usage: { input_tokens: 42 } } }) +
      responsesSse('response.output_text.delta', { delta: 'must not appear' }) +
      responsesSse('response.output_item.added', { output_index: 0,
        item: { type: 'function_call', call_id: 'call', name: 'read_file' } }) +
      responsesSse('response.function_call_arguments.delta', { output_index: 0, delta: '{}' }) +
      responsesSse('response.output_item.done', { output_index: 0,
        item: { type: 'function_call', call_id: 'call', name: 'read_file', arguments: '{}' } }),
    )).toEqual([]);
    const wire = [initial, ...output].map((event) =>
      JSON.stringify(parseAnthropicSse(event).data)).join('\n') + '\n';
    const readable = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(wire));
      controller.close();
    } });
    // This SDK entry point ingests decoded events (not the HTTP SSE error
    // parser). It must reject an errored stream, never return a final message.
    await expect(MessageStream.fromReadableStream(readable).finalMessage())
      .rejects.toThrow('stream ended without producing a Message');
  });

  it('installed Anthropic SDK accumulator consumes final input/cache updates', async () => {
    const t = new ResponsesStreamTranslator('m', 'sdk-usage');
    const events = [t.getInitialEvents(), ...t.processChunk(
      responsesSse('response.output_text.delta', { delta: 'hello' }) +
      responsesSse('response.completed', { response: { usage: {
        input_tokens: 42, input_tokens_details: { cached_tokens: 12 }, output_tokens: 9,
      } } }),
    )];
    // SDK fromReadableStream expects newline-delimited JSON events, not SSE.
    // Use its real accumulator; no model, transport mock, or credentials involved.
    const wire = events.map((event) => JSON.stringify(parseAnthropicSse(event).data)).join('\n') + '\n';
    const readable = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(wire));
      controller.close();
    } });
    const message = await MessageStream.fromReadableStream(readable).finalMessage();
    expect(message.usage).toMatchObject({ input_tokens: 30, cache_read_input_tokens: 12, output_tokens: 9 });
    expect(message.content).toEqual([{ type: 'text', text: 'hello' }]);
  });
  it.each([
    [undefined, 42, undefined],
    [{}, 42, undefined],
    [{ cached_tokens: 0 }, 42, 0],
    [{ cached_tokens: 12 }, 30, 12],
    [{ cached_tokens: 99 }, 0, 42],
  ])('separates input/cache for details %j', (details, input, cache) => {
    const t = new ResponsesStreamTranslator('m', 'usage');
    const events = parseAll(t.processChunk(responsesSse('response.completed', {
      response: { usage: { input_tokens: 42, output_tokens: 9,
        input_tokens_details: details, output_tokens_details: { reasoning_tokens: 7 } } },
    })));
    expect(events.find((event) => event.event === 'message_delta')?.data['usage']).toEqual({
      input_tokens: input, output_tokens: 9,
      ...(cache !== undefined ? { cache_read_input_tokens: cache } : {}),
    });
    expect(t.processChunk(responsesSse('response.completed', {
      response: { usage: { input_tokens: 999, output_tokens: 999 } },
    }))).toEqual([]);
  });

  it('keeps usage scoped to each tool turn', () => {
    for (const cached of [12, 30]) {
      const t = new ResponsesStreamTranslator('m', `turn-${cached}`);
      t.processChunk(responsesSse('response.output_item.added', {
        output_index: 0, item: { type: 'function_call', call_id: 'call', name: 'read_file' },
      }));
      const events = parseAll(t.processChunk(responsesSse('response.completed', {
        response: { usage: { input_tokens: 42, output_tokens: 9,
          input_tokens_details: { cached_tokens: cached } } },
      })));
      expect(events.find((event) => event.event === 'message_delta')?.data).toMatchObject({
        delta: { stop_reason: 'tool_use' },
        usage: { input_tokens: 42 - cached, cache_read_input_tokens: cached, output_tokens: 9 },
      });
    }
  });

  // Before TASK_2026_408 these terminals were swallowed (`[]`). They now end
  // the stream with one `error` event; usage is still never published.
  it.each(['response.failed', 'error', 'response.incomplete'])(
    'does not publish successful usage from failed terminal %s', (type) => {
      const onUsage = jest.fn();
      const t = new ResponsesStreamTranslator('m', 'terminal', onUsage);
      const events = parseAll(t.processChunk(responsesSse(type, {
        response: { usage: { input_tokens: 42, output_tokens: 9 } },
      })));
      expect(events.map((event) => event.event)).toEqual(['error']);
      expect(onUsage).not.toHaveBeenCalled();
    },
  );
});

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

// ---------------------------------------------------------------------------
// TASK_2026_408 — terminal events, frame state, received-argument accumulator
// ---------------------------------------------------------------------------

const PROMPT_TOO_LONG_DEFAULT =
  "prompt is too long: the request exceeds the model's context window";
const INCOMPLETE_TOOL_INPUT =
  'upstream_incomplete: Upstream response ended with incomplete tool input';
const USAGE = { input_tokens: 42, output_tokens: 9 };

/** A streamed function call: added, one arguments delta, then done. */
function toolCallSse(args: string, outputIndex = 0): string {
  const item = { type: 'function_call', call_id: `call_${outputIndex}`, name: 'read_file' };
  return responsesSse('response.output_item.added', { output_index: outputIndex, item }) +
    responsesSse('response.function_call_arguments.delta', { output_index: outputIndex, delta: args }) +
    responsesSse('response.output_item.done', {
      output_index: outputIndex, item: { ...item, arguments: args },
    });
}

function incompleteResponse(reason: string | undefined, toolArgs?: string): Record<string, unknown> {
  return {
    status: 'incomplete',
    incomplete_details: reason === undefined ? null : { reason },
    output: toolArgs === undefined ? [] : [
      { type: 'function_call', call_id: 'call_0', name: 'read_file', arguments: toolArgs },
    ],
    usage: USAGE,
  };
}

function errorEvent(type: string, message: string): ParsedEvent {
  return { event: 'error', data: { type: 'error', error: { type, message } } };
}

/** Feed decoded events through the installed SDK accumulator. */
function sdkFinalMessage(initial: string, events: readonly string[]) {
  const wire = [initial, ...events].map((event) =>
    JSON.stringify(parseAnthropicSse(event).data)).join('\n') + '\n';
  const readable = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(wire));
    controller.close();
  } });
  return MessageStream.fromReadableStream(readable).finalMessage();
}

describe('ResponsesStreamTranslator — terminal table', () => {
  it.each([
    ['max_output_tokens', 'max_tokens'],
    ['content_filter', 'refusal'],
  ])('incomplete %s without tools stops with %s and forwards usage', async (reason, stopReason) => {
    const onUsage = jest.fn();
    const onError = jest.fn();
    const t = new ResponsesStreamTranslator('m', 'inc', onUsage, onError);
    const initial = t.getInitialEvents();
    const out = t.processChunk(
      responsesSse('response.output_text.delta', { delta: 'partial' }) +
      responsesSse('response.incomplete', { response: incompleteResponse(reason) }),
    );
    expect(parseAll(out).map((event) => event.event)).toEqual([
      'content_block_start', 'content_block_delta', 'content_block_stop',
      'message_delta', 'message_stop',
    ]);
    expect(parseAll(out)[3].data).toEqual({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: USAGE,
    });
    expect(onUsage).toHaveBeenCalledWith(USAGE);
    expect(onError).not.toHaveBeenCalled();
    expect(t.isFinalized()).toBe(true);
    const message = await sdkFinalMessage(initial, out);
    expect(message.stop_reason).toBe(stopReason);
    expect(message.content).toEqual([{ type: 'text', text: 'partial' }]);
  });

  it.each([
    ['max_output_tokens', 'max_tokens'],
    ['content_filter', 'refusal'],
  ])('incomplete %s with complete tool args stops with %s after closing the tool block', async (reason, stopReason) => {
    const t = new ResponsesStreamTranslator('m', 'inc-tool');
    const initial = t.getInitialEvents();
    const out = t.processChunk(toolCallSse('{"path":"a"}') + responsesSse('response.incomplete', {
      response: incompleteResponse(reason, '{"path":"a"}'),
    }));
    const parsed = parseAll(out);
    expect(parsed.map((event) => event.event)).toEqual([
      'content_block_start', 'content_block_delta', 'content_block_stop',
      'message_delta', 'message_stop',
    ]);
    expect(parsed[3].data).toMatchObject({ delta: { stop_reason: stopReason } });
    const message = await sdkFinalMessage(initial, out);
    expect(message.content).toEqual([
      { type: 'tool_use', id: 'call_0', name: 'read_file', input: { path: 'a' } },
    ]);
  });

  it.each(['max_output_tokens', 'content_filter', 'other_reason', undefined])(
    'incomplete (%s) with truncated snapshot tool args ends with upstream_incomplete',
    async (reason) => {
      const onUsage = jest.fn();
      const onError = jest.fn();
      const t = new ResponsesStreamTranslator('m', 'inc-bad', onUsage, onError);
      const initial = t.getInitialEvents();
      const out = t.processChunk(toolCallSse('{"x":') + responsesSse('response.incomplete', {
        response: incompleteResponse(reason, '{"x":'),
      }));
      const parsed = parseAll(out);
      expect(parsed.at(-1)).toEqual(errorEvent('api_error', INCOMPLETE_TOOL_INPUT));
      expect(parsed.map((event) => event.event)).not.toContain('message_delta');
      expect(parsed.filter((event) => event.event === 'error')).toHaveLength(1);
      expect(onUsage).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      await expect(sdkFinalMessage(initial, out)).rejects.toThrow();
    },
  );

  it('uses the received-argument accumulator when the snapshot omits output (open call)', () => {
    const t = new ResponsesStreamTranslator('m', 'acc-open');
    const out = parseAll(t.processChunk(
      responsesSse('response.output_item.added', {
        output_index: 0, item: { type: 'function_call', call_id: 'c', name: 'read_file' },
      }) +
      responsesSse('response.function_call_arguments.delta', { output_index: 0, delta: '{"path":' }) +
      responsesSse('response.incomplete', {
        response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: USAGE },
      }),
    ));
    expect(out.at(-1)).toEqual(errorEvent('api_error', INCOMPLETE_TOOL_INPUT));
  });

  it('accumulates argument deltas received before the call has a name', () => {
    const t = new ResponsesStreamTranslator('m', 'acc-unnamed');
    const out = parseAll(t.processChunk(
      responsesSse('response.function_call_arguments.delta', { output_index: 0, delta: '{"path":' }) +
      responsesSse('response.incomplete', {
        response: { status: 'incomplete', incomplete_details: { reason: 'content_filter' } },
      }),
    ));
    expect(out).toEqual([errorEvent('api_error', INCOMPLETE_TOOL_INPUT)]);
  });

  it("uses closed calls' final arguments when the snapshot omits output", () => {
    const closedBad = new ResponsesStreamTranslator('m', 'acc-closed-bad');
    expect(parseAll(closedBad.processChunk(toolCallSse('{"x":') + responsesSse('response.incomplete', {
      response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    }))).at(-1)).toEqual(errorEvent('api_error', INCOMPLETE_TOOL_INPUT));

    const closedGood = new ResponsesStreamTranslator('m', 'acc-closed-good');
    expect(parseAll(closedGood.processChunk(toolCallSse('{"x":1}') + responsesSse('response.incomplete', {
      response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    }))).at(-2)?.data).toMatchObject({ delta: { stop_reason: 'max_tokens' } });
  });

  it('prefers snapshot output over the accumulator when present', () => {
    const t = new ResponsesStreamTranslator('m', 'acc-snapshot');
    const out = parseAll(t.processChunk(
      responsesSse('response.function_call_arguments.delta', { output_index: 0, delta: '{"path":' }) +
      responsesSse('response.incomplete', { response: incompleteResponse('max_output_tokens', '{"path":"a"}') }),
    ));
    expect(out.at(-2)?.data).toMatchObject({ delta: { stop_reason: 'max_tokens' } });
  });

  it('incomplete with another or missing reason and complete args is a 502-class error', () => {
    for (const reason of ['other_reason', undefined]) {
      const t = new ResponsesStreamTranslator('m', 'inc-other');
      expect(parseAll(t.processChunk(responsesSse('response.incomplete', {
        response: incompleteResponse(reason),
      })))).toEqual([
        errorEvent('api_error', 'upstream_incomplete: Upstream Responses response incomplete'),
      ]);
    }
  });

  it('incomplete with invalid usage keeps the existing usage error', () => {
    const t = new ResponsesStreamTranslator('m', 'inc-usage');
    expect(parseAll(t.processChunk(responsesSse('response.incomplete', {
      response: { ...incompleteResponse('max_output_tokens'), usage: { input_tokens: -1 } },
    })))).toEqual([errorEvent('api_error', 'Invalid upstream Responses usage')]);
  });

  it.each([
    ['context_length_exceeded', 'private-upstream-value', 'invalid_request_error', PROMPT_TOO_LONG_DEFAULT],
    ['rate_limit_exceeded', 'private-upstream-value', 'rate_limit_error', 'Upstream rate limit exceeded'],
    ['server_error', 'private-upstream-value', 'api_error', 'Upstream Responses request failed (server_error)'],
    ['invalid_prompt', 'private-upstream-value', 'invalid_request_error', 'Upstream rejected the request (invalid_prompt)'],
    [undefined, undefined, 'api_error', 'Upstream Responses request failed (unknown)'],
  ])('response.failed %s maps to %s', async (code, message, type, expected) => {
    const onUsage = jest.fn();
    const onError = jest.fn();
    const t = new ResponsesStreamTranslator('m', 'failed', onUsage, onError);
    const initial = t.getInitialEvents();
    const out = t.processChunk(
      responsesSse('response.output_text.delta', { delta: 'partial' }) +
      responsesSse('response.failed', {
        response: { status: 'failed', ...(code ? { error: { code, message } } : {}), usage: USAGE },
      }),
    );
    const parsed = parseAll(out);
    // The failure is the only terminal: no content_block_stop or message_delta.
    expect(parsed.map((event) => event.event)).toEqual([
      'content_block_start', 'content_block_delta', 'error',
    ]);
    expect(parsed[2]).toEqual(errorEvent(type, expected));
    expect(out.join('')).not.toContain('private-upstream-value');
    expect(onUsage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    await expect(sdkFinalMessage(initial, out)).rejects.toThrow();
  });

  it('response.failed with overflow numbers emits the token-gap contract message', () => {
    const t = new ResponsesStreamTranslator('m', 'failed-numbers');
    const [event] = parseAll(t.processChunk(responsesSse('response.failed', {
      response: { error: {
        code: 'context_length_exceeded',
        message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 130532 tokens.",
      } },
    })));
    expect(event).toEqual(errorEvent('invalid_request_error', 'prompt is too long: 130532 tokens > 128000 maximum'));
    expect((event.data['error'] as { message: string }).message)
      .toMatch(/prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i);
  });

  it.each([
    ['top-level', { code: 'context_length_exceeded', message: 'private-upstream-value' }],
    ['nested', { error: { code: 'context_length_exceeded', message: 'private-upstream-value' } }],
  ])('standalone error event with %s code/message is classified', (_shape, payload) => {
    const t = new ResponsesStreamTranslator('m', 'error-event');
    const out = t.processChunk(responsesSse('error', { type: 'error', ...payload }));
    expect(parseAll(out)).toEqual([errorEvent('invalid_request_error', PROMPT_TOO_LONG_DEFAULT)]);
    expect(out.join('')).not.toContain('private-upstream-value');
  });

  it('top-level error fields win over nested ones', () => {
    const t = new ResponsesStreamTranslator('m', 'error-precedence');
    expect(parseAll(t.processChunk(responsesSse('error', {
      type: 'error', code: 'rate_limit_exceeded', error: { code: 'context_length_exceeded' },
    })))).toEqual([errorEvent('rate_limit_error', 'Upstream rate limit exceeded')]);
  });

  it('ignores every event after a failed terminal', () => {
    const t = new ResponsesStreamTranslator('m', 'after-fail');
    t.processChunk(responsesSse('response.failed', { response: {} }));
    expect(t.processChunk(
      responsesSse('response.output_text.delta', { delta: 'late' }) +
      responsesSse('response.completed', { response: { usage: USAGE } }) +
      responsesSse('response.incomplete', { response: incompleteResponse('max_output_tokens') }) +
      responsesSse('error', { code: 'server_error' }) +
      'data: [DONE]\n\n',
    )).toEqual([]);
    expect(t.terminateTruncated()).toEqual([]);
  });

  it('terminateTruncated() emits one api_error, finalises, and is idempotent', async () => {
    const onError = jest.fn();
    const t = new ResponsesStreamTranslator('m', 'trunc', undefined, onError);
    const initial = t.getInitialEvents();
    const streamed = t.processChunk(responsesSse('response.output_text.delta', { delta: 'partial' }));
    expect(t.isFinalized()).toBe(false);
    const out = t.terminateTruncated();
    expect(parseAll(out)).toEqual([
      errorEvent('api_error', 'Upstream Responses stream ended before completion'),
    ]);
    expect(t.isFinalized()).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(t.terminateTruncated()).toEqual([]);
    expect(t.processChunk(responsesSse('response.completed', { response: { usage: USAGE } }))).toEqual([]);
    await expect(sdkFinalMessage(initial, [...streamed, ...out])).rejects.toThrow();
  });

  it('terminateTruncated() is a no-op after a successful terminal', () => {
    const t = new ResponsesStreamTranslator('m', 'trunc-after');
    t.processChunk(responsesSse('response.completed', { response: { usage: USAGE } }));
    expect(t.terminateTruncated()).toEqual([]);
  });
});

describe('ResponsesStreamTranslator — SSE frame state across chunks', () => {
  // JSON omits `type`, so the `event:` line is the only name.
  const frames: ReadonlyArray<[string, Record<string, unknown>, number]> = [
    ['response.failed', { response: { error: { code: 'context_length_exceeded' } } }, 1],
    ['response.incomplete', { response: incompleteResponse('max_output_tokens') }, 2],
    ['error', { code: 'rate_limit_exceeded', message: 'private-upstream-value' }, 1],
  ];

  function unsplit(name: string, data: Record<string, unknown>): string[] {
    return new ResponsesStreamTranslator('m', 'frame').processChunk(responsesSse(name, data));
  }

  it.each(frames)('%s: chunk split right after the event line', (name, data, count) => {
    const t = new ResponsesStreamTranslator('m', 'frame');
    expect(t.processChunk(`event: ${name}\n`)).toEqual([]);
    const out = t.processChunk(`data: ${JSON.stringify(data)}\n\n`);
    expect(out).toEqual(unsplit(name, data));
    expect(out).toHaveLength(count);
  });

  it.each(frames)('%s: data split across two data lines is joined by a newline', (name, data) => {
    const json = JSON.stringify(data);
    const cut = json.indexOf(':') + 1;
    const t = new ResponsesStreamTranslator('m', 'frame');
    expect(t.processChunk(
      `event: ${name}\ndata: ${json.slice(0, cut)}\ndata: ${json.slice(cut)}\n\n`,
    )).toEqual(unsplit(name, data));
  });

  it.each(frames)('%s: byte-at-a-time feed', (name, data) => {
    const t = new ResponsesStreamTranslator('m', 'frame');
    const out: string[] = [];
    for (const char of responsesSse(name, data)) out.push(...t.processChunk(char));
    expect(out).toEqual(unsplit(name, data));
  });

  it.each(frames)('%s: CRLF line ends, fed byte-at-a-time', (name, data) => {
    const t = new ResponsesStreamTranslator('m', 'frame');
    const out: string[] = [];
    for (const char of responsesSse(name, data).replace(/\n/g, '\r\n')) out.push(...t.processChunk(char));
    expect(out).toEqual(unsplit(name, data));
  });

  it.each(frames)('%s: bare CR line ends, resolved at clean EOF', (name, data) => {
    const t = new ResponsesStreamTranslator('m', 'frame');
    // The final CR is held (it could be half of CRLF) until EOF proves it is
    // a line end; no extra delimiter is fed.
    const out = t.processChunk(responsesSse(name, data).replace(/\n/g, '\r'));
    expect([...out, ...t.endOfStream()]).toEqual(unsplit(name, data));
    expect(t.endOfStream()).toEqual([]);
  });

  it('CR-only response.failed overflow yields the prompt-too-long error at EOF', () => {
    const t = new ResponsesStreamTranslator('m', 'cr-overflow');
    const wire =
      'event: response.failed\rdata: {"response":{"error":{"code":"context_length_exceeded"}}}\r\r';
    expect(t.processChunk(wire)).toEqual([]);
    expect(parseAll(t.endOfStream())).toEqual([
      errorEvent('invalid_request_error', PROMPT_TOO_LONG_DEFAULT),
    ]);
    expect(t.isFinalized()).toBe(true);
  });

  it.each([
    ['completed', responsesSse('response.completed', { response: { usage: USAGE } }), 'end_turn'],
    ['incomplete', responsesSse('response.incomplete', { response: incompleteResponse('max_output_tokens') }), 'max_tokens'],
  ])('CR-only %s terminal ending in exactly two CRs stops cleanly at EOF', (_name, frame, stopReason) => {
    const t = new ResponsesStreamTranslator('m', 'cr-stop');
    const out = [...t.processChunk(frame.replace(/\n/g, '\r')), ...t.endOfStream()];
    const parsed = parseAll(out);
    expect(parsed.map((event) => event.event)).toEqual(['message_delta', 'message_stop']);
    expect(parsed[0].data).toMatchObject({ delta: { stop_reason: stopReason } });
  });

  it('endOfStream() never dispatches a genuinely unfinished CR frame', () => {
    const t = new ResponsesStreamTranslator('m', 'cr-unfinished');
    // One CR ends the data line only; the frame's blank line never arrived.
    expect(t.processChunk(
      'event: response.failed\rdata: {"response":{"error":{"code":"context_length_exceeded"}}}\r',
    )).toEqual([]);
    expect(parseAll(t.endOfStream())).toEqual([
      errorEvent('api_error', 'Upstream Responses stream ended before completion'),
    ]);
  });

  it('endOfStream() keeps a split CRLF as one delimiter', () => {
    const t = new ResponsesStreamTranslator('m', 'crlf-eof');
    const wire = responsesSse('response.completed', { response: { usage: USAGE } }).replace(/\n/g, '\r\n');
    const out = [
      ...t.processChunk(wire.slice(0, -1)),
      ...t.processChunk(wire.slice(-1)),
      ...t.endOfStream(),
    ];
    expect(parseAll(out).map((event) => event.event)).toEqual(['message_delta', 'message_stop']);
  });

  it('does not dispatch a frame still pending at EOF; endOfStream reports it', () => {
    const t = new ResponsesStreamTranslator('m', 'pending');
    expect(t.processChunk(
      `event: response.completed\ndata: ${JSON.stringify({ response: { usage: USAGE } })}\n`,
    )).toEqual([]);
    expect(t.isFinalized()).toBe(false);
    expect(parseAll(t.endOfStream())).toEqual([
      errorEvent('api_error', 'Upstream Responses stream ended before completion'),
    ]);
    expect(t.endOfStream()).toEqual([]);
  });

  it('ignores SSE comments and keeps the event name for the frame it belongs to', () => {
    const t = new ResponsesStreamTranslator('m', 'comment');
    const out = parseAll(t.processChunk(
      ': keep-alive\n\nevent: response.output_text.delta\n: note\ndata: {"delta":"hi"}\n\n',
    ));
    expect(out.map((event) => event.event)).toEqual(['content_block_start', 'content_block_delta']);
  });

  it('an event name does not leak into the next frame', () => {
    const t = new ResponsesStreamTranslator('m', 'leak');
    expect(t.processChunk('event: response.failed\n\ndata: {"delta":"x"}\n\n')).toEqual([]);
    expect(t.isFinalized()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_408 Phase 2 — tool-name resolver, dense block indexes, and
// received/emitted argument state (each argument character emitted once)
// ---------------------------------------------------------------------------

const fnAdded = (outputIndex: number, item: Record<string, unknown> = {}): string =>
  responsesSse('response.output_item.added', {
    output_index: outputIndex, item: { type: 'function_call', ...item },
  });
const argsDelta = (outputIndex: number, delta: string, extra: Record<string, unknown> = {}): string =>
  responsesSse('response.function_call_arguments.delta', { output_index: outputIndex, delta, ...extra });
const argsDone = (outputIndex: number, args: string, extra: Record<string, unknown> = {}): string =>
  responsesSse('response.function_call_arguments.done', {
    output_index: outputIndex, item_id: `fc_${outputIndex}`, arguments: args, ...extra,
  });
const fnDone = (outputIndex: number, item: Record<string, unknown> = {}): string =>
  responsesSse('response.output_item.done', {
    output_index: outputIndex, item: { type: 'function_call', ...item },
  });
const COMPLETED = responsesSse('response.completed', { response: { usage: USAGE } });

/** `partial_json` of every input_json_delta, optionally for one block index. */
function inputJsonDeltas(events: readonly ParsedEvent[], index?: number): string[] {
  return events
    .filter((event) => event.event === 'content_block_delta' &&
      (event.data['delta'] as { type: string }).type === 'input_json_delta' &&
      (index === undefined || event.data['index'] === index))
    .map((event) => (event.data['delta'] as { partial_json: string }).partial_json);
}

function eventsOfType(events: readonly ParsedEvent[], type: string): ParsedEvent[] {
  return events.filter((event) => event.event === type);
}

function translate(wire: string, resolveToolName?: (name: string) => string) {
  const t = new ResponsesStreamTranslator('m', 'p2', undefined, undefined, resolveToolName);
  const initial = t.getInitialEvents();
  const out = t.processChunk(wire);
  return { t, initial, out, parsed: parseAll(out) };
}

describe('ResponsesStreamTranslator — tool-name resolver', () => {
  const ORIGINAL = 'mcp__server.with.dots__tool' + 'x'.repeat(43);
  const ALIAS = 'mcp__server_with_dots__toolxxxxxxxxxxxxxxxxxxxxxxxxxx_0123456789';
  const resolve = (name: string) => (name === ALIAS ? ORIGINAL : name);

  it.each([
    ['output_item.added', fnAdded(0, { call_id: 'c1', name: ALIAS }) + argsDelta(0, '{"v":"42"}') +
      fnDone(0, { call_id: 'c1', name: ALIAS, arguments: '{"v":"42"}' })],
    ['a name-bearing delta', argsDelta(0, '{"v":"42"}', { call_id: 'c1', name: ALIAS }) +
      fnDone(0, { call_id: 'c1', name: ALIAS, arguments: '{"v":"42"}' })],
    ['function_call_arguments.done', fnAdded(0, { call_id: 'c1' }) +
      argsDone(0, '{"v":"42"}', { name: ALIAS }) + fnDone(0, { call_id: 'c1' })],
    ['output_item.done (delayed name)', fnAdded(0, { call_id: 'c1' }) + argsDelta(0, '{"v":"42"}') +
      fnDone(0, { call_id: 'c1', name: ALIAS, arguments: '{"v":"42"}' })],
    ['output_item.done (unseen call)', fnDone(0, { call_id: 'c1', name: ALIAS, arguments: '{"v":"42"}' })],
  ])('resolves an aliased name that enters through %s', async (_entry, wire) => {
    const { initial, out, parsed } = translate(wire + COMPLETED, resolve);
    const starts = eventsOfType(parsed, 'content_block_start');
    expect(starts).toHaveLength(1);
    expect(starts[0].data['content_block']).toEqual(
      { type: 'tool_use', id: 'c1', name: ORIGINAL, input: {} });
    expect(out.join('')).not.toContain(ALIAS);
    const message = await sdkFinalMessage(initial, out);
    expect(message.content).toEqual([{ type: 'tool_use', id: 'c1', name: ORIGINAL, input: { v: '42' } }]);
  });

  it('defaults to the identity resolver and passes unknown names through', () => {
    const { parsed } = translate(fnAdded(0, { call_id: 'c1', name: 'NoSuchTool' }));
    expect(eventsOfType(parsed, 'content_block_start')[0].data['content_block'])
      .toMatchObject({ name: 'NoSuchTool' });
    const resolved = translate(fnAdded(0, { call_id: 'c1', name: 'NoSuchTool' }), resolve);
    expect(eventsOfType(resolved.parsed, 'content_block_start')[0].data['content_block'])
      .toMatchObject({ name: 'NoSuchTool' });
  });
});

describe('ResponsesStreamTranslator — tool-call arguments emitted exactly once', () => {
  const ARGS = '{"path":"src/a.ts","limit":10}';
  const PARSED = { path: 'src/a.ts', limit: 10 };
  const named = { call_id: 'call_x', name: 'read_file' };

  async function expectOneIntactCall(wire: string, deltaCount?: number) {
    const { initial, out, parsed } = translate(wire + COMPLETED);
    expect(eventsOfType(parsed, 'content_block_start')).toHaveLength(1);
    expect(eventsOfType(parsed, 'content_block_stop')).toHaveLength(1);
    expect(inputJsonDeltas(parsed).join('')).toBe(ARGS);
    if (deltaCount !== undefined) expect(inputJsonDeltas(parsed)).toHaveLength(deltaCount);
    const message = await sdkFinalMessage(initial, out);
    expect(message.content).toEqual([{ type: 'tool_use', id: 'call_x', name: 'read_file', input: PARSED }]);
    expect(message.stop_reason).toBe('tool_use');
    return parsed;
  }

  it('(a) deltas only: each delta is emitted as it arrives', async () => {
    const parsed = await expectOneIntactCall(
      fnAdded(0, named) + argsDelta(0, ARGS.slice(0, 9)) + argsDelta(0, ARGS.slice(9)) + fnDone(0, named), 2);
    expect(inputJsonDeltas(parsed)).toEqual([ARGS.slice(0, 9), ARGS.slice(9)]);
  });

  it('(b) function_call_arguments.done only: one input_json_delta with the full args', async () => {
    await expectOneIntactCall(fnAdded(0, named) + argsDone(0, ARGS) + fnDone(0, named), 1);
  });

  it('(b) output_item.done arguments only: one input_json_delta with the full args', async () => {
    await expectOneIntactCall(fnAdded(0, named) + fnDone(0, { ...named, arguments: ARGS }), 1);
  });

  it('(c) deltas plus matching done payloads emit no duplicate', async () => {
    await expectOneIntactCall(
      fnAdded(0, named) + argsDelta(0, ARGS.slice(0, 5)) + argsDelta(0, ARGS.slice(5)) +
      argsDone(0, ARGS) + fnDone(0, { ...named, arguments: ARGS }), 2);
  });

  it('(c) deltas are authoritative over a differing done payload', async () => {
    await expectOneIntactCall(
      fnAdded(0, named) + argsDelta(0, ARGS) + argsDone(0, '{"path":"other"}') +
      fnDone(0, { ...named, arguments: '{"path":"other"}' }), 1);
  });

  it('(d) delayed name at output_item.done: one start, one flushed delta, one stop', async () => {
    const parsed = await expectOneIntactCall(
      fnAdded(0, { call_id: 'call_x' }) + argsDelta(0, ARGS.slice(0, 7)) + argsDelta(0, ARGS.slice(7)) +
      fnDone(0, { ...named, arguments: ARGS }), 1);
    expect(parsed.map((event) => event.event)).toEqual([
      'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
    ]);
  });

  // Open item 2 (implementation-plan-review.md:13): the name arrives on a delta
  // after buffered pre-name deltas. Append, start, then ONE flush, so the
  // current delta is never emitted a second time.
  it.each([
    ['after a nameless output_item.added', fnAdded(0, { call_id: 'call_x' })],
    ['with no output_item.added at all', ''],
  ])('(e) name-bearing delta after buffered pre-name deltas (%s) emits every character once',
    async (_variant, prefix) => {
      const t = new ResponsesStreamTranslator('m', 'open-item-2');
      const initial = t.getInitialEvents();
      const buffered = t.processChunk(prefix + argsDelta(0, ARGS.slice(0, 8)) + argsDelta(0, ARGS.slice(8, 20)));
      expect(buffered).toEqual([]);

      const onName = t.processChunk(argsDelta(0, ARGS.slice(20), named));
      expect(parseAll(onName).map((event) => event.event)).toEqual(['content_block_start', 'content_block_delta']);
      expect(inputJsonDeltas(parseAll(onName))).toEqual([ARGS]);

      // The matching done payloads must not re-emit anything.
      const rest = t.processChunk(argsDone(0, ARGS) + fnDone(0, { ...named, arguments: ARGS }) + COMPLETED);
      const all = [...buffered, ...onName, ...rest];
      expect(inputJsonDeltas(parseAll(all)).join('')).toBe(ARGS);
      expect(inputJsonDeltas(parseAll(all))).toHaveLength(1);
      expect(eventsOfType(parseAll(all), 'content_block_start')).toHaveLength(1);

      const message = await sdkFinalMessage(initial, all);
      expect(message.content).toEqual([{ type: 'tool_use', id: 'call_x', name: 'read_file', input: PARSED }]);
    });

  it('a delta after a name-bearing start emits only its own fragment', () => {
    const { parsed } = translate(
      argsDelta(0, '{"a":') + argsDelta(0, '1,', named) + argsDelta(0, '"b":2}'));
    expect(inputJsonDeltas(parsed)).toEqual(['{"a":1,', '"b":2}']);
  });

  it('an unseen call at output_item.done with call_id + name starts, flushes, then stops', async () => {
    const parsed = await expectOneIntactCall(fnDone(0, { ...named, arguments: ARGS }), 1);
    expect(parsed.slice(0, 3).map((event) => event.event))
      .toEqual(['content_block_start', 'content_block_delta', 'content_block_stop']);
  });

  it('ignores function_call_arguments.done for an unknown call without a name', () => {
    const { t, parsed } = translate(argsDone(3, '{"x":'));
    expect(parsed).toEqual([]);
    // Not tracked, so it cannot turn a later incomplete terminal into an error.
    expect(parseAll(t.processChunk(responsesSse('response.incomplete', {
      response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    }))).map((event) => event.event)).toEqual(['message_delta', 'message_stop']);
  });

  it('a call that never gets a name emits nothing and keeps its args for the incomplete check', () => {
    const { t, parsed } = translate(
      argsDelta(0, '{"x":') + fnDone(0, { call_id: 'call_x', arguments: '{"x":' }));
    expect(parsed).toEqual([]);
    expect(parseAll(t.processChunk(responsesSse('response.incomplete', {
      response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    })))).toEqual([errorEvent('api_error', INCOMPLETE_TOOL_INPUT)]);
  });

  // Carried from Batch 2: an output_item.done for a call never seen, with no
  // name and no arguments, contributed no tool input and is NOT recorded, so a
  // later incomplete terminal keeps its stop reason instead of upstream_incomplete.
  it('does not record an unseen nameless done item that carried no arguments', () => {
    const { t, parsed } = translate(fnDone(0, { call_id: 'call_x' }));
    expect(parsed).toEqual([]);
    const out = parseAll(t.processChunk(responsesSse('response.incomplete', {
      response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: USAGE },
    })));
    expect(out.map((event) => event.event)).toEqual(['message_delta', 'message_stop']);
    expect(out[0].data).toMatchObject({ delta: { stop_reason: 'max_tokens' } });
  });

  it('still records a started call that received no arguments (its input would be a fabricated {})', () => {
    const { t } = translate(fnAdded(0, named) + fnDone(0, named));
    expect(parseAll(t.processChunk(responsesSse('response.incomplete', {
      response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    })))).toEqual([errorEvent('api_error', INCOMPLETE_TOOL_INPUT)]);
  });

  // code-logic-review-b4.md finding 2: an empty delta that supplies the name
  // must still start the block and flush the buffered pre-name text once.
  it('an empty name-bearing delta starts the call and flushes the buffered args once', async () => {
    const { initial, out, parsed } = translate(
      fnAdded(0, { call_id: 'call_x' }) + argsDelta(0, ARGS) +
      argsDelta(0, '', named) + fnDone(0, { call_id: 'call_x', arguments: ARGS }) + COMPLETED);
    expect(eventsOfType(parsed, 'content_block_start')).toHaveLength(1);
    expect(inputJsonDeltas(parsed)).toEqual([ARGS]);
    const message = await sdkFinalMessage(initial, out);
    expect(message.content).toEqual([{ type: 'tool_use', id: 'call_x', name: 'read_file', input: PARSED }]);
    expect(message.stop_reason).toBe('tool_use');
  });

  it('ignores an empty delta that supplies no name', () => {
    const { t, parsed } = translate(argsDelta(0, ''));
    expect(parsed).toEqual([]);
    expect(parseAll(t.processChunk(responsesSse('response.incomplete', {
      response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    }))).map((event) => event.event)).toEqual(['message_delta', 'message_stop']);
  });

  // code-logic-review-b4.md finding 3: a closed call is never reopened.
  it.each([
    ['a repeated output_item.done', fnDone(0, { ...named, arguments: ARGS })],
    ['a late arguments delta', argsDelta(0, '{"late":1}')],
    ['a late arguments delta that names the call', argsDelta(0, '{"late":1}', named)],
    ['a late function_call_arguments.done', argsDone(0, '{"late":1}', { name: 'read_file' })],
    ['a late output_item.added', fnAdded(0, named)],
    ['the same call id at another output index', fnDone(4, { ...named, arguments: ARGS })],
  ])('%s after the call closed emits nothing', async (_case, late) => {
    const { initial, out, parsed } = translate(
      fnDone(0, { ...named, arguments: ARGS }) + late + COMPLETED);
    expect(eventsOfType(parsed, 'content_block_start')).toHaveLength(1);
    expect(eventsOfType(parsed, 'content_block_stop')).toHaveLength(1);
    expect(inputJsonDeltas(parsed)).toEqual([ARGS]);
    const message = await sdkFinalMessage(initial, out);
    expect(message.content).toEqual([{ type: 'tool_use', id: 'call_x', name: 'read_file', input: PARSED }]);
  });
});

// code-logic-review-b4.md finding 1: the incomplete check judges the bytes
// already delivered to the client, not only a snapshot that differs from them.
describe('ResponsesStreamTranslator — incomplete check validates emitted tool input', () => {
  const named = { call_id: 'c', name: 'Read' };
  const snapshotWith = (args: string) => responsesSse('response.incomplete', {
    response: incompleteResponse('max_output_tokens', args),
  });

  it.each([
    ['open call, truncated emitted input', fnAdded(0, named) + argsDelta(0, '{"x":')],
    ['open call, no emitted input', fnAdded(0, named)],
    ['closed call, truncated emitted input', fnAdded(0, named) + argsDelta(0, '{"x":') + fnDone(0, named)],
    ['closed call, no emitted input', fnAdded(0, named) + fnDone(0, named)],
  ])('%s with a complete snapshot ends with upstream_incomplete', async (_case, wire) => {
    const onUsage = jest.fn();
    const t = new ResponsesStreamTranslator('m', 'emitted', onUsage);
    const initial = t.getInitialEvents();
    const out = t.processChunk(wire + snapshotWith('{"x":1}'));
    const parsed = parseAll(out);
    expect(parsed.at(-1)).toEqual(errorEvent('api_error', INCOMPLETE_TOOL_INPUT));
    expect(parsed.map((event) => event.event)).not.toContain('message_delta');
    expect(onUsage).not.toHaveBeenCalled();
    await expect(sdkFinalMessage(initial, out)).rejects.toThrow();
  });

  it('complete emitted input with a complete snapshot still stops with max_tokens', async () => {
    const t = new ResponsesStreamTranslator('m', 'emitted-ok');
    const initial = t.getInitialEvents();
    const out = t.processChunk(fnAdded(0, named) + argsDelta(0, '{"x":1}') + snapshotWith('{"x":1}'));
    const message = await sdkFinalMessage(initial, out);
    expect(message.stop_reason).toBe('max_tokens');
    expect(message.content).toEqual([{ type: 'tool_use', id: 'c', name: 'Read', input: { x: 1 } }]);
  });
});

describe('ResponsesStreamTranslator — block index allocation', () => {
  it.each([
    ['without text', '', [0, 1]],
    ['after a text block', responsesSse('response.output_text.delta', { delta: 'calling' }), [1, 2]],
  ])('two interleaved tool calls get distinct dense indexes (%s)', async (_variant, text, indexes) => {
    const a = { call_id: 'call_a', name: 'read_file' };
    const b = { call_id: 'call_b', name: 'grep' };
    const { initial, out, parsed } = translate(text +
      fnAdded(0, a) + fnAdded(1, b) +
      argsDelta(0, '{"path":') + argsDelta(1, '{"pattern":') +
      argsDelta(0, '"x.ts"}') + argsDelta(1, '"foo"}') +
      fnDone(0, { ...a, arguments: '{"path":"x.ts"}' }) + fnDone(1, { ...b, arguments: '{"pattern":"foo"}' }) +
      COMPLETED);
    const [ia, ib] = indexes;
    const starts = eventsOfType(parsed, 'content_block_start').map((event) => event.data['index']);
    expect(starts).toEqual(text ? [0, ia, ib] : [ia, ib]);
    expect(inputJsonDeltas(parsed, ia)).toEqual(['{"path":', '"x.ts"}']);
    expect(inputJsonDeltas(parsed, ib)).toEqual(['{"pattern":', '"foo"}']);
    const stops = eventsOfType(parsed, 'content_block_stop').map((event) => event.data['index']);
    expect(stops.filter((index) => index === ia)).toHaveLength(1);
    expect(stops.filter((index) => index === ib)).toHaveLength(1);
    const message = await sdkFinalMessage(initial, out);
    expect(message.content.filter((block) => block.type === 'tool_use')).toEqual([
      { type: 'tool_use', id: 'call_a', name: 'read_file', input: { path: 'x.ts' } },
      { type: 'tool_use', id: 'call_b', name: 'grep', input: { pattern: 'foo' } },
    ]);
  });

  it('allocates an index only when a block starts: a nameless call reserves none', async () => {
    const { initial, out, parsed } = translate(
      fnAdded(0, { call_id: 'late' }) + argsDelta(0, '{}') +
      fnAdded(1, { call_id: 'call_b', name: 'grep' }) + argsDelta(1, '{"pattern":"p"}') +
      fnDone(1, { call_id: 'call_b', name: 'grep', arguments: '{"pattern":"p"}' }) +
      fnDone(0, { call_id: 'late', name: 'read_file', arguments: '{}' }) + COMPLETED);
    expect(eventsOfType(parsed, 'content_block_start').map((event) => event.data['index'])).toEqual([0, 1]);
    const message = await sdkFinalMessage(initial, out);
    expect(message.content).toEqual([
      { type: 'tool_use', id: 'call_b', name: 'grep', input: { pattern: 'p' } },
      { type: 'tool_use', id: 'late', name: 'read_file', input: {} },
    ]);
  });

  it('sequential text, tool, text blocks keep indexes 0, 1, 2', async () => {
    const tool = { call_id: 'call_t', name: 'read_file' };
    const { initial, out, parsed } = translate(
      responsesSse('response.output_text.delta', { delta: 'before' }) +
      fnAdded(1, tool) + argsDelta(1, '{"path":"a"}') + fnDone(1, { ...tool, arguments: '{"path":"a"}' }) +
      responsesSse('response.output_text.delta', { delta: 'after' }) + COMPLETED);
    expect(eventsOfType(parsed, 'content_block_start').map((event) => event.data['index'])).toEqual([0, 1, 2]);
    expect(eventsOfType(parsed, 'content_block_stop').map((event) => event.data['index'])).toEqual([0, 1, 2]);
    const message = await sdkFinalMessage(initial, out);
    expect(message.content).toEqual([
      { type: 'text', text: 'before' },
      { type: 'tool_use', id: 'call_t', name: 'read_file', input: { path: 'a' } },
      { type: 'text', text: 'after' },
    ]);
  });
});
