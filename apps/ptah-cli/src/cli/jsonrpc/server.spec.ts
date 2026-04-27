/**
 * Unit tests for the JSON-RPC 2.0 stdio server.
 *
 * TASK_2026_104 Batch 3.
 *
 * Uses `PassThrough` streams as stand-ins for `process.stdin` /
 * `process.stdout` so each test is fully isolated.
 */

import { PassThrough } from 'node:stream';

import { decodeMessage } from './encoder.js';
import { InvalidParamsError, JsonRpcServer } from './server.js';
import {
  JsonRpcErrorCode,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
  type JsonRpcMessage,
} from './types.js';
import { StdinReader } from '../io/stdin-reader.js';
import { StdoutWriter } from '../io/stdout-writer.js';

function asMethod(message: JsonRpcMessage): string {
  if (isJsonRpcNotification(message) || isJsonRpcRequest(message)) {
    return message.method;
  }
  return '';
}

function asRequestId(message: JsonRpcMessage): number | string {
  if (isJsonRpcRequest(message)) return message.id;
  throw new Error('not a request');
}

interface Harness {
  server: JsonRpcServer;
  stdinIn: PassThrough;
  stdoutOut: PassThrough;
  outLines: string[];
  /** Wait for `n` lines to land on stdout (or reject after `timeoutMs`). */
  waitForLines: (n: number, timeoutMs?: number) => Promise<string[]>;
}

