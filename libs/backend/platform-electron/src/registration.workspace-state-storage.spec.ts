/**
 * `registerPlatformElectronServices` must not spawn a state-storage worker that
 * the host is about to replace.
 *
 * The coverage hole this closes (TASK_2026_411): every other worker-host spec
 * injects a fake `workerFactory`, so the DEFAULT factory — the one that calls
 * `new Worker(workerPath)` — had no test at all, and the only spec touching the
 * real artifact is opt-in behind `PTAH_PERF_SPECS=1`. Nothing counted worker
 * CONSTRUCTIONS, so a registration that eagerly built a second worker over the
 * same commit root as the host's own store was invisible until the Electron
 * e2e suite timed out.
 *
 * These assertions run in ordinary CI and are about construction COUNTS, which
 * is why `node:worker_threads` is mocked rather than a `workerFactory` injected:
 * injecting a factory would re-open the same hole by bypassing the default path.
 */

import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

/** Records one entry per `new Worker(...)`, in construction order. */
const mockWorkerPaths: string[] = [];

jest.mock('node:worker_threads', () => ({
  Worker: class MockWorker {
    constructor(workerPath: string) {
      mockWorkerPaths.push(workerPath);
    }
    postMessage(): void {
      /* deliberately silent — these specs never await readiness */
    }
    on(): this {
      return this;
    }
    unref(): void {
      /* no-op */
    }
    async terminate(): Promise<number> {
      return 0;
    }
  },
}));

// Imported AFTER the mock so the worker host closes over the fake `Worker`.
import { registerPlatformElectronServices } from './registration';
import { ElectronStateStorage } from './implementations/electron-state-storage';

const WORKER_PATH = '/fake/state-storage-worker.mjs';

/**
 * `ElectronStateStorage`'s constructor starts the worker host, but the host
 * reaches `new Worker(...)` through its promise request-chain — one microtask
 * later. Every count below MUST be taken after this flush: asserted
 * synchronously, they read zero even for an eagerly-constructed store, and the
 * regression these specs exist for would sail through.
 */
function flushWorkerConstruction(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeOptions(userDataPath: string) {
  return {
    appPath: userDataPath,
    userDataPath,
    logsPath: path.join(userDataPath, 'logs'),
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
    dialog: {} as never,
    getWindow: () => null,
    stateStorageWorkerPath: WORKER_PATH,
  };
}

describe('registerPlatformElectronServices — workspace state storage', () => {
  let container: DependencyContainer;
  let userDataPath: string;

  beforeEach(() => {
    mockWorkerPaths.length = 0;
    container = rootContainer.createChildContainer();
    userDataPath = path.join(os.tmpdir(), `ptah-reg-${Date.now()}`);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('spawns NO worker at registration time', async () => {
    registerPlatformElectronServices(container, makeOptions(userDataPath));

    await flushWorkerConstruction();

    // The regression: this used to be 1 — a worker owning
    // `<userData>/workspace-storage/default` before the host had any say.
    expect(mockWorkerPaths).toEqual([]);
  });

  it('builds exactly one worker-backed store, memoized across resolves', async () => {
    registerPlatformElectronServices(container, makeOptions(userDataPath));

    const first = container.resolve<ElectronStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    const second = container.resolve<ElectronStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );

    await flushWorkerConstruction();

    // Reference identity, not structural equality: a per-resolve factory would
    // hand every consumer its own worker over one commit root, which is the
    // same defect in a different disguise.
    expect(first).toBe(second);
    expect(mockWorkerPaths).toEqual([WORKER_PATH]);

    await first.dispose();
  });

  it('spawns no worker when the host overrides the token before resolving', async () => {
    registerPlatformElectronServices(container, makeOptions(userDataPath));

    // Exactly what `apps/ptah-electron/src/di/phase-1-infra.ts` does: replace
    // the registration with the authoritative store (the one carrying
    // `migrations` and `cacheExcludeKeyPrefixes`) before anything resolves it.
    const hostOwned = { get: jest.fn(), update: jest.fn(), keys: jest.fn() };
    container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      useValue: hostOwned,
    });

    expect(container.resolve(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE)).toBe(
      hostOwned,
    );

    await flushWorkerConstruction();
    expect(mockWorkerPaths).toEqual([]);
  });
});
