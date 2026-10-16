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
import { IpcBridge } from './ipc-bridge';

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

  beforeEach(() => {
    listeners.clear();
    workspacePath = 'workspace-a';
    committed = { ptahRoute: { route: '/chat' } };
    pendingWrite = deferred();
    update = jest.fn(async (_key: string, value: unknown) => {
      await pendingWrite.promise;
      committed = value;
    });
    const storage = {
      get: jest.fn(() => committed),
      update,
      getActiveWorkspacePath: () => workspacePath,
    };
    const container = {
      resolve: jest.fn((token: symbol) =>
        token === PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE ? storage : {},
      ),
    } as unknown as DependencyContainer;
    bridge = new IpcBridge(container, () => null);
    bridge.initialize();
  });

  afterEach(() => bridge.dispose());

  function getState(): unknown {
    const event: { returnValue?: unknown } = {};
    listeners.get('get-state')?.(event);
    return event.returnValue;
  }

  it('serves the latest route during an asynchronous storage write and then the committed route', async () => {
    const next = { ptahRoute: { route: '/setup-hub/new-project' } };
    const write = listeners.get('set-state')?.({}, next) as Promise<void>;
    expect(getState()).toEqual(next);
    pendingWrite.resolve();
    await write;
    expect(update).toHaveBeenCalledWith('webview-state', next);
    expect(getState()).toEqual(next);
  });

  it('keeps a pending route scoped to its workspace', async () => {
    const next = { ptahRoute: { route: '/setup-hub/new-project' } };
    const write = listeners.get('set-state')?.({}, next) as Promise<void>;
    workspacePath = 'workspace-b';
    expect(getState()).toEqual({ ptahRoute: { route: '/chat' } });
    workspacePath = 'workspace-a';
    expect(getState()).toEqual(next);
    pendingWrite.resolve();
    await write;
  });
});
