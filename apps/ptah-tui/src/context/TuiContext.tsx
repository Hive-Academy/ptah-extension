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
  /**
   * Absolute workspace root the engine was booted against. Lives on the
   * context rather than being drilled through props because the consumers
   * (`ChatPanel` → `useChat`) sit several layers below `App`, and the prop
   * chain silently dropped it.
   */
  workspacePath: string;
  reinitializeSdk: () => Promise<boolean>;
}

const TuiContext = createContext<TuiContextValue | null>(null);

export interface TuiProviderProps {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  workspacePath: string;
  reinitializeSdk: () => Promise<boolean>;
  children: React.ReactNode;
}

export function TuiProvider({
  transport,
  pushAdapter,
  fireAndForget,
  workspacePath,
  reinitializeSdk,
  children,
}: TuiProviderProps): React.JSX.Element {
  const value = React.useMemo(
    () => ({
      transport,
      pushAdapter,
      fireAndForget,
      workspacePath,
      reinitializeSdk,
    }),
    [transport, pushAdapter, fireAndForget, workspacePath, reinitializeSdk],
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
