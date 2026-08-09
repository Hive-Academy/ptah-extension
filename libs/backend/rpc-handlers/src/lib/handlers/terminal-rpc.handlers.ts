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

import { isAuthorizedTerminalCwd } from '../utils/workspace-authorization';
import {
  parseTerminalCreateParams,
  parseTerminalKillParams,
} from './terminal-rpc.schema';

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
   * Params are validated at the boundary via `terminal-rpc.schema.ts`: `shell`
   * is narrowed to the platform allowlist (renderer-supplied executable reaches
   * node-pty's spawn), and `cwd`, when explicitly supplied, is contained to an
   * open workspace folder or the home directory. Both rejections surface as a
   * structured RPC error (a fixed-message throw the transport catches), never a
   * silent substitution.
   *
   * Uses the workspace root as default cwd if no explicit cwd is provided.
   * Falls back to user home directory if no workspace is open.
   */
  private registerCreate(): void {
    this.rpcHandler.registerMethod<TerminalCreateParams, TerminalCreateResult>(
      'terminal:create',
      async (params) => {
        const parsed = parseTerminalCreateParams(params);
        if (!parsed) {
          throw new Error('terminal:create: invalid or disallowed parameters');
        }

        if (
          parsed.cwd &&
          !isAuthorizedTerminalCwd(parsed.cwd, this.workspace)
        ) {
          throw new Error(
            'terminal:create: cwd outside workspace root and home',
          );
        }

        const wsRoot = this.workspace.getWorkspaceRoot();
        const cwd = parsed.cwd || wsRoot || homedir();

        this.logger.info('[TerminalRpc] Creating terminal session', {
          cwd,
          shell: parsed.shell,
          name: parsed.name,
        } as unknown as Error);

        try {
          const result = this.ptyManager.create({
            cwd,
            shell: parsed.shell,
            name: parsed.name,
          });
          return result;
        } catch (error: unknown) {
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
        const parsed = parseTerminalKillParams(params);
        if (!parsed) {
          return { success: false, error: 'id is required' };
        }

        this.logger.info('[TerminalRpc] Killing terminal session', {
          id: parsed.id,
        } as unknown as Error);

        return this.ptyManager.kill(parsed.id);
      },
    );
  }
}
