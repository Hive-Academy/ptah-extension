/**
 * ElectronWebviewManagerAdapter — truthful delivery (TASK_2026_538 Batch 2).
 *
 * The adapter is the seam between backend push services and the IpcBridge:
 * `getActiveWebviews()` must report only the surfaces that can actually
 * receive an event (the single BrowserWindow renderer, only while it is
 * alive), and `sendMessage()` must report what really happened instead of
 * hard-coding `true`. `createDashboardBroadcast` reads these two answers to
 * decide between `delivered`, `no-surface` and `failed`.
 */

import { MESSAGE_TYPES, type SurfaceUpdatedPayload } from '@ptah-extension/shared';
import {
  createDashboardBroadcast,
  type DashboardSurfaceHost,
} from '@ptah-extension/vscode-lm-tools';

import type { IpcBridge } from './ipc-bridge';
import { ElectronWebviewManagerAdapter } from './webview-manager-adapter';

/**
 * The slice of IpcBridge the adapter touches. Cast into IpcBridge in the
 * factory: importing the real class would drag the `electron` module in, and
 * the adapter never uses anything beyond these two methods.
 */
interface IpcBridgeFake {
  hasLiveRenderer(): boolean;
  sendToRenderer(message: unknown): boolean;
}

function makeAdapter(fake: IpcBridgeFake): ElectronWebviewManagerAdapter {
  return new ElectronWebviewManagerAdapter(fake as unknown as IpcBridge);
}

describe('ElectronWebviewManagerAdapter — getActiveWebviews', () => {
  it('reports the main renderer as the only surface when the window is live', () => {
    const adapter = makeAdapter({
      hasLiveRenderer: jest.fn(() => true),
      sendToRenderer: jest.fn(() => true),
    });

    expect(adapter.getActiveWebviews()).toEqual(['ptah.main']);
  });

  it('reports no surfaces when there is no window', () => {
    const adapter = makeAdapter({
      hasLiveRenderer: jest.fn(() => false),
      sendToRenderer: jest.fn(() => true),
    });

    expect(adapter.getActiveWebviews()).toEqual([]);
  });

  it('reports no surfaces once the window is destroyed between enumeration and send', () => {
    // Simulates the destroy race: the first enumeration still sees a live
    // window, but by the time the push happens the renderer is gone. The
    // honest answer for the caller is an empty surface list and a false send.
    const fake: IpcBridgeFake = {
      hasLiveRenderer: jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValue(false),
      sendToRenderer: jest.fn(() => false),
    };
    const adapter = makeAdapter(fake);

    expect(adapter.getActiveWebviews()).toEqual(['ptah.main']);
    expect(adapter.getActiveWebviews()).toEqual([]);
  });
});

describe('ElectronWebviewManagerAdapter — sendMessage', () => {
  const TYPE = 'chat:chunk';
  const PAYLOAD = { i: 0 };

  it('returns true and forwards the payload when the bridge delivers', async () => {
    const fake: IpcBridgeFake = {
      hasLiveRenderer: jest.fn(() => true),
      sendToRenderer: jest.fn(() => true),
    };
    const adapter = makeAdapter(fake);

    await expect(adapter.sendMessage('any-view', TYPE, PAYLOAD)).resolves.toBe(
      true,
    );
    expect(fake.sendToRenderer).toHaveBeenCalledWith({ type: TYPE, payload: PAYLOAD });
  });

  it('returns false when sendToRenderer drops the message (destroyed window)', async () => {
    const adapter = makeAdapter({
      hasLiveRenderer: jest.fn(() => true),
      sendToRenderer: jest.fn(() => false),
    });

    await expect(adapter.sendMessage('any-view', TYPE, PAYLOAD)).resolves.toBe(
      false,
    );
  });

  it('returns false instead of rejecting when the bridge throws', async () => {
    const adapter = makeAdapter({
      hasLiveRenderer: jest.fn(() => true),
      sendToRenderer: jest.fn(() => {
        throw new Error('Object has been destroyed');
      }),
    });

    await expect(adapter.sendMessage('any-view', TYPE, PAYLOAD)).resolves.toBe(
      false,
    );
  });
});

/**
 * TASK_2026_538 Batch 14, Task 14.1 (R7): the adapter through the real
 * `createDashboardBroadcast`, not a re-implementation of it. Batch 2 proved
 * the adapter's own booleans; this proves the three delivery outcomes the
 * broadcast derives from them once the vscode-lm-tools barrel export (Task
 * 8.4) made `createDashboardBroadcast` and `DashboardSurfaceHost` reachable
 * from a host app.
 */
describe('ElectronWebviewManagerAdapter — through createDashboardBroadcast (TASK_2026_538 Batch 14, R7)', () => {
  const PAYLOAD: SurfaceUpdatedPayload = {
    routingId: 'tab-1',
    surfaceId: 'profile',
    revision: 3,
    origin: 'agent',
    change: { kind: 'deleted', reason: 'agent-deleted' },
  };

  it('delivers to the one live renderer and forwards the payload untouched', async () => {
    const fake: IpcBridgeFake = {
      hasLiveRenderer: jest.fn(() => true),
      sendToRenderer: jest.fn(() => true),
    };
    const adapter = makeAdapter(fake);
    const broadcast = createDashboardBroadcast(
      () => adapter,
      { debug: jest.fn() },
    );

    await expect(
      broadcast(MESSAGE_TYPES.SURFACE_UPDATED, PAYLOAD),
    ).resolves.toEqual({ status: 'delivered', surfaces: 1 });
    expect(fake.sendToRenderer).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.SURFACE_UPDATED,
      payload: PAYLOAD,
    });
  });

  it('reports no-surface — a success — when there is no window', async () => {
    const adapter = makeAdapter({
      hasLiveRenderer: jest.fn(() => false),
      sendToRenderer: jest.fn(() => true),
    });
    const broadcast = createDashboardBroadcast(
      () => adapter,
      { debug: jest.fn() },
    );

    await expect(
      broadcast(MESSAGE_TYPES.SURFACE_UPDATED, PAYLOAD),
    ).resolves.toEqual({ status: 'no-surface' });
  });

  it('reports failed, never delivered, when a live surface refuses the send', async () => {
    // enumeration sees a live window (surfaces.length === 1), so the broadcast
    // attempts the send; the send itself is the one that fails. This is the
    // "destroyed between enumeration and send" case at the broadcast level —
    // Task 14.1's own unit case above pins it on the adapter directly.
    const adapter = makeAdapter({
      hasLiveRenderer: jest.fn(() => true),
      sendToRenderer: jest.fn(() => false),
    });
    const broadcast = createDashboardBroadcast(
      () => adapter,
      { debug: jest.fn() },
    );

    await expect(
      broadcast(MESSAGE_TYPES.SURFACE_UPDATED, PAYLOAD),
    ).resolves.toEqual({
      status: 'failed',
      delivered: 0,
      surfaces: 1,
      reason: '1 of 1 attached surface(s) did not accept the spec',
    });
  });

  it('type-checks as a DashboardSurfaceHost (Req 11.4)', () => {
    const fake: IpcBridgeFake = {
      hasLiveRenderer: jest.fn(() => true),
      sendToRenderer: jest.fn(() => true),
    };
    const adapter = makeAdapter(fake);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time only
    const asHost: DashboardSurfaceHost = adapter;
    expect(asHost).toBe(adapter);
  });
});