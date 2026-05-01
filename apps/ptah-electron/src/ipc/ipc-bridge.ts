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
import {
  MESSAGE_TYPES,
  type ISdkPermissionHandler,
} from '@ptah-extension/shared';
import type { PtyManagerService } from '../services/pty-manager.service';

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
    private readonly getWindow: GetWindowFn,
    private readonly ptyManager?: PtyManagerService,
  ) {
    this.rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
    this.stateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
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
    this.setupTerminalHandlers();
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
            '[IpcBridge] Received invalid RPC message (not an object)',
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
          // Not an RPC call — check for fire-and-forget messages from the frontend.
          // In VS Code these are handled by WebviewMessageHandlerService; in Electron
          // they arrive on the same 'rpc' channel but without a method field.
          const messageType = msg['type'] as string | undefined;
          if (messageType) {
            this.handleFireAndForgetMessage(messageType, msg);
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
        // RPC hardening: error is always a string at the dispatcher boundary.
        event.sender.send('to-renderer', {
          type: MESSAGE_TYPES.RPC_RESPONSE,
          correlationId,
          success: response.success,
          data: response.data,
          error: response.error,
          errorCode: response.errorCode,
        });
      } catch (error) {
        // Catch unexpected errors to prevent main process crash
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          '[IpcBridge] Unexpected error handling RPC message:',
          errorMessage,
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
              error: `Internal error: ${errorMessage}`,
            });
          }
        } catch {
          // Last-resort: log and swallow to prevent cascading crashes
          console.error(
            '[IpcBridge] Failed to send error response to renderer',
          );
        }
      }
    });
  }

  /**
   * Handle fire-and-forget messages from the frontend.
   *
   * These are one-way messages that don't expect an RPC response.
   * In VS Code, they're handled by WebviewMessageHandlerService's switch/case.
   * In Electron, they arrive on the 'rpc' channel without a method field.
   *
   * Handled message types:
   * - SDK_PERMISSION_RESPONSE: User approved/denied a permission prompt
   * - ASK_USER_QUESTION_RESPONSE: User answered a clarifying question
   */
  private async handleFireAndForgetMessage(
    type: string,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const SDK_PERMISSION_HANDLER = Symbol.for('SdkPermissionHandler');

    switch (type) {
      case MESSAGE_TYPES.SDK_PERMISSION_RESPONSE: {
        // Frontend sends: { type, response: { id, decision, reason?, modifiedInput? } }
        const response = (msg['response'] || msg['payload']) as
          | {
              id: string;
              decision: string;
              reason?: string;
              modifiedInput?: Record<string, unknown>;
            }
          | undefined;
        if (!response?.id) {
          console.warn('[IpcBridge] SDK permission response missing payload');
          return;
        }
        try {
          if (this.container.isRegistered(SDK_PERMISSION_HANDLER)) {
            const handler = this.container.resolve<ISdkPermissionHandler>(
              SDK_PERMISSION_HANDLER,
            );
            handler.handleResponse(response.id, {
              id: response.id,
              decision: response.decision as
                | 'allow'
                | 'deny'
                | 'deny_with_message'
                | 'always_allow',
              reason: response.reason,
              modifiedInput: response.modifiedInput,
            });
            console.log('[IpcBridge] SDK permission response processed', {
              id: response.id,
              decision: response.decision,
            });
          }
        } catch (error) {
          console.error(
            '[IpcBridge] Failed to process SDK permission response',
            error instanceof Error ? error.message : String(error),
          );
        }
        break;
      }

      case MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE: {
        const payload = msg['payload'] as
          | { id: string; answers: Record<string, string> }
          | undefined;
        if (!payload) {
          console.warn('[IpcBridge] AskUserQuestion response missing payload');
          return;
        }
        try {
          if (this.container.isRegistered(SDK_PERMISSION_HANDLER)) {
            const handler = this.container.resolve<ISdkPermissionHandler>(
              SDK_PERMISSION_HANDLER,
            );
            handler.handleQuestionResponse({
              id: payload.id,
              answers: payload.answers,
            });
            console.log('[IpcBridge] AskUserQuestion response processed', {
              id: payload.id,
            });
          }
        } catch (error) {
          console.error(
            '[IpcBridge] Failed to process AskUserQuestion response',
            error instanceof Error ? error.message : String(error),
          );
        }
        break;
      }

      case MESSAGE_TYPES.SETUP_WIZARD_COMPLETE: {
        console.log(
          '[IpcBridge] Setup wizard complete — switching to chat and reloading',
        );
        try {
          // Navigate back to chat view (Electron equivalent of disposing the wizard panel)
          this.sendToRenderer({
            type: MESSAGE_TYPES.SWITCH_VIEW,
            payload: { view: 'orchestra-canvas' },
          });

          // Reload after a short delay so the view switch reaches the renderer first,
          // matching the same pattern used by command:execute → reloadWindow in auth flow
          const platformCommands = this.container.resolve<{
            reloadWindow(): Promise<void>;
          }>(TOKENS.PLATFORM_COMMANDS);
          setTimeout(() => platformCommands.reloadWindow(), 500);
        } catch (error) {
          console.error(
            '[IpcBridge] Failed to handle wizard complete',
            error instanceof Error ? error.message : String(error),
          );
        }
        break;
      }

      default:
        // Unknown message type — log for debugging but don't error
        console.debug('[IpcBridge] Unhandled message type from renderer', {
          type,
        });
        break;
    }
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
          error instanceof Error ? error.message : String(error),
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
          error instanceof Error ? error.message : String(error),
        );
      }
    });
  }

  /**
   * Setup terminal binary IPC handlers (TASK_2025_227).
   *
   * Terminal data uses direct IPC channels for low-latency communication:
   * - terminal:data-in  (renderer -> main): Keyboard input forwarded to PTY
   * - terminal:resize    (renderer -> main): Terminal dimension changes
   * - terminal:data-out  (main -> renderer): PTY output forwarded to xterm
   * - terminal:exit      (main -> renderer): PTY process exit notification
   *
   * Only session lifecycle (terminal:create, terminal:kill) uses JSON RPC.
   */
  private setupTerminalHandlers(): void {
    const ptyManager = this.ptyManager;
    if (!ptyManager) return;

    // Renderer -> Main: terminal keyboard input
    ipcMain.on(
      'terminal:data-in',
      (_event: IpcMainEvent, id: string, data: string) => {
        ptyManager.write(id, data);
      },
    );

    // Renderer -> Main: terminal resize
    ipcMain.on(
      'terminal:resize',
      (_event: IpcMainEvent, id: string, cols: number, rows: number) => {
        ptyManager.resize(id, cols, rows);
      },
    );

    // Main -> Renderer: PTY output data
    ptyManager.onData((id: string, data: string) => {
      const win = this.getWindow();
      if (win) {
        win.webContents.send('terminal:data-out', id, data);
      }
    });

    // Main -> Renderer: PTY exit notification
    ptyManager.onExit((id: string, exitCode: number) => {
      const win = this.getWindow();
      if (win) {
        win.webContents.send('terminal:exit', id, exitCode);
      }
    });

    console.log('[IpcBridge] Terminal IPC handlers initialized');
  }

  /**
   * Cleanup IPC listeners. Call on app shutdown.
   */
  dispose(): void {
    ipcMain.removeAllListeners('rpc');
    ipcMain.removeAllListeners('get-state');
    ipcMain.removeAllListeners('set-state');
    ipcMain.removeAllListeners('terminal:data-in');
    ipcMain.removeAllListeners('terminal:resize');
    this.ptyManager?.disposeAll();
    console.log('[IpcBridge] IPC listeners disposed');
  }
}
