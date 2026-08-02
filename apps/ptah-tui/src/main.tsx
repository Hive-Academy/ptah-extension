import 'reflect-metadata';

import React, { useState, useCallback } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import {
  withEngine,
  CliDIContainer,
  type EngineContext,
} from '@ptah-extension/cli-engine';

import { TuiWebviewManagerAdapter } from './transport/tui-webview-manager-adapter.js';
import { TuiFilePickerBridge } from './transport/tui-file-picker-bridge.js';
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
  workspacePath: string;
  filePicker: TuiFilePickerBridge;
  initialAuthReady: boolean;
  initialAuthError?: string;
  thothLifecycle: ThothLifecycle;
  onQuit: () => void;
}

function Root({
  ctx,
  workspacePath,
  filePicker,
  initialAuthReady,
  initialAuthError,
  thothLifecycle,
  onQuit,
}: RootProps): React.JSX.Element {
  const [authReady, setAuthReady] = useState(initialAuthReady);
  const [authError, setAuthError] = useState<string | undefined>(
    initialAuthError,
  );

  // `ctx.initializeSdk` rather than the bare `initializeSdkAdapter` export:
  // the context variant records the adapter so `withEngine` disposes it.
  const reinitializeSdk = useCallback(async (): Promise<boolean> => {
    const sdk = await ctx.initializeSdk();
    setAuthReady(sdk.initialized);
    setAuthError(sdk.errorMessage);
    return sdk.initialized;
  }, [ctx]);

  return (
    <App
      transport={ctx.transport}
      pushAdapter={ctx.pushAdapter}
      fireAndForget={ctx.fireAndForget}
      workspacePath={workspacePath}
      filePicker={filePicker}
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
  // Registered with the engine so `file:pick` has a selection surface, and
  // handed to the tree so the overlay can settle those requests.
  const filePicker = new TuiFilePickerBridge();
  const workspacePath = globals.cwd ?? process.cwd();
  const thothLifecycle = new ThothLifecycle();
  let signalExitCode = 0;

  const exitCode = await withEngine(
    { cwd: globals.cwd, config: globals.config, verbose: globals.verbose },
    {
      mode: 'full',
      requireSdk: false,
      thoth: 'off',
      host: 'tui',
      pushAdapter,
      filePicker,
    },
    async (ctx: EngineContext): Promise<number> => {
      // Booted with `requireSdk: false` so an unconfigured first run reaches
      // the UI; the adapter is initialized here instead. Going through
      // `ctx.initializeSdk` (not the bare export) is what registers it for
      // disposal in withEngine's finally.
      const sdk = await ctx.initializeSdk();

      if (smoke) {
        const app = render(
          <Root
            ctx={ctx}
            workspacePath={workspacePath}
            filePicker={filePicker}
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
          workspacePath={workspacePath}
          filePicker={filePicker}
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
