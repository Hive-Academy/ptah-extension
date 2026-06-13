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