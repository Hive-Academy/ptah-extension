import 'reflect-metadata';

import React, { useState, useCallback } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import {
  withEngine,
  initializeSdkAdapter,
  CliFireAndForgetHandler,
  CliDIContainer,
  type EngineContext,
} from '@ptah-extension/cli-engine';
import type { DependencyContainer } from 'tsyringe';

import { TuiWebviewManagerAdapter } from './transport/tui-webview-manager-adapter.js';
import { App } from './components/App.js';
import { ThothLifecycle } from './lib/thoth-lifecycle.js';
import { installConsoleCapture } from './lib/console-capture.js';

export const TUI_BUNDLE_API_VERSION = 1;

export interface RunTuiGlobals {
  cwd?: string;
  config?: string;
  verbose?: boolean;
}

interface RootProps {
  ctx: EngineContext;
  container: DependencyContainer;
  fireAndForget: CliFireAndForgetHandler;
  workspacePath: string;
  initialAuthReady: boolean;
  initialAuthError?: string;
  thothLifecycle: ThothLifecycle;
  onQuit: () => void;
}

function Root({
  ctx,
  container,
  fireAndForget,
  workspacePath,
  initialAuthReady,
  initialAuthError,
  thothLifecycle,
  onQuit,
}: RootProps): React.JSX.Element {
  const [authReady, setAuthReady] = useState(initialAuthReady);
  const [authError, setAuthError] = useState<string | undefined>(
    initialAuthError,
  );

  const reinitializeSdk = useCallback(async (): Promise<boolean> => {
    const sdk = await initializeSdkAdapter(container);
    setAuthReady(sdk.initialized);
    setAuthError(sdk.errorMessage);
    return sdk.initialized;
  }, [container]);

  return (
    <App
      transport={ctx.transport}
      pushAdapter={ctx.pushAdapter}
      fireAndForget={fireAndForget}
      workspacePath={workspacePath}
      authReady={authReady}
      authError={authError}
      reinitializeSdk={reinitializeSdk}
      thothLifecycle={thothLifecycle}
      onQuit={onQuit}
    />
  );
}

function createSmokeStdin(): NodeJS.ReadStream {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => NodeJS.ReadStream;
    ref: () => NodeJS.ReadStream;
    unref: () => NodeJS.ReadStream;
  };
  stream.isTTY = true;
  stream.setRawMode = () => stream;
  stream.ref = () => stream;
  stream.unref = () => stream;
  return stream;
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

export async function runTui(globals: RunTuiGlobals): Promise<number> {
  const smoke = process.env['PTAH_TUI_SMOKE'] === '1';

  if (!smoke && !ensureRawModeSupport()) {
    return 1;
  }

  const pushAdapter = new TuiWebviewManagerAdapter();
  const workspacePath = globals.cwd ?? process.cwd();
  const thothLifecycle = new ThothLifecycle();
  let signalExitCode = 0;

  const exitCode = await withEngine(
    { cwd: globals.cwd, config: globals.config, verbose: globals.verbose },
    { mode: 'full', requireSdk: false, thoth: 'off', pushAdapter },
    async (ctx: EngineContext): Promise<number> => {
      const sdk = await initializeSdkAdapter(ctx.container);
      const fireAndForget = new CliFireAndForgetHandler(ctx.container);

      if (smoke) {
        const app = render(
          <Root
            ctx={ctx}
            container={ctx.container}
            fireAndForget={fireAndForget}
            workspacePath={workspacePath}
            initialAuthReady={sdk.initialized}
            initialAuthError={sdk.errorMessage}
            thothLifecycle={thothLifecycle}
            onQuit={() => undefined}
          />,
          {
            exitOnCtrlC: false,
            patchConsole: false,
            stdin: createSmokeStdin(),
          },
        );
        app.unmount();
        await app.waitUntilExit();
        return 0;
      }

      const restoreConsole = installConsoleCapture();
      let unmounted = false;
      const app = render(
        <Root
          ctx={ctx}
          container={ctx.container}
          fireAndForget={fireAndForget}
          workspacePath={workspacePath}
          initialAuthReady={sdk.initialized}
          initialAuthError={sdk.errorMessage}
          thothLifecycle={thothLifecycle}
          onQuit={() => {
            unmounted = true;
          }}
        />,
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

      void thothLifecycle.activate(ctx.container);

      try {
        await app.waitUntilExit();
      } finally {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        await thothLifecycle.dispose(ctx.container);
        restoreConsole();
      }

      return signalExitCode;
    },
  );

  return exitCode;
}

process.on('exit', () => {
  CliDIContainer.flushSync();
});
