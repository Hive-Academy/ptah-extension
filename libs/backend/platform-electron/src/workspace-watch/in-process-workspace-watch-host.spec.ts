/**
 * The `PTAH_WATCH_HOST=0` hatch speaks the host protocol asynchronously in
 * both directions and reports an engine that cannot load as `fatal`, which the
 * adapter supervises like any crashed host.
 */
import {
  parseWorkspaceWatchHostOutbound,
  type WorkspaceWatchEngine,
  type WorkspaceWatchEngineCallback,
  type WorkspaceWatchHostOutbound,
} from '@ptah-extension/platform-core';

import { ElectronWorkspaceWatcher } from './electron-workspace-watcher';
import { createInProcessWorkspaceWatchHostForker } from './in-process-workspace-watch-host';

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function flushTimes(times: number): Promise<void> {
  for (let i = 0; i < times; i++) await flush();
}

function fakeEngine() {
  const callbacks: WorkspaceWatchEngineCallback[] = [];
  const unsubscribe = jest.fn(async () => undefined);
  const engine: WorkspaceWatchEngine = {
    subscribe: jest.fn(async (_dir, callback) => {
      callbacks.push(callback);
      return { unsubscribe };
    }),
  };
  return { engine, callbacks, unsubscribe };
}

describe('in-process workspace watch host', () => {
  it('heartbeats, subscribes and posts batches without delivering synchronously', async () => {
    const { engine, callbacks, unsubscribe } = fakeEngine();
    const host = createInProcessWorkspaceWatchHostForker({
      loadEngine: () => engine,
      env: {},
    }).fork();
    const received: WorkspaceWatchHostOutbound[] = [];
    host.on('message', (raw) => {
      const parsed = parseWorkspaceWatchHostOutbound(raw);
      if (parsed) received.push(parsed);
    });

    expect(received).toHaveLength(0);
    await flush();
    expect(received[0]).toEqual(expect.objectContaining({ type: 'heartbeat' }));

    host.postMessage({
      type: 'subscribe',
      id: 1,
      root: '/repo',
      options: {
        excludeGlobs: [],
        excludeDirNames: [],
        excludeSegmentRules: [],
        nestedRepoDetection: false,
      },
    });
    expect(engine.subscribe).not.toHaveBeenCalled();
    await flushTimes(3);
    expect(engine.subscribe).toHaveBeenCalledTimes(1);

    callbacks[0](null, [{ path: '/repo/a.ts', type: 'create' }]);
    // The coalescer holds the first batch after quiet for the 250 ms interval.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flush();
    expect(received).toContainEqual(
      expect.objectContaining({
        type: 'batch',
        id: 1,
        changes: [{ path: '/repo/a.ts', kind: 'create' }],
      }),
    );

    const exit = jest.fn();
    host.on('exit', exit);
    host.kill();
    host.kill();
    host.postMessage({ type: 'unsubscribe', id: 1 });
    await flushTimes(3);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(null);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('reports an engine that fails to load as fatal, which the adapter supervises', async () => {
    const forker = createInProcessWorkspaceWatchHostForker({
      loadEngine: () => {
        throw new Error('Cannot find module @parcel/watcher-win32-x64');
      },
    });
    const host = forker.fork();
    const received: unknown[] = [];
    host.on('message', (message) => received.push(message));
    await flush();
    expect(received).toEqual([
      {
        type: 'fatal',
        message:
          'watch engine failed to load: Cannot find module @parcel/watcher-win32-x64',
      },
    ]);
    host.kill();

    const diagnostics: string[] = [];
    const watcher = new ElectronWorkspaceWatcher({
      host: forker,
      supervision: { restartBudget: 0 },
      onDiagnostic: (d) => diagnostics.push(d.message),
    });
    watcher.watch(
      '/repo',
      {
        excludeGlobs: [],
        excludeDirNames: [],
        excludeSegmentRules: [],
        nestedRepoDetection: false,
      },
      () => undefined,
    );
    await flushTimes(2);
    expect(watcher.isDegraded).toBe(true);
    expect(diagnostics).toContain('[WorkspaceWatcher] host degraded');
    watcher.dispose();
  });
});
