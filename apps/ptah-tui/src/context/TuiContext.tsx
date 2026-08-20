import React, { createContext, useContext } from 'react';

import type {
  CliMessageTransport,
  CliWebviewManagerAdapter,
  CliFireAndForgetHandler,
} from '@ptah-extension/cli-engine';

import type { TuiFilePickerBridge } from '../transport/tui-file-picker-bridge.js';

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
  /**
   * Settles backend `file:pick` requests against the Ink overlay. Undefined
   * in hosts booted without one (the smoke render), which the consuming hook
   * treats as "no picker" rather than an error.
   */
  filePicker?: TuiFilePickerBridge;
  reinitializeSdk: () => Promise<boolean>;
}

const TuiContext = createContext<TuiContextValue | null>(null);

export interface TuiProviderProps {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  workspacePath: string;
  filePicker?: TuiFilePickerBridge;
  reinitializeSdk: () => Promise<boolean>;
  children: React.ReactNode;
}

export function TuiProvider({
  transport,
  pushAdapter,
  fireAndForget,
  workspacePath,
  filePicker,
  reinitializeSdk,
  children,
}: TuiProviderProps): React.JSX.Element {
  const value = React.useMemo(
    () => ({
      transport,
      pushAdapter,
      fireAndForget,
      workspacePath,
      filePicker,
      reinitializeSdk,
    }),
    [
      transport,
      pushAdapter,
      fireAndForget,
      workspacePath,
      filePicker,
      reinitializeSdk,
    ],
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
