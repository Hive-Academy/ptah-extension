/**
 * Electron Terminal RPC Handlers
 *
 * Handles terminal session lifecycle via JSON RPC:
 * - terminal:create  - Spawn a new PTY session
 * - terminal:kill    - Kill an existing PTY session
 *
 * Note: Terminal data flow (input/output/resize/exit) uses direct binary IPC
 * channels handled by IpcBridge + PtyManagerService, NOT JSON RPC.
 *
 * TASK_2025_227 Batch 4: Terminal integration backend
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  TerminalCreateParams,
  TerminalCreateResult,
  TerminalKillParams,
  TerminalKillResult,
} from '@ptah-extension/shared';
import type { PtyManagerService } from '../../pty-manager.service';
import { ELECTRON_TOKENS } from '../../../di/electron-tokens';

@injectable()
export class ElectronTerminalRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(ELECTRON_TOKENS.PTY_MANAGER_SERVICE)
    private readonly ptyManager: PtyManagerService,
  ) {}

  register(): void {
    this.registerCreate();
    this.registerKill();
  }

  /**
   * terminal:create - Spawn a new PTY session.
   *
   * Uses the workspace root as default cwd if no explicit cwd is provided.
   * Falls back to process.cwd() if no workspace is open.
   */
  private registerCreate(): void {
    this.rpcHandler.registerMethod<TerminalCreateParams, TerminalCreateResult>(
      'terminal:create',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        const cwd = params?.cwd || wsRoot || process.cwd();

        this.logger.info('[ElectronTerminalRpc] Creating terminal session', {
          cwd,
          shell: params?.shell,
          name: params?.name,
        } as unknown as Error);

        try {
          const result = this.ptyManager.create({
            cwd,
            shell: params?.shell,
            name: params?.name,
          });
          return result;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error('[ElectronTerminalRpc] Failed to create terminal', {
            error: message,
          } as unknown as Error);
          throw new Error(message);
        }
      },
    );
  }

  /**
   * terminal:kill - Kill an existing PTY session by ID.
   */
  private registerKill(): void {
    this.rpcHandler.registerMethod<TerminalKillParams, TerminalKillResult>(
      'terminal:kill',
      async (params) => {
        if (!params?.id) {
          return { success: false, error: 'id is required' };
        }

        this.logger.info('[ElectronTerminalRpc] Killing terminal session', {
          id: params.id,
        } as unknown as Error);

        return this.ptyManager.kill(params.id);
      },
    );
  }
}
