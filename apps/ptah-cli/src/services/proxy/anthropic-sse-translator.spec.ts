/**
 * Unit tests for `AnthropicSseTranslator`.
 *
 * Covers the translation table:
 *   1. start() emits `message_start` once (idempotent).
 *   2. text_delta x N → one `content_block_start` (text) + N `content_block_delta`.
 *   3. tool_start closes a prior text block and opens a `tool_use` block.
 *   4. tool_delta → `input_json_delta`.
 *   5. message_complete → `content_block_stop` (if open) + `message_delta` +
 *      `message_stop`.
 *   6. thinking_delta is dropped.
 *   7. tool_result is dropped.
 *   8. onError → single `error` frame.
 *   9. unknown event types are dropped silently.
 */

import {
  AnthropicSseTranslator,
  encodeSseFrame,
  type ChatChunkEventLike,
} from './anthropic-sse-translator.js';

const ev = (
  eventType: string,
  extra: Partial<ChatChunkEventLike> = {},
): ChatChunkEventLike => ({ eventType, ...extra }) as ChatChunkEventLike;

describe('AnthropicSseTranslator', () => {
  it('start() emits exactly one message_start frame', () => {
    const t = new AnthropicSseTranslator('claude-3-5-sonnet-20241022', 'msg_x');
    const first = t.start();
    expect(first).toHaveLength(1);
    expect(first[0].event).toBe('message_start');
    expect(first[0].data['type']).toBe('message_start');
    const message = first[0].data['message'] as Record<string, unknown>;
    expect(message['model']).toBe('claude-3-5-sonnet-20241022');
    expect(message['id']).toBe('msg_x');
    // Second call is idempotent.
    expect(t.start()).toEqual([]);
  });

  it('text_delta x2 emits content_block_start once + 2 content_block_delta', () => {
    const t = new AnthropicSseTranslator('m');
    t.start();
    const a = t.onChunk(ev('text_delta', { delta: 'Hello, ' }));
    const b = t.onChunk(ev('text_delta', { delta: 'world!' }));
    expect(a.map((f) => f.event)).toEqual([
      'content_block_start',
      'content_block_delta',
    ]);
    expect(b.map((f) => f.event)).toEqual(['content_block_delta']);
    expect((a[1].data['delta'] as Record<string, unknown>)['text']).toBe(
      'Hello, ',
    );
    expect((b[0].data['delta'] as Record<string, unknown>)['text']).toBe(
      'world!',
    );
  });

  it('tool_start closes prior text block and opens tool_use', () => {
    const t = new AnthropicSseTranslator('m');
    t.start();
    t.onChunk(ev('text_delta', { delta: 'preamble' }));
    const frames = t.onChunk(
      ev('tool_start', {
        toolCallId: 'toolu_1',
        toolName: 'Read',
        toolInput: { path: '/etc/hosts' },
      }),
    );
    const events = frames.map((f) => f.event);
    expect(events).toEqual([
      'content_block_stop',
      'content_block_start',
      'content_block_delta',
    ]);
    const toolBlock = frames[1].data['content_block'] as Record<
      string,
      unknown
    >;
    expect(toolBlock['type']).toBe('tool_use');
    expect(toolBlock['id']).toBe('toolu_1');
    expect(toolBlock['name']).toBe('Read');
    const delta = frames[2].data['delta'] as Record<string, unknown>;
    expect(delta['type']).toBe('input_json_delta');
    expect(delta['partial_json']).toBe('{"path":"/etc/hosts"}');
  });

  it('tool_delta emits input_json_delta on the open tool_use block', () => {
    const t = new AnthropicSseTranslator('m');
    t.start();
    t.onChunk(ev('tool_start', { toolCallId: 't1', toolName: 'X' }));
    const frames = t.onChunk(ev('tool_delta', { inputJsonDelta: '{"a":1' }));
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe('content_block_delta');
    const delta = frames[0].data['delta'] as Record<string, unknown>;
    expect(delta['type']).toBe('input_json_delta');
    expect(delta['partial_json']).toBe('{"a":1');
  });

  it('message_complete emits stop + message_delta + message_stop', () => {
    const t = new AnthropicSseTranslator('m');
    t.start();
    t.onChunk(ev('text_delta', { delta: 'hi' }));
    const frames = t.onChunk(
      ev('message_complete', {
        stopReason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    expect(frames.map((f) => f.event)).toEqual([
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    const messageDelta = frames[1].data;
    expect(
      (messageDelta['delta'] as Record<string, unknown>)['stop_reason'],
    ).toBe('end_turn');
    expect(messageDelta['usage']).toEqual({
      input_tokens: 10,
      output_tokens: 5,
    });
    expect(t.isStopped()).toBe(true);
  });

  it('drops thinking_delta, tool_result, and message_start', () => {
    const t = new AnthropicSseTranslator('m');
    t.start();
    expect(t.onChunk(ev('thinking_delta', { delta: 'thinking…' }))).toEqual([]);
    expect(t.onChunk(ev('tool_result', { toolCallId: 'a' }))).toEqual([]);
    expect(t.onChunk(ev('message_start'))).toEqual([]);
  });

  it('onError emits a single error frame and stops the translator', () => {
    const t = new AnthropicSseTranslator('m');
    t.start();
    const frames = t.onError('bad things');
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe('error');
    const errBody = frames[0].data['error'] as Record<string, unknown>;
    expect(errBody['message']).toBe('bad things');
    // After error, further chunks are dropped.
    expect(t.onChunk(ev('text_delta', { delta: 'ignored' }))).toEqual([]);
  });

  it('unknown event types are dropped without throwing', () => {
    const t = new AnthropicSseTranslator('m');
    t.start();
    expect(t.onChunk(ev('totally_made_up_event'))).toEqual([]);
  });

  it('emits message_start automatically if a chunk arrives before start()', () => {
    const t = new AnthropicSseTranslator('m');
    const frames = t.onChunk(ev('text_delta', { delta: 'auto-start' }));
    expect(frames[0].event).toBe('message_start');
    expect(frames[1].event).toBe('content_block_start');
    expect(frames[2].event).toBe('content_block_delta');
  });

  it('encodeSseFrame produces SSE wire format', () => {
    const out = encodeSseFrame({
      event: 'message_stop',
      data: { type: 'message_stop' },
    });
    expect(out).toBe('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });
});
