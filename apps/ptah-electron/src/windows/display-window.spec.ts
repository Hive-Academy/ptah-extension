/**
 * TASK_2026_853_3401 batch 7 — `ElectronDisplayWindowHost`.
 *
 * Runs the shared platform-core contract suite, then the Electron-only
 * behaviour: bounds persistence and restore, closing with the main window,
 * the trusted-sender lifecycle, the state push to the child and the
 * `displayWindow:closed` push to the main renderer.
 */

const onScreen = jest.fn((_bounds: unknown) => true);

jest.mock('./window-guards', () => ({
  installNavigationGuard: jest.fn(),
  isOnScreen: (bounds: unknown) => onScreen(bounds),
}));

import type { Rectangle } from 'electron';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { runDisplayWindowHostContract } from '@ptah-extension/platform-core/testing';
import type {
  DisplayWindowAction,
  DisplayWindowSnapshot,
} from '@ptah-extension/shared';
import {
  DISPLAY_WINDOW_BOUNDS_KEY,
  DISPLAY_WINDOW_DEFAULT_HEIGHT,
  DISPLAY_WINDOW_DEFAULT_WIDTH,
  ElectronDisplayWindowHost,
  type CreateDisplayWindowOptions,
  type DisplayChildWindow,
  type DisplayMainWindow,
  type DisplayWindowIpcBridge,
} from './display-window';

type Listener = () => void;

class FakeEmitter {
  private readonly listeners = new Map<string, Listener[]>();

  protected add(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  removeListener(event: string, listener: Listener): this {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((l) => l !== listener),
    );
    return this;
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  count(event: string): number {
    return (this.listeners.get(event) ?? []).length;
  }
}

class FakeMainWindow extends FakeEmitter implements DisplayMainWindow {
  destroyed = false;
  bounds: Rectangle = { x: 100, y: 50, width: 1200, height: 800 };

  isDestroyed(): boolean {
    return this.destroyed;
  }
  getBounds(): Rectangle {
    return this.bounds;
  }
  once(event: 'closed', listener: Listener): this {
    const wrapped: Listener = () => {
      this.removeListener(event, wrapped);
      listener();
    };
    this.add(event, wrapped);
    // Keep the original findable by removeListener, as Electron does.
    this.originals.set(listener, wrapped);
    return this;
  }
  override removeListener(event: string, listener: Listener): this {
    const wrapped = this.originals.get(listener);
    if (wrapped) {
      this.originals.delete(listener);
      return super.removeListener(event, wrapped);
    }
    return super.removeListener(event, listener);
  }
  closeNow(): void {
    this.destroyed = true;
    this.emit('closed');
  }

  private readonly originals = new Map<Listener, Listener>();
}

let nextWebContentsId = 100;

class FakeChildWindow extends FakeEmitter implements DisplayChildWindow {
  readonly sent: Array<{ channel: string; args: unknown[] }> = [];
  readonly webContents = {
    id: nextWebContentsId++,
    send: (channel: string, ...args: unknown[]) => {
      this.sent.push({ channel, args });
    },
    isDestroyed: () => this.destroyed,
    on: (event: string, listener: (...args: never[]) => void) => {
      this.contentsListeners.set(event, [
        ...(this.contentsListeners.get(event) ?? []),
        listener as (...args: unknown[]) => void,
      ]);
      return this.webContents;
    },
  };
  readonly contentsListeners = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();
  loadError: Error | null = null;
  destroyed = false;
  minimized = false;
  focused = 0;
  restored = 0;
  loaded: Array<{ filePath: string; query: Record<string, string> }> = [];
  bounds: Rectangle = { x: 10, y: 20, width: 600, height: 700 };

