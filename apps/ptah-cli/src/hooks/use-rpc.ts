/**
 * useRpc -- Generic RPC call hook for TUI components.
 *
 * TASK_2025_263 Batch 3
 *
 * Wraps CliMessageTransport.call() with loading/error state management.
 * Components use this to invoke backend RPC methods and react to results.
 *
 * Usage:
 *   const { call, loading, error } = useRpc();
 *   const result = await call<Params, Result>('session:list', {});
 */

import { useState, useCallback } from 'react';

import { useTuiContext } from '../context/TuiContext';

export interface UseRpcResult {
  /**
   * Invoke an RPC method. Returns the response data on success, or null on failure.
   * Sets loading/error state automatically.
   */
  call: <TParams = unknown, TResult = unknown>(
    method: string,
    params: TParams,
  ) => Promise<TResult | null>;

  /** True while an RPC call is in flight. */
  loading: boolean;

  /** Last error message, or null if the most recent call succeeded. */
  error: string | null;
}

/**
 * Hook providing a generic RPC caller with loading/error state.
 */
export function useRpc(): UseRpcResult {
  const { transport } = useTuiContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async <TParams = unknown, TResult = unknown>(
      method: string,
      params: TParams,
    ): Promise<TResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await transport.call<TParams, TResult>(method, params);

        if (response.success) {
          return (response.data as TResult) ?? null;
        }

        const errorMsg = response.error ?? 'Unknown RPC error';
        setError(errorMsg);
        return null;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [transport],
  );

  return { call, loading, error };
}
