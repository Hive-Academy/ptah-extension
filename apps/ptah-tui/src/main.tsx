import 'reflect-metadata';

import React from 'react';
import { render, Box, Text } from 'ink';
import { TuiDIContainer, type TuiBootstrapResult } from './di/container';
import { TuiRpcMethodRegistrationService } from './services/tui-rpc-method-registration.service';
import type { CliMessageTransport } from './transport/cli-message-transport';
import type { CliWebviewManagerAdapter } from './transport/cli-webview-manager-adapter';
import type { CliFireAndForgetHandler } from './transport/cli-fire-and-forget-handler';

/**
 * TUI App root component.
 *
 * Receives the DI-bootstrapped transport objects as props.
 * Future batches will add full chat UI, session management, etc.
 */
function App({
  transport,
  pushAdapter,
  fireAndForget,
}: {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
}) {
  // Suppress unused variable warnings -- these will be used in future batches
  void pushAdapter;
  void fireAndForget;

  const [status, setStatus] = React.useState<string>('Initializing...');

  React.useEffect(() => {
    // Smoke test: call session:list to verify RPC is working
    transport
      .call<Record<string, never>, unknown>('session:list', {})
      .then((response) => {
        if (response.success) {
          setStatus('RPC connected. Backend ready.');
        } else {
          setStatus(`RPC error: ${response.error ?? 'Unknown error'}`);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`RPC failed: ${message}`);
      });
  }, [transport]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Text bold color="cyan">
          Ptah TUI
        </Text>
        <Text> — The Coding Orchestra</Text>
      </Box>
      <Box marginTop={1}>
        <Text>{status}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
}

/**
 * Bootstrap the TUI application.
 *
 * 1. Setup DI container (all backend services)
 * 2. Register RPC methods
 * 3. Render Ink App with transport/pushAdapter/fireAndForget
 * 4. Setup graceful shutdown
 */
async function main(): Promise<void> {
  let bootstrapResult: TuiBootstrapResult | undefined;

  try {
    // Phase 1: Bootstrap DI container
    bootstrapResult = TuiDIContainer.setup({
      workspacePath: process.cwd(),
    });

    const { transport, pushAdapter, fireAndForget, logger } = bootstrapResult;

    // Phase 2: Register all RPC methods
    const rpcService = new TuiRpcMethodRegistrationService();
    rpcService.registerAll();

    logger.info('[TUI Main] DI container and RPC methods initialized');

    // Phase 3: Render Ink App
    const app = render(
      <App
        transport={transport}
        pushAdapter={pushAdapter}
        fireAndForget={fireAndForget}
      />,
    );

    // Phase 4: Graceful shutdown
    const cleanup = () => {
      logger.info('[TUI Main] Shutting down...');
      app.unmount();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Wait for the Ink app to exit
    await app.waitUntilExit();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    // Log to stderr since the TUI may not be initialized
    console.error(`[TUI Main] Fatal error during bootstrap: ${message}`);
    if (stack) {
      console.error(stack);
    }

    // Also log via the logger if available
    if (bootstrapResult?.logger) {
      bootstrapResult.logger.error(
        `[TUI Main] Fatal error during bootstrap: ${message}`,
        error instanceof Error ? error : new Error(message),
      );
    }

    process.exit(1);
  }
}

main();
