/**
 * `ChatBridge` — fire-and-forget broadcast → JSON-RPC turn primitive.
 *
 * Closes the gap between backend `chat:start / chat:continue / chat:resume`
 * (which return synchronously with `{ success: true }` and stream the actual
 * turn out-of-band via `chat:chunk`, `chat:complete`, `chat:error` broadcasts
 * on the `pushAdapter`) and the JSON-RPC turn-completion contract from spec
 * § 4.1.2.
 *
 * Pattern is intentionally aligned with `phase-runner.ts` async-broadcast mode
 * (register listeners BEFORE invoking the RPC, race completion vs timeout vs
 * abort, ALWAYS detach in `finally`).
 *
 * Behavior summary
 * ----------------
 *   1. Register filtered listeners on `pushAdapter` for `chat:chunk`,
 *      `chat:complete`, `chat:error` — every listener short-circuits unless
 *      `payload.tabId === opts.tabId` (multi-tabId isolation).
 *   2. Invoke `opts.rpcCall()` to kick the backend turn (the result is the
 *      synchronous accept ack; the real completion arrives via the listeners).
 *   3. On `chat:chunk` — demux `payload.event.eventType` into a flat spec-
 *      shaped `agent.thought | agent.message | agent.tool_use |
 *      agent.tool_result` JSON-RPC notification via `jsonrpc.notify(...)`.
 *      `message_start` swaps the synthetic `tabId` for the real SDK
 *      `sessionId` carried by subsequent events.
 *   4. On `chat:complete` (matching tabId) — resolve `{ success: true,
 *      sessionId, turnId }`.
 *   5. On `chat:error` (matching tabId) — resolve `{ success: false, error,
 *      sessionId }`.
 *   6. On `abortSignal` firing — resolve `{ success: false, cancelled: true }`.
 *      The CALLER is responsible for issuing the actual `chat:abort` RPC; the
 *      bridge only observes the abort signal and detaches cleanly.
 *   7. On timeout (default: no timeout) — resolve `{ success: false, error:
 *      'timed out' }` after `timeoutMs` ms with no terminal event.
 *
 * Listener-leak hardening: every `try` is paired with a `finally` that calls
 * `pushAdapter.off(name, listener)` for each listener attached, plus
 * `clearTimeout` for the timeout handle if any. The bridge MUST leave the
 * adapter at the same `listenerCount(name)` it found, regardless of outcome.
 *
 * No DI imports — wired manually by the upcoming `session.ts` (B10c) and
 * `interact.ts` (B10e). Tests pass a vanilla `EventEmitter` and a minimal
 * fake `JsonRpcServer` whose `notify` is a `jest.fn()`.
 */

import type { EventEmitter } from 'node:events';

import type { JsonRpcServer } from '../jsonrpc/server.js';

/** Outcome envelope returned by `runTurn`. Bridge NEVER throws. */
export type ChatTurnResult =
  | {
      readonly success: true;
      /** Real SDK session UUID (post-`message_start`) or the synthetic tabId. */
      readonly sessionId: string;
      /** Backend-supplied turn id when present on `chat:complete`. */
      readonly turnId?: string;
    }
  | {
      readonly success: false;
      /** Error message from `chat:error`, timeout, or transport failure. */
      readonly error: string;
      /** Best-known session id at time of failure. */
      readonly sessionId?: string;
      /** Distinguishes abort-signal cancellations from real failures. */
      readonly cancelled?: boolean;
    };

/** Options accepted by `runTurn`. */
export interface RunTurnOptions {
  /**
   * Synthetic tab id chosen by the caller for this turn. Must match the
   * `tabId` field in the backend's `chat:chunk | chat:complete | chat:error`
   * payloads. Used as the listener-side filter key for multi-tabId isolation.
   */
  readonly tabId: string;
  /**
   * Async callable that issues the `chat:start | chat:continue | chat:resume`
   * RPC. The synchronous `{ success: true }` ack is discarded — the real
   * completion arrives via `chat:complete` on the push adapter. If the call
   * itself rejects, the turn resolves `{ success: false, error }` and listeners
   * are detached.
   */
  readonly rpcCall: () => Promise<{ readonly success: boolean }>;
  /** Optional abort signal. On abort, the turn resolves with `cancelled: true`. */
  readonly abortSignal?: AbortSignal;
  /**
   * Optional wall-clock cap (ms). On expiry, resolves `{ success: false,
   * error: 'timed out' }`. When omitted, the bridge waits indefinitely for
   * `chat:complete | chat:error | abortSignal`.
   */
  readonly timeoutMs?: number;
  /**
   * Caller-supplied command label propagated into the terminal `task.complete`
   * / `task.error` notification (`params.command`). Defaults to `'chat'` when
   * omitted, matching the schema in `docs/jsonrpc-schema.md` § 1.10.
   */
  readonly command?: string;
}

