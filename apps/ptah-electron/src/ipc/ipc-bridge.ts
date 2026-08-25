/**
 * IPC Bridge -- Connects the Angular renderer with the Electron main process.
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

const STREAM_FLUSH_INTERVAL_MS = 16;

const BATCHABLE_STREAM_TYPES: ReadonlySet<string> = new Set<string>([
  MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
  MESSAGE_TYPES.CHAT_CHUNK,
  MESSAGE_TYPES.CHAT_THINKING,
  MESSAGE_TYPES.CHAT_TOOL_PROGRESS,
  MESSAGE_TYPES.AGENT_SUMMARY_CHUNK,
  MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM,
  MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS,
  MESSAGE_TYPES.INDEXING_PROGRESS,
]);

interface QueuedStreamEvent {
  readonly type: string;
  readonly payload?: unknown;
}

/**
 * Best-effort `type` off an outbound message, for diagnostics only.
 *
 * Returns `undefined` rather than a placeholder: "this message carried no
 * type" and "this message was typed X" are different facts, and the caller
 * renders them differently.
 */
function messageTypeOf(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const type = (message as Record<string, unknown>)['type'];
  return typeof type === 'string' ? type : undefined;
}

/**
 * Callback type for obtaining the BrowserWindow's webContents.send method.
 * Uses a thin interface instead of importing BrowserWindow directly to
 * avoid tight coupling and simplify testing.
 */
interface ElectronWindowHandle {
  webContents: {
    send(channel: string, ...args: unknown[]): void;
    /** Present on real Electron webContents; absent on lightweight test stubs. */
    isDestroyed?(): boolean;
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
  private readonly streamQueue: QueuedStreamEvent[] = [];
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Flips the first time {@link getWindow} returns a window and never flips
   * back. It is what separates "no renderer yet" (boot — expected) from "the
   * renderer went away" (mid-session — worth a warning). See
   * {@link resolveWindow}.
   */
  private hasHadWindow = false;

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
    const streamEvent = this.extractStreamEvent(message);
    if (streamEvent) {
      this.enqueueStreamEvent(streamEvent);
      return;
    }
    this.flushStreamQueue();
    const win = this.resolveWindow(messageTypeOf(message));
    if (!win) {
      return;
    }
    if (win.webContents.isDestroyed?.() === true) {
      return;
    }
    win.webContents.send('to-renderer', message);
  }

  /**
   * Resolve the renderer window, reporting an undeliverable push honestly.
   *
   * ### Why boot-time pushes are DROPPED and not queued (B2, TASK_2026_315)
   *
   * Traced at a clean boot, exactly two messages reach this method before the
   * `BrowserWindow` exists — `main.ts` runs `wireRuntime` at `:127` and only
   * creates the window inside `registerPostWindow` at `:145`:
   *
   *  1. `skillSynthesis:event` (the `boot-scan` stats event) — from
   *     `SkillTriggerService.runBootScan` via `SkillSynthesisService.pushEvent`.
   *  2. `harness:healthChanged` — from `HarnessHealthRpcService.pushIfChanged`,
   *     on the `reason: activation` reconcile pass.
   *
   * Both are EDGE-TRIGGERED notifications sitting on top of PULL-backed state,
   * and both consumers cold-pull when no push has reached them:
   * `HarnessCardComponent.ngOnInit` calls `HarnessHealthStore.refresh()`
   * whenever `health()` is still null, and `SkillSynthesisLiveService` feeds an
   * activity feed whose entire meaning is "while you were watching" — there was
   * nobody watching. Nothing downstream loses state it depended on.
   *
   * Queueing was the cheap option — `enqueueStreamEvent` above already buffers
   * one class of message — and it is the wrong one, for two reasons:
   *
   *  - The activation `harness:healthChanged` snapshot is superseded within
   *    milliseconds by the `content-download-complete` pass, and again by the
   *    renderer's own pull. A replay racing that pull would overwrite fresher
   *    state with staler state — strictly worse than the drop.
   *  - `IpcBridge` outlives a renderer reload (`SETUP_WIZARD_COMPLETE` below
   *    reloads the window deliberately), so a replay buffer would re-deliver
   *    boot events to a renderer that has already moved past them.
   *
   * So the drop stays, and only its reporting changes. Before the first window
   * a push has no subscriber and that is normal: debug, not warn. After a
   * window has existed, losing one is not normal and still warns. Either way
   * the message TYPE is named — the bare warning this replaces carried no type,
   * which is why identifying those two events needed a stack trace at all.
   */
  private resolveWindow(
    messageType: string | undefined,
  ): ElectronWindowHandle | null {
    const win = this.getWindow();
    if (win) {
      this.hasHadWindow = true;
      return win;
    }
    if (this.hasHadWindow) {
      console.warn(
        '[IpcBridge] Cannot send to renderer: the window is gone',
        messageType ?? '(untyped message)',
      );
    } else {
      console.debug(
        '[IpcBridge] Push dropped, no renderer yet (pull-backed, deliberately not queued):',
        messageType ?? '(untyped message)',
      );
    }
    return null;
  }

