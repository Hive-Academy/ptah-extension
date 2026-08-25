/**
 * B2 (TASK_2026_315) — what happens to a push with no renderer to push to.
 *
 * At a clean boot exactly two messages reach `sendToRenderer` before the
 * `BrowserWindow` exists — `skillSynthesis:event` (the boot-scan stats event)
 * and `harness:healthChanged` (the `reason: activation` reconcile). Both were
 * dropped with a bare `Cannot send to renderer: no window available` that
 * named neither the message nor whether losing it mattered.
 *
 * The decision was DROP, not queue: both are edge-triggered notifications over
 * pull-backed state, and replaying a boot snapshot into a renderer that has
 * already pulled — or has since reloaded — is worse than losing it. See the
 * docblock on `IpcBridge.resolveWindow` for the full reasoning.
 *
 * These tests pin the two halves of that decision that could silently rot:
 * nothing is buffered for later delivery, and a boot drop is reported at debug
 * while a mid-session one still warns.
 */

const ipcMainListeners = new Map<
  string,
  Array<(...args: unknown[]) => unknown>
>();

jest.mock('electron', () => {
  return {
    ipcMain: {
      on: (channel: string, listener: (...args: unknown[]) => unknown) => {
        const arr = ipcMainListeners.get(channel) ?? [];
        arr.push(listener);
        ipcMainListeners.set(channel, arr);
      },
      removeAllListeners: (channel: string) => {
        ipcMainListeners.delete(channel);
      },
    },
  };
});

import type { DependencyContainer } from 'tsyringe';
import { IpcBridge } from './ipc-bridge';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

/** The two message types actually observed dropping at boot. */
const BOOT_DROPPED_TYPES = [
  MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT,
  MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
] as const;

interface FakeWindow {
  webContents: { send: jest.Mock };
}

function makeWindow(): FakeWindow {
  return { webContents: { send: jest.fn() } };
}

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

describe('IpcBridge — pushes that arrive before the renderer', () => {
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    ipcMainListeners.clear();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(BOOT_DROPPED_TYPES)(
    'reports %s at debug — not warn — when no window has ever existed',
    (type) => {
      const bridge = new IpcBridge(makeContainer(), () => null);

      bridge.sendToRenderer({ type, payload: { any: 'thing' } });

      expect(warn).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(1);
      // The type must be named. Identifying these two events originally
      // required attaching a stack trace precisely because it was not.
      expect(debug.mock.calls[0]).toContain(type);

      bridge.dispose();
    },
  );

  it('does NOT buffer a pre-window push for replay once the window appears', () => {
    // The whole queue-vs-suppress decision in one assertion: a boot push is
    // gone, not pending. If someone later "improves" this into a replay queue,
    // this fails and they have to read the reasoning first.
    let win: FakeWindow | null = null;
    const bridge = new IpcBridge(
      makeContainer(),
      () => win as unknown as FakeWindow,
    );

    bridge.sendToRenderer({
      type: MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
      payload: { health: { stale: true }, summary: {} },
    });

    win = makeWindow();

    // Anything that would drain a buffer: a timer tick, a later send, dispose.
    jest.advanceTimersByTime(1000);
    bridge.dispose();

    const deliveredTypes = win.webContents.send.mock.calls.map(
      (call) => (call[1] as { type?: string } | undefined)?.type,
    );
    expect(deliveredTypes).not.toContain(MESSAGE_TYPES.HARNESS_HEALTH_CHANGED);
  });

  it('still WARNS when a window existed and then went away', () => {
    // This is the case the original warning was worth keeping for: a live
    // session losing a push is a real fault, unlike a boot-time drop.
    let win: FakeWindow | null = makeWindow();
    const bridge = new IpcBridge(
      makeContainer(),
      () => win as unknown as FakeWindow,
    );

    bridge.sendToRenderer({ type: MESSAGE_TYPES.SWITCH_VIEW, payload: {} });
    expect(win?.webContents.send).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();

    win = null;
    bridge.sendToRenderer({ type: MESSAGE_TYPES.SWITCH_VIEW, payload: {} });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toContain(MESSAGE_TYPES.SWITCH_VIEW);
    expect(debug).not.toHaveBeenCalled();

    bridge.dispose();
  });

  it('applies the same rule to the batched stream path', () => {
    // `flushStreamQueue` had its own copy of the warning; it must not shout at
    // boot either, and it must name what it dropped.
    const bridge = new IpcBridge(makeContainer(), () => null);

    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_CHUNK,
      payload: { i: 1 },
    });
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_THINKING,
      payload: { i: 2 },
    });
    jest.advanceTimersByTime(20);

    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0]).toContain(MESSAGE_TYPES.BATCH);

    bridge.dispose();
  });
});
