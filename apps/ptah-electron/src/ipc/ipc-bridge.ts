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
import type { CodexChatHostPorts } from '@ptah-extension/rpc-handlers';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { RpcHandler } from '@ptah-extension/vscode-core';
import {
  TOKENS,
  DEFAULT_CPU_PROFILE_DURATION_MS,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  MESSAGE_TYPES,
  type ISdkPermissionHandler,
} from '@ptah-extension/shared';
import { isTrustedIpcSender } from './ipc-sender-policy';
import {
  createReplayRecorderIfEnabled,
  tapReplayRecorder,
  type ReplayRecorder,
} from '../replay/replay-recorder';

const STREAM_FLUSH_INTERVAL_MS = 16;

/**
 * `diag:cpu-profile` duration bounds. The renderer supplies `durationMs`
 * unvalidated, so the IPC handler clamps it before it reaches
 * `CpuProfileCapture.captureFor`. A non-number falls back to the capture
 * default; anything else is held to [1 s, 60 s] — short enough that the
 * resulting `.cpuprofile` stays openable, long enough to span a stall.
 */
const MIN_CPU_PROFILE_DURATION_MS = 1_000;
const MAX_CPU_PROFILE_DURATION_MS = 60_000;

function clampCpuProfileDuration(durationMs: unknown): number {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) {
    return DEFAULT_CPU_PROFILE_DURATION_MS;
  }
  return Math.min(
    Math.max(durationMs, MIN_CPU_PROFILE_DURATION_MS),
    MAX_CPU_PROFILE_DURATION_MS,
  );
}

const BATCHABLE_STREAM_TYPES: ReadonlySet<string> = new Set<string>([
  MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
  MESSAGE_TYPES.CHAT_CHUNK,
  MESSAGE_TYPES.CHAT_THINKING,
  MESSAGE_TYPES.CHAT_TOOL_PROGRESS,
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
    /** The window's `webContents.id`; the IPC sender guard compares it to `event.sender.id`. */
    readonly id: number;
    send(channel: string, ...args: unknown[]): void;
    /** Present on real Electron webContents; absent on lightweight test stubs. */
    isDestroyed?(): boolean;
  };
}

type GetWindowFn = () => ElectronWindowHandle | null;

/**
 * The part of an `ipcMain` event the sender guard reads. Both `IpcMainEvent`
 * and `IpcMainInvokeEvent` satisfy it.
 */
type IpcSenderEvent = Pick<IpcMainEvent, 'sender' | 'senderFrame'>;

/**
 * Which trusted window an IPC call came from. `display` is the detached
 * Display window (TASK_2026_853_3401): it shares the preload and the renderer
 * document with the main window, so the sender policy trusts it the same way,
 * and this bridge then narrows what it may call.
 */
type IpcSenderRole = 'main' | 'display';

/**
 * The only RPC methods the detached Display window may call. Everything it
 * shows comes from the snapshot the main renderer publishes, so it needs no
 * other backend access. Any other method gets an RPC error reply.
 */
