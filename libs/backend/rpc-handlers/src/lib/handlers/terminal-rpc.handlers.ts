/**
 * Electron Terminal RPC Handlers
 *
 * Handles terminal session lifecycle via JSON RPC:
 * - terminal:create  - Spawn a new PTY session
 * - terminal:kill    - Kill an existing PTY session
 *
 * Note: Terminal data flow (input/output/resize/exit) uses direct binary IPC
 * channels handled by IpcBridge + PtyManagerService, NOT JSON RPC.
 */

import { homedir } from 'node:os';

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IPtyHost,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  RpcMethodName,
  TerminalCreateParams,
  TerminalCreateResult,
  TerminalKillParams,
  TerminalKillResult,
} from '@ptah-extension/shared';

@injectable()
export class TerminalRpcHandlers {
  static readonly METHODS = [
    'terminal:create',
    'terminal:kill',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.PTY_HOST)
    private readonly ptyManager: IPtyHost,
  ) {}

  register(): void {
    this.registerCreate();
    this.registerKill();
  }

  /**
   * terminal:create - Spawn a new PTY session.
   *
   * Uses the workspace root as default cwd if no explicit cwd is provided.
   * Falls back to user home directory if no workspace is open.
   */
  private registerCreate(): void {
    this.rpcHandler.registerMethod<TerminalCreateParams, TerminalCreateResult>(
      'terminal:create',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        const cwd = params?.cwd || wsRoot || homedir();

        this.logger.info('[TerminalRpc] Creating terminal session', {
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
          this.logger.error('[TerminalRpc] Failed to create terminal', {
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

        this.logger.info('[TerminalRpc] Killing terminal session', {
          id: params.id,
        } as unknown as Error);

        return this.ptyManager.kill(params.id);
      },
    );
  }
}
