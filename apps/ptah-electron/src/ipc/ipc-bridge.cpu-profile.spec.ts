/**
 * TASK_2026_329 — `diag:cpu-profile` duration clamping.
 *
 * The renderer supplies `durationMs` to the `diag:cpu-profile` IPC channel
 * unvalidated. The handler clamps it to [1 s, 60 s] before it reaches
 * `CpuProfileCapture.captureFor`, and treats a non-number as the capture
 * default. These tests pin both halves so a future edit that drops the clamp
 * cannot forward an unbounded duration into the profiler.
 */

const ipcMainListeners = new Map<
  string,
  Array<(...args: unknown[]) => unknown>
>();
/**
 * `invoke` channels (`diag:cpu-profile`) live in a registry separate from `on`
 * listeners and are torn down with `removeHandler`, not `removeAllListeners`.
 * Modelled here so `initialize()` / `dispose()` can be exercised end to end.
 */
const ipcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();

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
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcMainHandlers.set(channel, handler);
      },
      removeHandler: (channel: string) => {
        ipcMainHandlers.delete(channel);
      },
    },
  };
});

import type { DependencyContainer } from 'tsyringe';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { IpcBridge } from './ipc-bridge';
import {
  TOKENS,
  DEFAULT_CPU_PROFILE_DURATION_MS,
} from '@ptah-extension/vscode-core';

const TRUSTED_DOCUMENT = path.resolve('/app/renderer/index.html');
const MAIN_FRAME = { url: pathToFileURL(TRUSTED_DOCUMENT).href };
/** The main window's top frame showing the renderer — the trusted sender. */
const TRUSTED = {
  sender: { id: 1, mainFrame: MAIN_FRAME },
  senderFrame: MAIN_FRAME,
};

interface FakeCapture {
  captureFor: jest.Mock;
}

function makeContainer(capture: FakeCapture): DependencyContainer {
  // The handler resolves `TOKENS.CPU_PROFILE_CAPTURE` per call. Every other
  // resolve target (RPC_HANDLER, state storage) is stored but never invoked
  // during `initialize()`, so a single routed stub is enough.
  return {
    resolve: jest.fn((token: symbol) =>
      token === TOKENS.CPU_PROFILE_CAPTURE
        ? capture
        : { captureFor: jest.fn() },
    ),
    isRegistered: jest.fn(() => false),
  } as unknown as DependencyContainer;
}

describe('IpcBridge — diag:cpu-profile duration clamping', () => {
  let bridge: IpcBridge;
  let capture: FakeCapture;

  beforeEach(() => {
    ipcMainListeners.clear();
    ipcMainHandlers.clear();
    capture = { captureFor: jest.fn(async () => '/tmp/ptah.cpuprofile') };
    bridge = new IpcBridge(
      makeContainer(capture),
      () => ({ webContents: { id: 1, send: jest.fn() } }),
      [TRUSTED_DOCUMENT],
    );
    bridge.initialize();
  });

  afterEach(() => {
    bridge.dispose();
    jest.clearAllMocks();
  });

  it('clamps an over-limit durationMs down to 60_000', async () => {
    const handler = ipcMainHandlers.get('diag:cpu-profile');
    expect(handler).toBeDefined();

    await handler?.(TRUSTED, 10_000_000);

    expect(capture.captureFor).toHaveBeenCalledTimes(1);
    expect(capture.captureFor).toHaveBeenCalledWith(60_000);
  });

  it('clamps an under-limit durationMs up to 1_000', async () => {
    const handler = ipcMainHandlers.get('diag:cpu-profile');
    expect(handler).toBeDefined();

    await handler?.(TRUSTED, 10);

    expect(capture.captureFor).toHaveBeenCalledWith(1_000);
  });

  it('passes a non-number as the capture default', async () => {
    const handler = ipcMainHandlers.get('diag:cpu-profile');
    expect(handler).toBeDefined();

    await handler?.(TRUSTED, 'abc');

    expect(capture.captureFor).toHaveBeenCalledTimes(1);
    expect(capture.captureFor).toHaveBeenCalledWith(
      DEFAULT_CPU_PROFILE_DURATION_MS,
    );
  });

  it('passes undefined as the capture default', async () => {
    const handler = ipcMainHandlers.get('diag:cpu-profile');
    expect(handler).toBeDefined();

    await handler?.(TRUSTED, undefined);

    expect(capture.captureFor).toHaveBeenCalledWith(
      DEFAULT_CPU_PROFILE_DURATION_MS,
    );
  });

  it('passes an in-range durationMs through unchanged', async () => {
    const handler = ipcMainHandlers.get('diag:cpu-profile');
    expect(handler).toBeDefined();

    await handler?.(TRUSTED, 5_000);

    expect(capture.captureFor).toHaveBeenCalledWith(5_000);
  });

  it('rejects a subframe caller without capturing a profile', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const handler = ipcMainHandlers.get('diag:cpu-profile');
    const subframe = { url: MAIN_FRAME.url };

    await expect(
      handler?.({ ...TRUSTED, senderFrame: subframe }, 5_000),
    ).rejects.toThrow('untrusted sender');

    expect(capture.captureFor).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
