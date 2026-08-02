/**
 * The bridge is the only thing standing between an RPC call and a promise
 * that never settles, so its non-happy paths matter more than its happy one.
 */

import { TuiFilePickerBridge } from './tui-file-picker-bridge.js';

describe('TuiFilePickerBridge', () => {
  it('settles with what the subscriber selected', async () => {
    const bridge = new TuiFilePickerBridge();
    bridge.subscribe((request) => request.resolve(['/a.ts', '/b.ts']));

    await expect(bridge.pickFiles({ multiple: true })).resolves.toEqual([
      '/a.ts',
      '/b.ts',
    ]);
  });

  it('forwards the multiple flag to the subscriber', async () => {
    const bridge = new TuiFilePickerBridge();
    const seen: boolean[] = [];
    bridge.subscribe((request) => {
      seen.push(request.multiple);
      request.resolve([]);
    });

    await bridge.pickFiles({ multiple: false });
    await bridge.pickFiles({ multiple: true });
    expect(seen).toEqual([false, true]);
  });

  it('resolves empty when nothing is subscribed rather than hanging', async () => {
    const bridge = new TuiFilePickerBridge();

    await expect(bridge.pickFiles({ multiple: true })).resolves.toEqual([]);
  });

  it('resolves empty after the subscriber unmounts', async () => {
    const bridge = new TuiFilePickerBridge();
    const unsubscribe = bridge.subscribe((request) => request.resolve(['/x']));
    unsubscribe();

    await expect(bridge.pickFiles({ multiple: true })).resolves.toEqual([]);
  });

  it('ignores a second resolve for the same request', async () => {
    const bridge = new TuiFilePickerBridge();
    bridge.subscribe((request) => {
      request.resolve(['/first']);
      request.resolve(['/second']);
    });

    await expect(bridge.pickFiles({ multiple: true })).resolves.toEqual([
      '/first',
    ]);
  });

  it('routes to the latest subscriber', async () => {
    const bridge = new TuiFilePickerBridge();
    bridge.subscribe((request) => request.resolve(['/old']));
    bridge.subscribe((request) => request.resolve(['/new']));

    await expect(bridge.pickFiles({ multiple: true })).resolves.toEqual([
      '/new',
    ]);
  });
});
