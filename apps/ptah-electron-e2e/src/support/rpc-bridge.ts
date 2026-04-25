import type { ElectronApplication } from '@playwright/test';

/**
 * Test helper that bridges Playwright tests with the Electron main process
 * IPC layer. All operations use `electronApp.evaluate()` to run code inside
 * the Electron main process, where `ipcMain` and `BrowserWindow` are
 * available.
 *
 * The Electron app's IPC channels (see apps/ptah-electron/src/ipc/ipc-bridge.ts
 * and apps/ptah-electron/src/preload.ts):
 *   - 'rpc'                  : renderer -> main, fire-and-forget RPC dispatch
 *   - 'to-renderer'          : main -> renderer, RPC responses + push events
 *   - 'get-state' / 'set-state' : webview state persistence (sync get, async set)
 *   - 'get-startup-config'   : sync read of license/workspace bootstrap
 *   - 'clipboard:read-text' / 'clipboard:write-text'
 *   - 'terminal:data-in' / 'terminal:data-out' / 'terminal:resize' / 'terminal:exit'
 *
 * NOTE: 'rpc' is fire-and-forget at the IPC layer -- responses come back on
 * 'to-renderer'. `sendRpc` here returns the matched response by correlationId.
 */
export class RpcBridge {
  constructor(private readonly app: ElectronApplication) {}

  /**
   * Dispatch a payload to the main process on the given IPC channel and
   * await the matching `to-renderer` response (matched by `correlationId`).
   *
   * For RPC calls, the payload should be:
   *   { type: 'rpc:call', payload: { method, params, correlationId } }
   *
   * For fire-and-forget messages with no expected response, prefer
   * `sendFireAndForget` which doesn't wait.
   */
  async sendRpc(
    channel: string,
    payload: any,
    timeoutMs = 10_000,
  ): Promise<unknown> {
    const correlationId =
      (payload?.payload?.correlationId as string | undefined) ??
      (payload?.correlationId as string | undefined) ??
      `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Ensure the correlationId we wait for is on the payload.
    if (payload?.payload && !payload.payload.correlationId) {
      payload.payload.correlationId = correlationId;
    }

    return this.app.evaluate(
      async ({ ipcMain, BrowserWindow }, args) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) {
          throw new Error('[RpcBridge] No BrowserWindow available');
        }

        return await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(
              new Error(
                `[RpcBridge] sendRpc timed out after ${args.timeoutMs}ms (channel="${args.channel}")`,
              ),
            );
          }, args.timeoutMs);

          // Intercept the next 'to-renderer' send by monkey-patching webContents.send.
          // We restore the original after capturing the matching response.
          const originalSend = win.webContents.send.bind(win.webContents);
          (win.webContents as any).send = (
            sendChannel: string,
            ...sendArgs: unknown[]
          ) => {
            if (sendChannel === 'to-renderer') {
              const message = sendArgs[0] as
                | { correlationId?: string }
                | undefined;
              if (message?.correlationId === args.correlationId) {
                clearTimeout(timer);
                (win.webContents as any).send = originalSend;
                resolve(message);
                return;
              }
            }
            originalSend(sendChannel, ...sendArgs);
          };

          // Emit on the channel as if it came from the renderer.
          // `ipcMain.emit` synchronously invokes all registered listeners.
          ipcMain.emit(
            args.channel,
            { sender: win.webContents } as Electron.IpcMainEvent,
            args.payload,
          );
        });
      },
      { channel, payload, correlationId, timeoutMs },
    );
  }

  /**
   * Emit a fire-and-forget message on the given IPC channel. Does not
   * wait for any response. Useful for `set-state`, terminal data-in, etc.
   */
  async sendFireAndForget(channel: string, ...args: unknown[]): Promise<void> {
    await this.app.evaluate(
      ({ ipcMain, BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows()[0];
        ipcMain.emit(
          payload.channel,
          { sender: win?.webContents, returnValue: undefined } as
            | Electron.IpcMainEvent
            | Electron.IpcMainInvokeEvent,
          ...payload.args,
        );
      },
      { channel, args },
    );
  }

  /**
   * Wait for any message pushed from main -> renderer that matches
   * `filter`. Useful for asserting streaming events, push notifications,
   * or other unsolicited renderer messages.
   */
  async waitForRendererMessage(
    filter: (msg: unknown) => boolean,
    timeoutMs = 10_000,
  ): Promise<unknown> {
    return this.app.evaluate(
      async ({ BrowserWindow }, args) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) {
          throw new Error('[RpcBridge] No BrowserWindow available');
        }
        // Re-create the predicate inside the main-process context.
        // Playwright serializes args via structured clone, so functions
        // are not transferable -- we accept a stringified function body.
        const predicate = new Function(
          'msg',
          `return (${args.filterSource})(msg);`,
        ) as (msg: unknown) => boolean;

        return await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            (win.webContents as any).send = originalSend;
            reject(
              new Error(
                `[RpcBridge] waitForRendererMessage timed out after ${args.timeoutMs}ms`,
              ),
            );
          }, args.timeoutMs);

          const originalSend = win.webContents.send.bind(win.webContents);
          (win.webContents as any).send = (
            sendChannel: string,
            ...sendArgs: unknown[]
          ) => {
            if (sendChannel === 'to-renderer') {
              const message = sendArgs[0];
              try {
                if (predicate(message)) {
                  clearTimeout(timer);
                  (win.webContents as any).send = originalSend;
                  resolve(message);
                  return;
                }
              } catch {
                // Predicate threw -- ignore and forward.
              }
            }
            originalSend(sendChannel, ...sendArgs);
          };
        });
      },
      { filterSource: filter.toString(), timeoutMs },
    );
  }

  /**
   * Synchronously read the webview state via the 'get-state' IPC channel.
   * Matches the `ipcRenderer.sendSync('get-state')` path used by preload.
   */
  async getState(_key?: string): Promise<unknown> {
    // The Electron 'get-state' handler returns the entire cached state
    // object (no per-key indexing). Callers can index the returned value.
    return this.app.evaluate(({ ipcMain, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      let captured: unknown = undefined;
      const fakeEvent = {
        sender: win?.webContents,
        get returnValue() {
          return captured;
        },
        set returnValue(v: unknown) {
          captured = v;
        },
      } as unknown as Electron.IpcMainEvent;
      ipcMain.emit('get-state', fakeEvent);
      return captured;
    });
  }

  /**
   * Asynchronously persist webview state via 'set-state'. Mirrors the
   * `ipcRenderer.send('set-state', state)` path used by preload.
   */
  async setState(state: unknown): Promise<void> {
    await this.app.evaluate(({ ipcMain, BrowserWindow }, payload) => {
      const win = BrowserWindow.getAllWindows()[0];
      ipcMain.emit(
        'set-state',
        { sender: win?.webContents } as Electron.IpcMainEvent,
        payload,
      );
    }, state);
  }
}
