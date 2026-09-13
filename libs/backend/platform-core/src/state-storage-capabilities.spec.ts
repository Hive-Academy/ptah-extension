import type { IStateStorage } from './interfaces/state-storage.interface';
import { isAsyncStateStorage } from './interfaces/async-state-storage.interface';
import { hasStateStorageReadiness } from './interfaces/state-storage-readiness.interface';
import { hasStateStorageMaintenance } from './interfaces/state-storage-maintenance.interface';
import {
  StateStorageNotReadyError,
  StateStorageRecoveryRequiredError,
} from './state-storage-errors';

const baseStorage: IStateStorage = {
  get: () => undefined,
  update: async () => undefined,
  keys: () => [],
};

describe('optional state-storage capabilities', () => {
  it('requires every async method before accepting the async capability', () => {
    const asyncStorage = {
      ...baseStorage,
      getAsync: async () => undefined,
      readJsonSequence: async function* () {
        yield { items: [], nextCursor: null, done: true, approximateBytes: 0 };
      },
      replaceJsonSequence: async () => undefined,
    };

    expect(isAsyncStateStorage(baseStorage)).toBe(false);
    expect(isAsyncStateStorage(asyncStorage)).toBe(true);
  });

  it('detects readiness and maintenance structurally', () => {
    const readinessStorage = {
      ...baseStorage,
      getReadinessState: () => ({ status: 'ready' as const }),
      whenReady: async () => undefined,
    };
    const maintenanceStorage = {
      ...baseStorage,
      splitArrayValue: async () => ({
        sourceKey: 'source',
        sourceSha256: 'a'.repeat(64),
        itemCount: 0,
        extractedValueCount: 0,
        retainedSourceCount: 0,
        committedGeneration: 1,
        commitId: '018f55cb-3f18-7d5e-a1a4-000000000001',
      }),
    };

    expect(hasStateStorageReadiness(readinessStorage)).toBe(true);
    expect(hasStateStorageMaintenance(maintenanceStorage)).toBe(true);
  });

  it('exposes stable typed error codes without state contents', () => {
    const notReady = new StateStorageNotReadyError();
    const recovery = new StateStorageRecoveryRequiredError('manifest-invalid');

    expect(notReady).toMatchObject({
      name: 'StateStorageNotReadyError',
      code: 'STATE_STORAGE_NOT_READY',
    });
    expect(recovery).toMatchObject({
      name: 'StateStorageRecoveryRequiredError',
      code: 'STATE_STORAGE_RECOVERY_REQUIRED',
      reason: 'manifest-invalid',
    });
  });
});
