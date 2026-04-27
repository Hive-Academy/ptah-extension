/**
 * JSON-RPC 2.0 stdio server.
 *
 * TASK_2026_104 Batch 3.
 *
 * Bidirectional dispatcher for `interact` mode and the inbound channel of
 * `run` / `execute-spec` (which only receives permission responses).
 *
 *   - `register(method, handler)` — register an inbound method handler
 *   - `notify(method, params)` — fire-and-forget outbound notification
 *   - `request(method, params)` — outbound CLI → client request, returns a
 *     promise that resolves when the matching response arrives on stdin
 *   - `start(reader, writer)` — attach to a stdin reader + stdout writer
 *   - `stop()` — detach + reject all pending requests
 *
 * Standard error codes:
 *   -32700 Parse error  (malformed JSON on stdin)
 *   -32601 Method not found
 *   -32602 Invalid params (when handler throws an `InvalidParamsError`)
 *   -32603 Internal error (handler threw unexpectedly)
 *
 * No DI imports. Pure protocol layer — wired by `interact.ts` in Batch 6.
 */

import {
  encodeError,
  encodeNotification,
  encodeRequest,
  encodeResponse,
} from './encoder.js';
import type { StdinReader } from '../io/stdin-reader.js';
import type { StdoutWriter } from '../io/stdout-writer.js';
import {
  JsonRpcErrorCode,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type RequestId,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
} from './types.js';

/** A registered inbound handler. May return any JSON-serializable value. */
export type RpcHandler = (params: unknown) => Promise<unknown> | unknown;

/**
 * Throw inside a handler to surface a `-32602 Invalid params` error to the
 * client without leaking the raw exception message.
 */
export class InvalidParamsError extends Error {
  constructor(
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'InvalidParamsError';
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

export class JsonRpcServer {
  private readonly handlers = new Map<string, RpcHandler>();
  private readonly pending = new Map<RequestId, PendingRequest>();
  private reader: StdinReader | null = null;
  private writer: StdoutWriter | null = null;
  /** Monotonic id generator for outbound requests. */
  private nextRequestId = 1;
  private running = false;

  /** Register an inbound handler. Overrides any previous registration. */
  register(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler);
  }

  /** Remove a registered handler. */
  unregister(method: string): void {
    this.handlers.delete(method);
  }

  /** Attach the server to a reader + writer pair. */
  start(reader: StdinReader, writer: StdoutWriter): void {
    if (this.running) {
      return;
    }
    this.reader = reader;
    this.writer = writer;
    this.running = true;

    reader.start({
      onMessage: (message) => {
        // Fire-and-forget — errors inside dispatch are caught and reported.
        void this.dispatch(message);
      },
      onParseError: (result) => {
        // -32700 Parse error per JSON-RPC 2.0 spec. `id` is null since we
        // can't extract it from an unparseable line.
        void this.send(
          encodeError(null, JsonRpcErrorCode.ParseError, 'Parse error', {
            raw: result.raw,
            reason: result.reason,
          }),
        );
      },
      onEnd: () => {
        // Stream closed — let `stop()` handle cleanup so callers can detect EOF.
        this.running = false;
      },
    });
  }

  /** Detach the server and reject all pending outbound requests. */
  stop(): void {
    this.running = false;
    if (this.reader) {
      this.reader.stop();
      this.reader = null;
    }
    this.writer = null;
    for (const [, pending] of this.pending) {
      pending.reject(
        new Error('JsonRpcServer stopped before response arrived'),
      );
    }
    this.pending.clear();
  }

  /** Fire a JSON-RPC notification (no response expected). */
  async notify<TParams = unknown>(
    method: string,
    params?: TParams,
  ): Promise<void> {
    await this.send(encodeNotification(method, params));
  }

  /**
   * Send a JSON-RPC request to the client and resolve when the matching
   * response arrives. Throws if the client returns an error response or the
   * server is stopped before the response arrives.
   */
  request<TResult = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
  ): Promise<TResult> {
    const id = this.nextRequestId++;
    const promise = new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value: unknown) => resolve(value as TResult),
        reject,
        method,
      });
    });
    void this.send(encodeRequest(id, method, params));
    return promise;
  }

  // ------------------------------------------------------------------
  // Internal dispatch
  // ------------------------------------------------------------------

  private async dispatch(message: JsonRpcMessage): Promise<void> {
    if (isJsonRpcRequest(message)) {
      await this.dispatchRequest(message);
      return;
    }
    if (isJsonRpcSuccessResponse(message) || isJsonRpcErrorResponse(message)) {
      this.dispatchResponse(message);
      return;
    }
    if (isJsonRpcNotification(message)) {
      await this.dispatchNotification(message);
      return;
    }
    // Should not reach here — decoder already validated.
  }

  private async dispatchRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this.handlers.get(request.method);
    if (!handler) {
      await this.send(
        encodeError(
          request.id,
          JsonRpcErrorCode.MethodNotFound,
          `Method not found: ${request.method}`,
        ),
      );
      return;
    }

    try {
      const result = await handler(request.params);
      await this.send(encodeResponse(request.id, result ?? null));
    } catch (error) {
      if (error instanceof InvalidParamsError) {
        await this.send(
          encodeError(
            request.id,
            JsonRpcErrorCode.InvalidParams,
            error.message,
            error.data,
          ),
        );
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.send(
        encodeError(request.id, JsonRpcErrorCode.InternalError, message),
      );
    }
  }

  private async dispatchNotification(
    notification: JsonRpcNotification,
  ): Promise<void> {
    const handler = this.handlers.get(notification.method);
    if (!handler) {
      // JSON-RPC 2.0: notifications without a registered handler are silently
      // ignored — there's no `id` to respond to.
      return;
    }
    try {
      await handler(notification.params);
    } catch {
      // Swallow — by spec we cannot respond. The handler is responsible for
      // its own error reporting (e.g. by calling `notify('task.error', ...)`).
    }
  }

  private dispatchResponse(response: JsonRpcResponse): void {
    if (response.id === null || response.id === undefined) {
      // Cannot correlate a null-id response to any outbound request.
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      // No matching outbound request — ignore (could be a delayed response).
      return;
    }
    this.pending.delete(response.id);
    if (isJsonRpcErrorResponse(response)) {
      const errMsg = `${pending.method} failed: ${response.error.message}`;
      const err = new Error(errMsg);
      (err as unknown as { code: number; data: unknown }).code =
        response.error.code;
      (err as unknown as { code: number; data: unknown }).data =
        response.error.data;
      pending.reject(err);
      return;
    }
    pending.resolve(response.result);
  }

  private async send(line: string): Promise<void> {
    const w = this.writer;
    if (!w) {
      return;
    }
    await w.write(line);
  }
}
