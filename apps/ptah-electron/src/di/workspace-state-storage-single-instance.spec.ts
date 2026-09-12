/**
 * The Electron host must construct EXACTLY ONE worker-backed workspace state
 * storage per launch (TASK_2026_411).
 *
 * Phase 0 registers `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` and phase 1
 * overrides it with the authoritative `WorkspaceAwareStateStorage` — the only
 * one carrying `migrations` and `cacheExcludeKeyPrefixes`. Both resolve the
 * SAME default directory (`<userData>/workspace-storage/default`) whenever the
 * launch has no workspace argument, which is every e2e launch and every fresh
 * profile. While phase 0 built its store eagerly, the two workers raced on one
 * v2 commit root and the boot's readiness gate hung behind the loser.
 *
 * This runs the REAL phase functions against a mocked `node:worker_threads` and
 * counts constructions, so it fails on the defect rather than on a restatement
 * of the fix: with an eager phase-0 registration the count is 2.
 */

import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

/** One entry per `new Worker(...)`, in construction order. */
const mockWorkerPaths: string[] = [];

jest.mock('node:worker_threads', () => ({
  Worker: class MockWorker {
    constructor(workerPath: string) {
      mockWorkerPaths.push(workerPath);
    }
    postMessage(): void {
      /* silent: this spec counts constructions, it never awaits readiness */
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
import { registerPhase0Platform } from './phase-0-platform';
import { registerPhase1Infra } from './phase-1-infra';

const WORKER_PATH = '/fake/state-storage-worker.mjs';

/**
 * The worker host reaches `new Worker(...)` one microtask after the store is
 * constructed. Counts taken synchronously read zero even for the eager
 * two-worker wiring this spec exists to catch, so always flush first.
 */
function flushWorkerConstruction(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Electron DI — one workspace state storage worker per launch', () => {
  let container: DependencyContainer;

  beforeEach(() => {
    mockWorkerPaths.length = 0;
    container = rootContainer.createChildContainer();
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('constructs exactly one worker across phase 0 and phase 1', async () => {
    const userDataPath = path.join(os.tmpdir(), `ptah-di-${Date.now()}`);
    const options = {
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
      // No `initialFolders` — the fresh-launch / e2e case, where phase 0 and
      // phase 1 both resolve to `<userData>/workspace-storage/default`.
      stateStorageWorkerPath: WORKER_PATH,
    };

    const { logger } = registerPhase0Platform(container, options);
    registerPhase1Infra(container, options, logger);

    await flushWorkerConstruction();

    expect(mockWorkerPaths).toEqual([WORKER_PATH]);
  });

  it('leaves the authoritative host store registered under the token', async () => {
    const userDataPath = path.join(os.tmpdir(), `ptah-di-${Date.now()}-b`);
    const options = {
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

    const { logger } = registerPhase0Platform(container, options);
    registerPhase1Infra(container, options, logger);

    // Phase 3 (`registerStateStorageAdapters`) and every RPC handler resolve
    // this token; it must still answer, and with the workspace-aware store.
    const resolved = container.resolve(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE);

    expect(resolved).toBeDefined();
    expect(
      typeof (resolved as { setActiveWorkspace?: unknown }).setActiveWorkspace,
    ).toBe('function');

    await flushWorkerConstruction();
    // Resolving did not mint a second worker.
    expect(mockWorkerPaths).toEqual([WORKER_PATH]);
  });
});