  isDestroyed(): boolean {
    return this.destroyed;
  }
  isMinimized(): boolean {
    return this.minimized;
  }
  restore(): void {
    this.restored++;
  }
  focus(): void {
    this.focused++;
  }
  getBounds(): Rectangle {
    return this.bounds;
  }
  on(event: 'close', listener: Listener): this {
    this.add(event, listener);
    return this;
  }
  once(event: 'closed', listener: Listener): this {
    this.add(event, listener);
    return this;
  }
  /** Electron emits `close`, tears the window down, then emits `closed`. */
  close(): void {
    if (this.destroyed) return;
    this.emit('close');
    this.destroyed = true;
    this.emit('closed');
  }
  async loadFile(
    filePath: string,
    options: { query: Record<string, string> },
  ): Promise<void> {
    this.loaded.push({ filePath, query: options.query });
    if (this.loadError) throw this.loadError;
  }
  emitContents(event: string, ...args: unknown[]): void {
    for (const listener of this.contentsListeners.get(event) ?? [])
      listener(...args);
  }
}

class FakeBridge implements DisplayWindowIpcBridge {
  senderIds: Array<number | null> = [];
  pushes: unknown[] = [];
  deliver = true;

  setDisplayWindowSender(webContentsId: number | null): void {
    this.senderIds.push(webContentsId);
  }
  sendToRenderer(message: unknown): boolean {
    this.pushes.push(message);
    return this.deliver;
  }
  get currentSender(): number | null {
    return this.senderIds.length === 0
      ? null
      : this.senderIds[this.senderIds.length - 1];
  }
}

class FakeStorage implements IStateStorage {
  readonly values = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

interface Harness {
  host: ElectronDisplayWindowHost;
  main: FakeMainWindow;
  bridge: FakeBridge;
  storage: FakeStorage;
  children: FakeChildWindow[];
  placements: CreateDisplayWindowOptions['placement'][];
}

function harness(
  options: { main?: FakeMainWindow | null; loadError?: Error } = {},
): Harness {
  const main = options.main === undefined ? new FakeMainWindow() : options.main;
  const bridge = new FakeBridge();
  const storage = new FakeStorage();
  const children: FakeChildWindow[] = [];
  const placements: CreateDisplayWindowOptions['placement'][] = [];
  const host = new ElectronDisplayWindowHost({
    getMainWindow: () => main,
    bridge,
    resolveStateStorage: () => storage,
    appDir: '/app',
    createWindow: (create) => {
      placements.push(create.placement);
      const child = new FakeChildWindow();
      child.loadError = options.loadError ?? null;
      children.push(child);
      return child;
    },
  });
  return {
    host,
    main: main ?? new FakeMainWindow(),
    bridge,
    storage,
    children,
    placements,
  };
}

function relayedActions(
  bridge: FakeBridge,
): Array<{ tabId: string; action: DisplayWindowAction }> {
  const out: Array<{ tabId: string; action: DisplayWindowAction }> = [];
  for (const message of bridge.pushes) {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'displayWindow:action' &&
      'payload' in message
    ) {
      const payload = message.payload;
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'tabId' in payload &&
        typeof payload.tabId === 'string' &&
        'action' in payload
      ) {
        out.push({
          tabId: payload.tabId,
          action: payload.action as DisplayWindowAction,
        });
      }
    }
  }
  return out;
}

let contractBridge: FakeBridge;
runDisplayWindowHostContract('ElectronDisplayWindowHost', {
  createHost: () => {
    const h = harness();
    contractBridge = h.bridge;
    return h.host;
  },
  relayed: () => relayedActions(contractBridge),
});

const SNAPSHOT: DisplayWindowSnapshot = {
  tabId: 'tab-1',
  revision: 3,
  state: { selected: 'summary' },
};