function makeHarness(): Harness {
  const stdinIn = new PassThrough();
  const stdoutOut = new PassThrough();
  const reader = new StdinReader({ input: stdinIn });
  const writer = new StdoutWriter({ output: stdoutOut });
  const server = new JsonRpcServer();
  server.start(reader, writer);

  const outLines: string[] = [];
  let buffer = '';
  stdoutOut.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      outLines.push(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
    }
  });

  const waitForLines = (n: number, timeoutMs = 1000): Promise<string[]> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (outLines.length >= n) {
          resolve(outLines.slice(0, n));
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for ${n} lines (got ${outLines.length})`,
            ),
          );
          return;
        }
        setTimeout(tick, 5);
      };
      tick();
    });

  return { server, stdinIn, stdoutOut, outLines, waitForLines };
}

function send(stdinIn: PassThrough, obj: unknown): void {
  stdinIn.write(`${JSON.stringify(obj)}\n`);
}

describe('JsonRpcServer', () => {
  describe('register + dispatch', () => {
    it('routes inbound request to registered handler and emits response', async () => {
      const h = makeHarness();
      h.server.register('echo', (params) => ({ echoed: params }));

      send(h.stdinIn, {
        jsonrpc: '2.0',
        id: 1,
        method: 'echo',
        params: { x: 7 },
      });
      const [line] = await h.waitForLines(1);
      const decoded = decodeMessage(line);
      expect(decoded.ok).toBe(true);
      if (decoded.ok && isJsonRpcSuccessResponse(decoded.message)) {
        expect(decoded.message.id).toBe(1);
        expect(decoded.message.result).toEqual({ echoed: { x: 7 } });
      } else {
        throw new Error('expected success response');
      }
      h.server.stop();
    });

    it('emits -32601 for unknown method', async () => {
      const h = makeHarness();
      send(h.stdinIn, { jsonrpc: '2.0', id: 9, method: 'mystery' });
      const [line] = await h.waitForLines(1);
      const decoded = decodeMessage(line);
      expect(decoded.ok).toBe(true);
      if (decoded.ok && isJsonRpcErrorResponse(decoded.message)) {
        expect(decoded.message.error.code).toBe(
          JsonRpcErrorCode.MethodNotFound,
        );
        expect(decoded.message.id).toBe(9);
      } else {
        throw new Error('expected error response');
      }
      h.server.stop();
    });

    it('emits -32700 parse error for malformed JSON on stdin', async () => {
      const h = makeHarness();
      h.stdinIn.write('{not json\n');
      const [line] = await h.waitForLines(1);
      const decoded = decodeMessage(line);
      expect(decoded.ok).toBe(true);
      if (decoded.ok && isJsonRpcErrorResponse(decoded.message)) {
        expect(decoded.message.error.code).toBe(JsonRpcErrorCode.ParseError);
        expect(decoded.message.id).toBeNull();
      } else {
        throw new Error('expected error response');
      }
      h.server.stop();
    });

    it('emits -32602 when handler throws InvalidParamsError', async () => {
      const h = makeHarness();
      h.server.register('strict', () => {
        throw new InvalidParamsError('missing field x', { field: 'x' });
      });
      send(h.stdinIn, { jsonrpc: '2.0', id: 4, method: 'strict' });
      const [line] = await h.waitForLines(1);
      const decoded = decodeMessage(line);
      if (decoded.ok && isJsonRpcErrorResponse(decoded.message)) {
        expect(decoded.message.error.code).toBe(JsonRpcErrorCode.InvalidParams);
        expect(decoded.message.error.data).toEqual({ field: 'x' });
      } else {
        throw new Error('expected error response');
      }
      h.server.stop();
    });

    it('emits -32603 internal error when handler throws a generic Error', async () => {
      const h = makeHarness();
      h.server.register('boom', () => {
        throw new Error('kaboom');
      });
      send(h.stdinIn, { jsonrpc: '2.0', id: 5, method: 'boom' });
      const [line] = await h.waitForLines(1);
      const decoded = decodeMessage(line);
      if (decoded.ok && isJsonRpcErrorResponse(decoded.message)) {
        expect(decoded.message.error.code).toBe(JsonRpcErrorCode.InternalError);
        expect(decoded.message.error.message).toContain('kaboom');
      } else {
        throw new Error('expected error response');
      }
      h.server.stop();
    });
  });

  describe('outbound requests', () => {
    it('correlates response by id and resolves the promise', async () => {
      const h = makeHarness();
      const promise = h.server.request<{ ok: boolean }>('permission.request', {
        tool: 'edit',
      });
      const [line] = await h.waitForLines(1);
      const decoded = decodeMessage(line);
      if (!decoded.ok || asMethod(decoded.message) !== 'permission.request') {
        throw new Error('expected permission.request out');
      }
      const id = asRequestId(decoded.message);
      // Client responds.
      send(h.stdinIn, { jsonrpc: '2.0', id, result: { ok: true } });
      const result = await promise;
      expect(result).toEqual({ ok: true });
      h.server.stop();
    });

    it('rejects pending requests when stop() is called', async () => {
      const h = makeHarness();
      const promise = h.server.request('q.ask', {});
      h.server.stop();
      await expect(promise).rejects.toThrow(/stopped/);
    });

    it('rejects pending request with the error from an error response', async () => {
      const h = makeHarness();
      const promise = h.server.request('any', {});
      const [line] = await h.waitForLines(1);
      const decoded = decodeMessage(line);
      if (!decoded.ok) throw new Error('decode failed');
      const id = asRequestId(decoded.message);
      send(h.stdinIn, {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'denied' },
      });
      await expect(promise).rejects.toThrow(/denied/);
      h.server.stop();
    });

    it('handles multiple concurrent outbound requests independently', async () => {
      const h = makeHarness();
      const p1 = h.server.request<number>('m', 1);
      const p2 = h.server.request<number>('m', 2);

      const lines = await h.waitForLines(2);
      const ids = lines.map((l) => {
        const dec = decodeMessage(l);
        if (!dec.ok) throw new Error('decode');
        return asRequestId(dec.message);
      });
      expect(ids[0]).not.toBe(ids[1]);

      send(h.stdinIn, { jsonrpc: '2.0', id: ids[1], result: 200 });
      send(h.stdinIn, { jsonrpc: '2.0', id: ids[0], result: 100 });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(100);
      expect(r2).toBe(200);
      h.server.stop();
    });
  });

  describe('notifications (no id, no response)', () => {
    it('silently dispatches an inbound notification to a registered handler', async () => {
      const h = makeHarness();
      const calls: unknown[] = [];
      h.server.register('log.line', (p) => {
        calls.push(p);
      });
      send(h.stdinIn, {
        jsonrpc: '2.0',
        method: 'log.line',
        params: { msg: 'hi' },
      });
      // Give the dispatcher a tick to run the async handler.
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toEqual([{ msg: 'hi' }]);
      // No response should have been emitted.
      expect(h.outLines.length).toBe(0);
      h.server.stop();
    });

    it('emits an outbound notification via notify()', async () => {
      const h = makeHarness();
      await h.server.notify('agent.message', { text: 'hi' });
      const [line] = await h.waitForLines(1);
      const decoded = decodeMessage(line);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(asMethod(decoded.message)).toBe('agent.message');
        expect(isJsonRpcNotification(decoded.message)).toBe(true);
      }
      h.server.stop();
    });
  });

  describe('lifecycle', () => {
    it('start() is idempotent', () => {
      const h = makeHarness();
      h.server.start(
        new StdinReader({ input: h.stdinIn }),
        new StdoutWriter({ output: h.stdoutOut }),
      );
      // Should not throw.
      h.server.stop();
    });

    it('stop() is idempotent', () => {
      const h = makeHarness();
      h.server.stop();
      expect(() => h.server.stop()).not.toThrow();
    });
  });
});
