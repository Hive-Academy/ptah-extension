import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import { collectResponsesStream, ResponsesStreamError } from './responses-stream-collector';
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
      : expect(h.result).rejects.toMatchObject({ code: 'invalid_response' });
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
    const assertion = expect(h.result).rejects.toMatchObject({ code: 'invalid_response' });
    h.upstream.end(frame('response.completed', { ...snapshot,
      output: [{ type: 'function_call', name: 'search', call_id: 'call1', arguments: {} }] }));
    await assertion;
  });

  it.each([
    ['malformed function arguments', [{ type: 'function_call', name: 'search', call_id: 'call1',
      arguments: '{"private-upstream-value":' }]],
    ['empty refusal content', [{ type: 'message', content: [{ type: 'refusal', refusal: '' }] }]],
  ])('classifies terminal %s as an invalid upstream response', async (_name, output) => {
    const h = harness();
    const assertion = expect(h.result).rejects.toMatchObject({ code: 'invalid_response' });
    h.upstream.end(frame('response.completed', { ...snapshot, output }));
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

  describe('terminal table', () => {
    const SENTINEL = 'private-upstream-value';
    const message = { type: 'message', content: [{ type: 'output_text', text: 'partial' }] };
    const call = (args: string) => ({ type: 'function_call', call_id: 'call1', name: 'search', arguments: args });
    const tools = { 'no tools': [message], 'valid args': [message, call('{"q":"ok"}')],
      'invalid args': [message, call('{"x":')] } as const;
    const incomplete = (reason: string | undefined, output: readonly unknown[]) => frame('response.incomplete', {
      ...snapshot, status: 'incomplete', output,
      incomplete_details: reason === undefined ? null : { reason } });
    const failed = (error: unknown) => frame('response.failed', { status: 'failed', output: [], error });
    const toolInput = { code: 'upstream_incomplete', message: 'Upstream response ended with incomplete tool input',
      mapping: { status: 502, type: 'api_error',
        message: 'upstream_incomplete: Upstream response ended with incomplete tool input' } };
    const upstreamFailed = (status: number, type: string, text: string) =>
      ({ code: 'upstream_failed', message: text, mapping: { status, type, message: text } });
    const overflow = upstreamFailed(400, 'invalid_request_error',
      "prompt is too long: the request exceeds the model's context window");
    const unknownFailure = upstreamFailed(502, 'api_error', 'Upstream Responses request failed (unknown)');

    it.each<[string, string, { stop_reason: string } | Record<string, unknown>]>([
      ['completed', frame('response.completed'), { stop_reason: 'tool_use' }],
      ...(Object.entries(tools).flatMap(([name, output]) => [
        [`max_output_tokens × ${name}`, incomplete('max_output_tokens', output),
          name === 'invalid args' ? toolInput : { stop_reason: 'max_tokens' }],
        [`content_filter × ${name}`, incomplete('content_filter', output),
          name === 'invalid args' ? toolInput : { stop_reason: 'refusal' }],
      ]) as Array<[string, string, Record<string, unknown>]>),
      ['other incomplete reason', incomplete('something_else', tools['no tools']),
        upstreamFailed(502, 'api_error', 'upstream_incomplete: Upstream Responses response incomplete')],
      ['missing incomplete reason', incomplete(undefined, tools['no tools']),
        upstreamFailed(502, 'api_error', 'upstream_incomplete: Upstream Responses response incomplete')],
      ['other incomplete reason × invalid args', incomplete('something_else', tools['invalid args']), toolInput],
      ['failed context_length_exceeded', failed({ code: 'context_length_exceeded', message: SENTINEL }), overflow],
      ['failed rate_limit_exceeded', failed({ code: 'rate_limit_exceeded', message: SENTINEL }),
        upstreamFailed(429, 'rate_limit_error', 'Upstream rate limit exceeded')],
      ['failed server_error', failed({ code: 'server_error', message: SENTINEL }),
        upstreamFailed(502, 'api_error', 'Upstream Responses request failed (server_error)')],
      ['failed invalid_prompt', failed({ code: 'invalid_prompt', message: SENTINEL }),
        upstreamFailed(400, 'invalid_request_error', 'Upstream rejected the request (invalid_prompt)')],
      ['failed without error', failed(null), unknownFailure],
      ['failed snapshot missing output',
        `data: ${JSON.stringify({ type: 'response.failed', response: { error: { code: 'server_error' } } })}\n\n`,
        upstreamFailed(502, 'api_error', 'Upstream Responses request failed (server_error)')],
      ['bare failed frame', 'data: {"type":"response.failed"}\n\n', unknownFailure],
      ['standalone error, top-level code',
        `event: error\ndata: ${JSON.stringify({ type: 'error', code: 'context_length_exceeded', message: SENTINEL })}\n\n`,
        overflow],
      ['standalone error, nested code',
        `data: ${JSON.stringify({ type: 'error', error: { code: 'rate_limit_exceeded', message: SENTINEL } })}\n\n`,
        upstreamFailed(429, 'rate_limit_error', 'Upstream rate limit exceeded')],
      ['standalone error, top-level wins over nested',
        `data: ${JSON.stringify({ type: 'error', code: 'server_error', error: { code: 'rate_limit_exceeded' } })}\n\n`,
        upstreamFailed(502, 'api_error', 'Upstream Responses request failed (server_error)')],
      ['standalone error, overflow message with numbers',
        `data: ${JSON.stringify({ type: 'error', code: null, message:
          `This model's maximum context length is 128000 tokens. However, your messages resulted in 130532 tokens. ${SENTINEL}` })}\n\n`,
        upstreamFailed(400, 'invalid_request_error', 'prompt is too long: 130532 tokens > 128000 maximum')],
      ['bare error frame', 'data: {"type":"error"}\n\n', unknownFailure],
    ])('%s', async (_name, wire, expected) => {
      const h = harness();
      if ('stop_reason' in expected) {
        h.upstream.end(wire);
        const result = await h.result;
        expect(result).toMatchObject(expected);
        expect(result['usage']).toEqual({ input_tokens: 42, output_tokens: 9 });
        return;
      }
      const assertion = h.result.then(() => { throw new Error('resolved'); }, (error: unknown) => error);
      h.upstream.end(wire);
      const error = await assertion;
      expect(error).toBeInstanceOf(ResponsesStreamError);
      expect(error).toMatchObject(expected);
      expect(JSON.stringify({ message: (error as Error).message, mapping: (error as ResponsesStreamError).mapping }))
        .not.toContain(SENTINEL);
      expect(h.upstream.destroyed).toBe(true);
      expect(h.downstream.listenerCount('close')).toBe(0);
    });

    it.each(['max_output_tokens', 'content_filter'].flatMap((reason) =>
      [['number', 42], ['object', { q: 'ok' }], ['null', null]].map(([kind, args]) => [reason, kind, args] as const)),
    )('incomplete %s with %s arguments gives upstream_incomplete', async (reason, _kind, args) => {
      const h = harness();
      const assertion = expect(h.result).rejects.toMatchObject(toolInput);
      h.upstream.end(incomplete(reason, [message,
        { type: 'function_call', call_id: 'call1', name: 'search', arguments: args }]));
      await assertion;
    });

    it('keeps the incomplete-tool-input rejection ahead of content translation', async () => {
      const h = harness();
      const assertion = expect(h.result).rejects.toMatchObject(toolInput);
      // The refusal part is invalid content; the precedence rule must win first.
      h.upstream.end(incomplete('content_filter', [{ type: 'message', content: [{ type: 'refusal', refusal: '' }] },
        call('{"x":')]));
      await assertion;
    });
  });

  describe('SSE framing of terminal events whose JSON omits type', () => {
    const body = {
      'response.failed': { response: { status: 'failed', error: { code: 'context_length_exceeded' } } },
      'response.incomplete': { response: { ...snapshot, status: 'incomplete',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'partial' }] }],
        incomplete_details: { reason: 'content_filter' } } },
      error: { code: 'rate_limit_exceeded', message: 'private-upstream-value' },
    } as const;
    const expected = {
      'response.failed': { code: 'upstream_failed', mapping: { status: 400, type: 'invalid_request_error' } },
      'response.incomplete': { stop_reason: 'refusal' },
      error: { code: 'upstream_failed', mapping: { status: 429, type: 'rate_limit_error' } },
    } as const;
    type Name = keyof typeof body;
    const json = (name: Name) => JSON.stringify(body[name]);
    const variants: Record<string, (name: Name, write: (chunk: string | Buffer) => void) => void> = {
      unsplit: (name, write) => write(`event: ${name}\ndata: ${json(name)}\n\n`),
      'split after event line': (name, write) => {
        write(`event: ${name}\n`);
        write(`data: ${json(name)}\n\n`);
      },
      'multiline data': (name, write) => {
        const inner = json(name).slice(1, -1);
        write(`event: ${name}\ndata: {\ndata: ${inner}\ndata: }\n\n`);
      },
      'byte at a time': (name, write) => {
        for (const byte of Buffer.from(`event: ${name}\ndata: ${json(name)}\n\n`)) write(Buffer.from([byte]));
      },
      CRLF: (name, write) => {
        for (const char of `event: ${name}\r\ndata: ${json(name)}\r\n\r\n`) write(char);
      },
    };
    const cases = Object.keys(body).flatMap((name) =>
      Object.keys(variants).map((variant) => [name as Name, variant] as const));

    it.each(cases)('%s: %s gives the unsplit outcome', async (name, variant) => {
      const h = harness();
      const settled = h.result.then((value) => ({ value }), (error: unknown) => ({ error }));
      variants[variant](name, (chunk) => h.upstream.write(chunk));
      h.upstream.end();
      const outcome = await settled;
      if ('stop_reason' in expected[name]) {
        expect(outcome).toMatchObject({ value: expected[name] });
      } else {
        expect(outcome).toMatchObject({ error: expected[name] });
        expect((outcome as { error: Error }).error).toBeInstanceOf(ResponsesStreamError);
      }
    });
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
