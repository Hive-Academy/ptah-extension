/**
 * CLI Message Transport -- In-process RPC for the CLI application.
 *
 * Replaces IpcBridge: instead of ipcMain.on('rpc', handler) -> event.sender.send('to-renderer'),
 * the TUI calls rpcHandler.handleMessage() directly and awaits the response.
 *
 * The message format (RpcMessage/RpcResponse) is identical to what
 * the Angular frontend sends/receives, making all 17 RPC handlers work unchanged.
 *
 * Key design point: No serialization overhead -- objects are passed by reference.
 * The RpcHandler receives the exact same { method, params, correlationId } shape
 * it receives from Electron's IPC.
 */

import { randomUUID } from 'crypto';
import type { RpcHandler } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { DependencyContainer } from 'tsyringe';

export class CliMessageTransport {
  private readonly rpcHandler: RpcHandler;

  constructor(container: DependencyContainer) {
    this.rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
  }

  /**
   * Send an RPC request and await the response.
   * Replaces: window.vscode.postMessage() -> IPC -> RpcHandler -> IPC -> response
   *
   * @param method - RPC method name (e.g., 'session:list', 'chat:start')
   * @param params - Method parameters
   * @returns RPC response (same shape as Angular frontend receives)
   */
  async call<TParams = unknown, TResult = unknown>(
    method: string,
    params: TParams,
  ): Promise<{
    success: boolean;
    data?: TResult;
    error?: string;
    errorCode?: string;
  }> {
    const correlationId = randomUUID();
    const message = { method, params, correlationId };
    return this.rpcHandler.handleMessage(message) as Promise<{
      success: boolean;
      data?: TResult;
      error?: string;
      errorCode?: string;
    }>;
  }
}