describe('ElectronDisplayWindowHost — Electron behaviour', () => {
  beforeEach(() => {
    onScreen.mockReset();
    onScreen.mockReturnValue(true);
  });

  it('answers not-ready without a main window and creates nothing', async () => {
    const h = harness({ main: null });
    await expect(h.host.open()).resolves.toEqual({
      ok: false,
      reason: 'not-ready',
    });
    expect(h.children).toHaveLength(0);
    expect(h.bridge.senderIds).toEqual([]);
  });

  it('answers not-ready when the window cannot be created', async () => {
    const bridge = new FakeBridge();
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const host = new ElectronDisplayWindowHost({
      getMainWindow: () => new FakeMainWindow(),
      bridge,
      resolveStateStorage: () => undefined,
      appDir: '/app',
      createWindow: () => {
        throw new Error('no GPU');
      },
    });
    await expect(host.open()).resolves.toEqual({
      ok: false,
      reason: 'not-ready',
    });
    expect(host.isOpen()).toBe(false);
    expect(bridge.senderIds).toEqual([]);
    errorSpy.mockRestore();
  });

  it('loads the renderer with ptahWindow=display and trusts the child webContents', async () => {
    const h = harness();
    await h.host.open();
    const [child] = h.children;
    expect(child.loaded).toEqual([
      {
        filePath: expect.stringMatching(/renderer[\\/]index\.html$/),
        query: { ptahWindow: 'display' },
      },
    ]);
    expect(h.bridge.currentSender).toBe(child.webContents.id);
  });

  it('places a new window right of the main window by default', async () => {
    const h = harness();
    await h.host.open();
    expect(h.placements[0]).toEqual({
      x: 100 + 1200 + 8,
      y: 50,
      width: DISPLAY_WINDOW_DEFAULT_WIDTH,
      height: DISPLAY_WINDOW_DEFAULT_HEIGHT,
    });
  });

  it('falls back to OS placement when neither side is on screen', async () => {
    onScreen.mockReturnValue(false);
    const h = harness();
    await h.host.open();
    expect(h.placements[0]).toEqual({
      width: DISPLAY_WINDOW_DEFAULT_WIDTH,
      height: DISPLAY_WINDOW_DEFAULT_HEIGHT,
    });
  });

  it('restores saved bounds only when they are on screen and large enough', async () => {
    const saved = { x: 2000, y: 40, width: 480, height: 640 };
    const h = harness();
    h.storage.values.set(DISPLAY_WINDOW_BOUNDS_KEY, saved);
    await h.host.open();
    expect(h.placements[0]).toEqual(saved);

    await h.host.close();
    h.storage.values.set(DISPLAY_WINDOW_BOUNDS_KEY, { ...saved, width: 100 });
    await h.host.open();
    expect(h.placements[1]).not.toEqual({ ...saved, width: 100 });

    await h.host.close();
    h.storage.values.set(DISPLAY_WINDOW_BOUNDS_KEY, 'garbage');
    await h.host.open();
    expect(h.placements[2]).toMatchObject({
      width: DISPLAY_WINDOW_DEFAULT_WIDTH,
      height: DISPLAY_WINDOW_DEFAULT_HEIGHT,
    });
  });

  it('ignores off-screen saved bounds', async () => {
    const saved = { x: 9000, y: 9000, width: 480, height: 640 };
    onScreen.mockImplementation(
      (bounds) => JSON.stringify(bounds) !== JSON.stringify(saved),
    );
    const h = harness();
    h.storage.values.set(DISPLAY_WINDOW_BOUNDS_KEY, saved);
    await h.host.open();
    expect(h.placements[0]).not.toEqual(saved);
  });

  it('saves bounds under displayWindow.bounds when the window closes', async () => {
    const h = harness();
    await h.host.open();
    h.children[0].bounds = { x: 1, y: 2, width: 400, height: 500 };
    await h.host.close();
    expect(h.storage.values.get(DISPLAY_WINDOW_BOUNDS_KEY)).toEqual({
      x: 1,
      y: 2,
      width: 400,
      height: 500,
    });
    expect(h.storage.values.has('window.bounds')).toBe(false);
  });

  it('focuses (and restores) an open window instead of creating a second one', async () => {
    const h = harness();
    await h.host.open();
    h.children[0].minimized = true;
    await expect(h.host.open()).resolves.toEqual({ ok: true });
    expect(h.children).toHaveLength(1);
    expect(h.children[0].restored).toBe(1);
    expect(h.children[0].focused).toBe(1);
  });

  it('pushes each published snapshot to the child on to-renderer', async () => {
    const h = harness();
    await h.host.open();
    expect(h.host.publishState(SNAPSHOT)).toBe(true);
    expect(h.children[0].sent).toEqual([
      {
        channel: 'to-renderer',
        args: [{ type: 'displayWindow:state', payload: SNAPSHOT }],
      },
    ]);
    expect(h.bridge.pushes).toEqual([]);
  });

  it('relays child actions to the main renderer and reports delivery', async () => {
    const h = harness();
    const action: DisplayWindowAction = { type: 'select', key: 'artifact:a1' };
    expect(h.host.relayAction('tab-1', action)).toBe(true);
    expect(h.bridge.pushes).toEqual([
      { type: 'displayWindow:action', payload: { tabId: 'tab-1', action } },
    ]);
    h.bridge.deliver = false;
    expect(h.host.relayAction('tab-1', action)).toBe(false);
  });

  it('reports an action for a tab other than the cached snapshot as not relayed', async () => {
    const h = harness();
    await h.host.open();
    h.host.publishState(SNAPSHOT);
    const select: DisplayWindowAction = { type: 'select', key: 'summary' };
    expect(h.host.relayAction('tab-old', select)).toBe(false);
    expect(h.bridge.pushes).toEqual([]);
    // Re-attach is honoured whatever tab the child last saw.
    expect(h.host.relayAction('tab-old', { type: 'attach' })).toBe(true);
    expect(h.host.relayAction('tab-1', select)).toBe(true);
    expect(h.bridge.pushes).toHaveLength(2);
  });

  it.each<[string, Error | undefined, (child: FakeChildWindow) => void]>([
    ['a rejected loadFile', new Error('ENOENT'), () => undefined],
    [
      'did-fail-load on the main frame',
      undefined,
      (child) =>
        child.emitContents(
          'did-fail-load',
          {},
          -6,
          'ERR_FILE_NOT_FOUND',
          'file://x',
          true,
        ),
    ],
    [
      'render-process-gone',
      undefined,
      (child) =>
        child.emitContents('render-process-gone', {}, { reason: 'crashed' }),
    ],
  ])(
    'closes a broken child after %s and tells the main renderer',
    async (_label, loadError, trigger) => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const h = harness({ loadError });
      await h.host.open();
      const [child] = h.children;
      trigger(child);
      // Let a rejected loadFile reach its catch handler.
      await Promise.resolve();
      await Promise.resolve();
      expect(child.destroyed).toBe(true);
      expect(h.host.isOpen()).toBe(false);
      expect(h.bridge.currentSender).toBeNull();
      expect(h.bridge.pushes).toEqual([{ type: 'displayWindow:closed' }]);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );

  it('keeps the child open on an aborted or sub-frame load failure', async () => {
    const h = harness();
    await h.host.open();
    const [child] = h.children;
    child.emitContents(
      'did-fail-load',
      {},
      -3,
      'ERR_ABORTED',
      'file://x',
      true,
    );
    child.emitContents(
      'did-fail-load',
      {},
      -6,
      'ERR_FILE_NOT_FOUND',
      'file://y',
      false,
    );
    expect(child.destroyed).toBe(false);
    expect(h.host.isOpen()).toBe(true);
  });

  it('on child closed: untrusts the sender, drops the snapshot and tells the main renderer', async () => {
    const h = harness();
    await h.host.open();
    h.host.publishState(SNAPSHOT);
    // The user closes the child from its own title bar.
    h.children[0].close();
    expect(h.host.isOpen()).toBe(false);
    expect(h.host.getState()).toBeNull();
    expect(h.bridge.currentSender).toBeNull();
    expect(h.bridge.pushes).toEqual([{ type: 'displayWindow:closed' }]);
    expect(h.main.count('closed')).toBe(0);
  });

  it('closes the child when the main window closes', async () => {
    const h = harness();
    await h.host.open();
    h.main.closeNow();
    expect(h.children[0].destroyed).toBe(true);
    expect(h.host.isOpen()).toBe(false);
    expect(h.bridge.currentSender).toBeNull();
  });

  it('a late closed event of an old window does not untrust a newer one', async () => {
    const h = harness();
    await h.host.open();
    const first = h.children[0];
    // Simulate Electron emitting `closed` after a new window already opened:
    // close without the synchronous teardown, then reopen.
    first.close = () => undefined;
    await h.host.close();
    await h.host.open();
    const second = h.children[1];
    h.host.publishState(SNAPSHOT);
    first.destroyed = true;
    first.emit('closed');
    expect(h.bridge.currentSender).toBe(second.webContents.id);
    expect(h.host.getState()).toEqual(SNAPSHOT);
    expect(h.host.isOpen()).toBe(true);
  });
});
