import { useState, useCallback } from 'react';

import { useTuiContext } from '../context/TuiContext.js';

export interface UseRpcResult {
  call: <TParams = unknown, TResult = unknown>(
    method: string,
    params: TParams,
  ) => Promise<TResult | null>;
  loading: boolean;
  error: string | null;
}

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
