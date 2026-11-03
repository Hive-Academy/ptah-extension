/**
 * TASK_2026_853_3401 batch 7 — the detached Display window's IPC role.
 *
 * The child window shares the preload and the renderer document with the main
 * window. Once `setDisplayWindowSender(id)` trusts it, it may call only
 * `DISPLAY_WINDOW_ALLOWED_METHODS` on `rpc` and read `get-state`. Everything
 * else is refused, and the main window keeps its full surface.
 */

import 'reflect-metadata';

const listeners = new Map<string, (...args: unknown[]) => unknown>();
const handlers = new Map<string, (...args: unknown[]) => unknown>();

jest.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(channel, listener);
    },
    removeAllListeners: (channel: string) => listeners.delete(channel),
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}));

import * as path from 'path';
import { pathToFileURL } from 'url';
import { container as rootContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { DISPLAY_WINDOW_ALLOWED_METHODS, IpcBridge } from './ipc-bridge';

const TRUSTED_DOCUMENT = path.resolve('/app/renderer/index.html');
const MAIN_ID = 1;
const DISPLAY_ID = 5;

interface FakeSender {
  readonly id: number;
  readonly mainFrame: { readonly url: string };
  readonly sent: unknown[];
  send(channel: string, message: unknown): void;
  isDestroyed(): boolean;
}

function makeSender(id: number, query = ''): FakeSender {
  const sent: unknown[] = [];
  return {
    id,
    mainFrame: { url: `${pathToFileURL(TRUSTED_DOCUMENT).href}${query}` },
    sent,
    send: (_channel: string, message: unknown) => {
      sent.push(message);
    },
    isDestroyed: () => false,
  };
}

function eventFrom(sender: FakeSender): {
  sender: FakeSender;
  senderFrame: FakeSender['mainFrame'];
  returnValue?: unknown;
} {
  return { sender, senderFrame: sender.mainFrame };
}

describe('IpcBridge — detached Display window sender role', () => {
  let bridge: IpcBridge;
  let handleMessage: jest.Mock;
  let storageUpdate: jest.Mock;
  let main: FakeSender;
  let display: FakeSender;
  let capture: jest.Mock;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    listeners.clear();
    handlers.clear();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    handleMessage = jest.fn(async (request: { method: string }) => ({
      success: true,
      data: { method: request.method },
    }));
    storageUpdate = jest.fn(async () => undefined);
    capture = jest.fn(async () => '/tmp/x.cpuprofile');
    const container = rootContainer.createChildContainer();
    container.register(TOKENS.RPC_HANDLER, { useValue: { handleMessage } });
    container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      useValue: {
        get: () => ({ ptahRoute: { route: '/chat' } }),
        update: storageUpdate,
      },
    });
    container.register(TOKENS.CPU_PROFILE_CAPTURE, {
      useValue: { captureFor: capture },
    });
    main = makeSender(MAIN_ID);
    display = makeSender(DISPLAY_ID, '?ptahWindow=display');
    bridge = new IpcBridge(
      container,
      () => ({ webContents: { id: MAIN_ID, send: jest.fn() } }),
      [TRUSTED_DOCUMENT],
    );
    bridge.initialize();
  });

  afterEach(() => {
    bridge.dispose();
    jest.restoreAllMocks();
  });

  async function rpc(sender: FakeSender, method: string): Promise<void> {
    await listeners.get('rpc')?.(eventFrom(sender), {
      type: 'rpc:call',
      payload: { method, params: {}, correlationId: `c-${method}` },
    });
  }

  it('lists exactly the four plan methods', () => {
    expect([...DISPLAY_WINDOW_ALLOWED_METHODS].sort()).toEqual([
      'artifacts:openLink',
      'displayWindow:action',
      'displayWindow:close',
      'displayWindow:getState',
    ]);
  });

  it('drops every call from the child before it is trusted', async () => {
    await rpc(display, 'displayWindow:getState');
    expect(handleMessage).not.toHaveBeenCalled();
    expect(display.sent).toEqual([]);
  });

  it.each([...DISPLAY_WINDOW_ALLOWED_METHODS])(
    'routes the allowed method %s and replies to the child',
    async (method) => {
      bridge.setDisplayWindowSender(DISPLAY_ID);
      await rpc(display, method);
      expect(handleMessage).toHaveBeenCalledWith(
        expect.objectContaining({ method }),
      );
      expect(display.sent).toEqual([
        expect.objectContaining({
          type: MESSAGE_TYPES.RPC_RESPONSE,
          correlationId: `c-${method}`,
          success: true,
        }),
      ]);
      expect(main.sent).toEqual([]);
    },
  );

  it.each([
    'chat:start',
    'displayWindow:publishState',
    'displayWindow:open',
    'settings:set',
  ])('answers %s from the child with an RPC error and never routes it', async (method) => {
    bridge.setDisplayWindowSender(DISPLAY_ID);
    await rpc(display, method);
    expect(handleMessage).not.toHaveBeenCalled();
    expect(display.sent).toEqual([
      {
        type: MESSAGE_TYPES.RPC_RESPONSE,
        correlationId: `c-${method}`,
        success: false,
        error: `Method '${method}' is not available in the Display window`,
      },
    ]);
  });

  it('keeps the main window unrestricted while the child is trusted', async () => {
    bridge.setDisplayWindowSender(DISPLAY_ID);
    await rpc(main, 'chat:start');
    expect(handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'chat:start' }),
    );
    expect(main.sent).toEqual([
      expect.objectContaining({ correlationId: 'c-chat:start', success: true }),
    ]);
  });

  it('refuses fire-and-forget messages from the child', async () => {
    bridge.setDisplayWindowSender(DISPLAY_ID);
    const message = {
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: 'r1', decision: 'allow' },
    };
    await listeners.get('rpc')?.(eventFrom(display), message);
    await new Promise((resolve) => setImmediate(resolve));
    expect(handleMessage).not.toHaveBeenCalled();

    await listeners.get('rpc')?.(eventFrom(main), message);
    await new Promise((resolve) => setImmediate(resolve));
    expect(handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'agent:permissionResponse' }),
    );
  });

  it('lets the child read get-state but not write set-state', async () => {
    bridge.setDisplayWindowSender(DISPLAY_ID);
    const read = eventFrom(display);
    listeners.get('get-state')?.(read);
    expect(read.returnValue).toEqual({ ptahRoute: { route: '/chat' } });

    await listeners.get('set-state')?.(eventFrom(display), { evil: true });
    expect(storageUpdate).not.toHaveBeenCalled();

    await listeners.get('set-state')?.(eventFrom(main), { ok: true });
    expect(storageUpdate).toHaveBeenCalledWith('webview-state', { ok: true });
  });

  it('refuses diag:cpu-profile from the child', async () => {
    bridge.setDisplayWindowSender(DISPLAY_ID);
    await expect(
      handlers.get('diag:cpu-profile')?.(eventFrom(display), 5_000),
    ).rejects.toThrow('Display window');
    expect(capture).not.toHaveBeenCalled();
  });

  it('stops trusting the child after setDisplayWindowSender(null)', async () => {
    bridge.setDisplayWindowSender(DISPLAY_ID);
    bridge.setDisplayWindowSender(null);
    await rpc(display, 'displayWindow:getState');
    const read = eventFrom(display);
    listeners.get('get-state')?.(read);
    expect(handleMessage).not.toHaveBeenCalled();
    expect(display.sent).toEqual([]);
    expect(read.returnValue).toEqual({});
    expect(warn).toHaveBeenCalled();
  });
});