interface ChatChunkPayload {
  readonly tabId: string;
  readonly sessionId?: string;
  readonly event?: ChatChunkEvent;
}

interface ChatChunkEvent {
  readonly eventType: string;
  readonly sessionId?: string;
  readonly id?: string;
  readonly messageId?: string;
  readonly delta?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolInput?: Record<string, unknown>;
  readonly output?: unknown;
  readonly isError?: boolean;
  readonly text?: string;
}

interface ChatCompletePayload {
  readonly tabId: string;
  readonly sessionId?: string;
  readonly turnId?: string;
}

interface ChatErrorPayload {
  readonly tabId: string;
  readonly sessionId?: string;
  readonly error?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asChunk(payload: unknown): ChatChunkPayload | null {
  if (!isObject(payload)) return null;
  if (typeof payload['tabId'] !== 'string') return null;
  return payload as unknown as ChatChunkPayload;
}

function asComplete(payload: unknown): ChatCompletePayload | null {
  if (!isObject(payload)) return null;
  if (typeof payload['tabId'] !== 'string') return null;
  return payload as unknown as ChatCompletePayload;
}

function asError(payload: unknown): ChatErrorPayload | null {
  if (!isObject(payload)) return null;
  if (typeof payload['tabId'] !== 'string') return null;
  return payload as unknown as ChatErrorPayload;
}

/**
 * Bridge backend chat broadcasts → spec-shaped `agent.*` JSON-RPC notifications,
 * with turn boundary detection via `chat:complete | chat:error`.
 */
export class ChatBridge {
  constructor(
    private readonly pushAdapter: EventEmitter,
    private readonly jsonrpc: Pick<JsonRpcServer, 'notify'>,
  ) {}

