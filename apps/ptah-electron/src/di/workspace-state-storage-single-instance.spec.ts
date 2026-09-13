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

let mockWorkerReply:
  | ((request: Record<string, unknown>) => unknown | undefined)
  | null = null;

jest.mock('node:worker_threads', () => ({
  Worker: class MockWorker {
    private readonly messageListeners: Array<(value: unknown) => void> = [];

    constructor(workerPath: string) {
      mockWorkerPaths.push(workerPath);
    }
    postMessage(value: unknown): void {
      const reply = mockWorkerReply;
      if (!reply) return;
      queueMicrotask(() => {
        const response = reply(value as Record<string, unknown>);
        if (response === undefined) return;
        for (const listener of this.messageListeners) listener(response);
      });
    }
    on(event: string, listener: (value: unknown) => void): this {
      if (event === 'message') this.messageListeners.push(listener);
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
    mockWorkerReply = null;
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

  describe('split receipt logging at ready', () => {
    const receiptBase = {
      sourceKey: 'ptah.sessionMetadata',
      sourceSha256: 'a'.repeat(64),
      itemCount: 3,
      extractedValueCount: 5,
      droppedStdoutCount: 0,
      stdoutFallbackCount: 1,
      droppedBulkWithoutIdCount: 0,
      skippedItemCount: 0,
      committedGeneration: 2,
      commitId: '00000000-0000-4000-8000-000000000001',
    };

    function scriptReady(receipts: readonly Record<string, unknown>[]): void {
      mockWorkerReply = (request) => {
        const operationId = request['operationId'];
        if (request['type'] === 'initialize') {
          return {
            type: 'ready',
            operationId,
            generation: 2,
            mutationEpoch: 0,
            migrationReceipts: receipts,
          };
        }
        if (request['type'] === 'read-snapshot-page') {
          return {
            type: 'snapshot-page',
            operationId,
            operations: [],
            nextCursor: null,
            done: true,
            approximateBytes: 2,
          };
        }
        return { type: 'success', operationId };
      };
    }

    async function bootToReady(suffix: string) {
      const userDataPath = path.join(
        os.tmpdir(),
        `ptah-di-${Date.now()}-${suffix}`,
      );
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
      const info = jest.spyOn(logger, 'info');
      const warn = jest.spyOn(logger, 'warn');
      registerPhase1Infra(container, options, logger);
      const storage = container.resolve<{ whenReady(): Promise<void> }>(
        PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
      );
      await storage.whenReady();
      return { info, warn };
    }

    function receiptCalls(spy: jest.SpyInstance): unknown[][] {
      return spy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].startsWith('[Electron DI] Workspace state split'),
      );
    }

    it('logs one info line with counters only when nothing was dropped', async () => {
      scriptReady([receiptBase]);

      const { info, warn } = await bootToReady('receipt-info');

      expect(receiptCalls(warn)).toEqual([]);
      expect(receiptCalls(info)).toEqual([
        [
          '[Electron DI] Workspace state split completed',
          {
            sourceKey: 'ptah.sessionMetadata',
            committedGeneration: 2,
            itemCount: 3,
            extractedValueCount: 5,
            droppedStdoutCount: 0,
            stdoutFallbackCount: 1,
            droppedBulkWithoutIdCount: 0,
            skippedItemCount: 0,
          },
        ],
      ]);
      expect(mockWorkerPaths).toEqual([WORKER_PATH]);
    });

    it('logs one warn line with counters when values were dropped or skipped', async () => {
      scriptReady([
        {
          ...receiptBase,
          droppedStdoutCount: 28,
          droppedBulkWithoutIdCount: 1,
          skippedItemCount: 1,
        },
      ]);

      const { info, warn } = await bootToReady('receipt-warn');

      expect(receiptCalls(info)).toEqual([]);
      expect(receiptCalls(warn)).toEqual([
        [
          '[Electron DI] Workspace state split dropped or skipped values',
          {
            sourceKey: 'ptah.sessionMetadata',
            committedGeneration: 2,
            itemCount: 3,
            extractedValueCount: 5,
            droppedStdoutCount: 28,
            stdoutFallbackCount: 1,
            droppedBulkWithoutIdCount: 1,
            skippedItemCount: 1,
          },
        ],
      ]);
      expect(mockWorkerPaths).toEqual([WORKER_PATH]);
    });

    it('logs nothing when the ready handshake carries no receipt', async () => {
      scriptReady([]);

      const { info, warn } = await bootToReady('receipt-none');

      expect(receiptCalls(info)).toEqual([]);
      expect(receiptCalls(warn)).toEqual([]);
    });
  });
});
