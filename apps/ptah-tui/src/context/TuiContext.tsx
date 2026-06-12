import React, { createContext, useContext } from 'react';

import type {
  CliMessageTransport,
  CliWebviewManagerAdapter,
  CliFireAndForgetHandler,
} from '@ptah-extension/cli-engine';

export interface TuiContextValue {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
}

const TuiContext = createContext<TuiContextValue | null>(null);

export interface TuiProviderProps {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  children: React.ReactNode;
}

export function TuiProvider({
  transport,
  pushAdapter,
  fireAndForget,
  children,
}: TuiProviderProps): React.JSX.Element {
  const value = React.useMemo(
    () => ({ transport, pushAdapter, fireAndForget }),
    [transport, pushAdapter, fireAndForget],
  );

  return <TuiContext.Provider value={value}>{children}</TuiContext.Provider>;
}

export function useTuiContext(): TuiContextValue {
  const ctx = useContext(TuiContext);
  if (!ctx) {
    throw new Error('useTuiContext must be used within a TuiProvider.');
  }
  return ctx;
}