  /**
   * Run a single chat turn. Resolves only when ONE of:
   *   - `chat:complete` (matching tabId) — `{ success: true }`
   *   - `chat:error`    (matching tabId) — `{ success: false }`
   *   - `abortSignal.aborted`            — `{ success: false, cancelled: true }`
   *   - `timeoutMs` elapses              — `{ success: false, error: 'timed out' }`
   *   - `rpcCall()` throws              — `{ success: false, error }`
   *
   * Always detaches listeners + clears timers in `finally`. NEVER throws.
   */
  async runTurn(opts: RunTurnOptions): Promise<ChatTurnResult> {
    const { tabId, rpcCall, abortSignal, timeoutMs } = opts;
    const command = opts.command ?? 'chat';
    const startedAt = Date.now();
    let resolvedSessionId: string = tabId;
    const turnId = `${tabId}:t1`;
    let aggregatedText = '';

    let resolveOuter: (result: ChatTurnResult) => void = () => undefined;
    const outerPromise = new Promise<ChatTurnResult>((resolve) => {
      resolveOuter = resolve;
    });

    const debug = (message: string): void => {
      if (process.env['PTAH_LOG_LEVEL'] === 'debug') {
        process.stderr.write(`[ptah:chat-bridge] ${message}\n`);
      }
    };

    let settled = false;
    const emitTerminal = (result: ChatTurnResult): void => {
      const durationMs = Date.now() - startedAt;
      if (result.success === true) {
        const summary: Record<string, unknown> = {
          session_id: result.sessionId,
          turn_id: result.turnId ?? turnId,
        };
        if (aggregatedText.length > 0) {
          summary['text'] = aggregatedText;
        }
        void this.jsonrpc.notify('task.complete', {
          command,
          duration_ms: durationMs,
          summary,
        });
      } else {
        void this.jsonrpc.notify('task.error', {
          command,
          code: -32603,
          message: result.error,
          recoverable: result.cancelled === true,
          ptah_code: 'unknown',
          details: {
            session_id: result.sessionId ?? resolvedSessionId,
            cancelled: result.cancelled === true,
            duration_ms: durationMs,
          },
        });
      }
    };
    const settle = (result: ChatTurnResult): void => {
      if (settled) return;
      settled = true;
      emitTerminal(result);
      resolveOuter(result);
    };

    const onChunk = (payload: unknown): void => {
      const chunk = asChunk(payload);
      if (!chunk || chunk.tabId !== tabId) return;
      const event = chunk.event;
      if (!event || typeof event.eventType !== 'string') return;
      if (event.eventType === 'message_start') {
        const real = event.sessionId ?? chunk.sessionId;
        if (typeof real === 'string' && real.length > 0) {
          resolvedSessionId = real;
        }
        return;
      }
      switch (event.eventType) {
        case 'thinking_delta':
        case 'thought_delta': {
          const text = event.delta ?? event.text ?? '';
          if (text.length === 0) return;
          void this.jsonrpc.notify('agent.thought', {
            session_id: resolvedSessionId,
            turn_id: turnId,
            message_id: event.messageId ?? event.id,
            text,
          });
          return;
        }
        case 'text_delta': {
          const text = event.delta ?? event.text ?? '';
          if (text.length === 0) return;
          aggregatedText += text;
          void this.jsonrpc.notify('agent.message', {
            session_id: resolvedSessionId,
            turn_id: turnId,
            message_id: event.messageId ?? event.id,
            text,
            is_partial: true,
          });
          return;
        }
        case 'message_complete': {
          const text = event.text ?? '';
          void this.jsonrpc.notify('agent.message', {
            session_id: resolvedSessionId,
            turn_id: turnId,
            message_id: event.messageId ?? event.id,
            text,
            is_partial: false,
          });
          return;
        }
        case 'tool_start':
        case 'tool_use': {
          void this.jsonrpc.notify('agent.tool_use', {
            session_id: resolvedSessionId,
            turn_id: turnId,
            tool_use_id: event.toolCallId ?? event.id ?? '',
            tool_name: event.toolName ?? '',
            tool_input: event.toolInput ?? {},
          });
          return;
        }
        case 'tool_result': {
          void this.jsonrpc.notify('agent.tool_result', {
            session_id: resolvedSessionId,
            turn_id: turnId,
            tool_use_id: event.toolCallId ?? '',
            result: event.output,
            is_error: event.isError === true,
          });
          return;
        }
        default:
          debug(`dropped event type: ${event.eventType}`);
          return;
      }
    };

    const onComplete = (payload: unknown): void => {
      const completePayload = asComplete(payload);
      if (!completePayload || completePayload.tabId !== tabId) return;
      const sid =
        typeof completePayload.sessionId === 'string' &&
        completePayload.sessionId.length > 0
          ? completePayload.sessionId
          : resolvedSessionId;
      settle({
        success: true,
        sessionId: sid,
        turnId: completePayload.turnId,
      });
    };

    const onError = (payload: unknown): void => {
      const errorPayload = asError(payload);
      if (!errorPayload || errorPayload.tabId !== tabId) return;
      const sid =
        typeof errorPayload.sessionId === 'string' &&
        errorPayload.sessionId.length > 0
          ? errorPayload.sessionId
          : resolvedSessionId;
      settle({
        success: false,
        error: errorPayload.error ?? 'unknown chat error',
        sessionId: sid,
      });
    };
    this.pushAdapter.on('chat:chunk', onChunk);
    this.pushAdapter.on('chat:complete', onComplete);
    this.pushAdapter.on('chat:error', onError);
    let onAbort: (() => void) | undefined;
    if (abortSignal) {
      if (abortSignal.aborted) {
        settle({ success: false, error: 'aborted', cancelled: true });
      } else {
        onAbort = (): void => {
          settle({ success: false, error: 'aborted', cancelled: true });
        };
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    }
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        settle({
          success: false,
          error: `chat turn timed out after ${timeoutMs}ms`,
          sessionId: resolvedSessionId,
        });
      }, timeoutMs);
    }

    try {
      try {
        const ack = await rpcCall();
        if (ack && ack.success === false) {
          const ackError = (ack as { readonly error?: unknown }).error;
          const errorMessage =
            typeof ackError === 'string' && ackError.length > 0
              ? ackError
              : 'rpc rejected chat turn (success=false)';
          settle({
            success: false,
            error: errorMessage,
            sessionId: resolvedSessionId,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        settle({
          success: false,
          error: message,
          sessionId: resolvedSessionId,
        });
      }
      return await outerPromise;
    } finally {
      this.pushAdapter.off('chat:chunk', onChunk);
      this.pushAdapter.off('chat:complete', onComplete);
      this.pushAdapter.off('chat:error', onError);
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (onAbort && abortSignal) {
        abortSignal.removeEventListener('abort', onAbort);
      }
    }
  }
}
