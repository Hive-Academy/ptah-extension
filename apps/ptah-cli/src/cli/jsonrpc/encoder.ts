/**
 * JSON-RPC 2.0 wire-format helpers (NDJSON envelope).
 *
 * TASK_2026_104 Batch 3.
 *
 * Pure stateless functions:
 *   - `encodeNotification(method, params)` → NDJSON line
 *   - `encodeRequest(id, method, params)`  → NDJSON line
 *   - `encodeResponse(id, result)`         → NDJSON line
 *   - `encodeError(id, code, message, data?)` → NDJSON line
 *   - `decodeMessage(line)`                → discriminated union or parse error
 *
 * Each encoded line ends with exactly one `\n`. `JSON.stringify` is used as
 * the canonical serializer; circular references throw (caller's bug, not
 * ours — we surface the throw rather than swallow it).
 */

import {
  JSON_RPC_VERSION,
  type JsonRpcError,
  type JsonRpcErrorResponse,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
  type RequestId,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
} from './types.js';

/** Outcome of `decodeMessage`. */
export type DecodeResult =
  | { ok: true; message: JsonRpcMessage }
  | {
      ok: false;
      reason: 'parse_error' | 'invalid_envelope';
      raw: string;
      cause?: unknown;
    };

/** Encode a JSON-RPC notification as a single newline-terminated line. */
export function encodeNotification<TParams = unknown>(
  method: string,
  params?: TParams,
): string {
  const frame: JsonRpcNotification<TParams> = {
    jsonrpc: JSON_RPC_VERSION,
    method,
    ...(params !== undefined ? { params } : {}),
  };
  return `${JSON.stringify(frame)}\n`;
}

/** Encode a JSON-RPC request as a single newline-terminated line. */
export function encodeRequest<TParams = unknown>(
  id: RequestId,
  method: string,
  params?: TParams,
): string {
  const frame: JsonRpcRequest<TParams> = {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  };
  return `${JSON.stringify(frame)}\n`;
}

/** Encode a JSON-RPC success response as a single newline-terminated line. */
export function encodeResponse<TResult = unknown>(
  id: RequestId | null,
  result: TResult,
): string {
  const frame: JsonRpcSuccessResponse<TResult> = {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
  return `${JSON.stringify(frame)}\n`;
}

/** Encode a JSON-RPC error response as a single newline-terminated line. */
export function encodeError<TData = unknown>(
  id: RequestId | null,
  code: number,
  message: string,
  data?: TData,
): string {
  const error: JsonRpcError<TData> = {
    code,
    message,
    ...(data !== undefined ? { data } : {}),
  };
  const frame: JsonRpcErrorResponse<TData> = {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error,
  };
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Parse a single NDJSON line into a discriminated JSON-RPC message.
 * Returns `{ ok: false, reason: 'parse_error' }` on malformed JSON and
 * `{ ok: false, reason: 'invalid_envelope' }` on JSON that doesn't match
 * any of the four JSON-RPC 2.0 envelope shapes.
 */
export function decodeMessage(line: string): DecodeResult {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'parse_error', raw: line };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    return { ok: false, reason: 'parse_error', raw: line, cause };
  }

  if (
    isJsonRpcNotification(parsed) ||
    isJsonRpcRequest(parsed) ||
    isJsonRpcSuccessResponse(parsed) ||
    isJsonRpcErrorResponse(parsed)
  ) {
    return { ok: true, message: parsed };
  }

  return { ok: false, reason: 'invalid_envelope', raw: line };
}
