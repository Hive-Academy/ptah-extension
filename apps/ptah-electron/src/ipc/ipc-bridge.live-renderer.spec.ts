import 'reflect-metadata';
import type { DependencyContainer } from 'tsyringe';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { createMainWindowHandleGetter } from '../activation/bootstrap';
import { IpcBridge } from './ipc-bridge';
import { ElectronWebviewManagerAdapter } from './webview-manager-adapter';

function makeContainer(): DependencyContainer {
  return {
    resolve: jest.fn(() => ({
      handleMessage: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
    })),
    isRegistered: jest.fn(() => false),
  } as unknown as DependencyContainer;
}

function makeWindow() {
  return {
    isDestroyed: jest.fn(() => false),
    webContents: {
      send: jest.fn<void, [string, ...unknown[]]>(),
      isDestroyed: jest.fn(() => false),
    },
  };
}

describe('IpcBridge with the production main-window getter', () => {
  const message = {
    type: MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
    payload: { health: {}, summary: {} },
  };

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports a live renderer and forwards the message unchanged', () => {
    const win = makeWindow();
    const bridge = new IpcBridge(
      makeContainer(),
      createMainWindowHandleGetter(() => win),
    );

    expect(bridge.hasLiveRenderer()).toBe(true);
    expect(new ElectronWebviewManagerAdapter(bridge).getActiveWebviews()).toEqual([
      'ptah.main',
    ]);
    expect(bridge.sendToRenderer(message)).toBe(true);
    expect(win.webContents.send).toHaveBeenCalledWith('to-renderer', message);
  });

  it('drops a still-referenced window once the native window is destroyed', () => {
    const win = makeWindow();
    const getWindow = createMainWindowHandleGetter(() => win);
    const bridge = new IpcBridge(makeContainer(), getWindow);
    const adapter = new ElectronWebviewManagerAdapter(bridge);

    expect(bridge.hasLiveRenderer()).toBe(true);
    expect(bridge.sendToRenderer(message)).toBe(true);
    win.webContents.send.mockClear();
    win.isDestroyed.mockReturnValue(true);
    // A destroyed native window must not require touching its webContents.
    win.webContents.isDestroyed.mockImplementation(() => {
      throw new Error('Object has been destroyed');
    });

    expect(getWindow()).toBeNull();
    expect(bridge.hasLiveRenderer()).toBe(false);
    expect(adapter.getActiveWebviews()).toEqual([]);
    expect(bridge.sendToRenderer(message)).toBe(false);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('drops destroyed webContents while the native window is still live', () => {
    const win = makeWindow();
    const bridge = new IpcBridge(
      makeContainer(),
      createMainWindowHandleGetter(() => win),
    );

    expect(bridge.hasLiveRenderer()).toBe(true);
    expect(bridge.sendToRenderer(message)).toBe(true);
    win.webContents.send.mockClear();
    win.webContents.isDestroyed.mockReturnValue(true);

    expect(bridge.hasLiveRenderer()).toBe(false);
    expect(new ElectronWebviewManagerAdapter(bridge).getActiveWebviews()).toEqual(
      [],
    );
    expect(bridge.sendToRenderer(message)).toBe(false);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('reports no renderer when the main window is absent', () => {
    const bridge = new IpcBridge(
      makeContainer(),
      createMainWindowHandleGetter(() => null),
    );

    expect(bridge.hasLiveRenderer()).toBe(false);
    expect(new ElectronWebviewManagerAdapter(bridge).getActiveWebviews()).toEqual(
      [],
    );
    expect(bridge.sendToRenderer(message)).toBe(false);
  });

  it('keeps an already-created handle aware of native window destruction', () => {
    const win = makeWindow();
    const handle = createMainWindowHandleGetter(() => win)();

    expect(handle?.webContents.isDestroyed?.()).toBe(false);
    win.isDestroyed.mockReturnValue(true);
    win.webContents.isDestroyed.mockClear();

    expect(handle?.webContents.isDestroyed?.()).toBe(true);
    expect(win.webContents.isDestroyed).not.toHaveBeenCalled();
  });
});
