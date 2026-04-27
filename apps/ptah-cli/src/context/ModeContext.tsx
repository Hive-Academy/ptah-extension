/**
 * ModeContext -- Provides a single useMode() instance to the entire
 * component tree, preventing duplicate RPC calls and state divergence.
 *
 * TASK_2025_266 Batch 3
 *
 * Follows the same pattern as SessionContext: lifts the hook into a
 * React context provider so all consumers share one state instance.
 */

import React, { createContext, useContext } from 'react';

import { useMode, type UseModeResult } from '../hooks/use-mode.js';

type ModeContextValue = UseModeResult;

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const modeState = useMode();
  return (
    <ModeContext.Provider value={modeState}>{children}</ModeContext.Provider>
  );
}

/**
 * Access the shared mode state. Must be called within a ModeProvider.
 * Replaces direct useMode() calls in individual components.
 */
export function useModeContext(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) {
    throw new Error(
      'useModeContext must be used within a ModeProvider. ' +
        'Ensure the App component wraps its children with <ModeProvider>.',
    );
  }
  return ctx;
}
