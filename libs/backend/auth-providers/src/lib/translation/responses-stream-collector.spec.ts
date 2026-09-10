import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import { collectResponsesStream } from './responses-stream-collector';
import { MAX_BODY_SIZE } from './translation-proxy-helpers';

const snapshot = {
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello 🌍' }] },
    { type: 'function_call', call_id: 'call1', name: 'search', arguments: '{"q":"ok"}' }],
  usage: { input_tokens: 42, output_tokens: 9 },
};
const frame = (type: string, response: unknown = snapshot) =>
  `event: ${type}\r\ndata: ${JSON.stringify({ type, response })}\r\n\r\n`;
function harness() {
  const upstream = new PassThrough();
  const downstream = new EventEmitter();
  const result = collectResponsesStream(upstream as unknown as IncomingMessage,
    downstream as unknown as ServerResponse, 'gpt-test', 'test');
  return { upstream, downstream, result };
}

describe('collectResponsesStream', () => {
  it('contains malformed terminal usage and cleans up the stream', async () => {
    const h = harness();
    const assertion = expect(h.result).rejects.toThrow('Invalid Responses event stream');
    h.upstream.end(frame('response.completed', { ...snapshot,
      usage: { input_tokens: 'private-upstream-value', output_tokens: 9 } }));
    await assertion;
    expect(h.upstream.destroyed).toBe(true);
    expect(h.downstream.listenerCount('close')).toBe(0);
  });
  it.each([
    [undefined, 42, undefined],
    [{}, 42, undefined],
    [{ cached_tokens: 0 }, 42, 0],
    [{ cached_tokens: 12 }, 30, 12],
    [{ cached_tokens: 99 }, 0, 42],
  ])('preserves bounded input/cache accounting %j', async (details, input, cache) => {
    const h = harness();
    h.upstream.end(frame('response.completed', { ...snapshot, usage: {
      input_tokens: 42, output_tokens: 9, input_tokens_details: details,
      output_tokens_details: { reasoning_tokens: 7 },
    } }));
    expect((await h.result)['usage']).toEqual({ input_tokens: input, output_tokens: 9,
      ...(cache !== undefined ? { cache_read_input_tokens: cache } : {}) });
  });

  it('forwards usage on valid max-output incomplete responses', async () => {
    const h = harness();
    h.upstream.end(frame('response.incomplete', { ...snapshot, status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      usage: { input_tokens: 42, output_tokens: 9, input_tokens_details: { cached_tokens: 12 } } }));
    expect(await h.result).toMatchObject({ stop_reason: 'max_tokens',
      usage: { input_tokens: 30, cache_read_input_tokens: 12, output_tokens: 9 } });
  });
  it.each(['\r', '\r\n', '\n'])('accepts complete byte-split delimiter %j at EOF', async (delimiter) => {
    const h = harness();
    for (const char of frame('response.completed').replace(/\r\n/g, delimiter)) h.upstream.write(char);
    h.upstream.end();
    expect(await h.result).toMatchObject({ stop_reason: 'tool_use' });
  });

  it.each(['line', 'event', 'terminal'])('bounds oversized %s with the shared body budget', async (kind) => {
    const h = harness();
    const assertion = expect(h.result).rejects.toMatchObject({ code: 'payload_too_large' });
    if (kind === 'event') {
      const part = `data: ${'x'.repeat(1024 * 1024)}\n`;
      for (let i = 0; i < 51; i++) h.upstream.write(part);
    } else if (kind === 'terminal') {
      h.upstream.end(frame('response.completed', { ...snapshot, output: [{ type: 'message',
        content: [{ type: 'output_text', text: 'x'.repeat(MAX_BODY_SIZE) }] }] }));
    } else h.upstream.end('x'.repeat(MAX_BODY_SIZE + 1));
    await assertion;
    expect(h.upstream.destroyed).toBe(true);
    expect(h.downstream.listenerCount('close')).toBe(0);
    expect(h.upstream.listenerCount('data')).toBe(0);
  });

  it('rejects truncated max_tokens tool arguments explicitly rather than fabricating input', async () => {
    const h = harness();
    const assertion = expect(h.result).rejects.toMatchObject({ code: 'upstream_incomplete' });
    h.upstream.end(frame('response.incomplete', { ...snapshot, status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'function_call', name: 'search', call_id: 'call1', arguments: '{"q":' }] }));
    await assertion;
  });

  it.each(['completed', 'incomplete'])('rejects omitted function arguments on %s', async (status) => {
    const h = harness();
    const assertion = status === 'incomplete'
      ? expect(h.result).rejects.toMatchObject({ code: 'upstream_incomplete' })
      : expect(h.result).rejects.toThrow();
    h.upstream.end(frame(`response.${status}`, { ...snapshot, status,
      incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
      output: [{ type: 'function_call', name: 'search', call_id: 'call1' }] }));
    await assertion;
  });

  it('accepts explicit empty object arguments without fabrication', async () => {
    const h = harness();
    h.upstream.end(frame('response.completed', { ...snapshot,
      output: [{ type: 'function_call', name: 'search', call_id: 'call1', arguments: '{}' }] }));
    expect(await h.result).toMatchObject({ content: [{ type: 'tool_use', input: {} }] });
  });

  it('rejects nonstring function arguments', async () => {
    const h = harness();
    const assertion = expect(h.result).rejects.toThrow();
    h.upstream.end(frame('response.completed', { ...snapshot,
      output: [{ type: 'function_call', name: 'search', call_id: 'call1', arguments: {} }] }));
    await assertion;
  });

  it('preserves refusal text and separates cached from uncached input usage', async () => {
    const h = harness();
    h.upstream.end(frame('response.completed', { ...snapshot,
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot assist.' }] }],
      usage: { input_tokens: 42, output_tokens: 9, input_tokens_details: { cached_tokens: 12 } } }));
    expect(await h.result).toMatchObject({ content: [{ type: 'text', text: 'Cannot assist.' }],
      usage: { input_tokens: 30, cache_read_input_tokens: 12, output_tokens: 9 } });
  });
  it('uses final snapshot once, including tools, usage and byte-fragmented UTF8', async () => {
    const h = harness();
    const wire = 'data: {"type":"response.output_text.delta","delta":"Hello 🌍"}\n\n' + frame('response.completed');
    for (const byte of Buffer.from(wire)) h.upstream.write(Buffer.from([byte]));
    h.upstream.end();
    expect(await h.result).toMatchObject({ content: [
      { type: 'text', text: 'Hello 🌍' },
      { type: 'tool_use', id: 'call1', name: 'search', input: { q: 'ok' } },
    ], stop_reason: 'tool_use', usage: { input_tokens: 42, output_tokens: 9 } });
    expect(h.downstream.listenerCount('close')).toBe(0);
    expect(h.upstream.listenerCount('data')).toBe(0);
  });

  it('accepts multiline data and event name split across chunks', async () => {
    const h = harness();
    h.upstream.write('event: response.');
    h.upstream.end(`completed\ndata: {\ndata: "response":${JSON.stringify(snapshot)}\ndata: }\n\n`);
    expect(await h.result).toMatchObject({ stop_reason: 'tool_use' });
  });

  it('maps max_output_tokens to max_tokens', async () => {
    const h = harness();
    h.upstream.end(frame('response.incomplete', { ...snapshot, status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' } } as typeof snapshot));
    expect(await h.result).toMatchObject({ stop_reason: 'max_tokens' });
  });

  it.each(['data: [DONE]\n\n', '', 'data: {broken}\n\n',
    'data: {"type":"error"}\n\n', 'data: {"type":"response.failed"}\n\n'])('rejects unsuccessful streams %s', async (wire) => {
    const h = harness();
    const assertion = expect(h.result).rejects.toThrow();
    h.upstream.end(wire);
    await assertion;
  });

  it.each(['error', 'aborted', 'close'])('rejects premature %s even after terminal snapshot', async (event) => {
    const h = harness();
    const assertion = expect(h.result).rejects.toThrow();
    h.upstream.write(frame('response.completed'));
    h.upstream.emit(event, new Error('synthetic'));
    await assertion;
  });

  it('cancels upstream and removes listeners on downstream disconnect', async () => {
    const h = harness();
    const assertion = expect(h.result).rejects.toThrow('Downstream disconnected');
    h.downstream.emit('close');
    await assertion;
    expect(h.upstream.destroyed).toBe(true);
    expect(h.downstream.listenerCount('close')).toBe(0);
  });
});
