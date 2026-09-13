/**
 * `ElectronStateStorage` — the two shapes it takes that the main suite skips.
 *
 * 1. The **synchronous v1 store** (no `workerOptions`), which is what the global
 *    store still is. Its sequence methods have a whole second implementation
 *    that never touches a worker, and none of it was covered.
 * 2. A **worker-backed store that failed to become ready**. Every accessor is
 *    supposed to refuse with the typed error `main.ts` renders as a recovery
 *    screen; an untyped throw there is how a recovery state becomes a blank
 *    window (TASK_2026_411).
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  StateStorageNotReadyError,
  StateStorageRecoveryRequiredError,
  type StateStorageSequenceWriteChunk,
} from '@ptah-extension/platform-core';
import { ElectronStateStorage } from './electron-state-storage';
import type {
  ElectronStateWorkerFactory,
  ElectronStateWorkerLike,
} from './electron-state-storage-worker-host';

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-state-degraded-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

/** A worker that answers `initialize` with the verdict the test asks for. */
function workerAnswering(
  reply: (operationId: number) => unknown,
): ElectronStateWorkerFactory {
  return () => {
    const messageListeners: Array<(value: unknown) => void> = [];
    const worker: ElectronStateWorkerLike = {
      postMessage(value: unknown) {
        const operationId = (value as { operationId: number }).operationId;
        queueMicrotask(() => {
          for (const listener of messageListeners) listener(reply(operationId));
        });
      },
      on(event: string, listener: (arg: never) => void) {
        if (event === 'message') {
          messageListeners.push(listener as (value: unknown) => void);
        }
        return worker;
      },
      unref: () => undefined,
      terminate: async () => 0,
    } as ElectronStateWorkerLike;
    return worker;
  };
}

async function chunks<T>(
  ...items: T[][]
): Promise<AsyncIterable<StateStorageSequenceWriteChunk<T>>> {
  return (async function* () {
    for (const batch of items) yield { items: batch };
  })();
}

describe('ElectronStateStorage — synchronous v1 store', () => {
  let provider: ElectronStateStorage;

  beforeEach(async () => {
    provider = new ElectronStateStorage(await makeTempDir(), 'state.json');
  });

  it('reads a stored array back as one complete sequence page', async () => {
    await provider.update('list', [1, 2, 3]);

    const pages = [];
    for await (const page of provider.readJsonSequence<number>('list')) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      items: [1, 2, 3],
      nextCursor: null,
      done: true,
    });
    expect(pages[0].approximateBytes).toBeGreaterThan(0);
  });

  it('reads an absent key as an empty sequence rather than throwing', async () => {
    for await (const page of provider.readJsonSequence('never-written')) {
      expect(page).toMatchObject({ items: [], done: true });
    }
  });

  it('refuses to read a non-array value as a sequence', async () => {
    await provider.update('scalar', 'text');

    await expect(async () => {
      for await (const _page of provider.readJsonSequence('scalar')) {
        // The throw happens before the first page is produced.
      }
    }).rejects.toThrow('is not a JSON sequence');
  });

  it('replaceJsonSequence collapses every chunk into one stored array', async () => {
    await provider.replaceJsonSequence('list', await chunks([1, 2], [3]));

    expect(provider.get<number[]>('list')).toEqual([1, 2, 3]);
  });

  it('refuses splitArrayValue — it needs the worker-backed store', async () => {
    await expect(
      provider.splitArrayValue({
        kind: 'split-array-value',
        planVersion: 1,
        sourceKey: 'list',
        itemIdPath: ['id'],
        detailKeyPrefix: 'item:',
        indexKey: 'list.index',
        indexSchemaVersion: 1,
        summaryFields: [{ sourcePath: ['id'] }],
      }),
    ).rejects.toThrow('requires worker-backed state storage');
  });

  it('getAsync falls through to the synchronous read, default included', async () => {
    await provider.update('present', 'yes');

    await expect(provider.getAsync('present')).resolves.toBe('yes');
    await expect(provider.getAsync('absent', 'fallback')).resolves.toBe(
      'fallback',
    );
  });

  it('dispose is a no-op when there is no worker to tear down', async () => {
    await expect(provider.dispose()).resolves.toBeUndefined();
  });
});

describe('ElectronStateStorage — worker-backed store that never became ready', () => {
  it('reports recovery-required and refuses reads with the typed error', async () => {
    const storage = await makeTempDir();
    const provider = new ElectronStateStorage(storage, 'state.json', {
      workerPath: '/unused.mjs',
      workerFactory: workerAnswering((operationId) => ({
        type: 'failure',
        operationId,
        code: 'recovery-required',
        recoveryReason: 'migration-failed',
      })),
    });

    await expect(provider.whenReady()).rejects.toBeInstanceOf(
      StateStorageRecoveryRequiredError,
    );
    expect(provider.getReadinessState()).toEqual({
      status: 'recovery-required',
      reason: 'migration-failed',
    });
    // `main.ts` branches on this exact type to paint the recovery shell.
    expect(() => provider.get('anything')).toThrow(
      StateStorageRecoveryRequiredError,
    );
    expect(() => provider.keys()).toThrow(StateStorageRecoveryRequiredError);

    // Disposed even though the store never became ready: the host still holds a
    // worker handle and a handshake timer, and leaving them alive is what makes
    // a suite leak into whatever Jest runs next.
    await provider.dispose();
  });

  it('refuses reads with not-ready while the handshake is still outstanding', async () => {
    const storage = await makeTempDir();
    const provider = new ElectronStateStorage(storage, 'state.json', {
      // A worker that never answers: readiness stays `not-ready`.
      workerFactory: () =>
        ({
          postMessage: () => undefined,
          on() {
            return this as ElectronStateWorkerLike;
          },
          unref: () => undefined,
          terminate: async () => 0,
        }) as unknown as ElectronStateWorkerLike,
      workerPath: '/unused.mjs',
    });

    expect(provider.getReadinessState()).toEqual({ status: 'not-ready' });
    expect(() => provider.get('anything')).toThrow(StateStorageNotReadyError);
    // `updateSync` has no async counterpart in worker mode — it must say so
    // rather than silently writing the v1 file beside the v2 generation store.
    expect(() => provider.updateSync('k', 1)).toThrow(
      'updateSync is unavailable for worker-backed workspace storage',
    );

    await provider.dispose();
  });
});
