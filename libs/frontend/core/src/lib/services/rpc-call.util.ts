import { VSCodeService } from './vscode.service';
import {
  MESSAGE_TYPES,
  type RpcMethodName,
  type RpcMethodParams,
  type RpcMethodResult,
} from '@ptah-extension/shared';

/**
 * Result type for RPC calls.
 * Encapsulates success/failure with optional typed data and error message.
 */
export type RpcCallResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

/**
 * Pending request tracked by the RpcClient singleton.
 */
interface PendingRequest {
  resolve: (value: RpcCallResult<unknown>) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  method: string;
}

/**
 * RpcClient — singleton that multiplexes all RPC calls over a single
 * window `message` listener.
 *
 * Wave E1 (TASK_2026_103): promoted from the editor library into core so
 * it is the single canonical RPC client for every webview consumer
 * (chat, editor, setup-wizard, harness-builder, canvas, app shell). The
 * editor-bespoke client has been deleted; consumers now import this
 * util from `@ptah-extension/core`.
 *
 * Responsibilities:
 * - Attach the `message` listener exactly once (at construction) so no
 *   response can be missed by late listener attachment.
 * - Maintain a `Map<correlationId, PendingRequest>` keyed by correlationId.
 *   On response, clear the per-request timeout and resolve. On timeout,
 *   reject and delete the entry so a late response is silently dropped
 *   via lookup miss.
 * - Gate outbound `postMessage` calls behind a `readyPromise`. Callers
 *   from before the webview/host bridge is wired up will queue naturally
 *   via `await`.
 *
 * Ready semantics: the extension/Electron host is what ultimately drives
 * readiness. We expose `markReady()` so the app bootstrap can flip the
 * gate once the existing WEBVIEW_READY signal has been posted (reusing
 * the existing ready protocol — no new signal invented). As a defensive
 * fallback, any inbound RPC_RESPONSE also flips the gate because it
 * proves the host's message pump is live.
 */
class RpcClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readyPromise: Promise<void>;
  private markReadyFn!: () => void;
  private isReady = false;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.markReadyFn = () => {
        if (this.isReady) return;
        this.isReady = true;
        resolve();
      };
    });

    // Attach the listener synchronously so no response can be missed.
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.onMessage);
    }
  }

  /**
   * Flip the ready gate. Safe to call multiple times (idempotent).
   * Consumers should call this after the app has posted WEBVIEW_READY
   * (reusing the existing ready protocol — no new signal invented).
   */
  markReady(): void {
    this.markReadyFn();
  }

  private readonly onMessage = (event: MessageEvent): void => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== MESSAGE_TYPES.RPC_RESPONSE) return;

    // Defensive: receiving any response proves the host pump is live.
    this.markReadyFn();

    const correlationId = data.correlationId;
    if (typeof correlationId !== 'string') return;

    const entry = this.pending.get(correlationId);
    if (!entry) {
      // Late response for a request that already timed out — silently drop.
      return;
    }

    clearTimeout(entry.timeoutHandle);
    this.pending.delete(correlationId);

    // Error shape is now normalized to `string` at the dispatcher boundary,
    // but tolerate legacy `{ message }` shape during rollout.
    const rawError = data.error;
    const errorStr =
      rawError === undefined || rawError === null
        ? undefined
        : typeof rawError === 'string'
          ? rawError
          : typeof rawError === 'object' && 'message' in rawError
            ? String((rawError as { message?: unknown }).message ?? rawError)
            : String(rawError);

    entry.resolve({
      success: Boolean(data.success),
      data: data.data as unknown,
      error: errorStr,
    });
  };

  async call<T>(
    vscodeService: VSCodeService,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<RpcCallResult<T>> {
    const correlationId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Gate outbound send on readiness so calls made before the bridge is
    // wired up queue naturally via `await` instead of being dropped.
    await this.readyPromise;

    return new Promise<RpcCallResult<T>>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        // Timeout wins: reject and delete. A late response will miss the
        // lookup and be silently dropped by onMessage().
        const entry = this.pending.get(correlationId);
        if (!entry) return;
        this.pending.delete(correlationId);
        resolve({ success: false, error: `RPC timeout: ${method}` });
      }, timeoutMs);

      this.pending.set(correlationId, {
        resolve: resolve as (value: RpcCallResult<unknown>) => void,
        timeoutHandle,
        method,
      });

      vscodeService.postMessage({
        type: MESSAGE_TYPES.RPC_CALL,
        payload: { method, params, correlationId },
      });
    });
  }
}

// Module-level singleton. Lazily created on first use so that server-side
// rendering / test environments without `window` don't crash at import time.
let _client: RpcClient | null = null;

function getClient(): RpcClient {
  if (_client === null) {
    _client = new RpcClient();
  }
  return _client;
}

/**
 * Get the RpcClient singleton for lifecycle control (e.g. calling markReady()
 * from app bootstrap once the WEBVIEW_READY signal has been posted).
 */
export function getRpcClient(): { markReady(): void } {
  return getClient();
}

/**
 * Send an RPC call via postMessage and wait for the correlated response.
 *
 * Uses a module-level `RpcClient` singleton that registers the `message`
 * listener exactly once and multiplexes all in-flight requests by
 * correlationId — so late responses after a timeout are silently dropped
 * via lookup miss instead of racing with the caller.
 *
 * Outbound sends are gated on `readyPromise` so calls made before the
 * extension/Electron host bridge is ready queue naturally via `await`.
 *
 * The public signature is backward-compatible with the previous per-call
 * implementation — existing callers do not need to change.
 *
 * @param vscodeService - The VSCodeService instance for posting messages
 * @param method - The RPC method name (e.g., 'editor:openFile', 'git:info')
 * @param params - Parameters to send with the RPC call
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns Promise resolving to RpcCallResult with typed data on success
 */
export function rpcCall<T>(
  vscodeService: VSCodeService,
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
): Promise<RpcCallResult<T>>;

/**
 * Typed overload: when `method` is a known key of `RpcMethodRegistry`,
 * `params` and the resolved result are inferred automatically.
 */
export function rpcCall<K extends RpcMethodName>(
  vscodeService: VSCodeService,
  method: K,
  params: RpcMethodParams<K>,
  timeoutMs?: number,
): Promise<RpcCallResult<RpcMethodResult<K>>>;

export function rpcCall<T>(
  vscodeService: VSCodeService,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<RpcCallResult<T>> {
  return getClient().call<T>(vscodeService, method, params, timeoutMs);
}
