import 'reflect-metadata';

import React from 'react';
import { render, Box, Text, useApp, useInput, useStdin } from 'ink';
import {
  withEngine,
  initializeSdkAdapter,
  CliFireAndForgetHandler,
  CliDIContainer,
  type EngineContext,
  type CliWebviewManagerAdapter,
  type CliMessageTransport,
} from '@ptah-extension/cli-engine';
import { TuiWebviewManagerAdapter } from './transport/tui-webview-manager-adapter.js';

export const TUI_BUNDLE_API_VERSION = 1;

export interface RunTuiGlobals {
  cwd?: string;
  config?: string;
  verbose?: boolean;
}

interface AppProps {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  authReady: boolean;
  authError?: string;
  onQuit: () => void;
}

interface ErrorBoundaryState {
  error?: Error;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <Box flexDirection="column">
          <Text color="red">Ptah TUI render error</Text>
          <Text>{this.state.error.message}</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}

function QuitHandler({ onQuit }: { onQuit: () => void }): null {
  const { exit } = useApp();
  useInput((input, key) => {
    if ((key.ctrl && input === 'q') || (key.ctrl && input === 'c')) {
      onQuit();
      exit();
    }
  });
  return null;
}

function App({ authReady, authError, onQuit }: AppProps): React.ReactElement {
  const { isRawModeSupported } = useStdin();

  return (
    <Box flexDirection="column">
      {isRawModeSupported ? <QuitHandler onQuit={onQuit} /> : null}
      <Text color="cyan">Ptah TUI</Text>
      {authReady ? (
        <Text color="green">agent ready</Text>
      ) : (
        <Text color="yellow">
          agent not ready{authError ? ` — ${authError}` : ''} (Settings → Auth)
        </Text>
      )}
      <Text dimColor>Ctrl+Q to quit</Text>
    </Box>
  );
}

function ensureRawModeSupport(): boolean {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    return true;
  }
  process.stderr.write(
    '\n  Ptah TUI requires an interactive terminal (TTY with raw mode).\n' +
      '  nx pipes stdin, so `nx serve` cannot provide this.\n\n' +
      '  Run it directly from a real terminal:\n\n' +
      '    ptah tui\n\n',
  );
  return false;
}

let thothActivationSeam: (ctx: EngineContext) => Promise<void> = async () => {
  return;
};

export function __setThothActivationSeam(
  seam: (ctx: EngineContext) => Promise<void>,
): void {
  thothActivationSeam = seam;
}

export async function runTui(globals: RunTuiGlobals): Promise<number> {
  const smoke = process.env['PTAH_TUI_SMOKE'] === '1';

  if (!smoke && !ensureRawModeSupport()) {
    return 1;
  }

  const pushAdapter = new TuiWebviewManagerAdapter();
  let signalExitCode = 0;

  const exitCode = await withEngine(
    { cwd: globals.cwd, config: globals.config, verbose: globals.verbose },
    { mode: 'full', requireSdk: false, thoth: 'off', pushAdapter },
    async (ctx: EngineContext): Promise<number> => {
      const sdk = await initializeSdkAdapter(ctx.container);
      const fireAndForget = new CliFireAndForgetHandler(ctx.container);

      if (smoke) {
        const app = render(
          <ErrorBoundary>
            <App
              transport={ctx.transport}
              pushAdapter={pushAdapter}
              fireAndForget={fireAndForget}
              authReady={sdk.initialized}
              authError={sdk.errorMessage}
              onQuit={() => undefined}
            />
          </ErrorBoundary>,
          { exitOnCtrlC: false, patchConsole: false },
        );
        app.unmount();
        await app.waitUntilExit();
        return 0;
      }

      let unmounted = false;
      const app = render(
        <ErrorBoundary>
          <App
            transport={ctx.transport}
            pushAdapter={pushAdapter}
            fireAndForget={fireAndForget}
            authReady={sdk.initialized}
            authError={sdk.errorMessage}
            onQuit={() => {
              unmounted = true;
            }}
          />
        </ErrorBoundary>,
        { exitOnCtrlC: false },
      );

      const onSignal = (code: number) => () => {
        signalExitCode = code;
        if (!unmounted) {
          unmounted = true;
          app.unmount();
        }
      };
      const onSigint = onSignal(130);
      const onSigterm = onSignal(143);
      process.on('SIGINT', onSigint);
      process.on('SIGTERM', onSigterm);

      try {
        await thothActivationSeam(ctx);
        await app.waitUntilExit();
      } finally {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
      }

      return signalExitCode;
    },
  );

  return exitCode;
}

process.on('exit', () => {
  CliDIContainer.flushSync();
});
