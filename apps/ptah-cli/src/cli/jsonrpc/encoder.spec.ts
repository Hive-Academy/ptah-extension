/**
 * Unit tests for the JSON-RPC 2.0 encoder/decoder.
 *
 * TASK_2026_104 Batch 3.
 */

import {
  decodeMessage,
  encodeError,
  encodeNotification,
  encodeRequest,
  encodeResponse,
  type DecodeResult,
} from './encoder.js';

function asFailure(r: DecodeResult): Extract<DecodeResult, { ok: false }> {
  if (r.ok === true) throw new Error('expected decode failure');
  return r as Extract<DecodeResult, { ok: false }>;
}
import {
  JSON_RPC_VERSION,
  JsonRpcErrorCode,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
} from './types.js';

describe('encoder', () => {
  describe('encodeNotification', () => {
    it('emits a notification frame terminated by a single newline', () => {
      const line = encodeNotification('agent.thought', { text: 'hello' });
      expect(line.endsWith('\n')).toBe(true);
      const obj = JSON.parse(line.trimEnd());
      expect(obj).toEqual({
        jsonrpc: JSON_RPC_VERSION,
        method: 'agent.thought',
        params: { text: 'hello' },
      });
      expect(obj).not.toHaveProperty('id');
    });

    it('omits params when undefined', () => {
      const line = encodeNotification('session.shutdown');
      const obj = JSON.parse(line);
      expect(obj).toEqual({ jsonrpc: '2.0', method: 'session.shutdown' });
      expect(obj).not.toHaveProperty('params');
    });
  });

  describe('encodeRequest', () => {
    it('includes id, method, and params', () => {
      const line = encodeRequest(42, 'task.submit', { task: 'do x' });
      const obj = JSON.parse(line);
      expect(obj).toEqual({
        jsonrpc: '2.0',
        id: 42,
        method: 'task.submit',
        params: { task: 'do x' },
      });
    });

    it('accepts string ids', () => {
      const line = encodeRequest('req-1', 'permission.request');
      const obj = JSON.parse(line);
      expect(obj.id).toBe('req-1');
    });
  });

  describe('encodeResponse', () => {
    it('emits jsonrpc + id + result', () => {
      const line = encodeResponse(1, { ok: true });
      const obj = JSON.parse(line);
      expect(obj).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    });

    it('accepts null id (e.g. for parse-error responses)', () => {
      const line = encodeResponse(null, { ok: true });
      const obj = JSON.parse(line);
      expect(obj.id).toBeNull();
    });
  });

  describe('encodeError', () => {
    it('emits a JSON-RPC error frame with code + message', () => {
      const line = encodeError(
        7,
        JsonRpcErrorCode.MethodNotFound,
        'no such method',
      );
      const obj = JSON.parse(line);
      expect(obj).toEqual({
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32601, message: 'no such method' },
      });
    });

    it('attaches data when provided', () => {
      const line = encodeError(null, -32700, 'bad', { raw: 'oops' });
      const obj = JSON.parse(line);
      expect(obj.error.data).toEqual({ raw: 'oops' });
    });
  });

  describe('decodeMessage', () => {
    it('round-trips a notification', () => {
      const line = encodeNotification('agent.message', { text: 'hi' });
      const result = decodeMessage(line);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isJsonRpcNotification(result.message)).toBe(true);
      }
    });

    it('round-trips a request', () => {
      const line = encodeRequest(1, 'task.submit', { task: 'x' });
      const result = decodeMessage(line);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isJsonRpcRequest(result.message)).toBe(true);
      }
    });

    it('round-trips a success response', () => {
      const line = encodeResponse(1, { complete: true });
      const result = decodeMessage(line);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isJsonRpcSuccessResponse(result.message)).toBe(true);
      }
    });

    it('round-trips an error response', () => {
      const line = encodeError(1, -32603, 'internal');
      const result = decodeMessage(line);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isJsonRpcErrorResponse(result.message)).toBe(true);
      }
    });

    it('rejects malformed JSON with parse_error', () => {
      const result = asFailure(decodeMessage('{not json'));
      expect(result.reason).toBe('parse_error');
    });

    it('rejects empty / whitespace-only lines', () => {
      const result = asFailure(decodeMessage('   '));
      expect(result.reason).toBe('parse_error');
    });

    it('rejects valid JSON that is not a JSON-RPC envelope', () => {
      const result = asFailure(decodeMessage(JSON.stringify({ foo: 'bar' })));
      expect(result.reason).toBe('invalid_envelope');
    });

    it('rejects JSON with wrong jsonrpc version', () => {
      const result = decodeMessage(
        JSON.stringify({ jsonrpc: '1.0', method: 'x' }),
      );
      expect(result.ok).toBe(false);
    });
  });
});
