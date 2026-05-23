/**
 * DI registration helper for the stdio MCP transport.
 *
 * Called by `apps/ptah-cli/src/cli/commands/mcp-serve.ts` AFTER `withEngine`
 * resolves so the registration sees the fully-bootstrapped child container.
 * The helper is idempotent — calling it twice on the same container is
 * harmless.
 */

import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { StdioMcpServerService } from './stdio-mcp-server.service';

/** DI token for the stdio MCP server. Symbol-keyed to match repo convention. */
export const STDIO_MCP_SERVER_TOKEN = Symbol.for('StdioMcpServer');

export function registerMcpStdioServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  if (!container.isRegistered(TOKENS.LOGGER)) {
    throw new Error(
      '[McpStdio] DEPENDENCY ERROR: TOKENS.LOGGER must be registered first.',
    );
  }

  if (container.isRegistered(STDIO_MCP_SERVER_TOKEN)) {
    return;
  }

  logger.info('[McpStdio] Registering stdio MCP services...');
  container.registerSingleton(STDIO_MCP_SERVER_TOKEN, StdioMcpServerService);
  logger.info('[McpStdio] Stdio MCP services registered', {
    services: ['STDIO_MCP_SERVER'],
  });
}
