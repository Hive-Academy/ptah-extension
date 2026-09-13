/**
 * The renderer channels a FAILED boot still has to answer.
 *
 * `bootstrapElectron` awaits `WORKSPACE_STATE_STORAGE.whenReady()` before it
 * builds the `IpcBridge`. When that await rejects, `main.ts` paints the recovery
 * shell and returns — and before this module existed, it returned with `rpc`,
 * `get-state` and `set-state` unregistered. `get-state` is a SYNC channel the
 * preload calls, so the renderer blocked in it; `rpc` was simply silent, which
 * is how every RPC-driven Electron e2e spec came to fail on a 10 s timeout with
 * no error text (TASK_2026_411 / PR #494).
 */
const ipcMainListeners = new Map<
  string,
  Array<(...args: unknown[]) => unknown>
>();

jest.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      const arr = ipcMainListeners.get(channel) ?? [];
      arr.push(listener);
      ipcMainListeners.set(channel, arr);
    },
    listenerCount: (channel: string) =>
      (ipcMainListeners.get(channel) ?? []).length,
  },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  RECOVERY_MODE_CHANNELS,
  registerRecoveryModeIpc,
} from './recovery-mode-ipc';

interface SyncEvent {
  returnValue?: unknown;
}

function drive(channel: string, ...args: unknown[]): void {
  const listeners = ipcMainListeners.get(channel) ?? [];
  expect(listeners).toHaveLength(1);
  listeners[0](...args);
}

describe('recovery-mode IPC responders', () => {
  beforeEach(() => {
    ipcMainListeners.clear();
  });

  it('claims every renderer channel a failed boot would have left unserved', () => {
    registerRecoveryModeIpc('worker-unresponsive');

    for (const channel of RECOVERY_MODE_CHANNELS) {
      expect(ipcMainListeners.get(channel) ?? []).toHaveLength(1);
    }
  });

  it('answers the SYNC get-state channel — an unset returnValue is the wedge', () => {
    registerRecoveryModeIpc('worker-unresponsive');

    const event: SyncEvent = {};
    drive('get-state', event);

    expect(event.returnValue).toEqual({});
  });

  it('accepts set-state without persisting into a store under recovery', () => {
    registerRecoveryModeIpc('worker-unresponsive');

    expect(() => drive('set-state', {}, { some: 'state' })).not.toThrow();
  });

  it('answers an rpc call with a failure envelope carrying its correlationId', () => {
    registerRecoveryModeIpc('worker-unresponsive');
    const send = jest.fn();

    drive(
      'rpc',
      { sender: { send, isDestroyed: () => false } },
      {
        type: 'rpc:call',
        payload: { method: 'license:getStatus', correlationId: 'abc-1' },
      },
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('to-renderer', {
      type: MESSAGE_TYPES.RPC_RESPONSE,
      correlationId: 'abc-1',
      success: false,
      error:
        'Ptah is in recovery mode and cannot serve requests (worker-unresponsive).',
      errorCode: 'state-storage-recovery-required',
    });
  });

  it('accepts the unwrapped envelope shape and the requestId alias', () => {
    registerRecoveryModeIpc('startup-failed');
    const send = jest.fn();

    drive(
      'rpc',
      { sender: { send, isDestroyed: () => false } },
      { method: 'workspace:getInfo', requestId: 'legacy-7' },
    );

    expect(send.mock.calls[0][1]).toMatchObject({ correlationId: 'legacy-7' });
  });

  it('stays silent for a fire-and-forget message with no correlationId', () => {
    registerRecoveryModeIpc('startup-failed');
    const send = jest.fn();

    drive(
      'rpc',
      { sender: { send, isDestroyed: () => false } },
      { type: MESSAGE_TYPES.SDK_PERMISSION_RESPONSE },
    );
    drive('rpc', { sender: { send } }, 'not-an-object');

    expect(send).not.toHaveBeenCalled();
  });

  it('does not send into a destroyed or absent sender', () => {
    registerRecoveryModeIpc('startup-failed');
    const send = jest.fn();

    drive(
      'rpc',
      { sender: { send, isDestroyed: () => true } },
      { payload: { correlationId: 'gone' } },
    );
    drive('rpc', { sender: undefined }, { payload: { correlationId: 'gone' } });

    expect(send).not.toHaveBeenCalled();
  });

  it('never displaces a live IpcBridge listener', () => {
    // A failure raised AFTER `IpcBridge.initialize()` (the WEBVIEW_MANAGER and
    // session-notifier throws later in bootstrap) must keep the real bridge.
    const bridge = jest.fn();
    ipcMainListeners.set('rpc', [bridge]);

    registerRecoveryModeIpc('startup-failed');

    expect(ipcMainListeners.get('rpc')).toEqual([bridge]);
    expect(ipcMainListeners.get('get-state') ?? []).toHaveLength(1);
  });
});

describe('main.ts recovery ordering', () => {
  // Source-order assertions: `main.ts` uses `import.meta` and is not importable
  // under ts-jest. This is the existing pattern for this file
  // (`startup-config-ipc.spec.ts`, `state-storage-readiness-gate.spec.ts`).
  const mainSource = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');

  it('registers the recovery responders on the bootstrap failure path', () => {
    const bootstrapCatch = mainSource.indexOf(
      "'[Ptah Electron] Workspace storage did not become ready:'",
    );
    const register = mainSource.indexOf('registerRecoveryModeIpc(');

    expect(bootstrapCatch).toBeGreaterThanOrEqual(0);
    expect(register).toBeGreaterThan(bootstrapCatch);
  });

  it('registers them BEFORE the recovery shell the user will interact with', () => {
    const register = mainSource.indexOf('registerRecoveryModeIpc(');
    const recoveryShellLoad = mainSource.indexOf(
      'loadFile(preparingShellPath, { query: startupShellQuery })',
    );

    expect(register).toBeGreaterThanOrEqual(0);
    expect(recoveryShellLoad).toBeGreaterThan(register);
  });

  it('pins the premise: the bridge registration is downstream of the failure', () => {
    // If `IpcBridge` ever moves ahead of the storage await in `bootstrap.ts`,
    // this responder becomes dead code and should be deleted, not kept.
    const bootstrapSource = readFileSync(
      join(__dirname, 'bootstrap.ts'),
      'utf8',
    );
    const storageWait = bootstrapSource.indexOf(
      'PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE',
    );
    const bridge = bootstrapSource.indexOf('new IpcBridge');

    expect(storageWait).toBeGreaterThanOrEqual(0);
    expect(bridge).toBeGreaterThan(storageWait);
  });
});
