/**
 * WorkspaceAwareStateStorage — IStateStorage proxy that delegates to
 * per-workspace IStateStorage instances based on the active workspace.
 *
 * Registered as PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, so all services that
 * inject workspace-scoped storage automatically get the active workspace's
 * storage without needing child containers.
 *
 * Key insight: RPC handler singletons inject WORKSPACE_STATE_STORAGE at
 * construction time. With child containers, they'd get the root container's
 * instance and never see workspace-specific data. This proxy solves that
 * by delegating at call-time to the active workspace's storage.
 *
 * The class is decoupled from `ElectronStateStorage` via the
 * `StateStorageFactory` type so this layer-1 library has no dependency on
 * `platform-electron` (a layer 0.5 implementation). Apps must inject a factory
 * that produces `IStateStorage` instances for a given storage directory.
 */

import {
  StateStorageNotReadyError,
  hasStateStorageMaintenance,
  hasStateStorageReadiness,
  isAsyncStateStorage,
  type IAsyncStateStorage,
  type IStateStorage,
  type IStateStorageMaintenance,
  type IStateStorageReadiness,
  type StateStorageArraySplitPlan,
  type StateStorageMigrationReceipt,
  type StateStorageReadinessState,
  type StateStorageSequencePage,
  type StateStorageSequenceReadOptions,
  type StateStorageSequenceWriteChunk,
} from '@ptah-extension/platform-core';

/**
 * Factory that produces an `IStateStorage` instance for a given storage
 * directory path. Implementations decide the on-disk format (e.g. Electron
 * uses `ElectronStateStorage` with `workspace-state.json`; CLI uses
 * `CliStateStorage`).
 */
export type StateStorageFactory = (storageDirPath: string) => IStateStorage;

interface DisposableStateStorage {
  dispose(): void | Promise<void>;
}

function hasStateStorageDisposal(
  storage: IStateStorage,
): storage is IStateStorage & DisposableStateStorage {
  return (
    typeof (storage as Partial<DisposableStateStorage>).dispose === 'function'
  );
}