  private extractStreamEvent(message: unknown): QueuedStreamEvent | null {
    if (!message || typeof message !== 'object') return null;
    const obj = message as Record<string, unknown>;
    const type = obj['type'];
    if (typeof type !== 'string') return null;
    if (!BATCHABLE_STREAM_TYPES.has(type)) return null;
    return { type, payload: obj['payload'] };
  }

  private enqueueStreamEvent(event: QueuedStreamEvent): void {
    this.streamQueue.push(event);
    if (this.streamFlushTimer !== null) return;
    this.streamFlushTimer = setTimeout(() => {
      this.flushStreamQueue();
    }, STREAM_FLUSH_INTERVAL_MS);
  }

  private flushStreamQueue(): void {
    if (this.streamFlushTimer !== null) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
    if (this.streamQueue.length === 0) return;
    const events = this.streamQueue.splice(0, this.streamQueue.length);
    const win = this.resolveWindow(
      events.length === 1 ? events[0].type : MESSAGE_TYPES.BATCH,
    );
    if (!win) {
      return;
    }
    if (win.webContents.isDestroyed?.() === true) {
      return;
    }
    if (events.length === 1) {
      win.webContents.send('to-renderer', {
        type: events[0].type,
        payload: events[0].payload,
      });
      return;
    }
    win.webContents.send('to-renderer', {
      type: MESSAGE_TYPES.BATCH,
      payload: { events },
    });
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
        if (!message || typeof message !== 'object') {
          console.warn(
            '[IpcBridge] Received invalid RPC message (not an object)',
          );
          return;
        }

        const msg = message as Record<string, unknown>;
        const rpcData = (msg['payload'] || msg) as Record<string, unknown>;

        const method = rpcData['method'] as string | undefined;
        const params = rpcData['params'] as unknown;
        const correlationId =
          (rpcData['correlationId'] as string) ||
          (rpcData['requestId'] as string) ||
          '';

        if (!method) {
          const messageType = msg['type'] as string | undefined;
          if (messageType) {
            this.handleFireAndForgetMessage(messageType, msg);
          }
          return;
        }
        const response = await this.rpcHandler.handleMessage({
          method,
          params,
          correlationId,
        });
        this.flushStreamQueue();
        // The renderer can be torn down (app quitting / window closed) while an
        // async RPC is in flight; sending to a destroyed sender throws
        // "Object has been destroyed". Skip the reply — nothing is listening.
        if (event.sender.isDestroyed()) {
          return;
        }
        event.sender.send('to-renderer', {
          type: MESSAGE_TYPES.RPC_RESPONSE,
          correlationId,
          success: response.success,
          data: response.data,
          error: response.error,
          errorCode: response.errorCode,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          '[IpcBridge] Unexpected error handling RPC message:',
          errorMessage,
        );
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

          if (correlationId && !event.sender.isDestroyed()) {
            event.sender.send('to-renderer', {
              type: MESSAGE_TYPES.RPC_RESPONSE,
              correlationId,
              success: false,
              error: `Internal error: ${errorMessage}`,
            });
          }
        } catch {
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
          this.sendToRenderer({
            type: MESSAGE_TYPES.SWITCH_VIEW,
            payload: { view: 'orchestra-canvas' },
          });
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
   * Setup terminal binary IPC handlers.
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
    ipcMain.on(
      'terminal:data-in',
      (_event: IpcMainEvent, id: string, data: string) => {
        ptyManager.write(id, data);
      },
    );
    ipcMain.on(
      'terminal:resize',
      (_event: IpcMainEvent, id: string, cols: number, rows: number) => {
        ptyManager.resize(id, cols, rows);
      },
    );
    ptyManager.onData((id: string, data: string) => {
      const win = this.getWindow();
      if (win) {
        win.webContents.send('terminal:data-out', id, data);
      }
    });
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
    this.flushStreamQueue();
    ipcMain.removeAllListeners('rpc');
    ipcMain.removeAllListeners('get-state');
    ipcMain.removeAllListeners('set-state');
    ipcMain.removeAllListeners('terminal:data-in');
    ipcMain.removeAllListeners('terminal:resize');
    this.ptyManager?.disposeAll();
    console.log('[IpcBridge] IPC listeners disposed');
  }
}
