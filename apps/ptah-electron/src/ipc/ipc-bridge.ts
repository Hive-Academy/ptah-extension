/**
 * IPC Bridge -- Connects the Angular renderer with the Electron main process.
 *
 * TASK_2025_200 Batch 4, Task 4.1
 *
 * Message Flow:
 *   Angular Renderer
 *     -> preload.ts (window.vscode.postMessage -> ipcRenderer.send('rpc'))
 *     -> ipc-bridge.ts (ipcMain.on('rpc') -> RpcHandler.handleMessage())
 *     -> response -> event.sender.send('to-renderer')
 *     -> preload.ts (ipcRenderer.on('to-renderer') -> window.dispatchEvent(MessageEvent))
 *     -> Angular MessageRouterService
 *
 * The frontend sends messages in the format:
 *   { type: 'rpc:call', payload: { method, params, correlationId } }
 *
 * The backend responds in the format:
 *   { type: 'rpc:response', correlationId, success, data, error, errorCode }
 *
 * This matches the VS Code WebviewMessageHandlerService pattern exactly.
 */

import { ipcMain, type IpcMainEvent } from 'electron';
import type { DependencyContainer } from 'tsyringe';
import type { RpcHandler } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

/**
 * Callback type for obtaining the BrowserWindow's webContents.send method.
 * Uses a thin interface instead of importing BrowserWindow directly to
 * avoid tight coupling and simplify testing.
 */
interface ElectronWindowHandle {
  webContents: {
    send(channel: string, ...args: unknown[]): void;
  };
}

type GetWindowFn = () => ElectronWindowHandle | null;

/**
 * IPC Bridge -- Routes messages between the Angular renderer and the
 * Electron main process via ipcMain/ipcRenderer channels.
 *
 * Responsibilities:
 * - Listen for 'rpc' messages from preload (ipcMain.on)
 * - Route RPC calls to the RpcHandler from DI container
 * - Send responses back via event.sender.send('to-renderer')
 * - Handle 'get-state' and 'set-state' for webview state persistence
 * - Provide sendToRenderer() for pushing events from main to renderer
 */
export class IpcBridge {
  private readonly rpcHandler: RpcHandler;
  private readonly stateStorage: IStateStorage;

