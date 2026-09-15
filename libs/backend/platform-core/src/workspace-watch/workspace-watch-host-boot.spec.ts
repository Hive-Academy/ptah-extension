/**
 * `bootWorkspaceWatchHost` / `toWorkspaceWatchEngine` — the part every watch
 * host entry shares once its transport is bound (TASK_2026_437 C8, C9). The
 * entries themselves run for real in the Electron and CLI adapter specs.
 */
import type { WorkspaceWatchEngine } from './workspace-watch-host-core';
import {
  bootWorkspaceWatchHost,
  toWorkspaceWatchEngine,
} from './workspace-watch-host-boot';
import type { WorkspaceWatchHostOutbound } from './workspace-watch-protocol';

describe('toWorkspaceWatchEngine', () => {
  it('rejects a module without subscribe()', () => {
    for (const module of [undefined, null, {}, { subscribe: 'no' }]) {
      expect(() => toWorkspaceWatchEngine(module)).toThrow(
        '@parcel/watcher did not export subscribe()',
      );
    }
  });

  it('forwards subscribe with its receiver intact', async () => {
    const unsubscribe = jest.fn(async () => undefined);
    const module = {
      calls: [] as unknown[][],
      async subscribe(this: { calls: unknown[][] }, ...args: unknown[]) {
        this.calls.push(args);
        return { unsubscribe };
      },
    };
    const engine = toWorkspaceWatchEngine(module);
    const callback = jest.fn();
    const subscription = await engine.subscribe('/repo', callback, {
      ignore: ['node_modules'],
    });
    expect(module.calls).toEqual([
      ['/repo', callback, { ignore: ['node_modules'] }],
    ]);
    expect(subscription.unsubscribe).toBe(unsubscribe);
  });
});

describe('bootWorkspaceWatchHost', () => {
  it('posts one clipped fatal and returns undefined when the engine cannot load', () => {
    const posted: WorkspaceWatchHostOutbound[] = [];
    const core = bootWorkspaceWatchHost({
      post: (message) => posted.push(message),
      loadEngine: () => {
        throw new Error(`Cannot find module ${'x'.repeat(5_000)}`);
      },
      env: {},
    });

    expect(core).toBeUndefined();
    expect(posted).toHaveLength(1);
    const [fatal] = posted;
    expect(fatal.type).toBe('fatal');
    if (fatal.type !== 'fatal') return;
    expect(
      fatal.message.startsWith('watch engine failed to load: Cannot find'),
    ).toBe(true);
    expect(fatal.message.length).toBeLessThanOrEqual(2_048);
  });

  it('starts a core that heartbeats and handles inbound messages', async () => {
    const engine: WorkspaceWatchEngine = {
      subscribe: jest.fn(async () => ({ unsubscribe: async () => undefined })),
    };
    const posted: WorkspaceWatchHostOutbound[] = [];
    const core = bootWorkspaceWatchHost({
      post: (message) => posted.push(message),
      loadEngine: () => engine,
      env: {},
    });

    expect(core).toBeDefined();
    expect(posted[0]).toEqual({
      type: 'heartbeat',
      seq: 0,
      subscriptions: 0,
      eventsPerSec: 0,
    });
    core?.handleMessage({ type: 'subscribe' });
    expect(posted).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'invalid-message' }),
    );
    await core?.dispose();
  });
});