export const DISPLAY_WINDOW_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'displayWindow:getState',
  'displayWindow:action',
  'displayWindow:close',
  'artifacts:openLink',
]);

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
  // Synchronous get-state must see a route received before the worker-backed
  // storage update commits, including when the renderer reloads immediately.
  private readonly pendingWebviewStates = new Map<
    string | null,
    { state: unknown }
  >();
  private readonly streamQueue: QueuedStreamEvent[] = [];
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Flips the first time {@link getWindow} returns a window and never flips
   * back. It is what separates "no renderer yet" (boot — expected) from "the
   * renderer went away" (mid-session — worth a warning). See
   * {@link resolveWindow}.
   */
  private hasHadWindow = false;
  /** Sender ids already warned about, so a misbehaving frame logs once. */
  private readonly warnedSenderIds = new Set<number>();
  /** `webContents.id` of the open detached Display window, or `null`. */
  private displayWindowSenderId: number | null = null;
  private readonly recorder: ReplayRecorder | null;

  /**
   * @param trustedDocumentPaths - absolute paths of the documents the main
   *   window may show (renderer and boot shell). Only the main window's top
   *   frame showing one of them may call the guarded channels; see
   *   {@link isTrustedIpcSender}.
   */
  constructor(
    private readonly container: DependencyContainer,
    private readonly getWindow: GetWindowFn,
    private readonly trustedDocumentPaths: readonly string[],
    recorder?: ReplayRecorder | null,
  ) {
    this.rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
    this.stateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    this.recorder =
      recorder !== undefined
        ? recorder
        : __PTAH_REPLAY_RECORDER__
          ? createReplayRecorderIfEnabled()
          : null;
  }

  /**
   * Initialize all IPC listeners.
   * Must be called after DI container is fully configured and
   * before the renderer loads.
   */
  initialize(): void {
    this.setupRpcHandler();
    this.setupStateHandlers();
    this.setupDiagnosticsHandlers();
    console.log('[IpcBridge] IPC listeners initialized');
  }

  /**
   * Send a message to the renderer process.
   * Used by WebviewManagerAdapter and other services to push events
   * (e.g., streaming chunks, session updates) to the Angular frontend.
   *
   * @param message - The message object to send. Should include a `type` field
   *   matching MESSAGE_TYPES constants so MessageRouterService can dispatch it.
   * @returns true when the event was handed to `webContents.send` or queued as
   *   a batched stream event, and false when it was dropped (no window, or the
   *   window's webContents is destroyed). Delivery-reporting callers
   *   (`ElectronWebviewManagerAdapter.sendMessage`) read it; fire-and-forget
   *   call sites ignore it.
   */
  sendToRenderer(message: unknown): boolean {
    const streamEvent = this.extractStreamEvent(message);
    if (streamEvent) {
      this.enqueueStreamEvent(streamEvent);
      return true;
    }
    this.flushStreamQueue();
    const win = this.resolveWindow(messageTypeOf(message));
    if (!win) {
      return false;
    }
    if (win.webContents.isDestroyed?.() === true) {
      return false;
    }
    win.webContents.send('to-renderer', message);
    if (__PTAH_REPLAY_RECORDER__ && this.recorder) {
      tapReplayRecorder(this.recorder, (r) => r.recordPush(message));
    }
    return true;
  }

  /**
   * Trust (or, with `null`, stop trusting) the detached Display window's
   * webContents. Called by `ElectronDisplayWindowHost` when the window is
   * created and when it closes. Its calls are limited to
   * {@link DISPLAY_WINDOW_ALLOWED_METHODS} and the `get-state` read.
   */
  setDisplayWindowSender(webContentsId: number | null): void {
    this.displayWindowSenderId = webContentsId;
  }

  /**
   * Whether the renderer window exists right now and is not destroyed.
   *
   * Unlike {@link resolveWindow} this is an enquiry, not a push, so it logs
   * nothing — the "no renderer yet" boot state is expected here and would
   * otherwise spam a debug line on every enumeration. Consumers
   * (`ElectronWebviewManagerAdapter.getActiveWebviews`) use it to decide which
   * surfaces to report, which is what lets `createDashboardBroadcast` answer
   * `no-surface` instead of attempting a doomed send.
   */
  hasLiveRenderer(): boolean {
    const win = this.getWindow();
    return win !== null && win.webContents.isDestroyed?.() !== true;
  }

  /**
   * Resolve the renderer window, reporting an undeliverable push honestly.
   *
   * ### Why boot-time pushes are DROPPED and not queued (B2, TASK_2026_315)
   *
   * The activation `harness:healthChanged` notification can reach this method
   * before `BrowserWindow` exists. It sits on top of pull-backed state:
   * `HarnessCardComponent.ngOnInit` calls `HarnessHealthStore.refresh()`
   * whenever `health()` is still null.
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
   *    activation events to a renderer that has already moved past them.
   *
   * So the drop stays, and only its reporting changes. Before the first window
   * a push has no subscriber and that is normal: debug, not warn. After a
   * window has existed, losing one is not normal and still warns. Either way
   * the message TYPE is named so an undeliverable push can be diagnosed.
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
      const singleMessage = {
        type: events[0].type,
        payload: events[0].payload,
      };
      win.webContents.send('to-renderer', singleMessage);
      if (__PTAH_REPLAY_RECORDER__ && this.recorder) {
        tapReplayRecorder(this.recorder, (r) => r.recordPush(singleMessage));
      }
      return;
    }
    const batchMessage = {
      type: MESSAGE_TYPES.BATCH,
      payload: { events },
    };
    win.webContents.send('to-renderer', batchMessage);
    if (__PTAH_REPLAY_RECORDER__ && this.recorder) {
      tapReplayRecorder(this.recorder, (r) => r.recordPush(batchMessage));
    }
  }

  /**
   * Which trusted window an `ipcMain` call comes from: the top frame of the
   * main window or of the detached Display window, showing a trusted
   * document. `null` means untrusted: the caller drops the call; the first
   * drop per sender id is warned about, without the payload or the URL.
   */
  private senderRole(
    event: IpcSenderEvent,
    channel: string,
  ): IpcSenderRole | null {
    let senderId: number | undefined;
    let trusted = false;
    try {
      senderId = event.sender.id;
      const frame = event.senderFrame;
      const trustedIds: number[] = [];
      const mainId = this.getWindow()?.webContents.id;
      if (mainId !== undefined) trustedIds.push(mainId);
      if (this.displayWindowSenderId !== null) {
        trustedIds.push(this.displayWindowSenderId);
      }
      trusted = isTrustedIpcSender(
        {
          webContentsId: senderId,
          frameUrl: frame?.url,
          isMainFrame: frame !== null && frame === event.sender.mainFrame,
        },
        {
          webContentsIds: trustedIds,
          documentPaths: this.trustedDocumentPaths,
        },
      );
    } catch {
      // degradation-audit: optional-capability - reading a disposed frame or
      // webContents throws; a sender we cannot identify stays untrusted, so
      // the call is dropped (fail closed) and the drop is warned about below.
    }
    if (trusted && senderId !== undefined) {
      return senderId === this.displayWindowSenderId ? 'display' : 'main';
    }
    // A sender with no readable id is not remembered, so each such drop warns.
    if (senderId === undefined || !this.warnedSenderIds.has(senderId)) {
      if (senderId !== undefined) this.warnedSenderIds.add(senderId);
      const who = senderId === undefined ? 'unknown' : String(senderId);
      console.warn(
        `[IpcBridge] Dropped '${channel}' from webContents ${who}: not the main window's top frame on a trusted document, or its frame is gone (reload). Further drops from it are silent.`,
      );
    }
    return null;
  }

  /**
   * Refuse a channel the detached Display window may not use. Logged without
   * the payload; the window has no legitimate caller for these.
   */
  private refuseDisplayWindow(channel: string): void {
    console.warn(
      `[IpcBridge] Refused '${channel}' from the Display window: not in its IPC allowlist.`,
    );
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
      const role = this.senderRole(event, 'rpc');
      if (role === null) return;
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
          // Fire-and-forget messages answer permission prompts and drive the
          // wizard; the Display window has no such caller.
          if (role === 'display') {
            this.refuseDisplayWindow('rpc (fire-and-forget)');
            return;
          }
          const messageType = msg['type'] as string | undefined;
          if (messageType) {
            this.handleFireAndForgetMessage(messageType, msg);
          }
          return;
        }
        if (role === 'display' && !DISPLAY_WINDOW_ALLOWED_METHODS.has(method)) {
          this.refuseDisplayWindow(`rpc ${method}`);
          if (correlationId && !event.sender.isDestroyed()) {
            event.sender.send('to-renderer', {
              type: MESSAGE_TYPES.RPC_RESPONSE,
              correlationId,
              success: false,
              error: `Method '${method}' is not available in the Display window`,
            });
          }
          return;
        }
        if (__PTAH_REPLAY_RECORDER__ && this.recorder) {
          tapReplayRecorder(this.recorder, (r) =>
            r.recordRpcCall(method, params, correlationId),
          );
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
        if (__PTAH_REPLAY_RECORDER__ && this.recorder) {
          tapReplayRecorder(this.recorder, (r) =>
            r.recordRpcResult(correlationId, response),
          );
        }
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
   * - AGENT_MONITOR_PERMISSION_RESPONSE: User answered a CLI-agent permission
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
        const { decision } = response;
        if (
          decision !== 'allow' &&
          decision !== 'always_allow' &&
          decision !== 'deny_with_message' &&
          decision !== 'deny'
        ) {
          console.warn('[IpcBridge] SDK permission response has invalid decision');
          return;
        }
        try {
          // Codex host ports first (null when native Codex is not bound).
          const codexPorts = this.container.isRegistered(
            SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
            true,
          )
            ? this.container.resolve<
                Pick<CodexChatHostPorts, 'handlePermissionResponse'> | null
              >(
                SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
              )
            : null;
          if (
            codexPorts?.handlePermissionResponse({ ...response, decision }) === true
          ) {
            return;
          }
          if (this.container.isRegistered(SDK_PERMISSION_HANDLER)) {
            const handler = this.container.resolve<ISdkPermissionHandler>(
              SDK_PERMISSION_HANDLER,
            );
            handler.handleResponse(response.id, {
              id: response.id,
              decision,
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
            error instanceof Error ? error : new Error(String(error)),
          );
        }
        break;
      }

      case MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE: {
        const payload = msg['payload'] as
          { id: string; answers: Record<string, string> } | undefined;
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

      case MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE: {
        // CLI-agent lanes (Ptah CLI, Copilot) answer through the same RPC the
        // VS Code host forwards this message to; without this case the answer
        // was dropped while the renderer cleared the prompt locally.
        const payload = msg['payload'] as
          | { requestId?: string; decision?: string; reason?: string }
          | undefined;
        if (!payload?.requestId) {
          console.warn(
            '[IpcBridge] Agent permission response missing requestId',
          );
          return;
        }
        try {
          const response = await this.rpcHandler.handleMessage({
            method: 'agent:permissionResponse',
            params: payload,
            correlationId: payload.requestId,
          });
          if (!response.success) {
            console.warn('[IpcBridge] Agent permission response failed', {
              requestId: payload.requestId,
              error: response.error,
            });
          }
        } catch (error) {
          console.error(
            '[IpcBridge] Failed to process agent permission response',
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
      // A sync caller blocks until `returnValue` is set, so even a dropped
      // call must answer — with the empty state, never the stored one.
      // The Display window may read: the shared preload calls this while it
      // boots. It may not write (`set-state` below).
      if (this.senderRole(event, 'get-state') === null) {
        event.returnValue = {};
        return;
      }
      try {
        const pending = this.pendingWebviewStates.get(
          this.activeStateWorkspace(),
        );
        if (pending) {
          event.returnValue = pending.state ?? {};
          return;
        }
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
    ipcMain.on('set-state', async (event: IpcMainEvent, state: unknown) => {
      const role = this.senderRole(event, 'set-state');
      if (role === null) return;
      // One shared blob belongs to the main renderer; the Display window
      // writing it would overwrite the main window's routes and layout.
      if (role === 'display') {
        this.refuseDisplayWindow('set-state');
        return;
      }
      const workspacePath = this.activeStateWorkspace();
      const pending = { state };
      this.pendingWebviewStates.set(workspacePath, pending);
      try {
        await this.stateStorage.update('webview-state', state);
      } catch (error) {
        console.error(
          '[IpcBridge] Failed to set state:',
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (this.pendingWebviewStates.get(workspacePath) === pending) {
          this.pendingWebviewStates.delete(workspacePath);
        }
      }
    });
  }

  private activeStateWorkspace(): string | null {
    const storage = this.stateStorage as IStateStorage & {
      getActiveWorkspacePath?: () => string | null;
    };
    return storage.getActiveWorkspacePath?.() ?? null;
  }

  /**
   * `diag:cpu-profile` — capture a CPU profile of the main process.
   *
   * A DIRECT `ipcMain.handle`, deliberately not an `rpc:` method. The whole
   * point of this channel is to work when the app is wedged, and every RPC
   * method runs through `RpcHandler.handleMessage` on the main-process event
   * loop — the exact resource a hang has taken away. Electron delivers `invoke`
   * on the same loop, so this is not magic; it is simply the shortest path,
   * with no handler registry, no capability gate and no queue in front of it.
   *
   * `CpuProfileCapture` is resolved lazily per call rather than in the
   * constructor: this bridge is built during bootstrap, and paying for an
   * inspector-capable singleton on every launch to serve a channel almost
   * nobody invokes is the wrong trade.
   */
  private setupDiagnosticsHandlers(): void {
    ipcMain.handle(
      'diag:cpu-profile',
      async (event, durationMs?: number): Promise<string> => {
        // `invoke` always settles: a dropped call rejects instead of
        // capturing, so the untrusted caller learns nothing but the refusal.
        const role = this.senderRole(event, 'diag:cpu-profile');
        if (role === null) {
          throw new Error('diag:cpu-profile refused: untrusted sender');
        }
        if (role === 'display') {
          this.refuseDisplayWindow('diag:cpu-profile');
          throw new Error('diag:cpu-profile refused: Display window');
        }
        const capture = this.container.resolve<{
          captureFor(durationMs?: number): Promise<string>;
        }>(TOKENS.CPU_PROFILE_CAPTURE);
        return await capture.captureFor(clampCpuProfileDuration(durationMs));
      },
    );
    console.log('[IpcBridge] Diagnostics IPC handlers initialized');
  }

  /**
   * Cleanup IPC listeners. Call on app shutdown.
   */
  dispose(): void {
    this.flushStreamQueue();
    if (__PTAH_REPLAY_RECORDER__ && this.recorder) {
      tapReplayRecorder(this.recorder, (r) => r.flush());
    }
    ipcMain.removeAllListeners('rpc');
    ipcMain.removeAllListeners('get-state');
    ipcMain.removeAllListeners('set-state');
    // `handle` channels need removeHandler, not removeAllListeners.
    ipcMain.removeHandler('diag:cpu-profile');
    console.log('[IpcBridge] IPC listeners disposed');
  }
}
