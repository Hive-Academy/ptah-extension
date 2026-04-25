import 'reflect-metadata';

import React from 'react';
import { render } from 'ink';
import { CliDIContainer, type CliBootstrapResult } from './di/container';
import { CliRpcMethodRegistrationService } from './services/cli-rpc-method-registration.service';
import { App } from './components/App.js';
import { TOKENS } from '@ptah-extension/vscode-core';

/**
 * Check if stdin supports raw mode (required by Ink for keyboard input).
 * nx run-commands pipes stdin instead of providing a real TTY, so
 * `nx serve ptah-cli` won't work — the user must run the binary directly.
 */
function ensureRawModeSupport(): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    return; // Full TTY support — proceed normally
  }

  console.error(
    '\n  Ptah TUI requires an interactive terminal (TTY with raw mode).\n' +
      '  nx pipes stdin, so `nx serve` cannot provide this.\n\n' +
      '  Build + run directly instead:\n\n' +
      '    nx build ptah-cli && node dist/apps/ptah-cli/main.mjs\n',
  );
  process.exit(1);
}

/**
 * Bootstrap the CLI application.
 *
 * 1. Setup DI container (all backend services)
 * 2. Register RPC methods
 * 3. Render Ink App with transport/pushAdapter/fireAndForget
 * 4. Setup graceful shutdown
 */
async function main(): Promise<void> {
  let bootstrapResult: CliBootstrapResult | undefined;

  // Phase 0: Ensure terminal supports raw mode for Ink
  ensureRawModeSupport();

  try {
    // Phase 1: Bootstrap DI container
    bootstrapResult = CliDIContainer.setup({
      workspacePath: process.cwd(),
    });

    const { container, transport, pushAdapter, fireAndForget, logger } =
      bootstrapResult;

    // Phase 2: Register all RPC methods
    const rpcService = new CliRpcMethodRegistrationService();
    rpcService.registerAll();

    logger.info('[CLI Main] DI container and RPC methods initialized');

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
      logger.info('[CLI Main] Shutting down...');
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
    console.error(`[CLI Main] Fatal error during bootstrap: ${message}`);
    if (stack) {
      console.error(stack);
    }

    // Also log via the logger if available
    if (bootstrapResult?.logger) {
      bootstrapResult.logger.error(
        `[CLI Main] Fatal error during bootstrap: ${message}`,
        error instanceof Error ? error : new Error(message),
      );
    }

    process.exit(1);
  }
}

main();
