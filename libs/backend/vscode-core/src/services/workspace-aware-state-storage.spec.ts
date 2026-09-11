import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  StateStorageNotReadyError,
  hasStateStorageMaintenance,
  type IStateStorageMaintenance,
  type IStateStorageReadiness,
  type StateStorageArraySplitPlan,
  type StateStorageMigrationReceipt,
  type StateStorageReadinessState,
} from '@ptah-extension/platform-core';
import { WorkspaceAwareStateStorage } from './workspace-aware-state-storage';
import { WorkspaceContextManager } from './workspace-context-manager';

class ControlledStorage implements IStateStorageReadiness {
  private readonly data = new Map<string, unknown>();
  private state: StateStorageReadinessState;
  private resolveReady: (() => void) | null = null;
  private readonly ready: Promise<void>;

  constructor(isReady: boolean, entries: Record<string, unknown> = {}) {
    this.state = isReady ? { status: 'ready' } : { status: 'not-ready' };
    for (const [key, value] of Object.entries(entries))
      this.data.set(key, value);
    this.ready = isReady
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          this.resolveReady = resolve;
        });
  }

  markReady(): void {
    this.state = { status: 'ready' };
    this.resolveReady?.();
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.state.status !== 'ready') throw new StateStorageNotReadyError();
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (this.state.status !== 'ready') throw new StateStorageNotReadyError();
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }

  keys(): readonly string[] {
    if (this.state.status !== 'ready') throw new StateStorageNotReadyError();
    return [...this.data.keys()];
  }

  getReadinessState(): StateStorageReadinessState {
    return this.state;
  }

  async whenReady(): Promise<void> {
    await this.ready;
  }
}

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('WorkspaceAwareStateStorage readiness routing', () => {
  it('does not publish an unready delegate or fall back from it to default', async () => {
    const storages = new Map<string, ControlledStorage>();
    const proxy = new WorkspaceAwareStateStorage('/default', (storagePath) => {
      const storage = new ControlledStorage(storagePath === '/default', {
        source: storagePath,
      });
      storages.set(storagePath, storage);
      return storage;
    });
    proxy.addWorkspace('/workspace-a', '/storage-a');

    expect(() => proxy.setActiveWorkspace('/workspace-a')).toThrow(
      StateStorageNotReadyError,
    );
    expect(proxy.get('source')).toBe('/default');
    expect(proxy.getActiveWorkspacePath()).toBeNull();

    storages.get('/storage-a')?.markReady();
    await proxy.whenWorkspaceReady('/workspace-a');
    proxy.setActiveWorkspace('/workspace-a');
    expect(proxy.get('source')).toBe('/storage-a');
  });

  it('keeps the old workspace active until an async switch is ready', async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ptah-workspace-switch-'),
    );
    tmpDirs.push(root);
    const workspaceA = path.join(root, 'a');
    const workspaceB = path.join(root, 'b');
    await fs.mkdir(workspaceA);
    await fs.mkdir(workspaceB);

    const proxy = new WorkspaceAwareStateStorage(
      path.join(root, 'default-storage'),
      (storagePath) => {
        const storage = new ControlledStorage(
          storagePath.endsWith('default-storage'),
        );
        return storage;
      },
    );
    const manager = new WorkspaceContextManager(root, proxy);
    await manager.createWorkspace(workspaceA);
    const storageA = proxy.getStorageForWorkspace(
      path.resolve(workspaceA),
    ) as ControlledStorage;
    storageA.markReady();
    await manager.switchWorkspace(workspaceA);
    await proxy.update('owner', 'a');

    await manager.createWorkspace(workspaceB);
    const storageB = proxy.getStorageForWorkspace(
      path.resolve(workspaceB),
    ) as ControlledStorage;
    const switching = manager.switchWorkspace(workspaceB);
    await Promise.resolve();

    expect(manager.getActiveWorkspacePath()).toBe(path.resolve(workspaceA));
    await proxy.update('during-switch', 'a-only');
    expect(storageA.get('during-switch')).toBe('a-only');
    expect(() => storageB.get('during-switch')).toThrow(
      StateStorageNotReadyError,
    );

    storageB.markReady();
    await switching;
    expect(manager.getActiveWorkspacePath()).toBe(path.resolve(workspaceB));
    expect(proxy.get('owner')).toBeUndefined();
  });

  it('disposes a worker-backed delegate when its workspace is removed', () => {
    const dispose = jest.fn();
    const proxy = new WorkspaceAwareStateStorage('/default', (storagePath) => {
      const storage = new ControlledStorage(true) as ControlledStorage & {
        dispose?: () => void;
      };
      if (storagePath === '/worker-storage') storage.dispose = dispose;
      return storage;
    });
    proxy.addWorkspace('/workspace', '/worker-storage');

    proxy.removeWorkspace('/workspace');

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('forwards splitArrayValue to the active workspace delegate when maintenance is supported', async () => {
    const mockReceipt: StateStorageMigrationReceipt = {
      sourceKey: 'records',
      sourceSha256: 'abc',
      itemCount: 1,
      extractedValueCount: 1,
      retainedSourceCount: 0,
      committedGeneration: 2,
      commitId: 'commit-1',
    };
    const splitFn = jest.fn().mockResolvedValue(mockReceipt);
    const proxy = new WorkspaceAwareStateStorage('/default', (storagePath) => {
      const storage = new ControlledStorage(true) as ControlledStorage &
        Partial<IStateStorageMaintenance>;
      if (storagePath === '/maintenance-storage') {
        storage.splitArrayValue = splitFn;
      }
      return storage;
    });

    expect(hasStateStorageMaintenance(proxy)).toBe(true);

    proxy.addWorkspace('/workspace-m', '/maintenance-storage');
    proxy.setActiveWorkspace('/workspace-m');

    const plan: StateStorageArraySplitPlan = {
      kind: 'split-array-value',
      planVersion: 1,
      sourceKey: 'records',
      itemIdPath: ['id'],
      detailKeyPrefix: 'detail:',
      indexKey: 'records',
      indexSchemaVersion: 1,
      summaryFields: [{ sourcePath: ['id'] }],
    };

    const receipt = await proxy.splitArrayValue(plan);
    expect(receipt).toEqual(mockReceipt);
    expect(splitFn).toHaveBeenCalledWith(plan);
  });

  it('throws when the active delegate does not support maintenance operations', async () => {
    const proxy = new WorkspaceAwareStateStorage('/default', () => {
      return new ControlledStorage(true);
    });

    const plan: StateStorageArraySplitPlan = {
      kind: 'split-array-value',
      planVersion: 1,
      sourceKey: 'records',
      itemIdPath: ['id'],
      detailKeyPrefix: 'detail:',
      indexKey: 'records',
      indexSchemaVersion: 1,
      summaryFields: [{ sourcePath: ['id'] }],
    };

    await expect(proxy.splitArrayValue(plan)).rejects.toThrow(
      'Active workspace state storage does not support maintenance operations',
    );
  });
});
