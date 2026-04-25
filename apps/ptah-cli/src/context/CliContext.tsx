/**
 * TUI React Context -- provides transport, pushAdapter, and fireAndForget
 * to all child components in the Ink component tree.
 *
 * TASK_2025_263 Batch 3
 *
 * The DI container bootstraps these three objects in main.tsx, then passes
 * them into the TuiProvider. Any component can access them via useCliContext().
 */

import React, { createContext, useContext } from 'react';

import type { CliMessageTransport } from '../transport/cli-message-transport';
import type { CliWebviewManagerAdapter } from '../transport/cli-webview-manager-adapter';
import type { CliFireAndForgetHandler } from '../transport/cli-fire-and-forget-handler';

export interface CliContextValue {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
}

const CliContext = createContext<CliContextValue | null>(null);

export interface TuiProviderProps {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  children: React.ReactNode;
}

/**
 * Wraps the Ink component tree with transport/pushAdapter/fireAndForget.
 * Must be rendered near the root of the App component.
 */
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

  return <CliContext.Provider value={value}>{children}</CliContext.Provider>;
}

/**
 * Access the TUI context (transport, pushAdapter, fireAndForget).
 * Throws if called outside of TuiProvider.
 */
export function useCliContext(): CliContextValue {
  const ctx = useContext(CliContext);
  if (!ctx) {
    throw new Error(
      'useCliContext must be used within a TuiProvider. ' +
        'Ensure the App component wraps its children with <TuiProvider>.',
    );
  }
  return ctx;
}
