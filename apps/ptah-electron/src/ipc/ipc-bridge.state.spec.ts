const listeners = new Map<string, (...args: unknown[]) => unknown>();

jest.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(channel, listener);
    },
    removeAllListeners: (channel: string) => listeners.delete(channel),
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { IpcBridge } from './ipc-bridge';

const TRUSTED_DOCUMENT = path.resolve('/app/renderer/index.html');
const MAIN_FRAME = { url: pathToFileURL(TRUSTED_DOCUMENT).href };
/** The main window's top frame showing the renderer — the trusted sender. */
const TRUSTED = {
  sender: { id: 1, mainFrame: MAIN_FRAME },
  senderFrame: MAIN_FRAME,
};
/** Same document, another webContents — refused by the sender guard. */
const UNTRUSTED = {
  sender: { id: 2, mainFrame: MAIN_FRAME },
  senderFrame: MAIN_FRAME,
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('IpcBridge webview state', () => {
  let bridge: IpcBridge;
  let workspacePath: string;
  let committed: unknown;
  let pendingWrite: ReturnType<typeof deferred>;
  let update: jest.Mock;
  let storageGet: jest.Mock;

  beforeEach(() => {
    listeners.clear();
    workspacePath = 'workspace-a';
    committed = { ptahRoute: { route: '/chat' } };
    pendingWrite = deferred();
    update = jest.fn(async (_key: string, value: unknown) => {
      await pendingWrite.promise;
      committed = value;
    });
    storageGet = jest.fn(() => committed);
    const storage = {
      get: storageGet,
      update,
      getActiveWorkspacePath: () => workspacePath,
    };
    const container = {
      resolve: jest.fn((token: symbol) =>
        token === PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE ? storage : {},
      ),
    } as unknown as DependencyContainer;
    bridge = new IpcBridge(
      container,
      () => ({ webContents: { id: 1, send: jest.fn() } }),
      [TRUSTED_DOCUMENT],
    );
    bridge.initialize();
  });

  afterEach(() => bridge.dispose());

  function getState(sender: object = TRUSTED): unknown {
    const event: { returnValue?: unknown } = { ...sender };
    listeners.get('get-state')?.(event);
    return event.returnValue;
  }

  it('serves the latest route during an asynchronous storage write and then the committed route', async () => {
    const next = { ptahRoute: { route: '/setup-hub/new-project' } };
    const write = listeners.get('set-state')?.(TRUSTED, next) as Promise<void>;
    expect(getState()).toEqual(next);
    pendingWrite.resolve();
    await write;
    expect(update).toHaveBeenCalledWith('webview-state', next);
    expect(getState()).toEqual(next);
  });

  it('keeps a pending route scoped to its workspace', async () => {
    const next = { ptahRoute: { route: '/setup-hub/new-project' } };
    const write = listeners.get('set-state')?.(TRUSTED, next) as Promise<void>;
    workspacePath = 'workspace-b';
    expect(getState()).toEqual({ ptahRoute: { route: '/chat' } });
    workspacePath = 'workspace-a';
    expect(getState()).toEqual(next);
    pendingWrite.resolve();
    await write;
  });

  describe('untrusted sender', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => warn.mockRestore());

    it('answers get-state with {} without reading storage', () => {
      storageGet.mockClear();
      expect(getState(UNTRUSTED)).toEqual({});
      expect(storageGet).not.toHaveBeenCalled();
    });

    it('drops set-state without writing storage', async () => {
      await listeners.get('set-state')?.(UNTRUSTED, { stolen: true });
      expect(update).not.toHaveBeenCalled();
      expect(getState()).toEqual({ ptahRoute: { route: '/chat' } });
    });

    it('warns once per sender id, without the payload', async () => {
      getState(UNTRUSTED);
      await listeners.get('set-state')?.(UNTRUSTED, { secret: 'x' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain('secret');
    });
  });
});
