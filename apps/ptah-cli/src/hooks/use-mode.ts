/**
 * useMode -- Plan/Build mode management hook.
 *
 * TASK_2025_266 Batch 3
 *
 * Provides mode toggling between 'plan' (read-only, ask permission) and
 * 'build' (auto-edit, autopilot enabled). Persists the mode via the
 * config:autopilot-toggle RPC method.
 *
 * On mount, fetches the current autopilot state to derive the initial mode.
 *
 * Usage:
 *   const { mode, setMode, loading } = useMode();
 */

import { useState, useCallback, useEffect } from 'react';

import { useCliContext } from '../context/CliContext.js';

export type AppMode = 'plan' | 'build';

export interface UseModeResult {
  mode: AppMode;
  setMode: (mode: AppMode) => Promise<void>;
  loading: boolean;
}

/** RPC response shape for config:autopilot-get. */
interface AutopilotGetResult {
  enabled: boolean;
  permissionLevel: string;
}

/** RPC params shape for config:autopilot-toggle. */
interface AutopilotToggleParams {
  enabled: boolean;
  permissionLevel: string;
}

/**
 * Hook providing Plan/Build mode management via autopilot RPC methods.
 */
export function useMode(): UseModeResult {
  const { transport } = useCliContext();

  const [mode, setModeState] = useState<AppMode>('build');
  const [loading, setLoading] = useState(false);

  // Fetch initial autopilot state on mount
  useEffect(() => {
    let cancelled = false;

    const fetchInitialMode = async (): Promise<void> => {
      try {
        const response = await transport.call<
          Record<string, never>,
          AutopilotGetResult
        >('config:autopilot-get', {} as Record<string, never>);

        if (cancelled) return;

        if (response.success && response.data) {
          setModeState(response.data.enabled ? 'build' : 'plan');
        }
      } catch (error) {
        // Gracefully handle -- default to 'build' mode
        console.error('Failed to fetch autopilot state:', error);
      }
    };

    void fetchInitialMode();

    return () => {
      cancelled = true;
    };
  }, [transport]);

  const setMode = useCallback(
    async (newMode: AppMode): Promise<void> => {
      setLoading(true);
      try {
        const params: AutopilotToggleParams =
          newMode === 'build'
            ? { enabled: true, permissionLevel: 'auto-edit' }
            : { enabled: false, permissionLevel: 'ask' };

        const response = await transport.call<
          AutopilotToggleParams,
          { enabled: boolean; permissionLevel: string }
        >('config:autopilot-toggle', params);

        if (response.success) {
          setModeState(newMode);
        }
      } catch (error) {
        // Gracefully handle -- don't crash, keep current mode
        console.error('Failed to toggle mode:', error);
      } finally {
        setLoading(false);
      }
    },
    [transport],
  );

  return { mode, setMode, loading };
}
