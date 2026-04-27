/**
 * Unit tests for the line-buffered NDJSON stdin reader.
 *
 * TASK_2026_104 Batch 3.
 */

import { PassThrough } from 'node:stream';

import { StdinReader } from './stdin-reader.js';
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  type JsonRpcMessage,
} from '../jsonrpc/types.js';

/** Narrow a JsonRpcMessage to one with a `method` field (request or notification). */
function methodOf(message: JsonRpcMessage): string {
  if (isJsonRpcNotification(message) || isJsonRpcRequest(message)) {
    return message.method;
  }
  return '';
}

const tick = () => new Promise((r) => setImmediate(r));

describe('StdinReader', () => {
  it('parses a single newline-delimited JSON message', async () => {
    const input = new PassThrough();
    const reader = new StdinReader({ input });
    const messages: JsonRpcMessage[] = [];
    reader.start({ onMessage: (m) => messages.push(m) });

    input.write(
      '{"jsonrpc":"2.0","method":"agent.thought","params":{"text":"hi"}}\n',
    );
    await tick();
    await tick();

    expect(messages).toHaveLength(1);
    expect(methodOf(messages[0] as JsonRpcMessage)).toBe('agent.thought');
    reader.stop();
  });

  it('tolerates a JSON message split across multiple chunks', async () => {
    const input = new PassThrough();
    const reader = new StdinReader({ input });
    const messages: JsonRpcMessage[] = [];
    reader.start({ onMessage: (m) => messages.push(m) });

    input.write('{"jsonrpc":"2.0",');
    await tick();
    input.write('"method":"agent.message",');
    await tick();
    input.write('"params":{"text":"hello"}}\n');
    await tick();
    await tick();

    expect(messages).toHaveLength(1);
    expect(methodOf(messages[0] as JsonRpcMessage)).toBe('agent.message');
    reader.stop();
  });

  it('parses multiple back-to-back messages in one chunk', async () => {
    const input = new PassThrough();
    const reader = new StdinReader({ input });
    const messages: JsonRpcMessage[] = [];
    reader.start({ onMessage: (m) => messages.push(m) });

    input.write(
      '{"jsonrpc":"2.0","method":"a"}\n' +
        '{"jsonrpc":"2.0","method":"b"}\n' +
        '{"jsonrpc":"2.0","method":"c"}\n',
    );
    await tick();
    await tick();
    expect(messages.map(methodOf)).toEqual(['a', 'b', 'c']);
    reader.stop();
  });

  it('invokes onParseError on malformed JSON without crashing', async () => {
    const input = new PassThrough();
    const reader = new StdinReader({ input });
    const messages: JsonRpcMessage[] = [];
    const errors: string[] = [];
    reader.start({
      onMessage: (m) => messages.push(m),
      onParseError: (r) => errors.push(r.reason),
    });

    input.write('{not json\n');
    input.write('{"jsonrpc":"2.0","method":"x"}\n');
    await tick();
    await tick();

    expect(errors).toEqual(['parse_error']);
    expect(messages.map(methodOf)).toEqual(['x']);
    reader.stop();
  });

  it('reports invalid_envelope for valid-but-non-JSON-RPC payloads', async () => {
    const input = new PassThrough();
    const reader = new StdinReader({ input });
    const errors: string[] = [];
    reader.start({
      onMessage: () => {
        /* unused */
      },
      onParseError: (r) => errors.push(r.reason),
    });

    input.write('{"foo":"bar"}\n');
    await tick();
    await tick();
    expect(errors).toEqual(['invalid_envelope']);
    reader.stop();
  });

  it('skips blank / whitespace-only lines silently', async () => {
    const input = new PassThrough();
    const reader = new StdinReader({ input });
    const messages: JsonRpcMessage[] = [];
    const errors: string[] = [];
    reader.start({
      onMessage: (m) => messages.push(m),
      onParseError: (r) => errors.push(r.reason),
    });

    input.write('\n\n   \n{"jsonrpc":"2.0","method":"x"}\n');
    await tick();
    await tick();
    expect(messages).toHaveLength(1);
    expect(errors).toEqual([]);
    reader.stop();
  });

  it('invokes onEnd when the stream closes', async () => {
    const input = new PassThrough();
    const reader = new StdinReader({ input });
    const ended: boolean[] = [];
    reader.start({
      onMessage: () => {
        /* unused */
      },
      onEnd: () => ended.push(true),
    });

    input.end();
    await tick();
    await tick();
    expect(ended).toEqual([true]);
  });

  it('start() is idempotent (second call without stop is a no-op)', async () => {
    const input = new PassThrough();
    const reader = new StdinReader({ input });
    const messages: JsonRpcMessage[] = [];
    reader.start({ onMessage: (m) => messages.push(m) });
    // Second start with a different handler should be ignored.
    reader.start({
      onMessage: () => {
        throw new Error('should not be invoked');
      },
    });
    input.write('{"jsonrpc":"2.0","method":"ok"}\n');
    await tick();
    await tick();
    expect(messages).toHaveLength(1);
    reader.stop();
  });

  it('stop() can be called when the reader is already stopped', () => {
    const reader = new StdinReader({ input: new PassThrough() });
    expect(() => reader.stop()).not.toThrow();
    reader.start({ onMessage: () => undefined });
    reader.stop();
    expect(() => reader.stop()).not.toThrow();
  });
});
