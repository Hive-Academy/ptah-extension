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