export class WorkspaceAwareStateStorage
  implements
    IAsyncStateStorage,
    IStateStorageReadiness,
    IStateStorageMaintenance
{
  private readonly workspaces = new Map<string, IStateStorage>();
  private activeWorkspacePath: string | null = null;
  private readonly defaultStorage: IStateStorage;

  constructor(
    defaultStoragePath: string,
    private readonly storageFactory: StateStorageFactory,
  ) {
    this.defaultStorage = storageFactory(defaultStoragePath);
  }

  /**
   * Add a workspace with its own IStateStorage instance.
   * If the workspace already exists, this is a no-op.
   */
  addWorkspace(workspacePath: string, storageDirPath: string): void {
    if (this.workspaces.has(workspacePath)) {
      return;
    }
    this.workspaces.set(workspacePath, this.storageFactory(storageDirPath));
  }

  /**
   * Remove a workspace's storage instance, allowing it to be garbage collected.
   * If the removed workspace was active, resets to null (falls back to default).
   */
  removeWorkspace(workspacePath: string): void {
    const storage = this.workspaces.get(workspacePath);
    this.workspaces.delete(workspacePath);
    if (storage && hasStateStorageDisposal(storage)) {
      void Promise.resolve(storage.dispose()).catch(() => undefined);
    }
    if (this.activeWorkspacePath === workspacePath) {
      this.activeWorkspacePath = null;
    }
  }

  /**
   * Switch the active workspace. All subsequent get/update/keys calls
   * will delegate to this workspace's storage.
   */
  setActiveWorkspace(workspacePath: string): void {
    const storage = this.workspaces.get(workspacePath);
    if (!storage) {
      throw new Error(
        `Cannot set active workspace: no storage registered for "${workspacePath}". Call addWorkspace() first.`,
      );
    }
    if (
      hasStateStorageReadiness(storage) &&
      storage.getReadinessState().status !== 'ready'
    ) {
      throw new StateStorageNotReadyError(
        `Workspace state storage is not ready for "${workspacePath}"`,
      );
    }
    this.activeWorkspacePath = workspacePath;
  }

  /** Await a registered delegate without changing the currently active one. */
  async whenWorkspaceReady(workspacePath: string): Promise<void> {
    const storage = this.workspaces.get(workspacePath);
    if (!storage) {
      throw new Error(`No state storage is registered for "${workspacePath}"`);
    }
    if (hasStateStorageReadiness(storage)) await storage.whenReady();
  }

  /**
   * Get the currently active workspace path, or null if none is set.
   */
  getActiveWorkspacePath(): string | null {
    return this.activeWorkspacePath;
  }

  /**
   * Get all registered workspace paths.
   */
  getAllWorkspacePaths(): string[] {
    return Array.from(this.workspaces.keys());
  }

  /**
   * Get a value from the active workspace's storage.
   * Falls back to default storage if no workspace is active.
   */
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.getActiveStorage().get<T>(key, defaultValue);
  }

  /**
   * Update a value in the active workspace's storage.
   * Falls back to default storage if no workspace is active.
   */
  async update(key: string, value: unknown): Promise<void> {
    await this.getActiveStorage().update(key, value);
  }

  async getAsync<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    const storage = this.getActiveStorage();
    return isAsyncStateStorage(storage)
      ? await storage.getAsync(key, defaultValue)
      : storage.get(key, defaultValue);
  }

  async *readJsonSequence<T>(
    key: string,
    options?: StateStorageSequenceReadOptions,
  ): AsyncIterable<StateStorageSequencePage<T>> {
    const storage = this.getActiveStorage();
    if (isAsyncStateStorage(storage)) {
      yield* storage.readJsonSequence<T>(key, options);
      return;
    }
    const value = storage.get<T[]>(key, []);
    yield {
      items: value ?? [],
      nextCursor: null,
      done: true,
      approximateBytes: 0,
    };
  }

  async replaceJsonSequence<T>(
    key: string,
    chunks: AsyncIterable<StateStorageSequenceWriteChunk<T>>,
  ): Promise<void> {
    const storage = this.getActiveStorage();
    if (isAsyncStateStorage(storage)) {
      await storage.replaceJsonSequence(key, chunks);
      return;
    }
    const items: T[] = [];
    for await (const chunk of chunks) items.push(...chunk.items);
    await storage.update(key, items);
  }

  getReadinessState(): StateStorageReadinessState {
    const storage = this.getActiveStorage();
    return hasStateStorageReadiness(storage)
      ? storage.getReadinessState()
      : { status: 'ready' };
  }

  async whenReady(): Promise<void> {
    const storage = this.getActiveStorage();
    if (hasStateStorageReadiness(storage)) await storage.whenReady();
  }

  async splitArrayValue(
    plan: StateStorageArraySplitPlan,
  ): Promise<StateStorageMigrationReceipt> {
    const storage = this.getActiveStorage();
    if (hasStateStorageMaintenance(storage)) {
      return await storage.splitArrayValue(plan);
    }
    throw new Error(
      'Active workspace state storage does not support maintenance operations',
    );
  }

  /**
   * Get all keys from the active workspace's storage.
   * Falls back to default storage if no workspace is active.
   */
  keys(): readonly string[] {
    return this.getActiveStorage().keys();
  }

  /**
   * Get the storage instance for a specific workspace path.
   * Returns undefined if no storage is registered for that path.
   */
  getStorageForWorkspace(workspacePath: string): IStateStorage | undefined {
    return this.workspaces.get(workspacePath);
  }

  /**
   * Resolve the active storage delegate.
   * Returns the active workspace's storage if set, otherwise the default.
   */
  private getActiveStorage(): IStateStorage {
    if (this.activeWorkspacePath) {
      const storage = this.workspaces.get(this.activeWorkspacePath);
      if (storage) {
        return storage;
      }
      throw new Error(
        `Active workspace "${this.activeWorkspacePath}" has no registered storage`,
      );
    }
    return this.defaultStorage;
  }
}