  constructor(
    private readonly container: DependencyContainer,
    private readonly getWindow: GetWindowFn
  ) {
    this.rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
    this.stateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE
    );
  }

  /**
   * Initialize all IPC listeners.
   * Must be called after DI container is fully configured and
   * before the renderer loads.
   */
  initialize(): void {
    this.setupRpcHandler();
    this.setupStateHandlers();
    console.log('[IpcBridge] IPC listeners initialized');
  }

  /**
   * Send a message to the renderer process.
   * Used by WebviewManagerAdapter and other services to push events
   * (e.g., streaming chunks, session updates) to the Angular frontend.
   *
   * @param message - The message object to send. Should include a `type` field
   *   matching MESSAGE_TYPES constants so MessageRouterService can dispatch it.
   */
  sendToRenderer(message: unknown): void {
    const win = this.getWindow();
    if (!win) {
      console.warn('[IpcBridge] Cannot send to renderer: no window available');
      return;
    }
    win.webContents.send('to-renderer', message);
  }

  /**
   * Setup the main RPC message handler.
   *
   * Listens on the 'rpc' channel for messages from the preload script.
   * The preload script maps window.vscode.postMessage() to ipcRenderer.send('rpc').
   *
   * Frontend sends: { type: 'rpc:call', payload: { method, params, correlationId } }
   * We unwrap the payload, route to RpcHandler, and send the response back.
   */
  private setupRpcHandler(): void {
    ipcMain.on('rpc', async (event: IpcMainEvent, message: unknown) => {
      try {
        // Validate message structure
        if (!message || typeof message !== 'object') {
          console.warn(
            '[IpcBridge] Received invalid RPC message (not an object)'
          );
          return;
        }

        const msg = message as Record<string, unknown>;

        // The frontend wraps RPC data in { type: 'rpc:call', payload: {...} }
        // or { type: 'rpc:request', payload: {...} }
        // We need to unwrap the payload to get the actual RPC data.
        const rpcData = (msg['payload'] || msg) as Record<string, unknown>;

        const method = rpcData['method'] as string | undefined;
        const params = rpcData['params'] as unknown;
        const correlationId =
          (rpcData['correlationId'] as string) ||
          (rpcData['requestId'] as string) ||
          '';

        if (!method) {
          console.warn(
            '[IpcBridge] Received RPC message without method field',
            { messageType: msg['type'] }
          );
          // Send error response if we have a correlationId
          if (correlationId) {
            event.sender.send('to-renderer', {
              type: MESSAGE_TYPES.RPC_RESPONSE,
              correlationId,
              success: false,
              error: { message: 'Missing method field in RPC message' },
            });
          }
          return;
        }

        // Route to RpcHandler
        const response = await this.rpcHandler.handleMessage({
          method,
          params,
          correlationId,
        });

        // Send response back to renderer in the format MessageRouterService expects.
        // This matches the VS Code WebviewMessageHandlerService response format.
        event.sender.send('to-renderer', {
          type: MESSAGE_TYPES.RPC_RESPONSE,
          correlationId,
          success: response.success,
          data: response.data,
          error: response.error ? { message: response.error } : undefined,
          errorCode: response.errorCode,
        });
      } catch (error) {
        // Catch unexpected errors to prevent main process crash
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          '[IpcBridge] Unexpected error handling RPC message:',
          errorMessage
        );

        // Attempt to send error response
        try {
          const msg = message as Record<string, unknown>;
          const rpcData = (msg?.['payload'] || msg || {}) as Record<
            string,
            unknown
          >;
          const correlationId =
            (rpcData['correlationId'] as string) ||
            (rpcData['requestId'] as string) ||
            '';

          if (correlationId) {
            event.sender.send('to-renderer', {
              type: MESSAGE_TYPES.RPC_RESPONSE,
              correlationId,
              success: false,
              error: { message: `Internal error: ${errorMessage}` },
            });
          }
        } catch {
          // Last-resort: log and swallow to prevent cascading crashes
          console.error(
            '[IpcBridge] Failed to send error response to renderer'
          );
        }
      }
    });
  }

  /**
   * Setup state persistence handlers.
   *
   * - 'get-state': Synchronous IPC (ipcRenderer.sendSync) -- returns cached state.
   *   Used by the preload's window.vscode.getState() which returns synchronously.
   *
   * - 'set-state': Async IPC (ipcRenderer.send) -- persists state to workspace storage.
   *   Used by the preload's window.vscode.setState().
   */
  private setupStateHandlers(): void {
    // Synchronous state retrieval
    // The preload uses ipcRenderer.sendSync('get-state') which blocks until we set returnValue.
    ipcMain.on('get-state', (event: IpcMainEvent) => {
      try {
        const state =
          this.stateStorage.get<Record<string, unknown>>('webview-state');
        event.returnValue = state ?? {};
      } catch (error) {
        console.error(
          '[IpcBridge] Failed to get state:',
          error instanceof Error ? error.message : String(error)
        );
        event.returnValue = {};
      }
    });

    // Async state persistence
    ipcMain.on('set-state', async (_event: IpcMainEvent, state: unknown) => {
      try {
        await this.stateStorage.update('webview-state', state);
      } catch (error) {
        console.error(
          '[IpcBridge] Failed to set state:',
          error instanceof Error ? error.message : String(error)
        );
      }
    });
  }

  /**
   * Cleanup IPC listeners. Call on app shutdown.
   */
  dispose(): void {
    ipcMain.removeAllListeners('rpc');
    ipcMain.removeAllListeners('get-state');
    ipcMain.removeAllListeners('set-state');
    console.log('[IpcBridge] IPC listeners disposed');
  }
}
