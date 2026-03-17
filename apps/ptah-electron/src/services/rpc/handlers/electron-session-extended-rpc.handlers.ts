/**
 * Electron Session Extended RPC Handlers
 *
 * Previously held session:validate and session:cli-sessions, but those are now
 * handled by the shared SessionRpcHandlers (which provides richer implementations
 * with workspace-path-based file lookup and proper CliSessionReference types).
 *
 * This class is kept as a placeholder for future Electron-specific session methods.
 * If no Electron-specific session methods are needed, it can be removed entirely.
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 * TASK_2025_203 Code Review: Removed duplicate session:validate and session:cli-sessions
 *   that conflicted with shared SessionRpcHandlers (different response schemas).
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';

@injectable()
export class ElectronSessionExtendedRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler
  ) {}

  register(): void {
    // No Electron-specific session methods currently needed.
    // session:validate and session:cli-sessions are handled by the shared SessionRpcHandlers.
    this.logger.debug(
      '[Electron RPC] ElectronSessionExtendedRpcHandlers: no additional methods to register'
    );
  }
}
