import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

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
 * Send an RPC call via postMessage and wait for the correlated response.
 *
 * Uses crypto.randomUUID() to generate a unique correlationId, sends a
 * MESSAGE_TYPES.RPC_CALL via the VSCodeService, and listens for a
 * MESSAGE_TYPES.RPC_RESPONSE with a matching correlationId.
 *
 * The listener and timeout are cleaned up on response or timeout,
 * preventing memory leaks.
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
  timeoutMs = 30000,
): Promise<RpcCallResult<T>> {
  const correlationId = crypto.randomUUID();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ success: false, error: `RPC timeout: ${method}` });
    }, timeoutMs);

    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type !== MESSAGE_TYPES.RPC_RESPONSE) return;
      if (data.correlationId !== correlationId) return;

      cleanup();
      const errorStr = data.error
        ? typeof data.error === 'string'
          ? data.error
          : (data.error.message ?? String(data.error))
        : undefined;
      resolve({
        success: data.success,
        data: data.data as T,
        error: errorStr,
      });
    };

    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
    };

    window.addEventListener('message', handler);

    vscodeService.postMessage({
      type: MESSAGE_TYPES.RPC_CALL,
      payload: { method, params, correlationId },
    });
  });
}
