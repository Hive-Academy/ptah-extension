import { useState, useCallback, useEffect } from 'react';

import { useTuiContext } from '../context/TuiContext.js';

export type AppMode = 'plan' | 'build';

export interface UseModeResult {
  mode: AppMode;
  setMode: (mode: AppMode) => Promise<void>;
  loading: boolean;
}

interface AutopilotGetResult {
  enabled: boolean;
  permissionLevel: string;
}

interface AutopilotToggleParams {
  enabled: boolean;
  permissionLevel: string;
}

export function useMode(): UseModeResult {
  const { transport } = useTuiContext();

  const [mode, setModeState] = useState<AppMode>('build');
  const [loading, setLoading] = useState(false);

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
        console.error('Failed to toggle mode:', error);
      } finally {
        setLoading(false);
      }
    },
    [transport],
  );

  return { mode, setMode, loading };
}
